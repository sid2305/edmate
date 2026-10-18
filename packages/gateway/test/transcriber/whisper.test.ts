// The Whisper Transcriber (task 2.7, ADR-0005) over a mocked fetch: request shape, splitting and
// stitching (including a 60-minute recording), every failure loud, and the signed URL's query
// string never in an error, a log line or a trace.
import { TranscriptSchema, type TranscribeInput } from '@edmate/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Secret } from '../../src/keys/secret.js';
import type { AudioChunker } from '../../src/transcriber/chunking.js';
import { TranscriberError } from '../../src/transcriber/errors.js';
import {
  createWhisperTranscriber,
  type TranscriberTrace,
  type WhisperTranscriberOptions,
  WHISPER_MAX_UPLOAD_BYTES,
} from '../../src/transcriber/whisper.js';
import {
  MP3_FRAME_BYTES,
  MP3_FRAME_SAMPLES,
  MP3_SAMPLE_RATE,
  mp3,
  mp3FramesFor,
  wav,
} from '../fixtures/transcriber/audio.js';
import {
  evenSegments,
  verboseJson,
  whisperCutOff,
  whisperOk,
  whisperRateLimited,
  whisperServerError,
  whisperTooLarge,
} from '../fixtures/transcriber/whisper.js';
import { fakeKey, leaks } from '../helpers/fake-key.js';
import { type FakeResponse, fetchMock } from '../helpers/fetch-mock.js';

const HOST = 'storage.edmate.invalid';
const SIG = 'fake0sig0' + 'c0ffee'.repeat(4);
const SIGNED = `https://storage.edmate.invalid/recordings/class-7.mp3?X-Amz-Credential=fake0cred&X-Amz-Signature=${SIG}`;
const QUERY = new URL(SIGNED).search.slice(1);
const API = 'https://api.openai.invalid/v1';

const input: TranscribeInput = { url: SIGNED, mimeType: 'audio/mpeg' };

let console$: string[];

