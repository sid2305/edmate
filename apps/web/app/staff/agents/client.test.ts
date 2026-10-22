// Task 12.4d: the browser side of the staff agents API. Every call settles to a result and never
// rejects: a network failure, a non-2xx, unreadable JSON or a 200 of the wrong shape is a fixed
// error code (lessons: "UI state and server replies: trust neither, reset everything").
import { describe, expect, it, vi } from 'vitest';
import { loadAgents, setApproval, setSubject } from './client';

const AGENT = {
  agentId: 'agt_1',
  teacherSlug: 'asha-math',
  status: 'draft' as const,
  liveVersion: null,
  regulatedSubject: null,
  approvedAt: null,
  approvedBy: null,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('loadAgents', () => {
  it('GETs the agent list with no-store', async () => {
    const f = vi.fn(async () => json({ agents: [AGENT] }));
    expect(await loadAgents(f)).toEqual({ ok: true, agents: [AGENT] });
    expect(f).toHaveBeenCalledWith('/api/staff/agents', { method: 'GET', cache: 'no-store' });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['unreadable JSON', async () => new Response('{nope', { status: 200 })],
    ['a wrong shape', async () => json({ agents: [{ agentId: 1 }] })],
    ['no agents key', async () => json({})],
  ])('%s is provider_error', async (_label, f) => {
    expect(await loadAgents(f)).toEqual({ ok: false, code: 'provider_error' });
  });

  it("a non-2xx keeps the server's error code", async () => {
    const f = async () => json({ error: { code: 'forbidden', message: 'no', retryable: false } }, 403);
    expect(await loadAgents(f)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('uses the global fetch by default', async () => {
    // test/setup.ts makes the global fetch reject: the call still settles.
    expect(await loadAgents()).toEqual({ ok: false, code: 'provider_error' });
  });
});

describe('setSubject', () => {
  it('POSTs the subject change', async () => {
    const f = vi.fn(async () => json({ agentId: 'agt_1', changed: true }));
    const result = await setSubject({ agentId: 'agt_1', subject: 'health', note: ' covers symptoms ' }, f);
    expect(result).toEqual({ ok: true, changed: true });
    expect(f).toHaveBeenCalledWith('/api/staff/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'subject', agentId: 'agt_1', subject: 'health', note: 'covers symptoms' }),
      cache: 'no-store',
    });
  });

  it('omits a blank note, sends null to clear the subject', async () => {
    const f = vi.fn(async () => json({ agentId: 'agt_1', changed: true }));
    await setSubject({ agentId: 'agt_1', subject: null, note: '   ' }, f);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ action: 'subject', agentId: 'agt_1', subject: null });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['unreadable JSON', async () => new Response('', { status: 200 })],
    ['a wrong shape', async () => json({ ok: true })],
    ['another agent in the reply', async () => json({ agentId: 'agt_2', changed: true })],
  ])('%s is provider_error', async (_label, f) => {
    expect(await setSubject({ agentId: 'agt_1', subject: 'health' }, f)).toEqual({
      ok: false,
      code: 'provider_error',
    });
  });

  it("a non-2xx keeps the server's error code", async () => {
    const f = async () => json({ error: { code: 'validation', message: 'no', retryable: false } }, 400);
    expect(await setSubject({ agentId: 'agt_1', subject: 'health' }, f)).toEqual({
      ok: false,
      code: 'validation',
    });
  });
});

describe('setApproval', () => {
  it('POSTs the approval change', async () => {
    const f = vi.fn(async () => json({ agentId: 'agt_1', changed: true }));
    const result = await setApproval({ agentId: 'agt_1', approved: true }, f);
    expect(result).toEqual({ ok: true, changed: true });
    expect(f).toHaveBeenCalledWith('/api/staff/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approval', agentId: 'agt_1', approved: true }),
      cache: 'no-store',
    });
  });

  it('trims a real note', async () => {
    const f = vi.fn(async () => json({ agentId: 'agt_1', changed: false }));
    await setApproval({ agentId: 'agt_1', approved: false, note: ' revoked ' }, f);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ action: 'approval', agentId: 'agt_1', approved: false, note: 'revoked' });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['a wrong shape', async () => json({ ok: true })],
    ['another agent in the reply', async () => json({ agentId: 'agt_2', changed: true })],
  ])('%s is provider_error', async (_label, f) => {
    expect(await setApproval({ agentId: 'agt_1', approved: true }, f)).toEqual({
      ok: false,
      code: 'provider_error',
    });
  });

  it("a non-2xx keeps the server's error code", async () => {
    const f = async () => json({ error: { code: 'not_found', message: 'no', retryable: false } }, 404);
    expect(await setApproval({ agentId: 'agt_1', approved: true }, f)).toEqual({
      ok: false,
      code: 'not_found',
    });
  });
});
