// Provider errors become a GatewayError with a fixed code, a retry hint and a message the
// mapper writes itself. Nothing from the provider (body, url, request) is carried along.
import { inspect } from 'node:util';
import {
  APICallError,
  JSONParseError,
  NoObjectGeneratedError,
  RetryError,
  TypeValidationError,
} from 'ai';
import { describe, expect, it } from 'vitest';
import { GatewayError, mapProviderError, stopFailure } from '../../src/adapters/errors.js';
import { fakeKey, leaks } from '../helpers/fake-key.js';

function apiError(statusCode: number | undefined, responseBody: string, key: string): APICallError {
  return new APICallError({
    message: `provider said: ${responseBody} (key ${key})`,
    url: `https://provider.invalid/v1/messages?key=${key}`,
    requestBodyValues: { apiKey: key },
    ...(statusCode === undefined ? {} : { statusCode }),
    responseHeaders: { 'x-echo': key },
    responseBody,
    isRetryable: true,
    data: { key },
  });
}

/** Every text form of an error a log line, a trace or an API response could carry. */
function errorTexts(err: unknown): string[] {
  const e = err as Error;
  return [
    e.message,
    String(e.stack),
    JSON.stringify(e),
    inspect(e),
    inspect(e, { showHidden: true, depth: 10 }),
    String(e),
  ];
}

const cases: {
  label: string;
  status: number | undefined;
  body: string;
  code: GatewayError['code'];
  retryable: boolean;
}[] = [
  {
    label: '429',
    status: 429,
    body: '{"error":"slow down"}',
    code: 'rate_limited',
    retryable: true,
  },
  {
    label: '400 context (anthropic)',
    status: 400,
    body: '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 210000 tokens > 200000 maximum"}}',
    code: 'input_too_large',
    retryable: false,
  },
  {
    label: '400 context (openai-style)',
    status: 400,
    body: '{"error":{"code":"context_length_exceeded","message":"maximum context length is 8192 tokens"}}',
    code: 'input_too_large',
    retryable: false,
  },
  { label: '413', status: 413, body: 'too big', code: 'input_too_large', retryable: false },
  {
    label: '400 other',
    status: 400,
    body: '{"error":"bad field"}',
    code: 'validation',
    retryable: false,
  },
  {
    label: '404',
    status: 404,
    body: '{"error":"no such model"}',
    code: 'validation',
    retryable: false,
  },
  {
    label: '422 other',
    status: 422,
    body: '{"error":"unprocessable"}',
    code: 'validation',
    retryable: false,
  },
  {
    label: '401',
    status: 401,
    body: '{"error":"bad key"}',
    code: 'provider_error',
    retryable: false,
  },
  {
    label: '403',
    status: 403,
    body: '{"error":"forbidden"}',
    code: 'provider_error',
    retryable: false,
  },
  { label: '408', status: 408, body: 'timeout', code: 'provider_error', retryable: true },
  {
    label: '409 other 4xx',
    status: 409,
    body: 'conflict',
    code: 'provider_error',
    retryable: false,
  },
  { label: '500', status: 500, body: 'oops', code: 'provider_error', retryable: true },
  {
    label: '529 overloaded',
    status: 529,
    body: 'overloaded',
    code: 'provider_error',
    retryable: true,
  },
  {
    label: 'no status (connection failed)',
    status: undefined,
    body: '',
    code: 'provider_error',
    retryable: true,
  },
];