beforeEach(() => {
  console$ = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      console$.push(args.map(String).join(' '));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function build(responses: readonly FakeResponse[], over: Partial<WhisperTranscriberOptions> = {}) {
  const key = fakeKey();
  const mock = fetchMock(responses);
  const traces: TranscriberTrace[] = [];
  const t = createWhisperTranscriber(
    { apiKey: Secret.of(key) },
    {
      allowedHosts: [HOST],
      baseURL: API,
      fetch: mock.fetch,
      trace: (x) => traces.push(x),
      ...over,
    },
  );
  return { t, mock, traces, key };
}

/** Nothing the caller or an operator can see holds the signed URL's query string or the key. */
function expectNoLeak(texts: readonly string[], key: string) {
  for (const text of texts) {
    expect(text.includes(QUERY)).toBe(false);
    expect(text.includes(SIG)).toBe(false);
    expect(leaks(text, key)).toBe(false);
  }
}

async function failure(p: Promise<unknown>, key: string, traces: readonly TranscriberTrace[] = []) {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(TranscriberError);
    const e = err as TranscriberError;
    expect(e.cause).toBeUndefined();
    expectNoLeak(
      [
        e.message,
        String(e.stack),
        JSON.stringify(e),
        ...console$,
        ...traces.map((x) => JSON.stringify(x)),
      ],
      key,
    );
    return e;
  }
  throw new Error('expected a TranscriberError');
}

/** The multipart field `name` of an upload, as text. */
function field(body: string, name: string): string | undefined {
  const m = new RegExp(`name="${name.replace(/[[\]]/g, '\\$&')}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(
    body,
  );
  return m?.[1];
}

describe('createWhisperTranscriber: one upload', () => {
  it('downloads, uploads to /audio/transcriptions and returns a checked transcript', async () => {
    const audio = mp3(10);
    const { t, mock, traces, key } = build([{ body: audio }, whisperOk]);
    const out = await t.transcribe({ ...input, languageHint: 'en' });

    expect(out).toEqual({
      text: 'Compound interest grows. Every year it adds more.',
      language: 'en',
      durationMs: 4_500,
      segments: [
        { startMs: 0, endMs: 2_200, text: 'Compound interest grows.' },
        { startMs: 2_200, endMs: 4_400, text: 'Every year it adds more.' },
      ],
    });
    expect(TranscriptSchema.parse(out)).toEqual(out);
    expect(t.model).toBe('whisper-1');

    const [get, post] = mock.requests;
    expect(get?.url).toBe(SIGNED);
    expect(get?.headers['authorization']).toBeUndefined();
    expect(post?.url).toBe(`${API}/audio/transcriptions`);
    expect(post?.method).toBe('POST');
    expect(post?.headers['authorization'] === `Bearer ${key}`).toBe(true);
    expect(field(post!.body, 'model')).toBe('whisper-1');
    expect(field(post!.body, 'response_format')).toBe('verbose_json');
    expect(field(post!.body, 'timestamp_granularities[]')).toBe('segment');
    expect(field(post!.body, 'language')).toBe('en');
    expect(post!.body).toContain('filename="audio.mp3"');
    expect(post!.body).toContain('Content-Type: audio/mpeg');
    // The provider gets the bytes, never the signed URL.
    expect(post!.body.includes(QUERY)).toBe(false);
    expect(post!.body.includes(HOST)).toBe(false);

    expect(traces).toEqual([
      {
        event: 'transcriber.downloaded',
        source: `https://storage.edmate.invalid/recordings/class-7.mp3`,
        bytes: audio.byteLength,
        chunks: 1,
      },
      {
        event: 'transcriber.chunk',
        index: 0,
        of: 1,
        offsetMs: 0,
        bytes: audio.byteLength,
        segments: 2,
      },
    ]);
    expectNoLeak([...console$, ...traces.map((x) => JSON.stringify(x))], key);
    expect(console$).toEqual([]);
  });

  it('sends no language when there is no hint, drops blank segments and unknown languages', async () => {
    const { t, mock } = build([
      { body: mp3(4) },
      verboseJson({
        language: 'klingon',
        duration: 3,
        segments: [
          { start: 0, end: 1, text: '   ' },
          { start: 1, end: 2.5, text: ' Hello.' },
        ],
      }),
    ]);
    const out = await t.transcribe(input);
    expect(out).toEqual({
      text: 'Hello.',
      durationMs: 3_000,
      segments: [{ startMs: 1_000, endMs: 2_500, text: 'Hello.' }],
    });
    expect(field(mock.requests[1]!.body, 'language')).toBeUndefined();
  });

  it('uses the latest segment end as the duration when the provider reports none', async () => {
    const { t } = build([
      { body: mp3(4) },
      verboseJson({ duration: null, segments: [{ start: 0, end: 1.25, text: ' Hi.' }] }),
    ]);
    expect((await t.transcribe(input)).durationMs).toBe(1_250);
  });

  it('a custom model and the default OpenAI endpoint are used as given', async () => {
    const mock = fetchMock([{ body: mp3(2) }, whisperOk]);
    const t = createWhisperTranscriber(
      { apiKey: Secret.of(fakeKey()) },
      { allowedHosts: [HOST], model: 'whisper-2', fetch: mock.fetch },
    );
    expect(t.model).toBe('whisper-2');
    await t.transcribe(input);
    expect(new URL(mock.requests[1]!.url).host).toBe('api.openai.com');
    expect(field(mock.requests[1]!.body, 'model')).toBe('whisper-2');
  });

  it('refuses a non-https base URL at construction', () => {
    expect(() =>
      createWhisperTranscriber(
        { apiKey: Secret.of(fakeKey()) },
        { allowedHosts: [HOST], baseURL: 'http://api.openai.invalid/v1' },
      ),
    ).toThrow('openai: baseURL must be an https URL');
  });

  it('works with no trace hook and the global fetch untouched when a fetch is given', async () => {
    const mock = fetchMock([{ body: mp3(2) }, whisperOk]);
    const t = createWhisperTranscriber(
      { apiKey: Secret.of(fakeKey()) },
      { allowedHosts: [HOST], baseURL: API, fetch: mock.fetch },
    );
    expect((await t.transcribe(input)).segments).toHaveLength(2);
  });

  it('without a fetch option it uses the global fetch (which rule 4 turns off here)', async () => {
    const t = createWhisperTranscriber({ apiKey: Secret.of(fakeKey()) }, { allowedHosts: [HOST] });
    const err = await failure(t.transcribe(input), '');
    expect(err.message).toBe('transcriber: could not download the recording from storage');
  });
});

