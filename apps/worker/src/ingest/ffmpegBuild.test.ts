// Task 11.4l (ADR-0016 Decision 8): a static contract between apps/worker/Dockerfile and the
// chunker. The worker image builds its own LGPL-only ffmpeg; this test fails if the version or
// sha256 pin, the checksum step, the LGPL-only configure flags or the image's own licence check
// drift, or if the build stops enabling a component the chunker's argv needs. It never runs
// docker or a real ffmpeg: the lead rebuilds the image and checks the licence banner at review.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TranscriberError } from '@edmate/gateway';
import { describe, expect, it } from 'vitest';
import { createFfmpegChunker, type ProcessRunner } from './ffmpegChunker.js';

/** The Dockerfile with every comment line dropped: the comments mention `--enable-gpl` on purpose
 * and must neither trip nor satisfy a check. */
const DOCKERFILE = readFileSync(fileURLToPath(new URL('../../Dockerfile', import.meta.url)), 'utf8')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

/** The text of the stage `FROM … AS <name>`, up to the next `FROM` (empty if there is none). */
function stage(name: string): string {
  const lines = DOCKERFILE.split('\n');
  const start = lines.findIndex((l) =>
    new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`, 'i').test(l),
  );
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^FROM\s/i.test(l));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n');
}

/** The `./configure` flags in the `ffmpeg` stage, as `--name` or `--name=value` tokens. */
function configureTokens(): string[] {
  const text = stage('ffmpeg');
  const at = text.indexOf('./configure');
  if (at === -1) return [];
  const end = text.indexOf('make -j', at);
  const body = text.slice(at + './configure'.length, end === -1 ? undefined : end);
  return body
    .replace(/\\\n/g, ' ')
    .replace(/;/g, ' ')
    .split(/\s+/)
    .filter((t) => t.startsWith('--'));
}

type Kind = 'protocol' | 'demuxer' | 'decoder' | 'parser' | 'encoder' | 'muxer' | 'filter';

/** Every component of `kind` the configure line enables, e.g. `--enable-decoder=aac,opus`. */
function enabled(kind: Kind): Set<string> {
  const prefix = `--enable-${kind}=`;
  const names = configureTokens()
    .filter((t) => t.startsWith(prefix))
    .flatMap((t) => t.slice(prefix.length).split(','));
  return new Set(names.filter((n) => n.length > 0));
}

/** ffmpeg's `-f` input format name → the demuxer that `--enable-demuxer` must name. */
const DEMUXER_FOR_FORMAT: Readonly<Record<string, string>> = { mp4: 'mov', webm: 'matroska' };

/** The argv the chunker passes to ffmpeg for `mimeType`, captured by a fake runner. */
async function chunkerArgv(mimeType: string): Promise<readonly string[]> {
  let captured: readonly string[] = [];
  const run: ProcessRunner = (_bin, args) => {
    captured = args;
    return Promise.resolve({ code: 1 });
  };
  const chunk = createFfmpegChunker({ run });
  await expect(chunk(new Uint8Array([0, 1, 2, 3]), mimeType, 1_000_000)).rejects.toSatisfy(
    (err: unknown) => err instanceof TranscriberError && err.code === 'validation',
  );
  return captured;
}

/** The value after the first occurrence of `flag` at or after `from`. */
function valueAfter(argv: readonly string[], flag: string, from = 0): string | undefined {
  const at = argv.indexOf(flag, from);
  return at === -1 ? undefined : argv[at + 1];
}

describe('worker Dockerfile ffmpeg build (ADR-0016 Decision 8)', () => {
  it('the runtime stage installs no distro ffmpeg', () => {
    // Join backslash-continued lines first, so `apk add \` with `ffmpeg` on the next line is
    // caught; then take each `apk add` command up to the next `;`, `&&` or `||`.
    const logical = DOCKERFILE.replace(/\\\n/g, ' ');
    const apkCommands = [...logical.matchAll(/apk\s+add\b[^;&|\n]*/g)].map((m) => m[0]);
    expect(
      apkCommands.length,
      'the ffmpeg build stage installs its tools with apk',
    ).toBeGreaterThan(0);
    expect(apkCommands.filter((c) => /\bffmpeg\b/.test(c))).toEqual([]);
  });

  it('ffmpeg is fetched at a pinned version over https and checked against a pinned sha256', () => {
    const text = stage('ffmpeg');
    const version = /FFMPEG_VERSION='([^']*)'/.exec(text)?.[1];
    const sha = /FFMPEG_SHA256='([^']*)'/.exec(text)?.[1];
    expect(version).toMatch(/^7\.1\.\d+$/);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(sha).size, 'the sha256 is a placeholder').toBeGreaterThan(1);
    const url = text.indexOf('"https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"');
    expect(url).toBeGreaterThan(-1);
    // Anchor on the download command itself: a bare 'curl ' also matches the `apk add … curl …`
    // line that installs the tool.
    const curl = text.indexOf('curl -fsSL');
    const check = text.indexOf('sha256sum -c');
    const untar = text.indexOf('tar -x');
    expect(curl).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(curl);
    expect(untar).toBeGreaterThan(check);
  });

  it('configure is LGPL-only with no external library', () => {
    const tokens = configureTokens();
    expect(tokens).toEqual(
      expect.arrayContaining(['--disable-everything', '--disable-autodetect', '--disable-network']),
    );
    expect(tokens.filter((t) => /^--enable-(gpl|nonfree|version3|lib)/.test(t))).toEqual([]);
  });

  it("the build enables every component the chunker's argv needs", async () => {
    for (const mime of ['audio/mp4', 'video/mp4', 'video/webm']) {
      const argv = await chunkerArgv(mime);
      const input = argv.indexOf('-i');
      expect(input, mime).toBeGreaterThan(-1);
      const format = valueAfter(argv.slice(0, input), '-f');
      const demuxer = format === undefined ? undefined : DEMUXER_FOR_FORMAT[format];
      expect(
        demuxer,
        `-f ${String(format)}: add its demuxer to the Dockerfile and to DEMUXER_FOR_FORMAT`,
      ).toBeDefined();
      expect(enabled('demuxer').has(demuxer!), `${mime}: demuxer ${demuxer!}`).toBe(true);
      expect(enabled('encoder').has(valueAfter(argv, '-c:a')!), `${mime}: encoder`).toBe(true);
      expect(enabled('muxer').has(valueAfter(argv, '-f', input)!), `${mime}: muxer`).toBe(true);
      expect(enabled('muxer').has(valueAfter(argv, '-segment_format')!), `${mime}: wav`).toBe(true);
      expect(enabled('protocol').has(valueAfter(argv, '-protocol_whitelist')!), mime).toBe(true);
    }
    for (const decoder of ['aac', 'opus', 'vorbis']) {
      expect(enabled('decoder').has(decoder), `decoder ${decoder}`).toBe(true);
    }
    expect(enabled('filter').has('aresample')).toBe(true);
  });

  it('the image build fails closed on a GPL or incomplete ffmpeg', () => {
    const text = stage('ffmpeg');
    // `ffmpeg -L` wraps "GNU Lesser General Public\nLicense" across two lines, so the banner must
    // be joined into one line before it is grepped, or a correct LGPL build fails the image build.
    expect(text).toContain("./ffmpeg -hide_banner -L | tr '\\n' ' ' > /tmp/licence.txt");
    expect(text).toContain('GNU Lesser General Public License');
    expect(text).toMatch(
      /if grep -Eq -e '--enable-\(gpl\|nonfree\|version3\|lib\)' [^;]+; then [^;]*; exit 1; fi/,
    );
    expect(text.split('\n').filter((l) => /^\s*!\s*grep/.test(l))).toEqual([]);
  });

  it('runtime copies the built binary onto PATH with its licence', () => {
    const lines = stage('runtime').split('\n');
    const binary = lines.findIndex((l) =>
      /^COPY --from=ffmpeg \S+ \/usr\/local\/bin\/ffmpeg$/.test(l),
    );
    const licence = lines.findIndex((l) => /^COPY --from=ffmpeg .*COPYING\.LGPLv2\.1/.test(l));
    const user = lines.findIndex((l) => /^USER node$/.test(l));
    expect(binary).toBeGreaterThan(-1);
    expect(licence).toBeGreaterThan(-1);
    expect(user).toBeGreaterThan(Math.max(binary, licence));
  });
});
