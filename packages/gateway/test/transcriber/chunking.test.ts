// Splitting recordings over the upload limit (task 2.7): every piece plays on its own, is within
// the limit, and knows where it starts.
import { describe, expect, it } from 'vitest';
import { defaultChunker, splitMp3, splitWav } from '../../src/transcriber/chunking.js';
import { TranscriberError } from '../../src/transcriber/errors.js';
import {
  id3v2Tag,
  MP3_FRAME_BYTES,
  MP3_FRAME_SAMPLES,
  MP3_SAMPLE_RATE,
  mp3,
  mp3Frame,
  wav,
} from '../fixtures/transcriber/audio.js';

function ascii(b: Uint8Array, at: number, n: number): string {
  return String.fromCharCode(...b.subarray(at, at + n));
}

function u32(b: Uint8Array, at: number): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
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

describe('splitWav', () => {
  it('cuts the data on frame boundaries, gives each piece its own header, and times each piece', () => {
    // 10 s of 16 kHz mono 16-bit = 320,000 data bytes; 100,044-byte pieces hold 100,000 data bytes.
    const audio = wav(10_000);
    const pieces = splitWav(audio, 'audio/wav', 100_044);
    expect(pieces.map((p) => p.offsetMs)).toEqual([0, 3125, 6250, 9375]);
    expect(pieces.map((p) => p.durationMs)).toEqual([3125, 3125, 3125, 625]);
    expect(pieces.every((p) => p.bytes.byteLength <= 100_044)).toBe(true);
    expect(pieces.every((p) => p.mimeType === 'audio/wav')).toBe(true);
    for (const p of pieces) {
      expect(ascii(p.bytes, 0, 4)).toBe('RIFF');
      expect(u32(p.bytes, 4)).toBe(p.bytes.byteLength - 8);
      expect(ascii(p.bytes, 8, 8)).toBe('WAVEfmt ');
      expect(ascii(p.bytes, 36, 4)).toBe('data');
      expect(u32(p.bytes, 40)).toBe(p.bytes.byteLength - 44);
      expect((p.bytes.byteLength - 44) % 2).toBe(0);
    }
    const total = pieces.reduce((n, p) => n + p.bytes.byteLength - 44, 0);
    expect(total).toBe(320_000);
  });

  it('skips chunks before fmt (with odd-size padding) and reads only the data that is there', () => {
    const audio = wav(1_000, { listChunk: true, channels: 2, declaredDataSize: 0xffffffff });
    const pieces = splitWav(audio, 'audio/x-wav', 20_044);
    // 1 s of 16 kHz stereo = 64,000 bytes: 20,000-byte pieces, block-aligned to 4 bytes.
    expect(pieces.map((p) => p.offsetMs)).toEqual([0, 313, 625, 938]);
    expect(pieces.at(-1)?.durationMs).toBe(63);
  });

  it.each([
    ['not RIFF', new Uint8Array(64)],
    ['too short', new Uint8Array(4)],
    ['no data chunk', wav(1_000).subarray(0, 36)],
    ['empty data', wav(0)],
  ])('refuses %s as unreadable WAV', async (_name, audio) => {
    const err = await failure(() => splitWav(audio, 'audio/wav', 10_000));
    expect(err.code).toBe('validation');
    expect(err.message).toBe('transcriber: the recording is not readable WAV');
  });

  it('refuses a WAV with a zero byte rate or block align, or a limit smaller than one frame', async () => {
    const zeroRate = wav(1_000);
    zeroRate.fill(0, 28, 34); // byteRate and blockAlign
    expect((await failure(() => splitWav(zeroRate, 'audio/wav', 10_000))).code).toBe('validation');
    const shortFmt = wav(1_000);
    shortFmt.set([8, 0, 0, 0], 16); // fmt size 8: too short to hold the rates
    expect((await failure(() => splitWav(shortFmt, 'audio/wav', 10_000))).code).toBe('validation');
    expect((await failure(() => splitWav(wav(1_000), 'audio/wav', 44))).code).toBe('validation');
  });
});

