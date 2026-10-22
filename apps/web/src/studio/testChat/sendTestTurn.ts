// Task 8.5 Phase C: the browser side of the teacher test-chat routes (shapes in
// docs/tasks/8.5b/handoff.md). Client-safe: no node imports.
// - `startTestSession(agentId, packageId)`: POST /api/studio/agents/:agentId/test-sessions.
// - `sendTestTurn(...)`: POST /api/studio/test-sessions/:id/turns, every stream item to `onItem`
//   (the student chat's SSE reader, so parsing and validation are not duplicated). A network
//   failure or an abort ends the turn with `ended`, which the reducer drops.
// - `submitCorrection(input)`: POST /api/studio/corrections.
// Every call settles to a result and never rejects: a network failure, a non-2xx or a 2xx with a
// body of the wrong shape is a fixed error code (lessons: "a studio page that trusts a 200").
import type { ErrorCode } from '@edmate/contracts';
import { z } from 'zod';
import { readTurnStream, responseError } from '../../chat/sse';
import type { SendTurnOptions, StartSessionResult, TurnHandle } from '../../chat/sendTurn';

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

/** A 2xx body checked against `schema`; null when it is not JSON or not that shape. */
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

const StartedSchema = z.object({ sessionId: z.string().min(1) });

export async function startTestSession(
  agentId: string,
  packageId: string,
  fetchImpl?: FetchLike,
): Promise<StartSessionResult> {
  const res = await postJson(
    fetcher(fetchImpl),
    `/api/studio/agents/${encodeURIComponent(agentId)}/test-sessions`,
    { packageId },
  );
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, ...(await responseError(res)) };
  const body = await readBody(res, StartedSchema);
  return body === null ? FAILED : { ok: true, sessionId: body.sessionId };
}

export function sendTestTurn({ sessionId, body, onItem, fetch: fetchImpl }: SendTurnOptions): TurnHandle {
  const controller = new AbortController();
  const doFetch = fetcher(fetchImpl);
  const done = (async () => {
    let res: Response;
    try {
      res = await doFetch(`/api/studio/test-sessions/${encodeURIComponent(sessionId)}/turns`, {
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

export interface CorrectionInput {
  moduleId: string;
  question: string;
  badAnswer: string;
  correctedAnswer: string;
}

export type CorrectionResult =
  | { ok: true; correctionId: string }
  | { ok: false; code: ErrorCode; retryable: boolean };

const RecordedSchema = z.object({
  correctionId: z.string().min(1),
  chunkId: z.string().min(1),
  evalCaseId: z.string().min(1),
});

export async function submitCorrection(input: CorrectionInput, fetchImpl?: FetchLike): Promise<CorrectionResult> {
  const res = await postJson(fetcher(fetchImpl), '/api/studio/corrections', input);
  if (res === null) return FAILED;
  if (!res.ok) return { ok: false, ...(await responseError(res)) };
  const body = await readBody(res, RecordedSchema);
  return body === null ? FAILED : { ok: true, correctionId: body.correctionId };
}
