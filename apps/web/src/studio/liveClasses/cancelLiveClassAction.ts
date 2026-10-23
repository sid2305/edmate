// Task 11.1d Phase B: the browser side of the DELETE route that cancels (soft) one of the
// teacher's own scheduled classes. Client-safe: no node imports. Every call settles to a result
// and never rejects (same shape as `updateLiveClassAction.ts` / `scheduleLiveClassAction.ts`).
import type { ErrorCode } from '@edmate/contracts';
import { z } from 'zod';
import { responseError } from '../../chat/sse';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const FAILED = { ok: false, code: 'provider_error', retryable: true } as const;

function fetcher(fetchImpl: FetchLike | undefined): FetchLike {
  return fetchImpl ?? ((url, init) => fetch(url, init));
}

export type CancelLiveClassResult =
  | { ok: true; cancelled: boolean }
  | { ok: false; code: ErrorCode; retryable: boolean };

const CancelledSchema = z.object({ cancelled: z.boolean() });

/** DELETE /api/studio/live-classes/:id -- cancels (soft); already-cancelled is a no-op. */
export async function cancelLiveClass(
  id: string,
  fetchImpl?: FetchLike,
): Promise<CancelLiveClassResult> {
  let res: Response;
  try {
    res = await fetcher(fetchImpl)(`/api/studio/live-classes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      cache: 'no-store',
    });
  } catch {
    return FAILED;
  }
  if (!res.ok) return { ok: false, ...(await responseError(res)) };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return FAILED;
  }
  const parsed = CancelledSchema.safeParse(json);
  return parsed.success ? { ok: true, cancelled: parsed.data.cancelled } : FAILED;
}
