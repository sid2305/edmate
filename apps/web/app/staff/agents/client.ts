// Task 12.4d: the browser side of `/api/staff/agents`. Client-safe (no node imports). Every call
// settles to a result and never rejects: a network failure, a non-2xx, unreadable JSON or a 200 of
// the wrong shape is a fixed error code (lessons: "UI state and server replies: trust neither,
// reset everything").
import type { ErrorCode } from '@edmate/contracts';
import type { RegulatedSubject } from '@edmate/db';
import { z } from 'zod';
import { responseError } from '../../../src/chat/sse';

const ENDPOINT = '/api/staff/agents';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const AgentSchema = z.strictObject({
  agentId: z.string().min(1),
  teacherSlug: z.string().min(1).nullable(),
  status: z.enum(['draft', 'live', 'suspended']),
  liveVersion: z.number().int().min(1).nullable(),
  regulatedSubject: z.enum(['investing', 'health', 'law']).nullable(),
  approvedAt: z.string().nullable(),
  approvedBy: z.string().min(1).nullable(),
});
export const AgentListSchema = z.array(AgentSchema);
export type AgentView = z.infer<typeof AgentSchema>;

export type Failure = { ok: false; code: ErrorCode };
const FAILED: Failure = { ok: false, code: 'provider_error' };

const ListReply = z.object({ agents: AgentListSchema });
const UpdateReply = z.object({ agentId: z.string(), changed: z.boolean() });

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

/** GET the agent list. */
export async function loadAgents(fetchImpl?: FetchLike): Promise<{ ok: true; agents: AgentView[] } | Failure> {
  const res = await call(fetchImpl, { method: 'GET', cache: 'no-store' }, ENDPOINT);
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  const body = await readBody(res, ListReply);
  return body === null ? FAILED : { ok: true, agents: body.agents };
}

export interface SetSubjectInput {
  agentId: string;
  subject: RegulatedSubject | null;
  /** Free text; blank is omitted, anything else is trimmed. */
  note?: string;
}

export interface SetApprovalInput {
  agentId: string;
  approved: boolean;
  /** Free text; blank is omitted, anything else is trimmed. */
  note?: string;
}

async function post(
  body: Record<string, unknown>,
  agentId: string,
  fetchImpl: FetchLike | undefined,
): Promise<{ ok: true; changed: boolean } | Failure> {
  const res = await call(
    fetchImpl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
    ENDPOINT,
  );
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  const parsed = await readBody(res, UpdateReply);
  if (parsed === null || parsed.agentId !== agentId) return FAILED;
  return { ok: true, changed: parsed.changed };
}

/** POST a subject change. The reply must name the same agent, else it's a failure. */
export async function setSubject(
  input: SetSubjectInput,
  fetchImpl?: FetchLike,
): Promise<{ ok: true; changed: boolean } | Failure> {
  const note = input.note?.trim() ?? '';
  return post(
    { action: 'subject', agentId: input.agentId, subject: input.subject, ...(note === '' ? {} : { note }) },
    input.agentId,
    fetchImpl,
  );
}

/** POST an approval change. The reply must name the same agent, else it's a failure. */
export async function setApproval(
  input: SetApprovalInput,
  fetchImpl?: FetchLike,
): Promise<{ ok: true; changed: boolean } | Failure> {
  const note = input.note?.trim() ?? '';
  return post(
    { action: 'approval', agentId: input.agentId, approved: input.approved, ...(note === '' ? {} : { note }) },
    input.agentId,
    fetchImpl,
  );
}
