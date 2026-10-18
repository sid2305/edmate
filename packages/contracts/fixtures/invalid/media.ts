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
    name: 'url with userinfo',
    value: { ...transcribeInputFull, url: 'https://user:pw@storage.example.com/rec/a.m4a' }, // secret-scan: allow fake userinfo, reserved domain
    path: ['url'],
  },
  {
    schema: 'TranscribeInput',
    name: 'url with only a user name',
    value: { ...transcribeInputFull, url: 'https://user@storage.example.com/rec/a.m4a' }, // secret-scan: allow fake userinfo, reserved domain
    path: ['url'],
  },
  {
    schema: 'TranscribeInput',
    name: 'url with leading whitespace',
    value: { ...transcribeInputFull, url: ' https://storage.example.com/rec/a.m4a' },
    path: ['url'],
  },
  {
    schema: 'TranscribeInput',
    name: 'url with trailing whitespace',
    value: { ...transcribeInputFull, url: 'https://storage.example.com/rec/a.m4a\n' },
    path: ['url'],
  },
  {
    schema: 'TranscribeInput',
    name: 'scheme-only url without //',
    value: { ...transcribeInputFull, url: 'https:storage.example.com/rec/a.m4a' },
    path: ['url'],
  },
  {
    schema: 'TranscribeInput',
    name: 'url with one slash',
    value: { ...transcribeInputFull, url: 'https:/storage.example.com/rec/a.m4a' },
    path: ['url'],
  },
  {
    schema: 'TranscribeInput',
    name: 'upper-case scheme',
    value: { ...transcribeInputFull, url: 'HTTPS://storage.example.com/rec/a.m4a' },
    path: ['url'],
  },
  {
    schema: 'TranscribeInput',
    name: 'mime type without a subtype',
    value: { ...transcribeInputFull, mimeType: 'audio/' },
    path: ['mimeType'],
  },
  {
    schema: 'TranscribeInput',
    name: 'mime type with a trailing slash part only',
    value: { ...transcribeInputFull, mimeType: 'video' },
    path: ['mimeType'],
  },
  {
    schema: 'TranscribeInput',
    name: 'mime type with whitespace',
    value: { ...transcribeInputFull, mimeType: 'audio/mp4 ' },
    path: ['mimeType'],
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
    name: 'an earlier overlapping segment ends after the duration',
    value: {
      ...demoTranscript,
      durationMs: 3000,
      segments: [
        { startMs: 0, endMs: 3500, text: 'One.' },
        { startMs: 1000, endMs: 2000, text: 'Two.' },
      ],
    },
    path: ['segments', 0, 'endMs'],
  },
  {
    schema: 'Transcript',
    name: 'language is not a primary subtag',
    value: { ...demoTranscript, language: 'english' },
    path: ['language'],
  },
];
