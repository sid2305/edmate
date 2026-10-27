// Task 12.3d: the browser side of `/api/staff/repeat-infringers`. GET only, settles to a result
// and never rejects, same contract as `../client`'s `loadQueue`.
import { describe, expect, it, vi } from 'vitest';
import { loadFlagged } from './client';

const TEACHER = {
  teacherId: 'tch_a',
  slug: 'asha-math',
  displayName: 'Asha',
  subject: 'Math',
  name: 'Asha K',
  email: 'asha@example.test',
  activeTakedowns: [],
  lastDecision: null,
  subjectHistory: [],
  verificationStatus: 'verified' as const,
};

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('loadFlagged', () => {
  it('GETs the endpoint and returns the flagged teachers', async () => {
    const fetchImpl = fetchReturning(200, { teachers: [TEACHER] });
    const result = await loadFlagged(fetchImpl);
    expect(result).toEqual({ ok: true, teachers: [TEACHER] });
    expect(fetchImpl).toHaveBeenCalledWith('/api/staff/repeat-infringers', {
      method: 'GET',
      cache: 'no-store',
    });
  });

  it('a network failure never rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await loadFlagged(fetchImpl)).toEqual({ ok: false, code: 'provider_error' });
  });

  it('a non-2xx reply maps to its error code', async () => {
    const fetchImpl = fetchReturning(403, { error: { code: 'forbidden', message: 'no' } });
    expect(await loadFlagged(fetchImpl)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('unreadable JSON is a failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }));
    expect(await loadFlagged(fetchImpl)).toEqual({ ok: false, code: 'provider_error' });
  });

  it('a 200 of the wrong shape is a failure', async () => {
    const fetchImpl = fetchReturning(200, { teachers: [{ oops: true }] });
    expect(await loadFlagged(fetchImpl)).toEqual({ ok: false, code: 'provider_error' });
  });
});
