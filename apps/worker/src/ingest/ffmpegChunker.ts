// Task 11.4d (ADR-0016): a chunker for MP4, WebM and M4A recordings, so they split for Whisper's
// upload limit the same way WAV and MP3 already do. One `ffmpeg` process per call transcodes and
// splits in one pass to 16 kHz mono 16-bit PCM WAV pieces, each with its own valid header, read
// back in filename order. WAV and MP3 (and anything else `defaultChunker` already handles or
// refuses) go straight to `defaultChunker`, unchanged.
//
// No shell: every argv entry is a literal flag or a path this module created itself
// (`fs.mkdtemp` under `os.tmpdir()`); nothing from the recording's bytes or mimeType ever reaches
// the argument list. ffmpeg's stderr is drained but never logged (it could carry attacker-chosen
// bytes from the input file's metadata) -- only a fixed message and the exit code reach any error.
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_MAX_DOWNLOAD_BYTES,
  TranscriberError,
  defaultChunker,
  type AudioChunk,
  type AudioChunker,
} from '@edmate/gateway';

/** The ffmpeg input demuxer forced per allowed mime (ADR-0016): never interpolate the mime string
 * itself into the argv -- this fixed table is the only thing that reaches `-f`. ffmpeg otherwise
 * content-sniffs the input, which lets a file shaped like an HLS or concat playlist make it fetch
 * network URLs or read local files regardless of the real container; forcing the demuxer (together
 * with `-protocol_whitelist file`, below) rejects those inputs outright as invalid data. Its keys
 * are the three types `apps/web`'s upload table names as recordings the worker can't split today
 * (ADR-0016 Decision §2); everything else goes to `defaultChunker`. */
const FFMPEG_INPUT_FORMAT: Readonly<Record<string, string>> = {
  'audio/mp4': 'mp4',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};
/** Single source of truth with `FFMPEG_INPUT_FORMAT`'s keys, so the scope check and the forced
 * demuxer lookup can never disagree. */
const FFMPEG_SCOPE = new Set(Object.keys(FFMPEG_INPUT_FORMAT));

/** 16 kHz, mono, 16-bit PCM: the fixed output format the Decision computes `segment_time` from. */
const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
const OUTPUT_BYTE_RATE = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
/** Room for each piece's own ~44-byte WAV header plus muxer slack, so pieces stay under `maxBytes`. */
const HEADER_SLACK_BYTES = 4_096;

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** How often, while ffmpeg runs, the running total of piece bytes already on disk is checked
 * against `maxOutputBytes` -- so a decompression-bomb shape is caught while ffmpeg is still
 * writing, not only after it exits. */
const DEFAULT_OUTPUT_WATCH_MS = 500;
const UNREADABLE = 'the recording could not be read by the chunker';

/** What a process run reports back; a real run never carries stdout/stderr content (never logged). */
export interface ProcessResult {
  readonly code: number | null;
}

/** Runs one process to completion (or until `opts.signal` aborts it). Tests inject a fake one,
 * mirroring how `whisper.ts` already injects `fetch`. */
export type ProcessRunner = (
  bin: string,
  args: readonly string[],
  opts: { readonly signal: AbortSignal },
) => Promise<ProcessResult>;

/** How long `realRunner` waits after an abort sends SIGTERM before escalating to SIGKILL. A
 * process that ignores SIGTERM must not hang the (concurrency-1) ingest worker forever.
 * Overridable in `ProcessRunnerOptions` for tests that want a short grace window. */
export const DEFAULT_SIGKILL_GRACE_MS = 5_000;

export function drain(stream: NodeJS.ReadableStream | null): void {
  stream?.on('data', () => {
    /* ffmpeg's stderr/stdout is drained, never read into a string: it could carry
     * attacker-chosen bytes from the input file's metadata, and must never reach a log line. */
  });
  stream?.on('error', () => {
    /* A stream error (e.g. EPIPE on a closed pipe) must not crash the worker; the child's own
     * `exit`/`error` event still settles `run()`. */
  });
}

/** `child_process.spawn`, fixed argv, no shell -- the default `ProcessRunner`. Abort handling is
 * done by this module, not by `spawn`'s own `signal` option: Node's built-in integration rejects
 * the moment the signal aborts (it sends one SIGTERM but does not wait to see whether the child
 * actually exits), which would let `run()` settle while a process that ignores SIGTERM keeps
 * running. Instead, on abort this sends SIGTERM itself and starts a grace timer that escalates to
 * SIGKILL if `exit` hasn't fired by then; the timer is cleared as soon as the process actually
 * exits, and the promise settles exactly once, only on a real `exit` (or a genuine spawn
 * failure), never on the abort itself. */
