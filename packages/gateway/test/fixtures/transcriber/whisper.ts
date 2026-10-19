// Hand-built OpenAI /v1/audio/transcriptions responses (verbose_json, as whisper-1 returns them),
// shaped from OpenAI's public API reference. No real transcript.
import type { FakeResponse } from '../../helpers/fetch-mock.js';

export interface FakeSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The full verbose_json segment object (the SDK's schema needs every field). */
function segment(s: FakeSegment, id: number) {
  return {
    id,
    seek: 0,
    start: s.start,
    end: s.end,
    text: s.text,
    tokens: [50364, 400],
    temperature: 0,
    avg_logprob: -0.2,
    compression_ratio: 1.4,
    no_speech_prob: 0.01,
  };
}

export function verboseJson(opts: {
  text?: string;
  language?: string | null;
  duration?: number | null;
  segments?: readonly FakeSegment[] | null;
}): FakeResponse {
  const segments = opts.segments === null ? null : (opts.segments ?? []).map(segment);
  return {
    body: JSON.stringify({
      task: 'transcribe',
      text: opts.text ?? segments?.map((s) => s.text).join('') ?? '',
      language: opts.language === undefined ? 'english' : opts.language,
      duration: opts.duration === undefined ? 10 : opts.duration,
      ...(segments === null ? {} : { segments }),
    }),
  };
}

/** `count` segments of `every` seconds each, starting at 0, with numbered text. */
export function evenSegments(count: number, every: number, label = 'Part'): FakeSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    start: i * every,
    end: (i + 1) * every,
    text: ` ${label} ${String(i + 1)}.`,
  }));
}

export const whisperOk = verboseJson({
  duration: 4.5,
  segments: [
    { start: 0, end: 2.2, text: ' Compound interest grows.' },
    { start: 2.2, end: 4.4, text: ' Every year it adds more.' },
  ],
});

export const whisperRateLimited: FakeResponse = {
  status: 429,
  body: JSON.stringify({
    error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' },
  }),
};

export const whisperServerError: FakeResponse = {
  status: 503,
  body: JSON.stringify({ error: { message: 'The server is overloaded', type: 'server_error' } }),
};

export const whisperTooLarge: FakeResponse = {
  status: 413,
  body: JSON.stringify({
    error: { message: 'Maximum content size limit exceeded', type: 'invalid_request_error' },
  }),
};

/** A 200 whose body stops halfway through the JSON. */
export const whisperCutOff: FakeResponse = {
  body: '{"task":"transcribe","text":" Compound interest gr',
  contentType: 'application/json',
};
