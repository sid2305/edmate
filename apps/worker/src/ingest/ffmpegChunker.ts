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

/** The three types `apps/web`'s upload table names as recordings the worker can't split today
 * (ADR-0016 Decision §2); everything else goes to `defaultChunker`. */
const FFMPEG_SCOPE = new Set(['audio/mp4', 'video/mp4', 'video/webm']);

/** 16 kHz, mono, 16-bit PCM: the fixed output format the Decision computes `segment_time` from. */
const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
const OUTPUT_BYTE_RATE = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
/** Room for each piece's own ~44-byte WAV header plus muxer slack, so pieces stay under `maxBytes`. */
const HEADER_SLACK_BYTES = 4_096;

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
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

function drain(stream: NodeJS.ReadableStream | null): void {
  stream?.on('data', () => {
    /* ffmpeg's stderr/stdout is drained, never read into a string: it could carry
     * attacker-chosen bytes from the input file's metadata, and must never reach a log line. */
  });
}

/** `child_process.spawn`, fixed argv, no shell -- the default `ProcessRunner`. */
const realRunner: ProcessRunner = (bin, args, opts) =>
  new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: opts.signal,
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error('ffmpeg could not be started'));
      return;
    }
    drain(child.stdout);
    drain(child.stderr);
    let settled = false;
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      resolve({ code });
    });
  });

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
    if (id === 'fmt ' && size >= 16) byteRate = u32le(bytes, body + 8);
    if (id === 'data') {
      dataLength = Math.min(size, bytes.byteLength - body);
      break;
    }
    at = body + size + (size % 2);
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
  const run = opts.run ?? realRunner;

  return async (audio, mimeType, maxBytes): Promise<readonly AudioChunk[]> => {
    if (!FFMPEG_SCOPE.has(mimeType.toLowerCase())) {
      return defaultChunker(audio, mimeType, maxBytes);
    }

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

      const signal = AbortSignal.timeout(timeoutMs);
      let result: ProcessResult;
      try {
        result = await run(ffmpegPath, args, { signal });
      } catch {
        if (signal.aborted) {
          throw new TranscriberError(
            'provider_error',
            true,
            'ffmpeg timed out while chunking the recording',
          );
        }
        throw new TranscriberError('validation', false, UNREADABLE, undefined);
      }
      if (signal.aborted) {
        throw new TranscriberError(
          'provider_error',
          true,
          'ffmpeg timed out while chunking the recording',
        );
      }
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