describe('createWhisperTranscriber: a 60-minute recording over 25 MB', () => {
  it('splits it, shifts every segment by its piece offset, and stitches the pieces in order', async () => {
    const frames = mp3FramesFor(60 * 60_000);
    const audio = mp3(frames);
    expect(audio.byteLength > 25 * 1024 * 1024).toBe(true);

    const perPiece = Math.floor(WHISPER_MAX_UPLOAD_BYTES / MP3_FRAME_BYTES);
    const pieceSeconds = [perPiece, frames - perPiece].map(
      (n) => (n * MP3_FRAME_SAMPLES) / MP3_SAMPLE_RATE,
    );
    const offsetMs = Math.round(pieceSeconds[0]! * 1000);
    // 10-second segments across each piece, as Whisper returns them.
    const first = evenSegments(Math.floor(pieceSeconds[0]! / 10), 10, 'Early');
    const second = evenSegments(Math.floor(pieceSeconds[1]! / 10), 10, 'Late');
    const { t, mock, traces } = build([
      { body: audio },
      verboseJson({ duration: pieceSeconds[0]!, segments: first }),
      verboseJson({ duration: pieceSeconds[1]!, segments: second, language: 'english' }),
    ]);

    const out = await t.transcribe(input);

    expect(mock.requests).toHaveLength(3);
    for (const r of mock.requests.slice(1))
      expect(r.body.length < 25 * 1024 * 1024 + 4_096).toBe(true);
    expect(out.segments).toHaveLength(first.length + second.length);
    expect(out.segments[0]).toEqual({ startMs: 0, endMs: 10_000, text: 'Early 1.' });
    expect(out.segments[first.length]).toEqual({
      startMs: offsetMs,
      endMs: offsetMs + 10_000,
      text: 'Late 1.',
    });
    const last = out.segments.at(-1)!;
    expect(last.text).toBe(`Late ${String(second.length)}.`);
    expect(last.startMs).toBe(offsetMs + (second.length - 1) * 10_000);
    expect(out.durationMs).toBe(offsetMs + Math.round(pieceSeconds[1]! * 1000));
    expect(Math.abs(out.durationMs - 60 * 60_000) < 100).toBe(true);
    expect(out.text.startsWith('Early 1. Early 2.')).toBe(true);
    expect(out.text.endsWith(`Late ${String(second.length)}.`)).toBe(true);
    expect(out.language).toBe('en');
    expect(TranscriptSchema.parse(out)).toEqual(out);
    expect(traces.map((x) => (x.event === 'transcriber.chunk' ? x.offsetMs : x.chunks))).toEqual([
      2,
      0,
      offsetMs,
    ]);
    // 28 MB through a multipart upload twice: well under a second alone, slower on a busy runner.
  }, 30_000);

  it('a silent piece in the middle is fine; the transcript still has every spoken piece', async () => {
    const chunker: AudioChunker = (audio) => [
      { bytes: audio.subarray(0, 10), mimeType: 'audio/mpeg', offsetMs: 0, durationMs: 1_000 },
      { bytes: audio.subarray(10, 20), mimeType: 'audio/mpeg', offsetMs: 1_000, durationMs: 1_000 },
      { bytes: audio.subarray(20, 30), mimeType: 'audio/mpeg', offsetMs: 2_000 },
    ];
    const { t } = build(
      [
        { body: new Uint8Array(30).fill(7) },
        verboseJson({ duration: 1, segments: [{ start: 0, end: 1, text: ' One.' }] }),
        verboseJson({ text: '', duration: 1, segments: [] }),
        verboseJson({ duration: null, segments: [{ start: 0, end: 0.5, text: ' Three.' }] }),
      ],
      { chunker, maxUploadBytes: 10 },
    );
    expect(await t.transcribe(input)).toEqual({
      text: 'One. Three.',
      language: 'en',
      durationMs: 2_500,
      segments: [
        { startMs: 0, endMs: 1_000, text: 'One.' },
        { startMs: 2_000, endMs: 2_500, text: 'Three.' },
      ],
    });
  });

  it('splits a WAV over the limit with the built-in chunker', async () => {
    const audio = wav(2_000); // 64,044 bytes
    const { t, mock } = build(
      [
        { body: audio },
        verboseJson({ duration: 1, segments: [{ start: 0, end: 1, text: ' A.' }] }),
        verboseJson({ duration: 1, segments: [{ start: 0.5, end: 1, text: ' B.' }] }),
      ],
      { maxUploadBytes: 32_044 },
    );
    const out = await t.transcribe({ ...input, mimeType: 'audio/wav' });
    expect(out.segments).toEqual([
      { startMs: 0, endMs: 1_000, text: 'A.' },
      { startMs: 1_500, endMs: 2_000, text: 'B.' },
    ]);
    expect(mock.requests[1]!.body).toContain('Content-Type: audio/wav');
  });
});