export function createRealRunner(graceMs: number): ProcessRunner {
  return (bin, args, opts) =>
    new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(bin, args, {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('ffmpeg could not be started'));
        return;
      }
      drain(child.stdout);
      drain(child.stderr);
      let settled = false;
      let graceTimer: NodeJS.Timeout | undefined;
      const clearGrace = (): void => {
        if (graceTimer !== undefined) clearTimeout(graceTimer);
        graceTimer = undefined;
      };
      const onAbort = (): void => {
        if (settled) return;
        child.kill('SIGTERM');
        graceTimer = setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, graceMs);
      };
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
      child.on('error', (err) => {
        opts.signal.removeEventListener('abort', onAbort);
        if (settled) return;
        settled = true;
        clearGrace();
        reject(err);
      });
      child.on('exit', (code) => {
        opts.signal.removeEventListener('abort', onAbort);
        if (settled) return;
        settled = true;
        clearGrace();
        resolve({ code });
      });
    });
}

function ascii(b: Uint8Array, at: number, n: number): string {
  return String.fromCharCode(...b.subarray(at, at + n));
}

function u32le(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

/** A small, local RIFF/`data`-chunk reader for the WAV pieces this module's own ffmpeg call wrote
 * (fresh here, not imported from `packages/gateway`, which stays untouched -- ADR-0016). */
function wavDurationMs(bytes: Uint8Array): number {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new TranscriberError('validation', false, UNREADABLE);
  }
  let byteRate: number | undefined;
  let dataLength: number | undefined;
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const id = ascii(bytes, at, 4);
    const size = u32le(bytes, at + 4);
    const body = at + 8;
    // A chunk only counts when its declared bounds actually land inside the buffer; a short or
    // out-of-range chunk is never read for its value (which would silently see garbage), and a
    // chunk whose declared size runs past the end of the buffer ends the walk below.
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.byteLength) {
      byteRate = u32le(bytes, body + 8);
    }
    if (id === 'data') {
      if (body > bytes.byteLength) break;
      dataLength = Math.min(size, bytes.byteLength - body);
      break;
    }
    const next = body + size + (size % 2);
    if (next <= at || next > bytes.byteLength) break;
    at = next;
  }
  if (byteRate === undefined || byteRate === 0 || dataLength === undefined) {
    throw new TranscriberError('validation', false, UNREADABLE);
  }
  return Math.round((dataLength * 1000) / byteRate);
}

export interface FfmpegChunkerOptions {
  /** Defaults to `ffmpeg` (resolved on `PATH`). */
  readonly ffmpegPath?: string;
  /** Wall-clock budget for the one ffmpeg process this chunker runs per call. */
  readonly timeoutMs?: number;
  /** A running total across all produced pieces over this throws `input_too_large` (a
   * decompression-bomb shape); reused from `DEFAULT_MAX_DOWNLOAD_BYTES`, not duplicated. */
  readonly maxOutputBytes?: number;
  /** Tests inject a fake process runner; defaults to a real `child_process.spawn`. */
  readonly run?: ProcessRunner;
  /** How long the default runner waits after SIGTERM before escalating to SIGKILL. Ignored when
   * `run` is supplied. Defaults to `DEFAULT_SIGKILL_GRACE_MS`. */
  readonly sigkillGraceMs?: number;
  /** How often the running total of piece bytes already on disk is checked against
   * `maxOutputBytes` while ffmpeg is still running. Defaults to `DEFAULT_OUTPUT_WATCH_MS`. This
   * in-run cap is approximate: a fast writer can pass `maxOutputBytes` between ticks. The
   * total-size check after ffmpeg exits is exact and is the real limit. */
  readonly outputWatchMs?: number;
}

/**
 * An `AudioChunker` (ADR-0016) for MP4, WebM and M4A: one ffmpeg process re-encodes and splits the
 * recording into numbered 16 kHz mono 16-bit PCM WAV pieces in a per-call temp directory, which is
 * always removed before this returns. WAV and MP3 (and anything else) go to `defaultChunker`
 * unchanged.
 */
