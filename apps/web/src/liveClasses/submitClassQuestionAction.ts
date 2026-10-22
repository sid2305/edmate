// Task 11.2b: the browser side of POST /api/live-classes/[id]/questions. Client-safe: no node
// imports. Every call settles to a result and never rejects: a network failure, a non-2xx or a
// 2xx with a body of the wrong shape is a fixed error code (lessons: "a studio page that trusts a
// 200 response gets stuck").
import type { ErrorCode } from '@edmate/contracts';
import { z } from 'zod';
import { responseError } from '../chat/sse';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const FAILED = { ok: false, code: 'provider_error', retryable: true } as const;

function fetcher(fetchImpl: FetchLike | undefined): FetchLike {
  return fetchImpl ?? ((url, init) => fetch(url, init));
}

export type SubmitClassQuestionResult =
  | { ok: true; id: string }
  | { ok: false; code: ErrorCode; retryable: boolean };

const CreatedSchema = z.object({ id: z.string() });

/** POST /api/live-classes/:liveClassId/questions -- submits one pre-class question. */
export async function submitClassQuestion(
  liveClassId: string,
  text: string,
  fetchImpl?: FetchLike,
): Promise<SubmitClassQuestionResult> {
  let res: Response;
  try {
    res = await fetcher(fetchImpl)(`/api/live-classes/${encodeURIComponent(liveClassId)}/questions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
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
  const parsed = CreatedSchema.safeParse(json);
  return parsed.success ? { ok: true, id: parsed.data.id } : FAILED;
}
