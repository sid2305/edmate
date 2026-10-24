// Task 12.1b: the browser side of the staff verification API. Every call settles to a result and
// never rejects: a network failure, a non-2xx, unreadable JSON or a 200 of the wrong shape is a
// fixed error code (lessons: "UI state and server replies: trust neither, reset everything").
import { describe, expect, it, vi } from 'vitest';
import { decide, findTeacherBySlug, loadQueue } from './client';

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

  it('carries `safety: true` only on a rejection that sets it, never `false` (9.3e)', async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string) as { status: string };
      return json({ teacherId: 'tch_a', verificationStatus: sent.status });
    });
    await decide({ teacherId: 'tch_a', status: 'rejected', reason: 'unsafe', safety: true }, f);
    await decide({ teacherId: 'tch_a', status: 'rejected', safety: false }, f);
    await decide({ teacherId: 'tch_a', status: 'verified', safety: true }, f);
    await decide({ teacherId: 'tch_a', status: 'verified' }, f);
    const bodies = f.mock.calls.map((c) => JSON.parse(c[1].body as string));
    expect(bodies).toEqual([
      { teacherId: 'tch_a', status: 'rejected', reason: 'unsafe', safety: true },
      { teacherId: 'tch_a', status: 'rejected' },
      { teacherId: 'tch_a', status: 'verified' },
      { teacherId: 'tch_a', status: 'verified' },
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

describe('findTeacherBySlug (9.3f)', () => {
  const LOOKUP_ITEM = { ...ITEM, verificationStatus: 'verified' as const };

  it('GETs the lookup endpoint with the slug, no-store, and returns the teacher', async () => {
    const f = vi.fn(async () => json({ teacher: LOOKUP_ITEM }));
    expect(await findTeacherBySlug('asha-math', f)).toEqual({ ok: true, teacher: LOOKUP_ITEM });
    expect(f).toHaveBeenCalledWith('/api/staff/verifications/lookup?slug=asha-math', {
      method: 'GET',
      cache: 'no-store',
    });
  });

  it('encodes the slug', async () => {
    const f = vi.fn(async () => json({ teacher: null }));
    await findTeacherBySlug('a b/c', f);
    expect(f).toHaveBeenCalledWith('/api/staff/verifications/lookup?slug=a%20b%2Fc', {
      method: 'GET',
      cache: 'no-store',
    });
  });

  it('an unknown slug is a null teacher, not a failure', async () => {
    const f = async () => json({ teacher: null });
    expect(await findTeacherBySlug('no-such-teacher', f)).toEqual({ ok: true, teacher: null });
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['unreadable JSON', async () => new Response('{nope', { status: 200 })],
    ['a wrong shape', async () => json({ teacher: { teacherId: 1 } })],
    ['no teacher key', async () => json({})],
  ])('%s is provider_error', async (_label, f) => {
    expect(await findTeacherBySlug('asha-math', f)).toEqual({ ok: false, code: 'provider_error' });
  });

  it("a non-2xx keeps the server's error code", async () => {
    const f = async () =>
      json({ error: { code: 'forbidden', message: 'no', retryable: false } }, 403);
    expect(await findTeacherBySlug('asha-math', f)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('uses the global fetch by default', async () => {
    // test/setup.ts makes the global fetch reject: the call still settles.
    expect(await findTeacherBySlug('asha-math')).toEqual({ ok: false, code: 'provider_error' });
  });
});
