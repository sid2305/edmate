// Task 9.4: the browser side of the two turn routes.
// - `startSession(agentId)`: POST /api/sessions, giving the session id or a fixed error code.
// - `sendTurn(...)`: POST /api/sessions/:id/turns and feed every stream item to `onItem`. The
//   handle's `abort()` cancels the request. A network failure or an abort ends the turn with
//   `ended`, which the reducer drops (never left streaming).
import type { ErrorCode } from '@edmate/contracts';
import { z } from 'zod';
import type { ClientTurn } from '../turn/clientInput';
import { readTurnStream, responseError } from './sse';
import type { StreamItem } from './turnState';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface SendTurnOptions {
  sessionId: string;
  body: ClientTurn;
  onItem: (item: StreamItem) => void;
  /** Injected in tests; the global fetch otherwise. */
  fetch?: FetchLike;
}

export interface TurnHandle {
  abort(): void;
  /** Settles when the stream is finished; never rejects. */
  done: Promise<void>;
}

export function sendTurn({ sessionId, body, onItem, fetch: fetchImpl }: SendTurnOptions): TurnHandle {
  const controller = new AbortController();
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init));
  const done = (async () => {
    let res: Response;
    try {
      res = await doFetch(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch {
      onItem({ kind: 'ended' });
      return;
    }
    for await (const item of readTurnStream(res)) onItem(item);
  })();
  return { abort: () => controller.abort(), done };
}

export type StartSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; code: ErrorCode; retryable: boolean };

const StartedSchema = z.object({ sessionId: z.string().min(1) });
const FAILED: StartSessionResult = { ok: false, code: 'provider_error', retryable: true };

export async function startSession(agentId: string, fetchImpl?: FetchLike): Promise<StartSessionResult> {
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init));
  let res: Response;
  try {
    res = await doFetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId }),
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
  const parsed = StartedSchema.safeParse(json);
  return parsed.success ? { ok: true, sessionId: parsed.data.sessionId } : FAILED;
}
