// Turns whatever a provider SDK throws into a GatewayError: a fixed code from contracts, a
// retry hint for the router, and a message written here. Nothing from the provider error is
// kept (no body, url, request, headers or cause): any of them could carry the request.
import type { ErrorCode } from '@edmate/contracts';
import {
  APICallError,
  JSONParseError,
  NoObjectGeneratedError,
  RetryError,
  TypeValidationError,
} from 'ai';
import type { ProviderId } from '../keys/providers.js';

export type GatewayErrorCode = Extract<
  ErrorCode,
  'rate_limited' | 'input_too_large' | 'validation' | 'provider_error'
>;

export class GatewayError extends Error {
  override readonly name = 'GatewayError';

  constructor(
    readonly code: GatewayErrorCode,
    readonly retryable: boolean,
    readonly provider: ProviderId,
    message: string,
  ) {
    super(message);
  }

  toJSON(): {
    name: string;
    code: GatewayErrorCode;
    retryable: boolean;
    provider: ProviderId;
    message: string;
  } {
    return {
      name: this.name,
      code: this.code,
      retryable: this.retryable,
      provider: this.provider,
      message: this.message,
    };
  }
}

// Anthropic: "prompt is too long"; OpenAI-style servers: "context_length_exceeded",
// "maximum context length". Only tested against the body, never copied from it.
const CONTEXT_TOO_LONG =
  /prompt is too long|context[_ ]length|maximum context|context window|too many (?:input )?tokens/i;

function fromHttp(err: APICallError, provider: ProviderId): GatewayError {
  const status = err.statusCode;
  const make = (code: GatewayErrorCode, retryable: boolean, what: string) =>
    new GatewayError(code, retryable, provider, `${provider}: ${what}`);
  if (status === undefined) return make('provider_error', true, 'could not reach the provider');
  const http = `(HTTP ${status})`;
  if (status === 429) return make('rate_limited', true, `rate limited ${http}`);
  if (status === 413) return make('input_too_large', false, `input too large ${http}`);
  if (status === 400 || status === 404 || status === 422) {
    if (CONTEXT_TOO_LONG.test(err.responseBody ?? '')) {
      return make('input_too_large', false, `input too large for the model ${http}`);
    }
    return make('validation', false, `request rejected ${http}`);
  }
  // A provider key that is wrong or revoked: an operator problem, not the student's auth.
  if (status === 401 || status === 403) {
    return make('provider_error', false, `provider rejected Edmate's key ${http}`);
  }
  if (status === 408) return make('provider_error', true, `provider timed out ${http}`);
  if (status >= 500) return make('provider_error', true, `provider error ${http}`);
  return make('provider_error', false, `provider refused the request ${http}`);
}

export function mapProviderError(err: unknown, provider: ProviderId): GatewayError {
  if (err instanceof GatewayError) return err;
  if (RetryError.isInstance(err)) {
    if (err.lastError === undefined) {
      return new GatewayError(
        'provider_error',
        false,
        provider,
        `${provider}: unexpected provider failure`,
      );
    }
    return mapProviderError(err.lastError, provider);
  }
  if (APICallError.isInstance(err)) return fromHttp(err, provider);
  if (
    NoObjectGeneratedError.isInstance(err) ||
    TypeValidationError.isInstance(err) ||
    JSONParseError.isInstance(err)
  ) {
    return new GatewayError(
      'validation',
      false,
      provider,
      `${provider}: output did not match the requested schema`,
    );
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new GatewayError(
      'provider_error',
      true,
      provider,
      `${provider}: request timed out or was aborted`,
    );
  }
  return new GatewayError(
    'provider_error',
    false,
    provider,
    `${provider}: unexpected provider failure`,
  );
}
