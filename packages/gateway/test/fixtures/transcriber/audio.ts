// Synthetic audio, built in memory: silent but well-formed WAV and MP3 (MPEG-1 layer III)
// streams of a chosen length. Never a real recording (rule 5: no teacher uploads in the repo).

/** MPEG-1 layer III, 64 kbps, 44.1 kHz, mono, no padding: 208 bytes and 1,152 samples a frame. */
export const MP3_FRAME_BYTES = 208;
export const MP3_FRAME_SAMPLES = 1152;
export const MP3_SAMPLE_RATE = 44_100;
const MP3_HEADER = [0xff, 0xfb, 0x50, 0xc4];

export function mp3Frame(
  header: readonly number[] = MP3_HEADER,
  length = MP3_FRAME_BYTES,
): Uint8Array {
  const f = new Uint8Array(length);
  f.set(header, 0);
  return f;
}

/** `frames` silent frames, optionally behind an ID3v2 tag and followed by an ID3v1 tag. */
export function mp3(frames: number, opts: { id3v2?: boolean; id3v1?: boolean } = {}): Uint8Array {
  const id3v2 = opts.id3v2 === true ? id3v2Tag(32) : new Uint8Array(0);
  const id3v1 = opts.id3v1 === true ? id3v1Tag() : new Uint8Array(0);
  const out = new Uint8Array(id3v2.byteLength + frames * MP3_FRAME_BYTES + id3v1.byteLength);
  out.set(id3v2, 0);
  const frame = mp3Frame();
  for (let i = 0; i < frames; i += 1) out.set(frame, id3v2.byteLength + i * MP3_FRAME_BYTES);
  out.set(id3v1, id3v2.byteLength + frames * MP3_FRAME_BYTES);
  return out;
}

/** Frames needed for `ms` of MP3 audio (rounded up). */
export function mp3FramesFor(ms: number): number {
  return Math.ceil((ms * MP3_SAMPLE_RATE) / (1000 * MP3_FRAME_SAMPLES));
}

/** An ID3v2.4 tag with `size` bytes of (zero) frames and its footer flag off. */
export function id3v2Tag(size: number, footer = false): Uint8Array {
  const t = new Uint8Array(10 + size + (footer ? 10 : 0));
  t.set([0x49, 0x44, 0x33, 4, 0, footer ? 0x10 : 0], 0);
  t.set([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f], 6);
  return t;
}

export function id3v1Tag(): Uint8Array {
  const t = new Uint8Array(128);
  t.set([0x54, 0x41, 0x47], 0); // TAG
  return t;
}

function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

export interface WavShape {
  readonly sampleRate?: number;
  readonly channels?: number;
  readonly bitsPerSample?: number;
  /** Extra chunks before `fmt ` (say a LIST chunk), with an odd size to exercise padding. */
  readonly listChunk?: boolean;
  /** The size the data chunk declares; defaults to the real size. */
  readonly declaredDataSize?: number;
}

/** A PCM WAV of `ms` milliseconds of silence. */
export function wav(ms: number, shape: WavShape = {}): Uint8Array {
  const sampleRate = shape.sampleRate ?? 16_000;
  const channels = shape.channels ?? 1;
  const bits = shape.bitsPerSample ?? 16;
  const blockAlign = (channels * bits) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = Math.round((ms * sampleRate) / 1000) * blockAlign;
  const list = shape.listChunk === true ? [...ascii('LIST'), ...u32(3), 1, 2, 3, 0] : [];
  const fmt = [
    ...ascii('fmt '),
    ...u32(16),
    1,
    0,
    channels,
    0,
    ...u32(sampleRate),
    ...u32(byteRate),
    blockAlign,
    0,
    bits,
    0,
  ];
  const head = [
    ...ascii('RIFF'),
    ...u32(4 + list.length + fmt.length + 8 + dataSize),
    ...ascii('WAVE'),
    ...list,
    ...fmt,
    ...ascii('data'),
    ...u32(shape.declaredDataSize ?? dataSize),
  ];
  const out = new Uint8Array(head.length + dataSize);
  out.set(head, 0);
  return out;
}
