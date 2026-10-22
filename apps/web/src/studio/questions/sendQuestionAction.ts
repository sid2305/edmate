// Task 8.9 Phase C: the browser side of Phase B's questions routes (shapes in
// docs/tasks/8.9b/handoff.md). Client-safe: no node imports. Every call settles to a result and
// never rejects: a network failure, a non-2xx or a 2xx with a body of the wrong shape is a fixed
// error code (lessons: "a studio page that trusts a 200 response gets stuck").
import type { ErrorCode } from '@edmate/contracts';
import { z } from 'zod';
import { responseError } from '../../chat/sse';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const FAILED = { ok: false, code: 'provider_error', retryable: true } as const;

function fetcher(fetchImpl: FetchLike | undefined): FetchLike {
  return fetchImpl ?? ((url, init) => fetch(url, init));
}

async function postJson(doFetch: FetchLike, url: string, body: unknown): Promise<Response | null> {
  try {
    return await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return null;
  }
}

async function readBody<T>(res: Response, schema: z.ZodType<T>): Promise<T | null> {
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export interface AnswerActionInput {
  questionId: string;
  moduleId: string;
  answer: string;
}

export type AnswerActionResult =
  | { ok: true; answered: number; students: number }
  | { ok: false; code: ErrorCode; retryable: boolean };

const AnswerResultSchema = z.object({
  answered: z.number(),
  students: z.number(),
  threadMessages: z.number(),
  noteChunkId: z.string(),
  evalCaseId: z.string(),
});

/** POST /api/studio/questions/answer -- answers the whole group that `questionId` belongs to. */
export async function answerGroup(
  input: AnswerActionInput,
  fetchImpl?: FetchLike,
): Promise<AnswerActionResult> {
  const res = await postJson(fetcher(fetchImpl), '/api/studio/questions/answer', input);
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, ...(await responseError(res)) };
  const body = await readBody(res, AnswerResultSchema);
  return body === null ? FAILED : { ok: true, answered: body.answered, students: body.students };
}

export type DismissActionResult = { ok: true } | { ok: false; code: ErrorCode; retryable: boolean };

/** POST /api/studio/questions/dismiss -- closes only the named question (plan Q1). */
export async function dismissQuestion(
  questionId: string,
  fetchImpl?: FetchLike,
): Promise<DismissActionResult> {
  const res = await postJson(fetcher(fetchImpl), '/api/studio/questions/dismiss', { questionId });
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, ...(await responseError(res)) };
  return { ok: true };
}
