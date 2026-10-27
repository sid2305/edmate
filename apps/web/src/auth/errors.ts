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
 * (9.4e item 8) adds response headers such as `Retry-After`. The final `cache-control` is always
 * `no-store`: a real `Headers` instance is built from `headers` and then `set('cache-control',
 * 'no-store')` is called, which replaces any `cache-control`/`Cache-Control` entry regardless of
 * case, so a caller cannot override the fixed value. Every entry in `headers` must be
 * caller-constant (a value the server computed itself, e.g. `String(RETRY_AFTER_SECONDS)`) —
 * never built from request-derived input such as echoing a client-sent header back (9.4e/9.4f
 * review LOW).
 */
export function apiError(
  code: ErrorCode,
  message: string,
  status: number,
  headers?: Readonly<Record<string, string>>,
): Response {
  const h = new Headers(headers);
  h.set('cache-control', 'no-store');
  return Response.json({ error: errorBody(code, message) }, { status, headers: h });
}
