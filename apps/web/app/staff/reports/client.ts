// Task 12.2e: the browser side of `/api/staff/reports` and `/api/staff/takedowns` (12.2d).
// Client-safe (no node imports). Every call settles to a result and never rejects: a network
// failure, a non-2xx, unreadable JSON or a 200 of the wrong shape is a fixed error code (lessons:
// "UI state and server replies: trust neither, reset everything").
import { ChunkKindSchema, SourceRefSchema, type ErrorCode } from '@edmate/contracts';
import type { ReportCategory as DbReportCategory } from '@edmate/db';
import { z } from 'zod';
import { responseError } from '../../../src/chat/sse';

const REPORTS_ENDPOINT = '/api/staff/reports';
const TAKEDOWNS_ENDPOINT = '/api/staff/takedowns';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * 12.2a's REPORT_CATEGORIES, mirrored here so this client never imports `@edmate/db` (a
 * server-only package) at runtime. The `satisfies` clause and the exhaustiveness object below are
 * the compile-time-only (12.2i) guard: a category added to or dropped from `@edmate/db`'s
 * `REPORT_CATEGORIES` without a matching edit here fails `tsc`, not silently drifting.
 */
export const REPORT_CATEGORIES = [
  'harmful',
  'inappropriate',
  'wrong_information',
  'copyright',
  'other',
] as const satisfies readonly DbReportCategory[];
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/**
 * Never read at runtime: exists only so a `DbReportCategory` missing from the literal above fails
 * typecheck here too (the `satisfies` above alone would not catch a category dropped from this
 * list, only an extra/wrong one).
 */
const _categoryExhaustive: Record<DbReportCategory, true> = {
  harmful: true,
  inappropriate: true,
  wrong_information: true,
  copyright: true,
  other: true,
};
void _categoryExhaustive;

/** 12.2b's TAKEDOWN_KINDS, mirrored here for the same reason. */
export const TAKEDOWN_KINDS = ['document', 'agent'] as const;
export type TakedownKind = (typeof TAKEDOWN_KINDS)[number];

export const ReportSchema = z.strictObject({
  id: z.string().min(1),
  category: z.enum(REPORT_CATEGORIES),
  status: z.literal('open'),
  createdAt: z.string().min(1),
  messageId: z.string().min(1),
  teacherId: z.string().min(1).nullable(),
  agentId: z.string().min(1).nullable(),
  teacherSlug: z.string().min(1).nullable(),
  message: z
    .strictObject({
      role: z.enum(['agent', 'teacher']),
      text: z.string(),
      sources: z.array(SourceRefSchema).optional(),
      createdAt: z.string().min(1),
    })
    .nullable(),
  citedDocuments: z.array(
    z.strictObject({
      id: z.string().min(1),
      title: z.string(),
      kind: ChunkKindSchema,
      takenDown: z.boolean(),
    }),
  ),
});
export const ReportListSchema = z.array(ReportSchema);
export type ReportView = z.infer<typeof ReportSchema>;

export const TakedownSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(TAKEDOWN_KINDS),
  targetId: z.string().min(1),
  teacherId: z.string().min(1).nullable(),
  teacherSlug: z.string().min(1).nullable(),
  category: z.enum(REPORT_CATEGORIES),
  createdAt: z.string().min(1),
});
export const TakedownListSchema = z.array(TakedownSchema);
export type TakedownView = z.infer<typeof TakedownSchema>;

export type Failure = { ok: false; code: ErrorCode };
const FAILED: Failure = { ok: false, code: 'provider_error' };

