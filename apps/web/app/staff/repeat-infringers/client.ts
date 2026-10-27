// Task 12.3d: the browser side of `/api/staff/repeat-infringers`. GET only -- the suspend action
// goes through the existing `decide` (imported from `../client`, same as `/staff`'s own queue),
// which still posts to `/api/staff/verifications`. Client-safe (no node imports). Settles to a
// result and never rejects: a network failure, a non-2xx, unreadable JSON or a 200 of the wrong
// shape is a fixed error code (lessons: "UI state and server replies: trust neither, reset
// everything"). No new schema: the reply is shape-identical to a verification lookup item (each
// flagged teacher names their current status), so `../client`'s own `LookupItemSchema` validates
// it.
import type { ErrorCode } from '@edmate/contracts';
import { z } from 'zod';
import { responseError } from '../../../src/chat/sse';
import { LookupItemSchema, type LookupItem } from '../client';

const ENDPOINT = '/api/staff/repeat-infringers';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type Failure = { ok: false; code: ErrorCode };
const FAILED: Failure = { ok: false, code: 'provider_error' };

const ListReply = z.object({ teachers: z.array(LookupItemSchema) });

/** GET the flagged teachers. */
export async function loadFlagged(
  fetchImpl?: FetchLike,
): Promise<{ ok: true; teachers: LookupItem[] } | Failure> {
  let res: Response | null;
  try {
    res = await (fetchImpl ?? ((u, i) => fetch(u, i)))(ENDPOINT, {
      method: 'GET',
      cache: 'no-store',
    });
  } catch {
    res = null;
  }
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, code: (await responseError(res)).code };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return FAILED;
  }
  const parsed = ListReply.safeParse(body);
  return parsed.success ? { ok: true, teachers: parsed.data.teachers } : FAILED;
}
