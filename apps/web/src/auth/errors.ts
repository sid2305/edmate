import type { ErrorCode } from '@edmate/contracts';

/** Codes a client may retry without changing anything (build plan § API surface, Errors). */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['provider_error', 'rate_limited']);

/** The error object the API and server actions return. */
export interface ErrorBody {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { code, message, retryable: RETRYABLE.has(code) };
}

/**
 * The API's error body, `{ error: { code, message, retryable } }`, never cached. `headers`
 * (9.4e item 8) adds response headers such as `Retry-After`, without ever dropping
 * `cache-control`: the `'cache-control'?: never` member makes passing that key a type error, so a
 * caller cannot accidentally override the fixed `no-store` value below. Every entry in `headers`
 * must be caller-constant (a value the server computed itself, e.g. `String(RETRY_AFTER_SECONDS)`)
 * — never built from request-derived input such as echoing a client-sent header back (9.4e/9.4f
 * review LOW).
 */
export function apiError(
  code: ErrorCode,
  message: string,
  status: number,
  headers?: Readonly<Record<string, string>> & { 'cache-control'?: never },
): Response {
  return Response.json(
    { error: errorBody(code, message) },
    { status, headers: { ...headers, 'cache-control': 'no-store' } },
  );
}
