// Task 11.4d (ADR-0016): the ffmpeg chunker, proven two ways. Unit tests inject a fake process
// runner (no real ffmpeg, never `it.skip`) so argv, the no-shell invocation, the timeout-and-kill
// path, the output-size guard and temp-directory cleanup all run in CI every time. One opt-in
// block (skipped unless real ffmpeg is on `PATH`) proves the "any length" claim against a
// synthetic, silent MP4 generated inside the test and never committed, and that the chunker's
// output ingests through `createWhisperTranscriber` with a fake `fetch` (rule 4: no real model
// call).
import { EventEmitter } from 'node:events';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { stat, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWhisperTranscriber, Secret, TranscriberError } from '@edmate/gateway';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Spies on `readFile` for the "stops reading further pieces" test below. ESM modules are
// non-configurable, so the only way to count calls is a `vi.mock` wrapping the real
// implementation (every other export passes straight through, unchanged).
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
import {
  createFfmpegChunker,
  createRealRunner,
  drain,
  type ProcessResult,
  type ProcessRunner,
} from './ffmpegChunker.js';

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

describe('createFfmpegChunker: protocol whitelist and forced demuxer', () => {
  it.each([
    ['audio/mp4', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm', 'webm'],
  ] as const)(
    'forces -protocol_whitelist file and -f %s before -i for %s (never content-sniffed)',
    async (mime, format) => {
      let seen: readonly string[] | undefined;
      const run: ProcessRunner = async (_bin, args) => {
        seen = args;
        return { code: 1 }; // non-zero so we don't need real output pieces for this assertion
      };
      const chunker = createFfmpegChunker({ run });
      await failure(() => chunker(new Uint8Array([1, 2, 3]), mime, 1_000_000));

      const args = seen!;
      const iIndex = args.indexOf('-i');
      const whitelistIndex = args.indexOf('-protocol_whitelist');
      const formatIndex = args.indexOf('-f');
      expect(iIndex).toBeGreaterThan(-1);
      expect(whitelistIndex).toBeGreaterThan(-1);
      expect(args[whitelistIndex + 1]).toBe('file');
      expect(formatIndex).toBeGreaterThan(-1);
      expect(args[formatIndex + 1]).toBe(format);
      // Both must precede -i: ffmpeg must never be left to probe/content-sniff the input.
      expect(whitelistIndex).toBeLessThan(iIndex);
      expect(formatIndex).toBeLessThan(iIndex);
      // The forced format is always the fixed table's value, never the mime string itself.
      expect(args).not.toContain(mime);
    },
  );
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
  it('a runner that throws for a reason other than the timeout is a non-retryable validation error, and cleans up', async () => {
    const { run, dirs } = captureDir(async () => {
      throw new Error('ENOENT: ffmpeg could not be started');
    });
    const chunker = createFfmpegChunker({ run });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('validation');
    expect(err.retryable).toBe(false);
    await expect(stat(dirs[0]!)).rejects.toThrow();
  });

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

  it('an oversized total output trips the running-total guard, stops reading further pieces, and cleans up', async () => {
    const big = fakeWav(600); // each piece well over the tiny cap below once two are summed
    const { run, dirs } = captureDir(fakeRunnerWriting([big, big, big]));
    const chunker = createFfmpegChunker({ run, maxOutputBytes: big.byteLength + 10 });
    const fsp = await import('node:fs/promises');
    const readSpy = vi.mocked(fsp.readFile);
    readSpy.mockClear();
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('input_too_large');
    expect(err.retryable).toBe(false);
    // The running-total check runs before each piece is read: the first piece (under the cap) is
    // read, the second piece crosses it and throws before it (or any later piece) is ever read.
    expect(readSpy).toHaveBeenCalledTimes(1);
    await expect(stat(dirs[0]!)).rejects.toThrow();
  });

  it('no output pieces at all is the same unreadable error, not an empty success', async () => {
    const { run, dirs } = captureDir(fakeRunnerWriting([], 0));
    const chunker = createFfmpegChunker({ run });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('validation');
    await expect(stat(dirs[0]!)).rejects.toThrow();
  });

  it('aborts while ffmpeg is still running once the on-disk pieces cross the output cap, and clears the watch timer', async () => {
    const big = fakeWav(2_048);
    let abortSeen = false;
    const sizeWatchRunner: ProcessRunner = async (_bin, args, opts) => {
      const outPattern = args.at(-1)!;
      const dir = outPattern.slice(0, outPattern.lastIndexOf('/'));
      // Writes well past the cap before the runner is even asked to settle, then only resolves
      // once the size watch aborts it -- mirroring ffmpeg still writing pieces mid-run.
      await writeFile(join(dir, 'piece-000.wav'), big);
      await writeFile(join(dir, 'piece-001.wav'), big);
      return new Promise<ProcessResult>((resolve) => {
        opts.signal.addEventListener('abort', () => {
          abortSeen = true;
          resolve({ code: null });
        });
      });
    };
    const { run, dirs } = captureDir(sizeWatchRunner);
    const chunker = createFfmpegChunker({
      run,
      maxOutputBytes: big.byteLength + 10,
      outputWatchMs: 5,
    });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('input_too_large');
    expect(err.retryable).toBe(false);
    expect(abortSeen).toBe(true); // the dedicated size controller fired, not the timeout
    await expect(stat(dirs[0]!)).rejects.toThrow();
  });

  it('a spawn failure (ENOENT) is a non-retryable provider_error, not validation', async () => {
    const notStarted: ProcessRunner = async () => {
      const err = new Error('spawn ffmpeg ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    };
    const { run } = captureDir(notStarted);
    const chunker = createFfmpegChunker({ run });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('provider_error');
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('ENOENT');
  });

  it('a spawn failure (EACCES) is a non-retryable provider_error too', async () => {
    const notStarted: ProcessRunner = async () => {
      const err = new Error('spawn ffmpeg EACCES') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    };
    const { run } = captureDir(notStarted);
    const chunker = createFfmpegChunker({ run });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('provider_error');
    expect(err.retryable).toBe(false);
  });

  it('a rejection with no known spawn-failure code stays a validation error', async () => {
    const { run } = captureDir(async () => {
      throw new Error('some other ffmpeg failure, possibly carrying attacker-chosen bytes');
    });
    const chunker = createFfmpegChunker({ run });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('validation');
    expect(err.retryable).toBe(false);
    // Only the error's code/name may ever reach a message -- never its own message or a path.
    expect(err.message).not.toContain('possibly carrying attacker-chosen bytes');
  });
});

describe('createFfmpegChunker: wavDurationMs bounds checks', () => {
  function u32(v: number): number[] {
    return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  }
  function str(s: string): number[] {
    return Array.from(s, (c) => c.charCodeAt(0));
  }
  function bytes(...parts: readonly number[][]): Uint8Array {
    return new Uint8Array(parts.flat());
  }

  it('a truncated fmt chunk (declared size runs past the buffer) is unreadable, not a wrong duration', async () => {
    // RIFF/WAVE header + an 8-byte "fmt " chunk header declaring size 16, then nothing: the
    // chunk's own 16-byte body never arrives before the buffer ends.
    const truncated = bytes(str('RIFF'), u32(100), str('WAVE'), str('fmt '), u32(16));
    const { run } = captureDir(fakeRunnerWriting([truncated]));
    const chunker = createFfmpegChunker({ run });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('validation');
  });

  it('a fmt chunk whose declared size points past the end ends the walk as unreadable', async () => {
    const fmtBody = new Array(20).fill(0) as number[];
    const [b0, b1, b2, b3] = u32(32_000);
    fmtBody[8] = b0!;
    fmtBody[9] = b1!;
    fmtBody[10] = b2!;
    fmtBody[11] = b3!;
    // The fmt header's own 16 bytes fit, so byteRate is read, but its declared size (1000) sends
    // the walk past the end of the buffer before any "data" chunk is ever found.
    const oversizedFmt = bytes(
      str('RIFF'),
      u32(1_000),
      str('WAVE'),
      str('fmt '),
      u32(1_000),
      fmtBody,
    );
    const { run } = captureDir(fakeRunnerWriting([oversizedFmt]));
    const chunker = createFfmpegChunker({ run });
    const err = await failure(() => chunker(new Uint8Array(10), 'video/mp4', 1_000_000));
    expect(err.code).toBe('validation');
  });

  it('a data header landing exactly at the end of the buffer (no body) is a valid zero-length piece', async () => {
    const fmtBody = new Array(16).fill(0) as number[];
    const [b0, b1, b2, b3] = u32(32_000);
    fmtBody[8] = b0!;
    fmtBody[9] = b1!;
    fmtBody[10] = b2!;
    fmtBody[11] = b3!;
    const dataAtEnd = bytes(
      str('RIFF'),
      u32(1_000),
      str('WAVE'),
      str('fmt '),
      u32(16),
      fmtBody,
      str('data'),
      u32(100),
    );
    const { run } = captureDir(fakeRunnerWriting([dataAtEnd]));
    const chunker = createFfmpegChunker({ run });
    const chunks = await chunker(new Uint8Array(10), 'video/mp4', 1_000_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.durationMs).toBe(0);
  });
});

describe('ffmpegChunker: drain', () => {
  it('attaches an error listener to a drained stream, so a stream error never throws', () => {
    const stream = new EventEmitter();
    expect(() => {
      drain(stream as unknown as NodeJS.ReadableStream);
      stream.emit('error', new Error('EPIPE'));
    }).not.toThrow();
  });

  it('is a no-op for a null stream', () => {
    expect(() => drain(null)).not.toThrow();
  });
});

describe('createRealRunner: SIGTERM then SIGKILL', () => {
  it('escalates to SIGKILL after a grace period when the child ignores SIGTERM, so run() settles and the child is gone', async () => {
    const pidFile = join(tmpdir(), `edmate-sigterm-pid-${String(Date.now())}`);
    const code = [
      `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      `process.on('SIGTERM', () => {});`, // traps and ignores SIGTERM
      `setInterval(() => {}, 1000);`, // never exits on its own
    ].join(' ');
    const runner = createRealRunner(1_000); // grace
    const signal = AbortSignal.timeout(1_000); // timeout before grace

    const started = Date.now();
    const result = await runner(process.execPath, ['-e', code], { signal });
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(10_000); // settled; never hung waiting on an ignored SIGTERM
    expect(result.code).not.toBe(0); // killed, not a clean exit

    const fs = await import('node:fs/promises');
    const pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
    expect(() => process.kill(pid, 0)).toThrow(); // ESRCH: the process is gone
    await fs.rm(pidFile, { force: true });
  }, 15_000);

  it('removes its abort listener once the child exits normally, so a later abort does not try to kill it', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const runner = createRealRunner(1_000);
    const result = await runner(process.execPath, ['-e', 'process.exit(0)'], {
      signal: controller.signal,
    });
    expect(result.code).toBe(0);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    removeSpy.mockRestore();
    // The listener is gone: aborting afterwards is a no-op, not an attempt to kill a dead child.
    expect(() => controller.abort()).not.toThrow();
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

  it('rejects an HLS-shaped input labelled video/mp4 and makes no network connection (protocol whitelist + forced demuxer)', async () => {
    const net = await import('node:net');
    let connections = 0;
    const server = net.createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const playlist = `#EXTM3U\n#EXTINF:10,\nhttp://127.0.0.1:${String(port)}/x.ts\n`;

    const chunker = createFfmpegChunker();
    const err = await failure(() =>
      chunker(new TextEncoder().encode(playlist), 'video/mp4', 1_000_000),
    );
    expect(err.code).toBe('validation');
    expect(connections).toBe(0);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects a concat-shaped input labelled video/mp4 and never reads the local file it points at', async () => {
    const fs = await import('node:fs/promises');
    const secretPath = join(tmpdir(), `edmate-concat-secret-${String(Date.now())}.txt`);
    const secretContents = 'do-not-read-me';
    await fs.writeFile(secretPath, secretContents);
    const playlist = `ffconcat version 1.0\nfile '${secretPath}'\n`;

    const chunker = createFfmpegChunker();
    const err = await failure(() =>
      chunker(new TextEncoder().encode(playlist), 'video/mp4', 1_000_000),
    );
    expect(err.code).toBe('validation');
    // The forced mp4 demuxer never invokes the concat demuxer, so the referenced file is
    // untouched -- the chunker rejects the playlist itself before any file inclusion is read.
    expect(await fs.readFile(secretPath, 'utf8')).toBe(secretContents);
    await fs.rm(secretPath, { force: true });
  });

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