describe('mapProviderError: HTTP errors', () => {
  for (const c of cases) {
    it(`${c.label} -> ${c.code} (retryable ${c.retryable})`, () => {
      const key = fakeKey();
      const mapped = mapProviderError(apiError(c.status, c.body, key), 'anthropic');
      expect(mapped).toBeInstanceOf(GatewayError);
      expect(mapped.code).toBe(c.code);
      expect(mapped.retryable).toBe(c.retryable);
      expect(mapped.provider).toBe('anthropic');
      expect(mapped.message.startsWith('anthropic: ')).toBe(true);
      for (const text of errorTexts(mapped)) expect(leaks(text, key)).toBe(false);
      // The provider's own words are not echoed either.
      if (c.body.length > 0) expect(mapped.message.includes(c.body)).toBe(false);
      expect('cause' in mapped).toBe(false);
    });
  }

  it('a 400 with no body is a validation error', () => {
    const err = new APICallError({
      message: 'x',
      url: 'u',
      requestBodyValues: {},
      statusCode: 400,
    });
    expect(mapProviderError(err, 'anthropic').code).toBe('validation');
  });

  it('names the HTTP status in the message', () => {
    const mapped = mapProviderError(apiError(503, 'x', fakeKey()), 'openai-compatible');
    expect(mapped.message).toBe('openai-compatible: provider error (HTTP 503)');
  });

  it('unwraps a RetryError to its last error', () => {
    const key = fakeKey();
    const retry = new RetryError({
      message: `gave up (${key})`,
      reason: 'maxRetriesExceeded',
      errors: [apiError(500, 'x', key), apiError(429, 'x', key)],
    });
    const mapped = mapProviderError(retry, 'anthropic');
    expect(mapped.code).toBe('rate_limited');
    for (const text of errorTexts(mapped)) expect(leaks(text, key)).toBe(false);
  });

  it('maps an empty RetryError to a non-retryable provider error', () => {
    const retry = new RetryError({ message: 'none', reason: 'abort', errors: [] });
    const mapped = mapProviderError(retry, 'anthropic');
    expect(mapped.code).toBe('provider_error');
    expect(mapped.retryable).toBe(false);
  });
});

describe('mapProviderError: other errors', () => {
  it('a GatewayError passes through unchanged', () => {
    const original = new GatewayError('rate_limited', true, 'anthropic', 'x');
    expect(mapProviderError(original, 'openai-compatible')).toBe(original);
  });

  it('output that fails the schema -> validation', () => {
    const key = fakeKey();
    const errors = [
      new NoObjectGeneratedError({
        message: `no object ${key}`,
        text: key,
        response: { id: 'r', timestamp: new Date(0), modelId: 'm' },
        usage: {
          inputTokens: 1,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokens: 1,
          outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
          totalTokens: 2,
        },
        finishReason: 'stop',
      }),
      new TypeValidationError({ value: { key }, cause: new Error(key) }),
      new JSONParseError({ text: key, cause: new Error(key) }),
    ];
    for (const err of errors) {
      const mapped = mapProviderError(err, 'openai-compatible');
      expect(mapped.code).toBe('validation');
      expect(mapped.retryable).toBe(false);
      for (const text of errorTexts(mapped)) expect(leaks(text, key)).toBe(false);
    }
  });

  it('a timeout or abort -> retryable provider error', () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const err = new Error('took too long');
      err.name = name;
      const mapped = mapProviderError(err, 'anthropic');
      expect(mapped.code).toBe('provider_error');
      expect(mapped.retryable).toBe(true);
      expect(mapped.message).toBe('anthropic: request timed out or was aborted');
    }
  });

  it('anything else -> non-retryable provider error with a fixed message', () => {
    const key = fakeKey();
    for (const err of [new TypeError(`fetch failed ${key}`), key, undefined, null, { key }]) {
      const mapped = mapProviderError(err, 'anthropic');
      expect(mapped.code).toBe('provider_error');
      expect(mapped.retryable).toBe(false);
      expect(mapped.message).toBe('anthropic: unexpected provider failure');
      for (const text of errorTexts(mapped)) expect(leaks(text, key)).toBe(false);
    }
  });

  it('stopFailure: length -> truncated, content-filter -> content_filter, others -> none', () => {
    expect(stopFailure('length', 'anthropic')?.reason).toBe('truncated');
    expect(stopFailure('content-filter', 'anthropic')?.reason).toBe('content_filter');
    for (const r of ['stop', 'tool-calls', 'other', 'error', undefined]) {
      expect(stopFailure(r, 'anthropic')).toBeUndefined();
    }
    const err = stopFailure('length', 'openai-compatible')!;
    expect(JSON.parse(JSON.stringify(err))).toEqual({
      name: 'GatewayError',
      code: 'provider_error',
      retryable: false,
      provider: 'openai-compatible',
      message: 'openai-compatible: output was cut off at the token limit',
      reason: 'truncated',
    });
  });

  it('GatewayError serialises to its safe fields only', () => {
    const err = new GatewayError('validation', false, 'anthropic', 'anthropic: bad output');
    expect(JSON.parse(JSON.stringify(err))).toEqual({
      name: 'GatewayError',
      code: 'validation',
      retryable: false,
      provider: 'anthropic',
      message: 'anthropic: bad output',
    });
  });
});
