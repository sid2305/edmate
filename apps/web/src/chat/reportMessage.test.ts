// Task 12.2c: the browser side of POST /api/sessions/:id/reports.
import { describe, expect, it, vi } from 'vitest';
import { reportMessage } from './reportMessage';

const INPUT = { sessionId: 'ses_1', agentId: 'agt_1', messageId: 'msg_1', category: 'harmful' as const };

describe('reportMessage', () => {
  it('POSTs the right path, body and headers; { ok: true } on a 200', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const result = await reportMessage(INPUT, fetchImpl);
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/sessions/ses_1/reports',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: 'agt_1', messageId: 'msg_1', category: 'harmful' }),
        cache: 'no-store',
      }),
    );
  });

  it('{ ok: true } on a 201 too (a first-time report)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    expect(await reportMessage(INPUT, fetchImpl)).toEqual({ ok: true });
  });

  it('a non-2xx reply maps through the error body', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'not_found', message: 'nope', retryable: false } }), {
          status: 404,
        }),
    );
    expect(await reportMessage(INPUT, fetchImpl)).toEqual({ ok: false, code: 'not_found', retryable: false });
  });

  it('a network failure is a retryable provider_error, not a throw', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down');
    });
    expect(await reportMessage(INPUT, fetchImpl)).toEqual({
      ok: false,
      code: 'provider_error',
      retryable: true,
    });
  });

  it('a 200 reply that is not valid JSON is a provider_error', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }));
    expect(await reportMessage(INPUT, fetchImpl)).toEqual({
      ok: false,
      code: 'provider_error',
      retryable: true,
    });
  });

  it('a 200 reply with the wrong shape is a provider_error', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 }));
    expect(await reportMessage(INPUT, fetchImpl)).toEqual({
      ok: false,
      code: 'provider_error',
      retryable: true,
    });
  });

  it('the fetch call is encoded for a path-unsafe session id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await reportMessage({ ...INPUT, sessionId: 'a/b c' }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('/api/sessions/a%2Fb%20c/reports', expect.anything());
  });
});