describe('splitMp3', () => {
  const frameMs = (MP3_FRAME_SAMPLES * 1000) / MP3_SAMPLE_RATE;

  it('keeps whole frames per piece and times pieces from the sample counts', () => {
    const pieces = splitMp3(mp3(100), 'audio/mpeg', 30 * MP3_FRAME_BYTES);
    expect(pieces.map((p) => p.bytes.byteLength / MP3_FRAME_BYTES)).toEqual([30, 30, 30, 10]);
    expect(pieces.map((p) => p.offsetMs)).toEqual(
      [0, 30, 60, 90].map((n) => Math.round(n * frameMs)),
    );
    expect(pieces[0]?.durationMs).toBe(Math.round(30 * frameMs));
    for (const p of pieces) expect([p.bytes[0], p.bytes[1]]).toEqual([0xff, 0xfb]);
  });

  it('skips ID3v2 tags (with a footer) at the start and stops at an ID3v1 tag or zero padding', () => {
    const tagged = mp3(10, { id3v2: true, id3v1: true });
    const pieces = splitMp3(tagged, 'audio/mpeg', 4 * MP3_FRAME_BYTES);
    expect(pieces.map((p) => p.bytes.byteLength)).toEqual(
      [4, 4, 2].map((n) => n * MP3_FRAME_BYTES),
    );
    const footer = id3v2Tag(5, true);
    const withFooter = new Uint8Array(footer.byteLength + 3 * MP3_FRAME_BYTES + 50);
    withFooter.set(footer, 0);
    withFooter.set(mp3(3), footer.byteLength);
    expect(splitMp3(withFooter, 'audio/mpeg', 10_000).map((p) => p.bytes.byteLength)).toEqual([
      3 * MP3_FRAME_BYTES,
    ]);
  });

  it('starts a new piece when the sample rate changes, and reads MPEG-2 and MPEG-2.5 frames', () => {
    // MPEG-2 layer III, 64 kbps, 22.05 kHz: 72 * 64000 / 22050 = 208 bytes, 576 samples.
    const v2 = mp3Frame([0xff, 0xf3, 0x80, 0xc4], 208);
    // MPEG-2.5 layer III, 8 kbps, 8 kHz, padded: 72 * 8000 / 8000 + 1 = 73 bytes.
    const v25 = mp3Frame([0xff, 0xe3, 0x1a, 0xc4], 73);
    const audio = new Uint8Array([...mp3(2), ...v2, ...v2, ...v25]);
    const pieces = splitMp3(audio, 'audio/mpeg', 10_000);
    expect(pieces.map((p) => p.bytes.byteLength)).toEqual([2 * MP3_FRAME_BYTES, 2 * 208, 73]);
    expect(pieces[1]?.durationMs).toBe(Math.round((2 * 576 * 1000) / 22_050));
    expect(pieces[2]?.durationMs).toBe(72);
    expect(pieces[2]?.offsetMs).toBe(Math.round(2 * frameMs + (2 * 576 * 1000) / 22_050));
  });

  it('keeps a last frame that is cut short', () => {
    const audio = mp3(3).subarray(0, 3 * MP3_FRAME_BYTES - 50);
    const pieces = splitMp3(audio, 'audio/mpeg', 10_000);
    expect(pieces.map((p) => p.bytes.byteLength)).toEqual([3 * MP3_FRAME_BYTES - 50]);
  });

  it.each([
    ['garbage between frames', new Uint8Array([...mp3(2), 1, 2, 3, 4, ...mp3(2)])],
    ['no frames at all', new Uint8Array(0)],
    ['only a tag', id3v2Tag(8)],
    ['a layer II header', mp3Frame([0xff, 0xfd, 0x50, 0xc4])],
    ['a reserved MPEG version', mp3Frame([0xff, 0xeb, 0x50, 0xc4])],
    ['a free-format bitrate', mp3Frame([0xff, 0xfb, 0x00, 0xc4])],
    ['a bad bitrate index', mp3Frame([0xff, 0xfb, 0xf0, 0xc4])],
    ['a reserved sample rate', mp3Frame([0xff, 0xfb, 0x5c, 0xc4])],
    ['a header cut short', new Uint8Array([0xff, 0xfb])],
  ])('refuses %s as unreadable MP3', async (_name, audio) => {
    const err = await failure(() => splitMp3(audio, 'audio/mpeg', 10_000));
    expect(err.code).toBe('validation');
    expect(err.message).toBe('transcriber: the recording is not readable MP3');
  });

  it('refuses a limit smaller than one frame', async () => {
    expect((await failure(() => splitMp3(mp3(2), 'audio/mpeg', 100))).code).toBe('validation');
  });
});

describe('defaultChunker', () => {
  it('splits WAV and MP3 by MIME type, case-insensitively', async () => {
    expect((await defaultChunker(wav(1_000), 'audio/WAV', 10_044)).length).toBe(4);
    expect((await defaultChunker(mp3(4), 'audio/mpeg', 2 * MP3_FRAME_BYTES)).length).toBe(2);
    expect((await defaultChunker(mp3(4), 'audio/mp3', 2 * MP3_FRAME_BYTES)).length).toBe(2);
  });

  it('refuses any other format over the limit as input_too_large', async () => {
    const err = await failure(() => defaultChunker(new Uint8Array(10), 'audio/webm', 5));
    expect(err.code).toBe('input_too_large');
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/only when they are WAV or MP3/);
  });
});
