// Video/audio transcript -> one unit per fixed time window, located by its start timestamp. This
// mirrors the PDF "one unit per page" precedent exactly: a video "page" is a 90-second time slice.
// Within-unit splitting (paragraph -> sentence -> word) is left to 5.3's unchanged chunkDocument.
import type { Transcript } from '@edmate/contracts';
import { IngestError } from '../errors.js';
import type { ParsedDocument, ParsedUnit } from '../types.js';
import { collapse, requireTitle } from './sections.js';

/** 90 seconds: ordinary speech density lands at roughly one chunk per unit (lead decision, 5.2). */
export const VIDEO_UNIT_WINDOW_MS = 90_000;

/** `H:MM:SS` once past an hour, else `MM:SS` (no leading zero on the leftmost unit). */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${String(minutes)}:${pad(seconds)}`;
}

/**
 * Buckets timed segments by their time window (`floor(startMs / VIDEO_UNIT_WINDOW_MS)`); each
 * non-empty bucket becomes one unit, its segments' trimmed text joined by spaces and its locator
 * the window's start timestamp. Shared by `parseVideoTranscript` (2.7 recordings) and the caption
 * parsers (8.2c `.vtt`/`.srt`), so a caption file lands in the same 90 s units a Whisper transcript
 * gives. Segment order does not need to be window-sorted: buckets are keyed by window, not by
 * iteration order (the caller still sorts by `startMs` first, so text within a shared window
 * reads in chronological order).
 */
export function unitsFromTimedText(
  segments: readonly { readonly startMs: number; readonly text: string }[],
): ParsedUnit[] {
  const buckets = new Map<number, string[]>();
  for (const segment of segments) {
    const text = collapse(segment.text);
    if (text === '') continue;
    const window = Math.floor(segment.startMs / VIDEO_UNIT_WINDOW_MS);
    const bucket = buckets.get(window);
    if (bucket === undefined) buckets.set(window, [text]);
    else bucket.push(text);
  }
  const windows = [...buckets.keys()].sort((a, b) => a - b);
  return windows.map((window) => ({
    text: (buckets.get(window) ?? []).join(' '),
    locator: formatTimestamp(window * VIDEO_UNIT_WINDOW_MS),
  }));
}

/**
 * `Transcript.segments` -> `ParsedDocument`. `Transcript.segments` is contract-guaranteed
 * non-empty (`TranscriptSchema.segments.min(1)`), so this always returns >= 1 unit.
 */
export function parseVideoTranscript(transcript: Transcript, sourceTitle: string): ParsedDocument {
  const title = requireTitle(sourceTitle);
  const units = unitsFromTimedText(transcript.segments);
  // Every real segment carries non-blank text (contracts min(1)), so this only guards the
  // theoretical case of a transcript whose segments are all whitespace.
  if (units.length === 0) {
    throw new IngestError('validation', false, 'the recording has no speech to learn from');
  }
  return { sourceTitle: title, units };
}
