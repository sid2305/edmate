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
 * `cache-control`.
 */
export function apiError(
  code: ErrorCode,
  message: string,
  status: number,
  headers?: Readonly<Record<string, string>>,
): Response {
  return Response.json(
    { error: errorBody(code, message) },
    { status, headers: { ...headers, 'cache-control': 'no-store' } },
  );
}
