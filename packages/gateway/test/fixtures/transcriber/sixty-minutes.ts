// A transcript shaped like a 60-minute live class: 720 five-second segments and the byte size a
// 64 kbps MP3 of that length would have. Synthetic text only (rule 5: no real class).
import type { TranscribeInput, Transcript } from '@edmate/contracts';

export const SIXTY_MINUTES_MS = 60 * 60_000;
/** 64 kbps for an hour: what the recording would weigh in storage (over Whisper's 25 MB). */
export const SIXTY_MINUTES_MP3_BYTES = (64_000 / 8) * 3_600;

export const sixtyMinuteInput: TranscribeInput = {
  url: 'https://storage.edmate.invalid/recordings/live-class-60m.mp3?X-Amz-Signature=fake0sig',
  mimeType: 'audio/mpeg',
  languageHint: 'en',
};

export function sixtyMinuteTranscript(): Transcript {
  const segments = Array.from({ length: 720 }, (_, i) => ({
    startMs: i * 5_000,
    endMs: i * 5_000 + 4_800,
    text: `Minute ${String(Math.floor(i / 12) + 1)}, point ${String((i % 12) + 1)}.`,
  }));
  return {
    text: segments.map((s) => s.text).join(' '),
    language: 'en',
    durationMs: SIXTY_MINUTES_MS,
    segments,
  };
}
