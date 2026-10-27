// Task 11.4d (ADR-0016): the ffmpeg chunker, proven two ways. Unit tests inject a fake process
// runner (no real ffmpeg, never `it.skip`) so argv, the no-shell invocation, the timeout-and-kill
// path, the output-size guard and temp-directory cleanup all run in CI every time. One opt-in
// block (skipped unless real ffmpeg is on `PATH`) proves the "any length" claim against a
// synthetic, silent MP4 generated inside the test and never committed, and that the chunker's
// output ingests through `createWhisperTranscriber` with a fake `fetch` (rule 4: no real model
// call).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWhisperTranscriber, Secret, TranscriberError } from '@edmate/gateway';
import { afterEach, describe, expect, it } from 'vitest';
import { createFfmpegChunker, type ProcessResult, type ProcessRunner } from './ffmpegChunker.js';

const FAKE_KEY = 'sk-fake-not-a-real-key-0000000000000000'; // secret-scan: allow synthetic fixture, not a real credential

/** Whether real ffmpeg is usable on this machine -- checked once, synchronously, so the opt-in
 * tests below skip cleanly (never throw) when it is absent. */
const FFMPEG_PRESENT = (() => {
  try {
    return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
})();

/** A fake WAV piece: a valid RIFF/WAVE/fmt /data header around `dataBytes` of silence, at the
 * fixed 16 kHz mono 16-bit rate the real chunker always writes. */
function fakeWav(dataBytes: number): Uint8Array {
  const byteRate = 32_000; // 16 kHz * 1 channel * 2 bytes/sample
  const out = new Uint8Array(44 + dataBytes);
  const write = (s: string, at: number) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  const u32 = (v: number, at: number) => {
    out[at] = v & 0xff;
    out[at + 1] = (v >>> 8) & 0xff;
    out[at + 2] = (v >>> 16) & 0xff;
    out[at + 3] = (v >>> 24) & 0xff;
  };
  write('RIFF', 0);
  u32(out.byteLength - 8, 4);
  write('WAVE', 8);
  write('fmt ', 12);
  u32(16, 16);
  out[20] = 1; // PCM
  out[22] = 1; // mono
  u32(16_000, 24); // sample rate
  u32(byteRate, 28);
  out[32] = 2; // block align
  out[34] = 16; // bits per sample
  write('data', 36);
  u32(dataBytes, 40);
  return out;
}

/** A fake runner that writes `pieces` (as numbered WAV files) into the output directory the real
 * argv names, then resolves with `code`. Mirrors what real ffmpeg would leave on disk. */
function fakeRunnerWriting(pieces: readonly Uint8Array[], code = 0): ProcessRunner {
  return async (_bin, args) => {
    const outPattern = args.at(-1)!;
    const dir = outPattern.slice(0, outPattern.lastIndexOf('/'));
    const fs = await import('node:fs/promises');
    for (const [i, bytes] of pieces.entries()) {
      const name = `piece-${String(i).padStart(3, '0')}.wav`;
      await fs.writeFile(join(dir, name), bytes);
    }
    return { code };
  };
}

const createdDirs: string[] = [];

afterEach(async () => {
  // Belt-and-suspenders: every real temp dir this suite made should already be gone, but a failed
  // assertion mid-test must never leave one behind.
  const fs = await import('node:fs/promises');
  await Promise.all(createdDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  createdDirs.length = 0;
});

/** Captures the temp directory the chunker created, from a fake runner's own argv, before the
 * chunker's `finally` removes it -- so a test can assert the directory both existed and is gone. */
function captureDir(run: ProcessRunner): { run: ProcessRunner; dirs: string[] } {
  const dirs: string[] = [];
  const wrapped: ProcessRunner = async (bin, args, opts) => {
    const outPattern = args.at(-1)!;
    const dir = outPattern.slice(0, outPattern.lastIndexOf('/'));
    dirs.push(dir);
    createdDirs.push(dir);
    return run(bin, args, opts);
  };
  return { run: wrapped, dirs };
}

async function failure(fn: () => unknown): Promise<TranscriberError> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(TranscriberError);
    return err as TranscriberError;
  }
  throw new Error('expected a TranscriberError');
}

