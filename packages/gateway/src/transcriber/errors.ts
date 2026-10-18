// Every Transcriber failure is a TranscriberError: a fixed code from contracts, a retry hint and a
// message written here. Nothing from the failing request is kept (no URL, body, headers or cause):
// the recording's signed URL is a bearer credential (ADR-0005) and must never reach a log line.
import type { ErrorCode } from '@edmate/contracts';
import { APICallError } from 'ai';
import { mapProviderError } from '../adapters/errors.js';

export type TranscriberErrorCode = Extract<
  ErrorCode,
  'validation' | 'forbidden' | 'not_found' | 'input_too_large' | 'rate_limited' | 'provider_error'
>;

/** `truncated`: the provider's answer, or the audio it decoded, was cut short. */
export type TranscriberErrorReason = 'truncated';

export class TranscriberError extends Error {
  override readonly name = 'TranscriberError';
  readonly reason?: TranscriberErrorReason;

  constructor(
    readonly code: TranscriberErrorCode,
    readonly retryable: boolean,
    message: string,
    reason?: TranscriberErrorReason,
  ) {
    super(`transcriber: ${message}`);
    if (reason !== undefined) this.reason = reason;
  }

  toJSON(): {
    name: string;
    code: TranscriberErrorCode;
    retryable: boolean;
    message: string;
    reason?: TranscriberErrorReason;
  } {
    return {
      name: this.name,
      code: this.code,
      retryable: this.retryable,
      message: this.message,
      ...(this.reason === undefined ? {} : { reason: this.reason }),
    };
  }
}

/** A provider (OpenAI) failure as a TranscriberError, via the gateway's own mapping. */
export function mapTranscriptionError(err: unknown): TranscriberError {
  if (err instanceof TranscriberError) return err;
  // A 2xx whose body did not parse: the answer was cut off or malformed, never an empty success.
  if (APICallError.isInstance(err) && err.statusCode !== undefined && err.statusCode < 300) {
    return new TranscriberError(
      'provider_error',
      false,
      `the provider's response was cut off or malformed (HTTP ${String(err.statusCode)})`,
      'truncated',
    );
  }
  const g = mapProviderError(err, 'openai');
  return new TranscriberError(g.code, g.retryable, g.message);
}
