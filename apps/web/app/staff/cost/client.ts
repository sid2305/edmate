// Task 13.5 Phase B: the browser side of `/api/staff/cost`. Client-safe (no node imports). Every
// call settles to a result and never rejects: a network failure, a non-2xx, unreadable JSON or a
// 200 of the wrong shape is a fixed error code (lessons: "UI state and server replies: trust
// neither, reset everything").
import type { ErrorCode } from '@edmate/contracts';
import { z } from 'zod';
import { responseError } from '../../../src/chat/sse';

const ENDPOINT = '/api/staff/cost';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const MoneySchema = z.strictObject({ amountMinor: z.number().int().nonnegative(), currency: z.string().min(1) });

export const CostRowSchema = z.strictObject({
  teacherId: z.string().min(1),
  packageId: z.string().min(1),
  packageName: z.string(),
  activeStudents: z.number().int().nonnegative(),
  costMicroUsd: z.number().nonnegative(),
  calls: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  unpriced: z.number().int().nonnegative(),
  costPerTurnMicroUsd: z.number().nonnegative().nullable(),
  costPerActiveStudentMicroUsd: z.number().nonnegative().nullable(),
  pricePerMonth: MoneySchema.nullable(),
  costAsPctOfPrice: z.number().nullable(),
});
export const CostRowListSchema = z.array(CostRowSchema);
export type CostRowView = z.infer<typeof CostRowSchema>;

export type Failure = { ok: false; code: ErrorCode };
const FAILED: Failure = { ok: false, code: 'provider_error' };

const CostReply = z.object({ rows: CostRowListSchema });

export interface LoadCostInput {
  /** ISO date-time; omitted means the server's own default (last 30 days). */
  since?: string;
  until?: string;
}

/** GET the cost dashboard rows for a period. */
export async function loadCost(
  input: LoadCostInput = {},
  fetchImpl?: FetchLike,
): Promise<{ ok: true; rows: CostRowView[] } | Failure> {
  const params = new URLSearchParams();
  if (input.since !== undefined) params.set('since', input.since);
  if (input.until !== undefined) params.set('until', input.until);
  const qs = params.toString();
  const url = qs === '' ? ENDPOINT : `${ENDPOINT}?${qs}`;
  let res: Response;
  try {
    res = await (fetchImpl ?? ((u, i) => fetch(u, i)))(url, { method: 'GET', cache: 'no-store' });
  } catch {
    return FAILED;
  }
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return FAILED;
  }
  const parsed = CostReply.safeParse(body);
  return parsed.success ? { ok: true, rows: parsed.data.rows } : FAILED;
}