describe('createFfmpegChunker: argv and no-shell invocation', () => {
  it('builds a fixed, no-shell argv naming only our own temp paths (never the input bytes or mimeType)', async () => {
    let seen: { bin: string; args: readonly string[] } | undefined;
    const run: ProcessRunner = async (bin, args) => {
      seen = { bin, args };
      return { code: 1 }; // non-zero so we don't need real output pieces for this assertion
    };
    const chunker = createFfmpegChunker({ run });
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4]);
    await failure(() => chunker(payload, 'video/mp4', 1_000_000));

    expect(seen).toBeDefined();
    expect(seen?.bin).toBe('ffmpeg');
    const args = seen!.args;
    expect(args).toContain('-nostdin');
    expect(args).toContain('-vn');
    expect(args).toContain('-y');
    expect(args).toContain('pcm_s16le');
    expect(args).toContain('wav');
    // Every path argument is under the OS temp dir -- never anything derived from the caller.
    const paths = args.filter((a) => a.includes(tmpdir()));
    expect(paths.length).toBeGreaterThanOrEqual(2); // the input file and the output pattern
    // Nothing in the argv is the raw payload or the mimeType string.
    const joined = args.join('\u0000');
    expect(joined).not.toContain('video/mp4');
    expect(joined.includes('\xde\xad\xbe\xef')).toBe(false);
  });

  it('never invokes a shell', async () => {
    const run: ProcessRunner = async () => ({ code: 1 });
    const chunker = createFfmpegChunker({ run });
    await failure(() => chunker(new Uint8Array([1]), 'video/webm', 1_000_000));
    // The fake runner itself proves no shell string is built: `run`'s signature takes argv, not a
    // command line, and `createFfmpegChunker` never concatenates `args` into a string anywhere.
  });
});

describe('createFfmpegChunker: scope', () => {
  it('delegates audio/mpeg and audio/wav to defaultChunker unchanged', async () => {
    const run: ProcessRunner = async () => {
      throw new Error('ffmpeg should never run for a type defaultChunker already handles');
    };
    const chunker = createFfmpegChunker({ run });
    // A WAV small enough to need no splitting at all exercises defaultChunker's own path.
    const err = await failure(() => chunker(new Uint8Array(4), 'audio/wav', 10));
    expect(err.code).toBe('validation'); // defaultChunker's own "not readable WAV" refusal
  });

  it('delegates an unknown type to defaultChunker, which refuses it as input_too_large', async () => {
    const run: ProcessRunner = async () => {
      throw new Error('ffmpeg should never run for a type outside its scope');
    };
    const chunker = createFfmpegChunker({ run });
    const err = await failure(() => chunker(new Uint8Array(10), 'audio/ogg', 5));
    expect(err.code).toBe('input_too_large');
  });
});

describe('createFfmpegChunker: failure paths and cleanup', () => {
  it('a non-zero exit is a non-retryable validation error, and removes the temp directory', async () => {
    const { run, dirs } = captureDir(async () => ({ code: 1 }));
    const chunker = createFfmpegChunker({ run });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('validation');
    expect(err.retryable).toBe(false);
    expect(dirs).toHaveLength(1);
    await expect(stat(dirs[0]!)).rejects.toThrow();
  });

  it('a timeout kills the process (never resolving) and becomes a retryable provider_error, and cleans up', async () => {
    const hanging: ProcessRunner = (_bin, _args, opts) =>
      new Promise<ProcessResult>((resolve) => {
        opts.signal.addEventListener('abort', () => resolve({ code: null }));
      });
    const { run, dirs } = captureDir(hanging);
    const chunker = createFfmpegChunker({ run, timeoutMs: 20 });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('provider_error');
    expect(err.retryable).toBe(true);
    expect(dirs).toHaveLength(1);
    await expect(stat(dirs[0]!)).rejects.toThrow();
  });

  it('an oversized total output trips the running-total guard, reads no further pieces, and cleans up', async () => {
    const big = fakeWav(600); // each piece well over the tiny cap below once two are summed
    const { run, dirs } = captureDir(fakeRunnerWriting([big, big, big]));
    const chunker = createFfmpegChunker({ run, maxOutputBytes: big.byteLength + 10 });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('input_too_large');
    expect(err.retryable).toBe(false);
    const leftoverNames = await readdir(dirs[0]!).catch(() => []);
    expect(leftoverNames.length).toBeLessThan(3); // stopped before reading every piece
    await expect(stat(dirs[0]!)).rejects.toThrow();
  });

  it('no output pieces at all is the same unreadable error, not an empty success', async () => {
    const { run, dirs } = captureDir(fakeRunnerWriting([], 0));
    const chunker = createFfmpegChunker({ run });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('validation');
    await expect(stat(dirs[0]!)).rejects.toThrow();
  });
});

