// Splitting a recording that is too big for one Whisper upload (25 MB) into pieces that each
// play on their own, with the time each piece starts at (task 2.7).
//
// Built in: PCM/float WAV (cut on sample-frame boundaries, each piece with its own header) and
// MPEG audio layer III (cut on frame boundaries; ID3 tags are skipped). Any other format over the
// limit needs a chunker from the composition root (say an ffmpeg one in the worker), or it fails
// as `input_too_large`. A chunker never guesses: audio it cannot read is a `validation` error.
import { TranscriberError } from './errors.js';

export interface AudioChunk {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  /** Where this piece starts in the whole recording. */
  readonly offsetMs: number;
  /** How long this piece plays, when the chunker knows it exactly. */
  readonly durationMs?: number;
}

/** Splits `audio` into pieces of at most `maxBytes` each, in playback order. */
export type AudioChunker = (
  audio: Uint8Array,
  mimeType: string,
  maxBytes: number,
) => readonly AudioChunk[] | Promise<readonly AudioChunk[]>;

const WAV_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']);
const MP3_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3']);

function unreadable(format: string): TranscriberError {
  return new TranscriberError('validation', false, `the recording is not readable ${format}`);
}

function ascii(b: Uint8Array, at: number, n: number): string {
  return String.fromCharCode(...b.subarray(at, at + n));
}

function u32le(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

function writeU32le(b: Uint8Array, at: number, v: number): void {
  b[at] = v & 0xff;
  b[at + 1] = (v >>> 8) & 0xff;
  b[at + 2] = (v >>> 16) & 0xff;
  b[at + 3] = (v >>> 24) & 0xff;
}

/** WAV: the `fmt ` chunk is copied into every piece; the `data` chunk is cut on frame boundaries. */
export function splitWav(audio: Uint8Array, mimeType: string, maxBytes: number): AudioChunk[] {
  if (audio.byteLength < 12 || ascii(audio, 0, 4) !== 'RIFF' || ascii(audio, 8, 4) !== 'WAVE') {
    throw unreadable('WAV');
  }
  let fmt: Uint8Array | undefined;
  let data: Uint8Array | undefined;
  for (let at = 12; at + 8 <= audio.byteLength;) {
    const id = ascii(audio, at, 4);
    const size = u32le(audio, at + 4);
    const body = at + 8;
    if (id === 'fmt ') fmt = audio.subarray(body, body + size);
    if (id === 'data') {
      // A streamed WAV can declare more data than it holds (or 0xFFFFFFFF): read what is there.
      data = audio.subarray(body, Math.min(body + size, audio.byteLength));
      break;
    }
    at = body + size + (size % 2);
  }
  if (fmt === undefined || fmt.byteLength < 16 || data === undefined) throw unreadable('WAV');
  const byteRate = u32le(fmt, 8);
  const blockAlign = fmt[12]! | (fmt[13]! << 8);
  if (byteRate === 0 || blockAlign === 0 || data.byteLength === 0) throw unreadable('WAV');

  const header = 12 + 8 + fmt.byteLength + (fmt.byteLength % 2) + 8;
  const perPiece = Math.floor((maxBytes - header) / blockAlign) * blockAlign;
  if (perPiece <= 0) throw unreadable('WAV');
  const pieces: AudioChunk[] = [];
  for (let start = 0; start < data.byteLength; start += perPiece) {
    const slice = data.subarray(start, Math.min(start + perPiece, data.byteLength));
    const out = new Uint8Array(header + slice.byteLength);
    out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    writeU32le(out, 4, out.byteLength - 8);
    out.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8); // WAVEfmt
    writeU32le(out, 16, fmt.byteLength);
    out.set(fmt, 20);
    const dataAt = header - 8;
    out.set([0x64, 0x61, 0x74, 0x61], dataAt); // data
    writeU32le(out, dataAt + 4, slice.byteLength);
    out.set(slice, header);
    pieces.push({
      bytes: out,
      mimeType,
      offsetMs: Math.round((start * 1000) / byteRate),
      durationMs: Math.round((slice.byteLength * 1000) / byteRate),
    });
  }
  return pieces;
}