describe('createWhisperTranscriber: never silent', () => {
  it('an empty transcript is a validation error, not { text: "" }', async () => {
    const { t, key, traces } = build([{ body: mp3(2) }, verboseJson({ text: '', segments: [] })]);
    const err = await failure(t.transcribe(input), key, traces);
    expect(err.code).toBe('validation');
    expect(err.retryable).toBe(false);
    expect(err.message).toBe('transcriber: empty transcript: the provider returned no speech');
  });

  it('text with no segment timings fails (the port needs them)', async () => {
    const { t, key } = build([{ body: mp3(2) }, verboseJson({ text: 'Hello', segments: null })]);
    const err = await failure(t.transcribe(input), key);
    expect(err.code).toBe('provider_error');
    expect(err.message).toBe('transcriber: piece 1 of 1 came back without segment timings');
  });

  it('a response cut off mid-JSON is truncated', async () => {
    const { t, key } = build([{ body: mp3(2) }, whisperCutOff]);
    const err = await failure(t.transcribe(input), key);
    expect(err.code).toBe('provider_error');
    expect(err.reason).toBe('truncated');
    expect(err.retryable).toBe(false);
  });

  it('a piece the provider heard as much shorter than it is is truncated', async () => {
    const chunker: AudioChunker = (audio) => [
      { bytes: audio.subarray(0, 10), mimeType: 'audio/mpeg', offsetMs: 0, durationMs: 60_000 },
      {
        bytes: audio.subarray(10, 20),
        mimeType: 'audio/mpeg',
        offsetMs: 60_000,
        durationMs: 60_000,
      },
    ];
    const { t, key, mock } = build(
      [
        { body: new Uint8Array(20).fill(1) },
        verboseJson({ duration: 59, segments: [{ start: 0, end: 59, text: ' Fine.' }] }),
        verboseJson({ duration: 20, segments: [{ start: 0, end: 20, text: ' Cut.' }] }),
      ],
      { chunker, maxUploadBytes: 10 },
    );
    const err = await failure(t.transcribe(input), key);
    expect(err.reason).toBe('truncated');
    expect(err.message).toBe('transcriber: the provider heard only part of piece 2 of 2');
    expect(mock.requests).toHaveLength(3);
  });

  it('segments that break the schema (going backwards) fail validation', async () => {
    const { t, key } = build([
      { body: mp3(2) },
      verboseJson({
        duration: 5,
        segments: [
          { start: 2, end: 3, text: ' Later.' },
          { start: 1, end: 2, text: ' Earlier.' },
        ],
      }),
    ]);
    const err = await failure(t.transcribe(input), key);
    expect(err.code).toBe('validation');
    expect(err.message).toBe('transcriber: the stitched transcript failed validation');
  });

  it.each([
    ['429', whisperRateLimited, 'rate_limited', true],
    ['503', whisperServerError, 'provider_error', true],
    ['413', whisperTooLarge, 'input_too_large', false],
  ] as const)('HTTP %s from the provider is %s', async (_s, response, code, retryable) => {
    const { t, key, traces } = build([{ body: mp3(2) }, response]);
    const err = await failure(t.transcribe(input), key, traces);
    expect(err.code).toBe(code);
    expect(err.retryable).toBe(retryable);
    expect(err.message.includes('Rate limit reached')).toBe(false);
  });

  it('a provider call that hangs past the piece timeout is a retryable failure', async () => {
    const { t, key } = build([{ body: mp3(2) }, { body: '{"text":', hold: true }], {
      chunkTimeoutMs: 20,
    });
    const err = await failure(t.transcribe(input), key);
    expect(err.code).toBe('provider_error');
    expect(err.retryable).toBe(true);
  });

  it('a later piece failing fails the whole call: no partial transcript', async () => {
    const audio = mp3(4);
    const { t, key, mock } = build(
      [
        { body: audio },
        verboseJson({ duration: 0.2, segments: [{ start: 0, end: 0.1, text: ' A.' }] }),
        whisperServerError,
      ],
      { maxUploadBytes: 2 * MP3_FRAME_BYTES },
    );
    const err = await failure(t.transcribe(input), key);
    expect(err.code).toBe('provider_error');
    expect(mock.requests).toHaveLength(3);
  });
});

