// The one error type every payments adapter throws (ADR-0015 §7). Like GatewayError, it builds its
// own fixed words, drops any `cause`, and its JSON carries no request or response data, key,
// secret, header or URL.

/** ADR-0015 §7. The list is part of the port's contract: a new code needs an ADR. */
export const PAYMENTS_ERROR_CODES = [
  'invalid_signature',
  'stale_signature',
  'malformed_event',
  'unsupported',
  'not_found',
  'conflict',
  'validation',
  'rate_limited',
  'provider_error',
] as const;

export type PaymentsErrorCode = (typeof PAYMENTS_ERROR_CODES)[number];

const MESSAGES: Readonly<Record<PaymentsErrorCode, string>> = {
  invalid_signature: 'webhook signature is missing or does not match',
  stale_signature: 'webhook signature timestamp is outside the tolerance',
  malformed_event: 'webhook event is malformed or not understood',
  unsupported: 'payment operation or provider is not supported',
  not_found: 'payment object was not found',
  conflict: 'payment request conflicts with an earlier one or the current state',
  validation: 'payment request is invalid',
  rate_limited: 'payment provider rate limit reached',
  provider_error: 'payment provider failed',
};

export interface PaymentsErrorOptions {
  /**
   * Only for `provider_error`: true on 5xx and timeouts (the default), false on 401/403 so a bad
   * key is never retried. `rate_limited` is always retryable; every other code never is.
   */
  readonly retryable?: boolean;
}

export class PaymentsError extends Error {
  override readonly name = 'PaymentsError';
  readonly code: PaymentsErrorCode;
  readonly retryable: boolean;

  constructor(code: PaymentsErrorCode, options: PaymentsErrorOptions = {}) {
    // Fixed words only, and no `cause`: nothing a caller passes can reach the message.
    super(MESSAGES[code]);
    this.code = code;
    this.retryable =
      code === 'rate_limited' || (code === 'provider_error' && options.retryable !== false);
  }

  toJSON(): { name: string; code: PaymentsErrorCode; retryable: boolean; message: string } {
    return { name: this.name, code: this.code, retryable: this.retryable, message: this.message };
  }
}

/** True for a PaymentsError, optionally with the given code. */
export function isPaymentsError(err: unknown, code?: PaymentsErrorCode): err is PaymentsError {
  return err instanceof PaymentsError && (code === undefined || err.code === code);
}
