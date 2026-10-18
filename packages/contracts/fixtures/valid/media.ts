import type { TranscribeInput, Transcript, TranscriptSegment } from '../../src/index.js';

// Synthetic: the host is a reserved example domain and the query is not a real signature.
export const transcribeInputMinimal = {
  url: 'https://storage.example.com/rec/rec_test_01.m4a?sig=test',
  mimeType: 'audio/mp4',
} satisfies TranscribeInput;

export const transcribeInputFull = {
  url: 'https://storage.example.com/rec/rec_test_02.mp4?sig=test',
  mimeType: 'video/mp4',
  languageHint: 'hi',
} satisfies TranscribeInput;

export const transcriptSegmentFirst = {
  startMs: 0,
  endMs: 4200,
  text: 'Today we add fractions with unlike denominators.',
} satisfies TranscriptSegment;

export const transcriptSegmentSecond = {
  startMs: 4200,
  endMs: 9000,
  text: 'First find a common denominator.',
} satisfies TranscriptSegment;

export const transcriptMinimal = {
  text: 'Hello.',
  durationMs: 800,
  segments: [{ startMs: 0, endMs: 800, text: 'Hello.' }],
} satisfies Transcript;

export const demoTranscript = {
  text: 'Today we add fractions with unlike denominators. First find a common denominator.',
  language: 'en',
  durationMs: 9500,
  segments: [transcriptSegmentFirst, transcriptSegmentSecond],
} satisfies Transcript;

export const valid = {
  TranscribeInput: [
    transcribeInputMinimal,
    transcribeInputFull,
    { ...transcribeInputMinimal, mimeType: 'audio/mpeg' } satisfies TranscribeInput,
  ],
  TranscriptSegment: [
    transcriptSegmentFirst,
    { startMs: 100, endMs: 100, text: 'Okay.' } satisfies TranscriptSegment,
  ],
  Transcript: [
    transcriptMinimal,
    demoTranscript,
    // Overlapping segments are allowed as long as starts never go backwards.
    {
      text: 'One. Two.',
      durationMs: 3000,
      segments: [
        { startMs: 0, endMs: 2000, text: 'One.' },
        { startMs: 1500, endMs: 3000, text: 'Two.' },
      ],
    } satisfies Transcript,
  ],
};
