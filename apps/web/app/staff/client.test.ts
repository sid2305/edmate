// Task 12.1b: the browser side of the staff verification API. Every call settles to a result and
// never rejects: a network failure, a non-2xx, unreadable JSON or a 200 of the wrong shape is a
// fixed error code (lessons: "UI state and server replies: trust neither, reset everything").
import { describe, expect, it, vi } from 'vitest';
import { decide, loadQueue } from './client';

const ITEM = { teacherId: 'tch_a', slug: 'asha-math', subject: 'Math', name: 'Asha', email: null };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('loadQueue', () => {
  it('GETs the queue with no-store and returns the parsed rows', async () => {
    const f = vi.fn(async () => json({ teachers: [ITEM] }));
    expect(await loadQueue(f)).toEqual({ ok: true, teachers: [ITEM] });
    expect(f).toHaveBeenCalledWith('/api/staff/verifications', { method: 'GET', cache: 'no-store' });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['unreadable JSON', async () => new Response('{nope', { status: 200 })],
    ['a wrong shape', async () => json({ teachers: [{ teacherId: 1 }] })],
    ['no teachers key', async () => json({})],
  ])('%s is provider_error', async (_label, f) => {
    expect(await loadQueue(f)).toEqual({ ok: false, code: 'provider_error' });
  });

  it("a non-2xx keeps the server's error code", async () => {
    const f = async () =>
      json({ error: { code: 'forbidden', message: 'no', retryable: false } }, 403);
    expect(await loadQueue(f)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('uses the global fetch by default', async () => {
    // test/setup.ts makes the global fetch reject: the call still settles.
    expect(await loadQueue()).toEqual({ ok: false, code: 'provider_error' });
  });
});

describe('decide', () => {
  it('POSTs the decision as JSON and returns the new status', async () => {
    const f = vi.fn(async () => json({ teacherId: 'tch_a', verificationStatus: 'rejected' }));
    const result = await decide({ teacherId: 'tch_a', status: 'rejected', reason: 'mismatch' }, f);
    expect(result).toEqual({ ok: true, verificationStatus: 'rejected' });
    expect(f).toHaveBeenCalledWith('/api/staff/verifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teacherId: 'tch_a', status: 'rejected', reason: 'mismatch' }),
      cache: 'no-store',
    });
  });

  it('omits a blank reason, trims a real one', async () => {
    const f = vi.fn(async () => json({ teacherId: 'tch_a', verificationStatus: 'verified' }));
    await decide({ teacherId: 'tch_a', status: 'verified', reason: '   ' }, f);
    await decide({ teacherId: 'tch_a', status: 'verified', reason: ' ok ' }, f);
    const bodies = f.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(bodies).toEqual([
      { teacherId: 'tch_a', status: 'verified' },
      { teacherId: 'tch_a', status: 'verified', reason: 'ok' },
    ]);
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['unreadable JSON', async () => new Response('', { status: 200 })],
    ['a wrong shape', async () => json({ ok: true })],
    ['another teacher in the reply', async () => json({ teacherId: 'tch_b', verificationStatus: 'verified' })],
    ['another status in the reply', async () => json({ teacherId: 'tch_a', verificationStatus: 'rejected' })],
  ])('%s is provider_error', async (_label, f) => {
    expect(await decide({ teacherId: 'tch_a', status: 'verified' }, f)).toEqual({
      ok: false,
      code: 'provider_error',
    });
  });

  it("a non-2xx keeps the server's error code (the not-self 403 is forbidden)", async () => {
    const f = async () =>
      json({ error: { code: 'forbidden', message: 'no', retryable: false } }, 403);
    expect(await decide({ teacherId: 'tch_a', status: 'verified' }, f)).toEqual({
      ok: false,
      code: 'forbidden',
    });
  });
});
