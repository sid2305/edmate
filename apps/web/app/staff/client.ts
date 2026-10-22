// Task 12.1b: the browser side of `/api/staff/verifications`. Client-safe (no node imports). Every
// call settles to a result and never rejects: a network failure, a non-2xx, unreadable JSON or a
// 200 of the wrong shape is a fixed error code (lessons: "UI state and server replies: trust
// neither, reset everything").
import type { ErrorCode } from '@edmate/contracts';
import { z } from 'zod';
import { responseError } from '../../src/chat/sse';

const ENDPOINT = '/api/staff/verifications';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const QueueItemSchema = z.object({
  teacherId: z.string().min(1),
  slug: z.string().min(1),
  subject: z.string(),
  name: z.string(),
  email: z.string().nullable(),
});
export const QueueSchema = z.array(QueueItemSchema);
export type QueueItem = z.infer<typeof QueueItemSchema>;

export type Decision = 'verified' | 'rejected';

export type Failure = { ok: false; code: ErrorCode };
const FAILED: Failure = { ok: false, code: 'provider_error' };

const QueueReply = z.object({ teachers: QueueSchema });
const DecisionReply = z.object({
  teacherId: z.string(),
  verificationStatus: z.enum(['verified', 'rejected']),
});

async function call(fetchImpl: FetchLike | undefined, init: RequestInit): Promise<Response | null> {
  try {
    return await (fetchImpl ?? ((u, i) => fetch(u, i)))(ENDPOINT, init);
  } catch {
    return null;
  }
}

async function readBody<T>(res: Response, schema: z.ZodType<T>): Promise<T | null> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** GET the pending queue. */
export async function loadQueue(
  fetchImpl?: FetchLike,
): Promise<{ ok: true; teachers: QueueItem[] } | Failure> {
  const res = await call(fetchImpl, { method: 'GET', cache: 'no-store' });
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  const body = await readBody(res, QueueReply);
  return body === null ? FAILED : { ok: true, teachers: body.teachers };
}

export interface DecideInput {
  teacherId: string;
  status: Decision;
  /** Free text; blank is omitted, anything else is trimmed. */
  reason?: string;
}

/** POST one approve/reject. The reply must name the same teacher and status, else it's a failure. */
export async function decide(
  input: DecideInput,
  fetchImpl?: FetchLike,
): Promise<{ ok: true; verificationStatus: Decision } | Failure> {
  const reason = input.reason?.trim() ?? '';
  const res = await call(fetchImpl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teacherId: input.teacherId,
      status: input.status,
      ...(reason === '' ? {} : { reason }),
    }),
    cache: 'no-store',
  });
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  const body = await readBody(res, DecisionReply);
  if (body === null || body.teacherId !== input.teacherId || body.verificationStatus !== input.status) {
    return FAILED;
  }
  return { ok: true, verificationStatus: body.verificationStatus };
}
