// Task 12.2c: the browser side of POST /api/sessions/:id/reports. A student reports an agent or
// teacher reply in their own chat; the reply is `{ ok: true }` both the first time and on a repeat
// report of the same message (12.2 design: idempotent, never an error on a duplicate).
import type { ErrorCode } from '@edmate/contracts';
import { z } from 'zod';
import { responseError } from './sse';

/**
 * A closed set of report reasons (12.2 Q2: no free text from students). Mirrors packages/db's
 * `REPORT_CATEGORIES` (`packages/db/src/repositories/map.ts`); duplicated here, not imported, so
 * this client bundle never pulls in `@edmate/db` (a server-only package).
 */
export const REPORT_CATEGORIES = [
  'harmful',
  'inappropriate',
  'wrong_information',
  'copyright',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ReportMessageInput {
  sessionId: string;
  agentId: string;
  messageId: string;
  category: ReportCategory;
}

export type ReportMessageResult = { ok: true } | { ok: false; code: ErrorCode; retryable: boolean };

const OkSchema = z.object({ ok: z.literal(true) });
const FAILED: ReportMessageResult = { ok: false, code: 'provider_error', retryable: true };

/** POSTs one report. Never throws: a network failure, a bad reply or a non-2xx status is a typed
 * failure the caller can show fixed text for (never the server's own message). */
export async function reportMessage(
  input: ReportMessageInput,
  fetchImpl?: FetchLike,
): Promise<ReportMessageResult> {
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init));
  let res: Response;
  try {
    res = await doFetch(`/api/sessions/${encodeURIComponent(input.sessionId)}/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: input.agentId,
        messageId: input.messageId,
        category: input.category,
      }),
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
  return OkSchema.safeParse(json).success ? { ok: true } : FAILED;
}
