// Task 12.5c: the browser side of the staff alert inbox API. Every call settles to a result and
// never rejects: a network failure, a non-2xx, unreadable JSON or a 200 of the wrong shape is a
// fixed error code (lessons: "UI state and server replies: trust neither, reset everything").
import { describe, expect, it, vi } from 'vitest';
import { acknowledge, loadAlerts } from './client';

const ALERT = {
  id: 'alr_1',
  level: 'alert' as const,
  kind: 'distress' as const,
  studentId: 'stu_1',
  teacherId: 'tch_a',
  sessionId: 'ses_1',
  teacherSlug: 'asha-math',
  excerptRedacted: 'synthetic excerpt',
  createdAt: '2026-10-22T10:00:00.000Z',
  receivedAt: '2026-10-22T10:00:01.000Z',
  escalatedAt: null,
  escalationRound: 0,
  lastPagedAt: null,
  acknowledgedAt: null,
  acknowledgedBy: null,
  ackNote: null,
  overdue: false,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('loadAlerts', () => {
  it('GETs the inbox with no-store, defaulting to status=open', async () => {
    const f = vi.fn(async () => json({ alerts: [ALERT] }));
    expect(await loadAlerts(undefined, f)).toEqual({ ok: true, alerts: [ALERT] });
    expect(f).toHaveBeenCalledWith('/api/staff/alerts?status=open', { method: 'GET', cache: 'no-store' });
  });

  it('passes status=all through', async () => {
    const f = vi.fn(async () => json({ alerts: [] }));
    await loadAlerts('all', f);
    expect(f).toHaveBeenCalledWith('/api/staff/alerts?status=all', { method: 'GET', cache: 'no-store' });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['unreadable JSON', async () => new Response('{nope', { status: 200 })],
    ['a wrong shape', async () => json({ alerts: [{ id: 1 }] })],
    ['no alerts key', async () => json({})],
  ])('%s is provider_error', async (_label, f) => {
    expect(await loadAlerts('open', f)).toEqual({ ok: false, code: 'provider_error' });
  });

  it("a non-2xx keeps the server's error code", async () => {
    const f = async () => json({ error: { code: 'forbidden', message: 'no', retryable: false } }, 403);
    expect(await loadAlerts('open', f)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('uses the global fetch by default', async () => {
    // test/setup.ts makes the global fetch reject: the call still settles.
    expect(await loadAlerts()).toEqual({ ok: false, code: 'provider_error' });
  });
});

describe('acknowledge', () => {
  it('POSTs the acknowledgement as JSON and returns the result', async () => {
    const f = vi.fn(async () => json({ alertId: 'alr_1', acknowledged: true }));
    const result = await acknowledge({ alertId: 'alr_1', note: 'followed up' }, f);
    expect(result).toEqual({ ok: true, acknowledged: true });
    expect(f).toHaveBeenCalledWith('/api/staff/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alertId: 'alr_1', note: 'followed up' }),
      cache: 'no-store',
    });
  });

  it('omits a blank note, trims a real one', async () => {
    const f = vi.fn(async () => json({ alertId: 'alr_1', acknowledged: true }));
    await acknowledge({ alertId: 'alr_1', note: '   ' }, f);
    await acknowledge({ alertId: 'alr_1', note: ' ok ' }, f);
    const bodies = f.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(bodies).toEqual([{ alertId: 'alr_1' }, { alertId: 'alr_1', note: 'ok' }]);
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['unreadable JSON', async () => new Response('', { status: 200 })],
    ['a wrong shape', async () => json({ ok: true })],
    ['another alert in the reply', async () => json({ alertId: 'alr_2', acknowledged: true })],
  ])('%s is provider_error', async (_label, f) => {
    expect(await acknowledge({ alertId: 'alr_1' }, f)).toEqual({ ok: false, code: 'provider_error' });
  });

  it("a non-2xx keeps the server's error code", async () => {
    const f = async () => json({ error: { code: 'not_found', message: 'no', retryable: false } }, 404);
    expect(await acknowledge({ alertId: 'alr_1' }, f)).toEqual({ ok: false, code: 'not_found' });
  });

  it('uses the global fetch by default', async () => {
    expect(await acknowledge({ alertId: 'alr_1' })).toEqual({ ok: false, code: 'provider_error' });
  });
});