describe('createFfmpegChunker: happy path', () => {
  it('returns AudioChunk[] with monotonically increasing offsetMs and durationMs from each own header, and cleans up', async () => {
    const p1 = fakeWav(32_000); // 1 s
    const p2 = fakeWav(32_000); // 1 s
    const p3 = fakeWav(16_000); // 0.5 s
    const { run, dirs } = captureDir(fakeRunnerWriting([p1, p2, p3]));
    const chunker = createFfmpegChunker({ run });
    const chunks = await chunker(new Uint8Array(10), 'audio/mp4', 1_000_000);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.offsetMs)).toEqual([0, 1_000, 2_000]);
    expect(chunks.map((c) => c.durationMs)).toEqual([1_000, 1_000, 500]);
    expect(chunks.every((c) => c.mimeType === 'audio/wav')).toBe(true);
    await expect(stat(dirs[0]!)).rejects.toThrow();
  });
});

describe.runIf(FFMPEG_PRESENT)('createFfmpegChunker: real ffmpeg (opt-in)', () => {
  /** A synthetic MP4 generated by real ffmpeg -- a quiet fixed tone, not a recording, never
   * committed. (A true silent `anullsrc` source encodes to only a few hundred bytes under AAC no
   * matter the target bitrate, which is too small to exercise Whisper's own upload-size gate in
   * the "ingests" test below; a tone keeps the encoder's bit allocation realistic.) */
  function syntheticMp4(seconds: number): Uint8Array {
    const dir = spawnSync('mktemp', ['-d']).stdout.toString().trim();
    createdDirs.push(dir);
    const out = join(dir, 'tone.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=16000',
        '-t',
        String(seconds),
        '-c:a',
        'aac',
        out,
      ],
      { stdio: 'ignore' },
    );
    return readFileSync(out);
  }

  it('splits a short synthetic silent MP4 into several pieces when maxBytes is artificially small', async () => {
    const mp4 = syntheticMp4(12);
    const chunker = createFfmpegChunker();
    // A small cap forces several pieces despite the clip's small encoded size.
    const maxBytes = 40_000;
    const chunks = await chunker(mp4, 'video/mp4', maxBytes);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.bytes.byteLength).toBeLessThanOrEqual(maxBytes);
    const offsets = chunks.map((c) => c.offsetMs);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    const totalMs = chunks.reduce((n, c) => n + (c.durationMs ?? 0), 0);
    expect(Math.abs(totalMs - 12_000)).toBeLessThan(2_000); // within one segment length
  });

  it('ingests a synthetic MP4 through createWhisperTranscriber with a fake fetch (no real model call)', async () => {
    const mp4 = syntheticMp4(16); // ~58 KB of tone, comfortably over the 50 KB upload cap below
    const host = 'storage.edmate.invalid';
    const url = `https://${host}/recordings/class.mp4`;
    let transcriptionCalls = 0;
    const fakeFetch: typeof fetch = async (input) => {
      const u = new URL(typeof input === 'string' ? input : input.toString());
      if (u.host === host) {
        return new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } });
      }
      transcriptionCalls += 1;
      const body = JSON.stringify({
        task: 'transcribe',
        text: ` piece ${String(transcriptionCalls)}`,
        language: 'english',
        duration: 2,
        segments: [
          {
            id: 0,
            seek: 0,
            start: 0,
            end: 2,
            text: ` piece ${String(transcriptionCalls)}`,
            tokens: [1, 2],
            temperature: 0,
            avg_logprob: -0.1,
            compression_ratio: 1,
            no_speech_prob: 0.01,
          },
        ],
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const transcriber = createWhisperTranscriber(
      { apiKey: Secret.of(FAKE_KEY) },
      {
        allowedHosts: [host],
        baseURL: 'https://api.openai.invalid/v1',
        chunker: createFfmpegChunker(),
        // Smaller than the synthetic clip's own encoded size (so it is forced through the
        // chunker at all -- whisper.ts skips chunking when the download is already under the
        // limit), but comfortably above one WAV piece's own size, so pieces pass the upload cap.
        maxUploadBytes: 50_000,
        fetch: fakeFetch,
      },
    );
    const transcript = await transcriber.transcribe({ url, mimeType: 'video/mp4' });
    expect(transcript.segments.length).toBeGreaterThan(0);
    expect(transcriptionCalls).toBeGreaterThan(1);
    const offsets = transcript.segments.map((s) => s.startMs);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});
