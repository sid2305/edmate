// Task 8.7 Phase D: the browser side of the studio publish API (server shapes: publish.ts).
// Client-safe: zod only, no node or db imports. Every body read is try/caught and every server
// payload goes through `safeParse` (lessons: "UI state and server replies: trust neither"); a
// malformed reply is an error result, never a cast. Loose objects so an extra server field never
// breaks the page.
import { z } from 'zod';

const BASE = '/api/studio/publish';

const GroupSchema = z.object({
  origin: z.enum(['platform', 'agent']),
  group: z.string(),
  total: z.number(),
  passed: z.number(),
  minPercent: z.number(),
  pass: z.boolean(),
  reason: z.enum(['empty_group', 'below_threshold']).optional(),
});
const FailedCaseSchema = z.object({
  caseId: z.string(),
  origin: z.enum(['platform', 'agent']),
  group: z.string(),
  suite: z.string(),
  failedChecks: z.array(z.string()),
  errorCode: z.string().optional(),
  question: z.string().optional(),
});
const CategorySchema = z.object({
  key: z.string(),
  measured: z.boolean(),
  total: z.number(),
  passed: z.number(),
  percent: z.number().nullable(),
  pass: z.boolean(),
});
const RunSchema = z.object({
  runId: z.string(),
  status: z.enum(['queued', 'running', 'passed', 'failed', 'error']),
  changes: z.array(z.string()),
  groups: z.array(GroupSchema),
  errorCode: z.string().nullable(),
  failedCases: z.array(FailedCaseSchema),
  scorecard: z.object({ pass: z.boolean(), categories: z.array(CategorySchema) }).nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
});
const LatestSchema = z.object({ run: RunSchema.nullable() });
const StartedSchema = z.object({ runId: z.string() });

export type PublishGroup = z.infer<typeof GroupSchema>;
export type PublishFailedCaseView = z.infer<typeof FailedCaseSchema>;
export type PublishRun = z.infer<typeof RunSchema>;

/** A failed call: the HTTP status (0 = network), the error code and the server's `reason`. */
export interface PublishFailure {
  ok: false;
  status: number;
  code: string;
  reason?: string;
}
export type PublishResult<T> = { ok: true; value: T } | PublishFailure;

async function failure(res: Response): Promise<PublishFailure> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown }; reason?: unknown };
    const code = typeof body.error?.code === 'string' ? body.error.code : 'provider_error';
    const out: PublishFailure = { ok: false, status: res.status, code };
    if (typeof body.reason === 'string') out.reason = body.reason;
    return out;
  } catch {
    return { ok: false, status: res.status, code: 'provider_error' };
  }
}

async function call<T>(init: RequestInit, schema: z.ZodType<T>): Promise<PublishResult<T>> {
  let res: Response;
  try {
    res = await fetch(BASE, { cache: 'no-store', ...init });
  } catch {
    return { ok: false, status: 0, code: 'provider_error' };
  }
  if (!res.ok) return failure(res);
  try {
    const parsed = schema.safeParse(await res.json());
    if (parsed.success) return { ok: true, value: parsed.data };
  } catch {
    // fall through: an unreadable body is a malformed reply
  }
  return { ok: false, status: res.status, code: 'malformed' };
}

/** The teacher's latest gate run, or null before the first publish. */
export async function loadLatestRun(): Promise<PublishResult<PublishRun | null>> {
  const r = await call({ method: 'GET' }, LatestSchema);
  return r.ok ? { ok: true, value: r.value.run } : r;
}

/** Starts a publish; the gate runs on the worker. */
export async function startPublish(): Promise<PublishResult<{ runId: string }>> {
  return call(
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    StartedSchema,
  );
}
