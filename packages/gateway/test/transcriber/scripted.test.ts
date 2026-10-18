// Acceptance (task 2.7): "a 60-minute audio fixture transcribes through the scripted adapter".
// The scripted Transcriber checks inputs and outputs exactly like the real one and never returns
// an empty result.
import { TranscriptSchema } from '@edmate/contracts';
import { describe, expect, it, vi } from 'vitest';
import * as testing from '../../src/testing/index.js';
import {
  createScriptedTranscriber,
  ScriptedTranscriberError,
} from '../../src/testing/scriptedTranscriber.js';
import {
  SIXTY_MINUTES_MP3_BYTES,
  SIXTY_MINUTES_MS,
  sixtyMinuteInput,
  sixtyMinuteTranscript,
} from '../fixtures/transcriber/sixty-minutes.js';

const short = {
  text: 'Hello.',
  durationMs: 1_000,
  segments: [{ startMs: 0, endMs: 900, text: 'Hello.' }],
};

describe('createScriptedTranscriber', () => {
  it('transcribes the 60-minute fixture with no network call', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const t = createScriptedTranscriber([{ transcript: sixtyMinuteTranscript() }]);
    const out = await t.transcribe(sixtyMinuteInput);

    expect(SIXTY_MINUTES_MP3_BYTES > 25 * 1024 * 1024).toBe(true);
    expect(out.durationMs).toBe(SIXTY_MINUTES_MS);
    expect(out.segments).toHaveLength(720);
    expect(out.segments.at(-1)).toEqual({
      startMs: 3_595_000,
      endMs: 3_599_800,
      text: 'Minute 60, point 12.',
    });
    expect(out.text.startsWith('Minute 1, point 1. Minute 1, point 2.')).toBe(true);
    expect(TranscriptSchema.parse(out)).toEqual(out);
    expect(t.calls).toEqual([sixtyMinuteInput]);
    expect(t.remaining()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it('replays entries in order and rejects once the script runs out', async () => {
    const t = createScriptedTranscriber(
      [{ transcript: short }, { transcript: sixtyMinuteTranscript() }],
      { model: 'scripted-whisper' },
    );
    expect(t.model).toBe('scripted-whisper');
    expect((await t.transcribe(sixtyMinuteInput)).text).toBe('Hello.');
    expect((await t.transcribe(sixtyMinuteInput)).segments).toHaveLength(720);
    const err = await t.transcribe(sixtyMinuteInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScriptedTranscriberError);
    expect((err as ScriptedTranscriberError).callIndex).toBe(2);
    expect((err as Error).message).toBe('ScriptedTranscriber: no entry left for call 2');
    expect(createScriptedTranscriber([]).model).toBe('scripted-transcriber');
  });

  it('throws a scripted error, standing in for a provider failure', async () => {
    const boom = new Error('provider down');
    const t = createScriptedTranscriber([{ error: boom }]);
    await expect(t.transcribe(sixtyMinuteInput)).rejects.toBe(boom);
  });

  it.each([
    ['empty text', { ...short, text: '' }],
    ['no segments', { ...short, segments: [] }],
    [
      'a segment past the duration',
      { ...short, segments: [{ startMs: 0, endMs: 2_000, text: 'x' }] },
    ],
    ['not an object', 'Hello.'],
  ])('a fixture with %s fails loudly instead of being returned', async (_n, transcript) => {
    const t = createScriptedTranscriber([{ transcript }]);
    const err = await t.transcribe(sixtyMinuteInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScriptedTranscriberError);
    expect((err as Error).message).toBe('ScriptedTranscriber: invalid transcript for call 0');
  });

  it('refuses an invalid input without consuming an entry or echoing the URL', async () => {
    const t = createScriptedTranscriber([{ transcript: short }]);
    const err = await t
      .transcribe({ url: 'http://storage.edmate.invalid/a.mp3?sig=fake0', mimeType: 'audio/mpeg' })
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe('ScriptedTranscriber: invalid input for call 0');
    expect((err as Error).message.includes('sig=')).toBe(false);
    expect(t.remaining()).toBe(1);
    expect(t.calls).toEqual([]);
  });

  it('is exported from the testing entry point only', () => {
    expect(Object.keys(testing).sort()).toEqual([
      'ScriptedTranscriberError',
      'createScriptedTranscriber',
    ]);
  });
});
