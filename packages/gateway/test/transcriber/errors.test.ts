// TranscriberError mapping (task 2.7): one fixed code and retry hint per failure, nothing from
// the provider's error kept.
import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { mapTranscriptionError, TranscriberError } from '../../src/transcriber/errors.js';

const SIGNED = 'https://storage.edmate.invalid/r.mp3?X-Amz-Signature=fake0sig0value';

function apiError(
  statusCode: number | undefined,
  responseBody = 'provider said something',
): APICallError {
  return new APICallError({
    message: `failed for ${SIGNED}`,
    url: 'https://api.openai.invalid/v1/audio/transcriptions',
    requestBodyValues: { file: SIGNED },
    ...(statusCode === undefined ? {} : { statusCode }),
    responseBody,
  });
}

describe('mapTranscriptionError', () => {
  it.each([
    [429, 'rate_limited', true],
    [413, 'input_too_large', false],
    [400, 'validation', false],
    [401, 'provider_error', false],
    [500, 'provider_error', true],
    [503, 'provider_error', true],
    [undefined, 'provider_error', true],
  ] as const)('HTTP %s is %s (retryable %s)', (status, code, retryable) => {
    const err = mapTranscriptionError(apiError(status));
    expect(err).toBeInstanceOf(TranscriberError);
    expect(err.code).toBe(code);
    expect(err.retryable).toBe(retryable);
    expect(err.reason).toBeUndefined();
    expect(err.message.startsWith('transcriber: openai: ')).toBe(true);
    const printed = [err.message, JSON.stringify(err), String(err.stack)].join('\n');
    expect(printed.includes('fake0sig0value')).toBe(false);
    expect(printed.includes('provider said')).toBe(false);
  });

  it('a 2xx whose body did not parse is a truncated provider_error, not retryable', () => {
    const err = mapTranscriptionError(apiError(200, '{"text":" half'));
    expect(err.code).toBe('provider_error');
    expect(err.retryable).toBe(false);
    expect(err.reason).toBe('truncated');
    expect(err.message).toBe(
      "transcriber: the provider's response was cut off or malformed (HTTP 200)",
    );
    expect(err.toJSON()).toEqual({
      name: 'TranscriberError',
      code: 'provider_error',
      retryable: false,
      message: "transcriber: the provider's response was cut off or malformed (HTTP 200)",
      reason: 'truncated',
    });
  });

  it('passes a TranscriberError through unchanged', () => {
    const own = new TranscriberError('forbidden', false, 'x');
    expect(mapTranscriptionError(own)).toBe(own);
    expect(own.toJSON()).toEqual({
      name: 'TranscriberError',
      code: 'forbidden',
      retryable: false,
      message: 'transcriber: x',
    });
  });

  it('a timeout is retryable; anything else is a fixed unexpected failure', () => {
    const timeout = Object.assign(new Error(`timed out ${SIGNED}`), { name: 'TimeoutError' });
    expect(mapTranscriptionError(timeout).retryable).toBe(true);
    const other = mapTranscriptionError(new Error(`boom ${SIGNED}`));
    expect(other.code).toBe('provider_error');
    expect(other.message).toBe('transcriber: openai: unexpected provider failure');
  });
});