async function call(
  fetchImpl: FetchLike | undefined,
  init: RequestInit,
  url: string,
): Promise<Response | null> {
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

const ReportsReply = z.object({ reports: ReportListSchema });
const ReviewReply = z.object({ id: z.string(), status: z.string() });
const TakedownsReply = z.object({ takedowns: TakedownListSchema });
const ActReply = z.object({
  id: z.string(),
  status: z.string(),
  agentStatus: z.enum(['draft', 'live']).optional(),
});

/** GET the open report queue. */
export async function loadReports(
  fetchImpl?: FetchLike,
): Promise<{ ok: true; reports: ReportView[] } | Failure> {
  const res = await call(fetchImpl, { method: 'GET', cache: 'no-store' }, REPORTS_ENDPOINT);
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  const body = await readBody(res, ReportsReply);
  return body === null ? FAILED : { ok: true, reports: body.reports };
}

export interface ReviewInput {
  reportId: string;
  decision: 'dismissed' | 'actioned';
  /** Free text; blank is omitted, anything else is trimmed. */
  note?: string;
}

/** POST one report's review. The reply must name the same report, else it's a failure. */
export async function reviewReport(
  input: ReviewInput,
  fetchImpl?: FetchLike,
): Promise<{ ok: true; id: string } | Failure> {
  const note = input.note?.trim() ?? '';
  const res = await call(
    fetchImpl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reportId: input.reportId,
        decision: input.decision,
        ...(note === '' ? {} : { note }),
      }),
      cache: 'no-store',
    },
    REPORTS_ENDPOINT,
  );
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  const body = await readBody(res, ReviewReply);
  if (body === null || body.id !== input.reportId) return FAILED;
  return { ok: true, id: body.id };
}

/** GET active takedowns. */
export async function loadTakedowns(
  fetchImpl?: FetchLike,
): Promise<{ ok: true; takedowns: TakedownView[] } | Failure> {
  const res = await call(fetchImpl, { method: 'GET', cache: 'no-store' }, TAKEDOWNS_ENDPOINT);
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  const body = await readBody(res, TakedownsReply);
  return body === null ? FAILED : { ok: true, takedowns: body.takedowns };
}

export interface CreateTakedownInput {
  kind: TakedownKind;
  targetId: string;
  category: ReportCategory;
  /** The report this takedown was decided from; the server closes it `actioned`. */
  reportId?: string;
  /** Free text; blank is omitted, anything else is trimmed. */
  note?: string;
}

async function postTakedown(
  body: Record<string, unknown>,
  fetchImpl: FetchLike | undefined,
): Promise<{ ok: true; id: string; agentStatus?: 'draft' | 'live' } | Failure> {
  const res = await call(
    fetchImpl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
    TAKEDOWNS_ENDPOINT,
  );
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  const parsed = await readBody(res, ActReply);
  return parsed === null
    ? FAILED
    : {
        ok: true,
        id: parsed.id,
        ...(parsed.agentStatus === undefined ? {} : { agentStatus: parsed.agentStatus }),
      };
}

/** POST `{ action: 'create' }`: take down one document or a whole agent. */
export async function createTakedown(
  input: CreateTakedownInput,
  fetchImpl?: FetchLike,
): Promise<{ ok: true; id: string } | Failure> {
  const note = input.note?.trim() ?? '';
  return postTakedown(
    {
      action: 'create',
      kind: input.kind,
      targetId: input.targetId,
      category: input.category,
      ...(input.reportId === undefined ? {} : { reportId: input.reportId }),
      ...(note === '' ? {} : { note }),
    },
    fetchImpl,
  );
}

export interface LiftTakedownInput {
  takedownId: string;
  /** Free text; blank is omitted, anything else is trimmed. */
  note?: string;
}

/** POST `{ action: 'lift' }`. The reply must name the same takedown, else it's a failure. */
export async function liftTakedown(
  input: LiftTakedownInput,
  fetchImpl?: FetchLike,
): Promise<{ ok: true; id: string; agentStatus?: 'draft' | 'live' } | Failure> {
  const note = input.note?.trim() ?? '';
  const result = await postTakedown(
    { action: 'lift', takedownId: input.takedownId, ...(note === '' ? {} : { note }) },
    fetchImpl,
  );
  if (result.ok && result.id !== input.takedownId) return FAILED;
  return result;
}
