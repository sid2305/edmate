// Task 11.1d Phase B: the browser side of the PUT route that edits one of the teacher's own
// scheduled classes (title/link/startsAt only). Client-safe: no node imports. Every call settles
// to a result and never rejects: a network failure, a non-2xx or a 2xx with a body of the wrong
// shape is a fixed error code (lessons: "a studio page that trusts a 200 response gets stuck").
import type { ErrorCode } from '@edmate/contracts';
import { z } from 'zod';
import { responseError } from '../../chat/sse';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const FAILED = { ok: false, code: 'provider_error', retryable: true } as const;

function fetcher(fetchImpl: FetchLike | undefined): FetchLike {
  return fetchImpl ?? ((url, init) => fetch(url, init));
}

export interface UpdateLiveClassInput {
  title: string;
  link: string;
  startsAt: string;
}

export type UpdateLiveClassResult =
  | { ok: true }
  | { ok: false; code: ErrorCode; retryable: boolean };

const UpdatedSchema = z.object({ updated: z.literal(true) });

/** PUT /api/studio/live-classes/:id -- edits title/link/startsAt before the class starts. */
export async function updateLiveClass(
  id: string,
  input: UpdateLiveClassInput,
  fetchImpl?: FetchLike,
): Promise<UpdateLiveClassResult> {
  let res: Response;
  try {
    res = await fetcher(fetchImpl)(`/api/studio/live-classes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
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
  const parsed = UpdatedSchema.safeParse(json);
  return parsed.success ? { ok: true } : FAILED;
}
