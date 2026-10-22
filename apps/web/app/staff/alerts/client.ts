// Task 12.5c: the browser side of `/api/staff/alerts`. Client-safe (no node imports). Every call
// settles to a result and never rejects: a network failure, a non-2xx, unreadable JSON or a 200 of
// the wrong shape is a fixed error code (lessons: "UI state and server replies: trust neither,
// reset everything").
import type { ErrorCode } from '@edmate/contracts';
import { z } from 'zod';
import { responseError } from '../../../src/chat/sse';

const ENDPOINT = '/api/staff/alerts';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const AlertSchema = z.object({
  id: z.string().min(1),
  level: z.enum(['info', 'alert', 'critical']),
  kind: z.enum(['distress', 'abuse', 'misuse', 'other']),
  studentId: z.string(),
  teacherId: z.string(),
  sessionId: z.string(),
  teacherSlug: z.string().nullable(),
  excerptRedacted: z.string(),
  createdAt: z.string(),
  receivedAt: z.string(),
  escalatedAt: z.string().nullable(),
  escalationRound: z.number(),
  lastPagedAt: z.string().nullable(),
  acknowledgedAt: z.string().nullable(),
  acknowledgedBy: z.string().nullable(),
  ackNote: z.string().nullable(),
  overdue: z.boolean(),
});
export const AlertListSchema = z.array(AlertSchema);
export type AlertView = z.infer<typeof AlertSchema>;

export type Status = 'open' | 'all';

export type Failure = { ok: false; code: ErrorCode };
const FAILED: Failure = { ok: false, code: 'provider_error' };

const ListReply = z.object({ alerts: AlertListSchema });
const AckReply = z.object({ alertId: z.string(), acknowledged: z.boolean() });

async function call(fetchImpl: FetchLike | undefined, init: RequestInit, url: string): Promise<Response | null> {
  try {
    return await (fetchImpl ?? ((u, i) => fetch(u, i)))(url, init);
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

/** GET the alert inbox. */
export async function loadAlerts(
  status: Status = 'open',
  fetchImpl?: FetchLike,
): Promise<{ ok: true; alerts: AlertView[] } | Failure> {
  const res = await call(fetchImpl, { method: 'GET', cache: 'no-store' }, `${ENDPOINT}?status=${status}`);
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  const body = await readBody(res, ListReply);
  return body === null ? FAILED : { ok: true, alerts: body.alerts };
}

export interface AcknowledgeInput {
  alertId: string;
  /** Free text; blank is omitted, anything else is trimmed. */
  note?: string;
}

/** POST one acknowledgement. The reply must name the same alert, else it's a failure. */
export async function acknowledge(
  input: AcknowledgeInput,
  fetchImpl?: FetchLike,
): Promise<{ ok: true; acknowledged: boolean } | Failure> {
  const note = input.note?.trim() ?? '';
  const res = await call(
    fetchImpl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alertId: input.alertId, ...(note === '' ? {} : { note }) }),
      cache: 'no-store',
    },
    ENDPOINT,
  );
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  const body = await readBody(res, AckReply);
  if (body === null || body.alertId !== input.alertId) return FAILED;
  return { ok: true, acknowledged: body.acknowledged };
}
