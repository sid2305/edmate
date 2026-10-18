import { demoTranscript, transcribeInputFull, transcriptSegmentFirst } from '../valid/media.js';
import type { InvalidCase } from './case.js';

export const invalid: InvalidCase[] = [
  {
    schema: 'TranscribeInput',
    name: 'plain http url',
    value: { ...transcribeInputFull, url: 'http://storage.example.com/rec/rec_test_01.m4a' },
    path: ['url'],
  },
  {
    schema: 'TranscribeInput',
    name: 'file url',
    value: { ...transcribeInputFull, url: 'file:///tmp/rec_test_01.m4a' },
    path: ['url'],
  },
  {
    schema: 'TranscribeInput',
    name: 'not a url',
    value: { ...transcribeInputFull, url: 'rec/rec_test_01.m4a' },
    path: ['url'],
  },
  {
    schema: 'TranscribeInput',
    name: 'mime type is not audio or video',
    value: { ...transcribeInputFull, mimeType: 'application/pdf' },
    path: ['mimeType'],
  },
  {
    schema: 'TranscribeInput',
    name: 'language hint is not a primary subtag',
    value: { ...transcribeInputFull, languageHint: 'en-US' },
    path: ['languageHint'],
  },
  {
    schema: 'TranscribeInput',
    name: 'unknown key',
    value: { ...transcribeInputFull, storageKey: 'rec/rec_test_01.m4a' },
    path: [],
  },
  {
    schema: 'TranscriptSegment',
    name: 'empty text',
    value: { ...transcriptSegmentFirst, text: '' },
    path: ['text'],
  },
  {
    schema: 'TranscriptSegment',
    name: 'negative start',
    value: { ...transcriptSegmentFirst, startMs: -1 },
    path: ['startMs'],
  },
  {
    schema: 'TranscriptSegment',
    name: 'fractional end',
    value: { ...transcriptSegmentFirst, endMs: 4200.5 },
    path: ['endMs'],
  },
  {
    schema: 'Transcript',
    name: 'empty text',
    value: { ...demoTranscript, text: '' },
    path: ['text'],
  },
  {
    schema: 'Transcript',
    name: 'no segments',
    value: { ...demoTranscript, segments: [] },
    path: ['segments'],
  },
  {
    schema: 'Transcript',
    name: 'segment ends before it starts',
    value: { ...demoTranscript, segments: [{ startMs: 500, endMs: 400, text: 'Hi.' }] },
    path: ['segments', 0, 'endMs'],
  },
  {
    schema: 'Transcript',
    name: 'segment starts go backwards',
    value: {
      ...demoTranscript,
      segments: [
        { startMs: 1000, endMs: 2000, text: 'One.' },
        { startMs: 500, endMs: 2500, text: 'Two.' },
      ],
    },
    path: ['segments', 1, 'startMs'],
  },
  {
    schema: 'Transcript',
    name: 'last segment ends after the duration',
    value: { ...demoTranscript, durationMs: 8999 },
    path: ['segments', 1, 'endMs'],
  },
  {
    schema: 'Transcript',
    name: 'language is not a primary subtag',
    value: { ...demoTranscript, language: 'english' },
    path: ['language'],
  },
];
