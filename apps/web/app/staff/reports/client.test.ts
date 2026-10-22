// Task 12.2e: the browser side of the staff reports and takedowns API. Every call settles to a
// result and never rejects: a network failure, a non-2xx, unreadable JSON or a 200 of the wrong
// shape is a fixed error code (lessons: "UI state and server replies: trust neither, reset
// everything").
import { describe, expect, it, vi } from 'vitest';
import {
  createTakedown,
  liftTakedown,
  loadReports,
  loadTakedowns,
  reviewReport,
} from './client';

const REPORT = {
  id: 'rp_1',
  category: 'harmful' as const,
  status: 'open' as const,
  createdAt: '2026-10-22T00:00:00.000Z',
  messageId: 'msg_1',
  teacherId: 'tch_a',
  agentId: 'agt_1',
  teacherSlug: 'asha-math',
  message: { role: 'agent' as const, text: 'synthetic reply', createdAt: '2026-10-22T00:00:00.000Z' },
  citedDocuments: [],
};
const TAKEDOWN = {
  id: 'tkd_1',
  kind: 'document' as const,
  targetId: 'doc_1',
  teacherId: 'tch_a',
  teacherSlug: 'asha-math',
  category: 'copyright' as const,
  createdAt: '2026-10-22T00:00:00.000Z',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('loadReports', () => {
  it('GETs the open queue with no-store', async () => {
    const f = vi.fn(async () => json({ reports: [REPORT] }));
    expect(await loadReports(f)).toEqual({ ok: true, reports: [REPORT] });
    expect(f).toHaveBeenCalledWith('/api/staff/reports', { method: 'GET', cache: 'no-store' });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['unreadable JSON', async () => new Response('{nope', { status: 200 })],
    ['a wrong shape', async () => json({ reports: [{ id: 1 }] })],
    ['no reports key', async () => json({})],
  ])('%s is provider_error', async (_label, f) => {
    expect(await loadReports(f)).toEqual({ ok: false, code: 'provider_error' });
  });

  it("a non-2xx keeps the server's error code", async () => {
    const f = async () => json({ error: { code: 'forbidden', message: 'no', retryable: false } }, 403);
    expect(await loadReports(f)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('uses the global fetch by default', async () => {
    // test/setup.ts makes the global fetch reject: the call still settles.
    expect(await loadReports()).toEqual({ ok: false, code: 'provider_error' });
  });
});

describe('reviewReport', () => {
  it('POSTs a dismiss with a trimmed note', async () => {
    const f = vi.fn(async () => json({ id: 'rp_1', status: 'dismissed' }));
    const result = await reviewReport({ reportId: 'rp_1', decision: 'dismissed', note: ' seen ' }, f);
    expect(result).toEqual({ ok: true, id: 'rp_1' });
    expect(f).toHaveBeenCalledWith('/api/staff/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reportId: 'rp_1', decision: 'dismissed', note: 'seen' }),
      cache: 'no-store',
    });
  });

  it('omits a blank note', async () => {
    const f = vi.fn(async () => json({ id: 'rp_1', status: 'dismissed' }));
    await reviewReport({ reportId: 'rp_1', decision: 'dismissed', note: '   ' }, f);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ reportId: 'rp_1', decision: 'dismissed' });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['a wrong shape', async () => json({ ok: true })],
    ['another report in the reply', async () => json({ id: 'rp_2', status: 'dismissed' })],
  ])('%s is provider_error', async (_label, f) => {
    expect(await reviewReport({ reportId: 'rp_1', decision: 'dismissed' }, f)).toEqual({
      ok: false,
      code: 'provider_error',
    });
  });

  it("a non-2xx keeps the server's error code", async () => {
    const f = async () => json({ error: { code: 'not_found', message: 'no', retryable: false } }, 404);
    expect(await reviewReport({ reportId: 'rp_1', decision: 'dismissed' }, f)).toEqual({
      ok: false,
      code: 'not_found',
    });
  });
});

describe('loadTakedowns', () => {
  it('GETs active takedowns with no-store', async () => {
    const f = vi.fn(async () => json({ takedowns: [TAKEDOWN] }));
    expect(await loadTakedowns(f)).toEqual({ ok: true, takedowns: [TAKEDOWN] });
    expect(f).toHaveBeenCalledWith('/api/staff/takedowns', { method: 'GET', cache: 'no-store' });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['a wrong shape', async () => json({ takedowns: [{ id: 1 }] })],
  ])('%s is provider_error', async (_label, f) => {
    expect(await loadTakedowns(f)).toEqual({ ok: false, code: 'provider_error' });
  });
});

describe('createTakedown', () => {
  it('POSTs a document takedown linked to a report', async () => {
    const f = vi.fn(async () => json({ id: 'tkd_1', status: 'active' }));
    const result = await createTakedown(
      { kind: 'document', targetId: 'doc_1', category: 'copyright', reportId: 'rp_1', note: ' bad ' },
      f,
    );
    expect(result).toEqual({ ok: true, id: 'tkd_1' });
    expect(f).toHaveBeenCalledWith('/api/staff/takedowns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        kind: 'document',
        targetId: 'doc_1',
        category: 'copyright',
        reportId: 'rp_1',
        note: 'bad',
      }),
      cache: 'no-store',
    });
  });

  it('POSTs an agent takedown with no report', async () => {
    const f = vi.fn(async () => json({ id: 'tkd_2', status: 'active' }));
    await createTakedown({ kind: 'agent', targetId: 'agt_1', category: 'harmful' }, f);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ action: 'create', kind: 'agent', targetId: 'agt_1', category: 'harmful' });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['a wrong shape', async () => json({ ok: true })],
  ])('%s is provider_error', async (_label, f) => {
    expect(await createTakedown({ kind: 'agent', targetId: 'agt_1', category: 'harmful' }, f)).toEqual({
      ok: false,
      code: 'provider_error',
    });
  });

  it("a non-2xx keeps the server's error code", async () => {
    const f = async () => json({ error: { code: 'validation', message: 'no', retryable: false } }, 400);
    expect(await createTakedown({ kind: 'agent', targetId: 'agt_1', category: 'harmful' }, f)).toEqual({
      ok: false,
      code: 'validation',
    });
  });
});

describe('liftTakedown', () => {
  it('POSTs a lift', async () => {
    const f = vi.fn(async () => json({ id: 'tkd_1', status: 'lifted' }));
    const result = await liftTakedown({ takedownId: 'tkd_1', note: ' restored ' }, f);
    expect(result).toEqual({ ok: true, id: 'tkd_1' });
    expect(f).toHaveBeenCalledWith('/api/staff/takedowns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'lift', takedownId: 'tkd_1', note: 'restored' }),
      cache: 'no-store',
    });
  });

  it('fails when the reply names a different takedown', async () => {
    const f = vi.fn(async () => json({ id: 'tkd_2', status: 'lifted' }));
    expect(await liftTakedown({ takedownId: 'tkd_1' }, f)).toEqual({ ok: false, code: 'provider_error' });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['a wrong shape', async () => json({ ok: true })],
  ])('%s is provider_error', async (_label, f) => {
    expect(await liftTakedown({ takedownId: 'tkd_1' }, f)).toEqual({ ok: false, code: 'provider_error' });
  });
});