export function createFfmpegChunker(opts: FfmpegChunkerOptions = {}): AudioChunker {
  const ffmpegPath = opts.ffmpegPath ?? 'ffmpeg';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const run = opts.run ?? createRealRunner(opts.sigkillGraceMs ?? DEFAULT_SIGKILL_GRACE_MS);

  return async (audio, mimeType, maxBytes): Promise<readonly AudioChunk[]> => {
    const lowerMime = mimeType.toLowerCase();
    if (!FFMPEG_SCOPE.has(lowerMime)) {
      return defaultChunker(audio, mimeType, maxBytes);
    }
    // `lowerMime` is in `FFMPEG_SCOPE`, which is derived from this table's own keys, so the lookup
    // always hits.
    const inputFormat = FFMPEG_INPUT_FORMAT[lowerMime]!;

    const dir = await mkdtemp(join(tmpdir(), 'edmate-ffmpeg-'));
    try {
      const inputPath = join(dir, 'input');
      await writeFile(inputPath, audio);
      const segmentSeconds = Math.max(
        1,
        Math.floor((maxBytes - HEADER_SLACK_BYTES) / OUTPUT_BYTE_RATE),
      );
      const outputPattern = join(dir, 'piece-%03d.wav');
      const args = [
        '-nostdin',
        '-y',
        '-protocol_whitelist',
        'file',
        '-f',
        inputFormat,
        '-i',
        inputPath,
        '-vn',
        '-ac',
        String(CHANNELS),
        '-ar',
        String(SAMPLE_RATE),
        '-c:a',
        'pcm_s16le',
        '-f',
        'segment',
        '-segment_time',
        String(segmentSeconds),
        '-segment_format',
        'wav',
        '-reset_timestamps',
        '1',
        outputPattern,
      ];

      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const sizeController = new AbortController();
      const outputWatchMs = opts.outputWatchMs ?? DEFAULT_OUTPUT_WATCH_MS;
      const tooLargeError = (): TranscriberError =>
        new TranscriberError(
          'input_too_large',
          false,
          `the chunker produced more audio than the ${String(maxOutputBytes)}-byte limit`,
        );
      const timedOutError = (): TranscriberError =>
        new TranscriberError(
          'provider_error',
          true,
          'ffmpeg timed out while chunking the recording',
        );
      let checking = false;
      const watchInterval = setInterval(() => {
        if (checking) return;
        checking = true;
        void (async () => {
          try {
            const names = await readdir(dir);
            let total = 0;
            for (const name of names) {
              if (!name.startsWith('piece-') || !name.endsWith('.wav')) continue;
              try {
                const info = await stat(join(dir, name));
                total += info.size;
              } catch {
                // the file vanished between readdir and stat (ffmpeg rotated it away); ignore
              }
            }
            if (total > maxOutputBytes) sizeController.abort();
          } catch {
            // a transient dir read failure; the next tick retries
          } finally {
            checking = false;
          }
        })();
      }, outputWatchMs);

      const signal = AbortSignal.any([timeoutSignal, sizeController.signal]);
      let result: ProcessResult;
      try {
        result = await run(ffmpegPath, args, { signal });
      } catch (err) {
        clearInterval(watchInterval);
        if (sizeController.signal.aborted) throw tooLargeError();
        if (timeoutSignal.aborted) throw timedOutError();
        const code =
          err !== null && typeof err === 'object' && 'code' in err
            ? (err as { code?: unknown }).code
            : undefined;
        if (code === 'ENOENT' || code === 'EACCES') {
          throw new TranscriberError(
            'provider_error',
            false,
            `ffmpeg could not be started (${String(code)})`,
          );
        }
        throw new TranscriberError('validation', false, UNREADABLE, undefined);
      }
      clearInterval(watchInterval);
      // A watch tick already in flight can abort `sizeController` after this branch has read it
      // as not aborted. Harmless today (the exact post-exit check below still catches it), but
      // later code must not re-read this signal and expect the earlier answer.
      if (sizeController.signal.aborted) throw tooLargeError();
      if (timeoutSignal.aborted) throw timedOutError();
      if (result.code !== 0) {
        throw new TranscriberError('validation', false, UNREADABLE);
      }

      const names = (await readdir(dir))
        .filter((name) => name.startsWith('piece-') && name.endsWith('.wav'))
        .sort();
      if (names.length === 0) {
        throw new TranscriberError('validation', false, UNREADABLE);
      }

      const chunks: AudioChunk[] = [];
      let totalBytes = 0;
      let offsetMs = 0;
      for (const name of names) {
        const path = join(dir, name);
        const info = await stat(path);
        totalBytes += info.size;
        if (totalBytes > maxOutputBytes) {
          throw new TranscriberError(
            'input_too_large',
            false,
            `the chunker produced more audio than the ${String(maxOutputBytes)}-byte limit`,
          );
        }
        const bytes = await readFile(path);
        const durationMs = wavDurationMs(bytes);
        chunks.push({ bytes: new Uint8Array(bytes), mimeType: 'audio/wav', offsetMs, durationMs });
        offsetMs += durationMs;
      }
      return chunks;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
