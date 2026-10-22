// Task 8.5 Phase C: the test-chat browser client. fetch is always injected (rule 4: no real
// network). Each call hits the Phase B route with the right payload, and every failure (network,
// non-2xx, a 200 with a malformed body) settles to an error code, never a rejection.
import { formatSseEvent } from '@edmate/harness';
import { describe, expect, it, vi } from 'vitest';
import type { StreamItem } from '../../chat/turnState';
import { sendTestTurn, startTestSession, submitCorrection } from './sendTestTurn';

type Call = [string, RequestInit];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const BODY = { agentId: 'agt_a', kind: 'message', text: 'Hi', lang: 'en', clientTs: '2026-10-22T10:00:00.000Z' } as const;
const CORRECTION = { moduleId: 'mod_1', question: 'What is 2+2?', badAnswer: '5', correctedAnswer: '4' };

describe('startTestSession', () => {
  it('POSTs the package to the agent test-sessions route and returns the session id', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i: RequestInit) => json({ sessionId: 'ses_1' }, 201));
    await expect(startTestSession('agt/a', 'pkg_1', fetchImpl)).resolves.toEqual({ ok: true, sessionId: 'ses_1' });
    const [url, init] = fetchImpl.mock.calls[0] as Call;
    expect(url).toBe('/api/studio/agents/agt%2Fa/test-sessions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ packageId: 'pkg_1' });
  });

  it('maps a non-2xx to its error code', async () => {
    const fetchImpl = async () => json({ error: { code: 'not_found', message: 'x', retryable: false } }, 404);
    await expect(startTestSession('agt_a', 'pkg_1', fetchImpl)).resolves.toEqual({
      ok: false,
      code: 'not_found',
      retryable: false,
    });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new Error('offline'))],
    ['a 200 that is not JSON', async () => new Response('<html>', { status: 200 })],
    ['a 200 of the wrong shape', async () => json({ id: 'ses_1' })],
  ])('%s is a retryable provider_error', async (_name, fetchImpl) => {
    await expect(startTestSession('agt_a', 'pkg_1', fetchImpl)).resolves.toEqual({
      ok: false,
      code: 'provider_error',
      retryable: true,
    });
  });
});

describe('sendTestTurn', () => {
  it('POSTs the turn to the test-session turns route and forwards every stream item', async () => {
    const fetchImpl = vi.fn(
      async (_u: string, _i: RequestInit) =>
        new Response(formatSseEvent({ type: 'token', text: 'Hi' }) + formatSseEvent({ type: 'done', messageId: 'm', usage: [] }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const items: StreamItem[] = [];
    await sendTestTurn({ sessionId: 'ses/1', body: BODY, onItem: (i) => items.push(i), fetch: fetchImpl }).done;
    const [url, init] = fetchImpl.mock.calls[0] as Call;
    expect(url).toBe('/api/studio/test-sessions/ses%2F1/turns');
    expect(JSON.parse(init.body as string)).toEqual(BODY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(items.map((i) => (i.kind === 'event' ? i.event.type : i.kind))).toEqual(['token', 'done', 'ended']);
  });

  it('a network failure or an abort ends the turn', async () => {
    const items: StreamItem[] = [];
    const fetchImpl = (_u: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const handle = sendTestTurn({ sessionId: 'ses_1', body: BODY, onItem: (i) => items.push(i), fetch: fetchImpl });
    handle.abort();
    await handle.done;
    expect(items).toEqual([{ kind: 'ended' }]);
  });
});

describe('submitCorrection', () => {
  it('POSTs the correction payload and returns the correction id', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i: RequestInit) =>
      json({ correctionId: 'cor_1', chunkId: 'chk_1', evalCaseId: 'tec_1' }, 201),
    );
    await expect(submitCorrection(CORRECTION, fetchImpl)).resolves.toEqual({ ok: true, correctionId: 'cor_1' });
    const [url, init] = fetchImpl.mock.calls[0] as Call;
    expect(url).toBe('/api/studio/corrections');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(CORRECTION);
  });

  it('maps a 400 to validation', async () => {
    const fetchImpl = async () => json({ error: { code: 'validation', message: 'x', retryable: false } }, 400);
    await expect(submitCorrection(CORRECTION, fetchImpl)).resolves.toEqual({
      ok: false,
      code: 'validation',
      retryable: false,
    });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new Error('offline'))],
    ['a 200 that is not JSON', async () => new Response('nope', { status: 201 })],
    ['a 200 of the wrong shape', async () => json({ correctionId: 'cor_1' }, 201)],
  ])('%s is a retryable provider_error', async (_name, fetchImpl) => {
    await expect(submitCorrection(CORRECTION, fetchImpl)).resolves.toEqual({
      ok: false,
      code: 'provider_error',
      retryable: true,
    });
  });
});
