// Task 5.2: Transcript -> ParsedDocument, one unit per fixed time window (mirrors the PDF
// "one unit per page" precedent). No real transcription: segments are a synthetic Transcript,
// built in code, matching the shape of the gateway's own 60-minute fixture (rule 4).
import { describe, expect, it } from 'vitest';
import type { Transcript } from '@edmate/contracts';
import {
  formatTimestamp,
  parseVideoTranscript,
  VIDEO_UNIT_WINDOW_MS,
} from '../../src/parse/video.js';

function transcript(
  segments: readonly { startMs: number; endMs: number; text: string }[],
  durationMs: number,
): Transcript {
  return {
    text: segments.map((s) => s.text).join(' '),
    language: 'en',
    durationMs,
    segments: [...segments],
  };
}

/** A 60-minute, 5-second-segment transcript: 720 segments, same shape as the gateway's fixture. */
function sixtyMinutes(): Transcript {
  const segments = Array.from({ length: 720 }, (_, i) => ({
    startMs: i * 5_000,
    endMs: i * 5_000 + 4_800,
    text: `Minute ${String(Math.floor(i / 12) + 1)}, point ${String((i % 12) + 1)}.`,
  }));
  return transcript(segments, 60 * 60_000);
}

describe('formatTimestamp', () => {
  it.each([
    [0, '0:00'],
    [1_000, '0:01'],
    [59_000, '0:59'],
    [60_000, '1:00'],
    [61_000, '1:01'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_661_000, '1:01:01'],
    [7_320_000, '2:02:00'],
  ])('%i ms -> %s', (ms, expected) => {
    expect(formatTimestamp(ms)).toBe(expected);
  });
});

describe('parseVideoTranscript', () => {
  it('a single-segment transcript makes one unit located at 0:00', () => {
    const t = transcript([{ startMs: 0, endMs: 2_000, text: 'Hello class.' }], 3_000);
    const doc = parseVideoTranscript(t, 'Lesson one');
    expect(doc).toEqual({
      sourceTitle: 'Lesson one',
      units: [{ text: 'Hello class.', locator: '0:00' }],
    });
  });

  it('a segment exactly on a window boundary starts the next window', () => {
    const t = transcript(
      [
        { startMs: 0, endMs: 1_000, text: 'First window.' },
        { startMs: VIDEO_UNIT_WINDOW_MS, endMs: VIDEO_UNIT_WINDOW_MS + 1_000, text: 'Second window.' },
      ],
      VIDEO_UNIT_WINDOW_MS + 2_000,
    );
    const doc = parseVideoTranscript(t, 'Boundary');
    expect(doc.units).toEqual([
      { text: 'First window.', locator: '0:00' },
      { text: 'Second window.', locator: formatTimestamp(VIDEO_UNIT_WINDOW_MS) },
    ]);
  });

  it('a trailing partial window still becomes its own unit', () => {
    const t = transcript(
      [
        { startMs: 0, endMs: 1_000, text: 'Full window of talking.' },
        { startMs: VIDEO_UNIT_WINDOW_MS + 500, endMs: VIDEO_UNIT_WINDOW_MS + 1_000, text: 'Short tail.' },
      ],
      VIDEO_UNIT_WINDOW_MS + 2_000,
    );
    const doc = parseVideoTranscript(t, 'Tail');
    expect(doc.units).toHaveLength(2);
    expect(doc.units[1]).toEqual({
      text: 'Short tail.',
      locator: formatTimestamp(VIDEO_UNIT_WINDOW_MS),
    });
  });

  it('joins multiple segments in the same window with a space, trimmed', () => {
    const t = transcript(
      [
        { startMs: 0, endMs: 1_000, text: '  Hello  ' },
        { startMs: 1_000, endMs: 2_000, text: 'world.  ' },
      ],
      3_000,
    );
    const doc = parseVideoTranscript(t, 'Joined');
    expect(doc.units).toEqual([{ text: 'Hello world.', locator: '0:00' }]);
  });

  it('refuses a transcript whose only segment is whitespace (theoretical, schema-legal)', () => {
    const t = transcript([{ startMs: 0, endMs: 500, text: ' ' }], 500);
    expect(() => parseVideoTranscript(t, 'Blank')).toThrow('no speech to learn from');
  });

  it('never returns an empty document (contract guarantees >= 1 segment)', () => {
    const t = transcript([{ startMs: 0, endMs: 500, text: 'x' }], 500);
    const doc = parseVideoTranscript(t, 'Nonempty');
    expect(doc.units.length).toBeGreaterThanOrEqual(1);
  });

  it('locators are strictly increasing and within [0, durationMs] for a 60-minute fixture', () => {
    const t = sixtyMinutes();
    const doc = parseVideoTranscript(t, 'Live class');
    expect(doc.sourceTitle).toBe('Live class');
    // 720 segments at 5s each over 90s windows: 40 full windows (no partial tail).
    expect(doc.units).toHaveLength(40);
    const toMs = (locator: string): number => {
      const parts = locator.split(':').map(Number);
      return parts.length === 3
        ? (parts[0] ?? 0) * 3_600_000 + (parts[1] ?? 0) * 60_000 + (parts[2] ?? 0) * 1_000
        : (parts[0] ?? 0) * 60_000 + (parts[1] ?? 0) * 1_000;
    };
    let prev = -1;
    for (const unit of doc.units) {
      expect(unit.text.length).toBeGreaterThan(0);
      const ms = toMs(unit.locator);
      expect(ms).toBeGreaterThan(prev);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(t.durationMs);
      expect(unit.locator).toMatch(/^\d+:\d{2}(:\d{2})?$/);
      prev = ms;
    }
  });
});
