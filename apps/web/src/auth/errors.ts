import type { ErrorCode } from '@edmate/contracts';

/** Codes a client may retry without changing anything (build plan § API surface, Errors). */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['provider_error', 'rate_limited']);

/** The API's error body, `{ error: { code, message, retryable } }`, never cached. */
export function apiError(code: ErrorCode, message: string, status: number): Response {
  return Response.json(
    { error: { code, message, retryable: RETRYABLE.has(code) } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}
