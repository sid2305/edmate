// Task 9.4 Phase B: starting a session and sending a turn. fetch is injected (the global one
// rejects in tests); every item from the stream reaches the callback, and a network failure or an
// abort ends the turn (dropped), never leaves it streaming.
import { formatSseEvent } from '@edmate/harness';
import { describe, expect, it, vi } from 'vitest';
import { sendTurn, startSession } from './sendTurn';
import type { StreamItem } from './turnState';

const BODY = { agentId: 'agent-1', kind: 'message', text: 'Hi', lang: 'en', clientTs: '2026-10-20T10:00:00.000Z' } as const;

function sse(...chunks: string[]): Response {
  return new Response(chunks.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('sendTurn', () => {
  it('POSTs the client body as JSON to the session turns route and forwards every item', async () => {
    const fetchImpl = vi.fn(async () =>
      sse(formatSseEvent({ type: 'token', text: 'Hello' }), formatSseEvent({ type: 'done', messageId: 'm-1', usage: [] })),
    );
    const items: StreamItem[] = [];
    const handle = sendTurn({ sessionId: 'sess-1', body: BODY, onItem: (i) => items.push(i), fetch: fetchImpl });
    await handle.done;

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sessions/sess-1/turns');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json', accept: 'text/event-stream' });
    expect(JSON.parse(init.body as string)).toEqual(BODY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(items.map((i) => (i.kind === 'event' ? i.event.type : i.kind))).toEqual(['token', 'done', 'ended']);
  });

  it('escapes the session id in the path', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => sse());
    await sendTurn({ sessionId: 'a/b?c', body: BODY, onItem: () => {}, fetch: fetchImpl }).done;
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/sessions/a%2Fb%3Fc/turns');
  });

  it('a network failure ends the turn', async () => {
    const items: StreamItem[] = [];
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('offline');
    });
    await sendTurn({ sessionId: 's', body: BODY, onItem: (i) => items.push(i), fetch: fetchImpl }).done;
    expect(items).toEqual([{ kind: 'ended' }]);
  });

  it('abort() cancels the request and ends the turn', async () => {
    const items: StreamItem[] = [];
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const handle = sendTurn({ sessionId: 's', body: BODY, onItem: (i) => items.push(i), fetch: fetchImpl });
    handle.abort();
    await handle.done;
    expect(items).toEqual([{ kind: 'ended' }]);
  });

  it('uses the global fetch when none is injected', async () => {
    const items: StreamItem[] = [];
    // The test setup's global fetch rejects (no network), so the turn ends.
    await sendTurn({ sessionId: 's', body: BODY, onItem: (i) => items.push(i) }).done;
    expect(items).toEqual([{ kind: 'ended' }]);
  });
});

describe('startSession', () => {
  it('POSTs the agent id and returns the session id on 201', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ sessionId: 'sess-9' }, { status: 201 }));
    expect(await startSession('agent-1', fetchImpl)).toEqual({ ok: true, sessionId: 'sess-9' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sessions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ agentId: 'agent-1' });
  });

  it('returns the error code (not the server message) on a JSON error', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { code: 'no_access', message: 'SERVER WORDING', retryable: false } }, { status: 403 }),
    );
    expect(await startSession('agent-1', fetchImpl)).toEqual({ ok: false, code: 'no_access', retryable: false });
  });

  it('a 2xx with a malformed body is a provider_error', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: 1 }, { status: 201 }));
    expect(await startSession('agent-1', fetchImpl)).toEqual({ ok: false, code: 'provider_error', retryable: true });
  });

  it('a 2xx with a body that is not JSON is a provider_error', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 201 }));
    expect(await startSession('agent-1', fetchImpl)).toEqual({ ok: false, code: 'provider_error', retryable: true });
  });

  it('a network failure is a retryable provider_error', async () => {
    expect(await startSession('agent-1')).toEqual({ ok: false, code: 'provider_error', retryable: true });
  });
});