// MPEG audio layer III frame header tables (ISO 11172-3 / 13818-3).
const MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MP3_SAMPLE_RATES: Readonly<Record<number, readonly number[]>> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

interface Mp3Frame {
  readonly length: number;
  readonly samples: number;
  readonly sampleRate: number;
}

/** The layer III frame starting at `at`, or undefined when there is no valid header there. */
function mp3Frame(b: Uint8Array, at: number): Mp3Frame | undefined {
  if (at + 4 > b.byteLength) return undefined;
  const h1 = b[at + 1]!;
  const h2 = b[at + 2]!;
  if (b[at] !== 0xff || (h1 & 0xe0) !== 0xe0) return undefined;
  const version = (h1 >> 3) & 0x3;
  const layer = (h1 >> 1) & 0x3;
  const rates = MP3_SAMPLE_RATES[version];
  if (rates === undefined || layer !== 0x1) return undefined;
  const v1 = version === 3;
  const kbps = (v1 ? MP3_BITRATES_V1 : MP3_BITRATES_V2)[(h2 >> 4) & 0xf];
  const sampleRate = rates[(h2 >> 2) & 0x3];
  if (kbps === undefined || kbps === 0 || sampleRate === undefined) return undefined;
  const padding = (h2 >> 1) & 0x1;
  const length = Math.floor(((v1 ? 144 : 72) * kbps * 1000) / sampleRate) + padding;
  return { length, samples: v1 ? 1152 : 576, sampleRate };
}

/** Bytes taken by ID3v2 tags at `at` (0 when there are none). */
function id3v2Length(b: Uint8Array, at: number): number {
  if (at + 10 > b.byteLength || ascii(b, at, 3) !== 'ID3') return 0;
  const size =
    ((b[at + 6]! & 0x7f) << 21) |
    ((b[at + 7]! & 0x7f) << 14) |
    ((b[at + 8]! & 0x7f) << 7) |
    (b[at + 9]! & 0x7f);
  const footer = (b[at + 5]! & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

/** MP3: whole frames per piece; times come from the frames' sample counts. */
export function splitMp3(audio: Uint8Array, mimeType: string, maxBytes: number): AudioChunk[] {
  let at = id3v2Length(audio, 0);
  const pieces: AudioChunk[] = [];
  let pieceStart = at;
  let pieceSamples = 0;
  let pieceRate = 0;
  let elapsedMs = 0;
  const close = (end: number): void => {
    const durationMs = Math.round((pieceSamples * 1000) / pieceRate);
    pieces.push({
      bytes: audio.slice(pieceStart, end),
      mimeType,
      offsetMs: Math.round(elapsedMs),
      durationMs,
    });
    elapsedMs += (pieceSamples * 1000) / pieceRate;
  };
  while (at < audio.byteLength) {
    const frame = mp3Frame(audio, at);
    if (frame === undefined) {
      // Trailing ID3v1 tag or padding after the last frame ends the audio; anything else is damage.
      if (ascii(audio, at, 3) === 'TAG' || audio.subarray(at).every((x) => x === 0)) break;
      throw unreadable('MP3');
    }
    if (frame.length > maxBytes) throw unreadable('MP3');
    const changedRate = pieceRate !== 0 && frame.sampleRate !== pieceRate;
    if (at + frame.length - pieceStart > maxBytes || changedRate) {
      close(at);
      pieceStart = at;
      pieceSamples = 0;
    }
    pieceRate = frame.sampleRate;
    pieceSamples += frame.samples;
    at += frame.length;
  }
  if (pieceSamples === 0) throw unreadable('MP3');
  close(Math.min(at, audio.byteLength));
  return pieces;
}

/** WAV and MP3 are split here; anything else over the limit is refused. */
export const defaultChunker: AudioChunker = (audio, mimeType, maxBytes) => {
  const type = mimeType.toLowerCase();
  if (WAV_TYPES.has(type)) return splitWav(audio, mimeType, maxBytes);
  if (MP3_TYPES.has(type)) return splitMp3(audio, mimeType, maxBytes);
  throw new TranscriberError(
    'input_too_large',
    false,
    `recordings over ${String(maxBytes)} bytes are split only when they are WAV or MP3; transcode it or configure a chunker`,
  );
};