describe('createWhisperTranscriber: chunker problems', () => {
  it('a recording over the limit in a format the default chunker cannot split is input_too_large', async () => {
    const { t, key, mock } = build([{ body: new Uint8Array(50) }], { maxUploadBytes: 10 });
    const err = await failure(t.transcribe({ ...input, mimeType: 'audio/webm' }), key);
    expect(err.code).toBe('input_too_large');
    expect(mock.requests).toHaveLength(1);
  });

  it.each([
    ['no pieces', () => []],
    [
      'an empty piece',
      (a: Uint8Array) => [{ bytes: a.subarray(0, 0), mimeType: 'audio/mpeg', offsetMs: 0 }],
    ],
    [
      'a piece over the limit',
      (a: Uint8Array) => [{ bytes: a, mimeType: 'audio/mpeg', offsetMs: 0 }],
    ],
    [
      'pieces out of order',
      (a: Uint8Array) => [
        { bytes: a.subarray(0, 5), mimeType: 'audio/mpeg', offsetMs: 10 },
        { bytes: a.subarray(5, 10), mimeType: 'audio/mpeg', offsetMs: 0 },
      ],
    ],
  ] as const)('a chunker that returns %s is refused before any upload', async (_n, chunker) => {
    const { t, key, mock } = build([{ body: new Uint8Array(50) }], { maxUploadBytes: 10, chunker });
    const err = await failure(t.transcribe(input), key);
    expect(err.code).toBe('validation');
    expect(mock.requests).toHaveLength(1);
  });

  it('a chunker that throws something else becomes a fixed validation error', async () => {
    const chunker: AudioChunker = () => {
      throw new Error(`cannot split ${SIGNED}`);
    };
    const { t, key } = build([{ body: new Uint8Array(50) }], { maxUploadBytes: 10, chunker });
    const err = await failure(t.transcribe(input), key);
    expect(err.message).toBe('transcriber: the recording could not be split for upload');
  });
});

describe('createWhisperTranscriber: storage hosts (ADR-0005)', () => {
  it('an empty allowedHosts refuses every URL without any request', async () => {
    const { t, key, mock } = build([], { allowedHosts: [] });
    const err = await failure(t.transcribe(input), key);
    expect(err.code).toBe('forbidden');
    expect(mock.requests).toHaveLength(0);
  });

  it('a host not on the list is refused without any request', async () => {
    const { t, key, mock } = build([]);
    const err = await failure(
      t.transcribe({ ...input, url: `https://other.edmate.invalid/r.mp3?${QUERY}` }),
      key,
    );
    expect(err.code).toBe('forbidden');
    expect(mock.requests).toHaveLength(0);
  });

  it('a redirect to another host is refused and nothing reaches the provider', async () => {
    const { t, key, mock, traces } = build([
      { status: 302, body: '', headers: { location: `https://evil.invalid/x?${QUERY}` } },
      whisperOk,
    ]);
    const err = await failure(t.transcribe(input), key, traces);
    expect(err.code).toBe('forbidden');
    expect(mock.requests).toHaveLength(1);
    expect(traces).toEqual([]);
  });

  it('an invalid input is refused before any request, without echoing it', async () => {
    const { t, key, mock } = build([]);
    for (const bad of [
      { url: `http://storage.edmate.invalid/r.mp3?${QUERY}`, mimeType: 'audio/mpeg' },
      { url: SIGNED, mimeType: 'text/plain' },
      { url: ` ${SIGNED}`, mimeType: 'audio/mpeg' },
    ]) {
      const err = await failure(t.transcribe(bad), key);
      expect(err.code).toBe('validation');
    }
    expect(mock.requests).toHaveLength(0);
  });

  it('a mistyped allowedHosts entry fails at construction', () => {
    expect(() => build([], { allowedHosts: [`https://storage.edmate.invalid`] })).toThrow(
      /bare host/,
    );
  });
});
