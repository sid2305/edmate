// Task 13.5 Phase B: the browser side of `/api/staff/cost`. Every call settles to a result and
// never rejects: a network failure, a non-2xx, unreadable JSON or a 200 of the wrong shape is a
// fixed error code (lessons: "UI state and server replies: trust neither, reset everything").
import { describe, expect, it, vi } from 'vitest';
import { loadCost } from './client';

const ROW = {
  teacherId: 'tch_a',
  packageId: 'pkg_1',
  packageName: 'Algebra',
  activeStudents: 4,
  costMicroUsd: 500_000,
  calls: 10,
  unknown: 0,
  unpriced: 0,
  costPerTurnMicroUsd: 100_000,
  costPerActiveStudentMicroUsd: 125_000,
  pricePerMonth: { amountMinor: 2000, currency: 'USD' },
  costAsPctOfPrice: 2.5,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('loadCost', () => {
  it('GETs with no query params when no period is given', async () => {
    const f = vi.fn(async () => json({ rows: [ROW] }));
    expect(await loadCost({}, f)).toEqual({ ok: true, rows: [ROW] });
    expect(f).toHaveBeenCalledWith('/api/staff/cost', { method: 'GET', cache: 'no-store' });
  });

  it('GETs with since/until query params when given', async () => {
    const f = vi.fn(async (_url: string, _init: RequestInit) => json({ rows: [] }));
    await loadCost({ since: '2026-09-01T00:00:00.000Z', until: '2026-10-01T00:00:00.000Z' }, f);
    const url = f.mock.calls[0]![0];
    expect(url).toContain('since=2026-09-01T00%3A00%3A00.000Z');
    expect(url).toContain('until=2026-10-01T00%3A00%3A00.000Z');
  });

  it.each([
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['unreadable JSON', async () => new Response('{nope', { status: 200 })],
    ['a wrong shape', async () => json({ rows: [{ packageId: 1 }] })],
    ['no rows key', async () => json({})],
  ])('%s is provider_error', async (_label, f) => {
    expect(await loadCost({}, f)).toEqual({ ok: false, code: 'provider_error' });
  });

  it("a non-2xx keeps the server's error code", async () => {
    const f = async () => json({ error: { code: 'forbidden', message: 'no', retryable: false } }, 403);
    expect(await loadCost({}, f)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('a null price and null derived fields parse fine', async () => {
    const f = async () =>
      json({
        rows: [
          {
            ...ROW,
            pricePerMonth: null,
            costPerTurnMicroUsd: null,
            costPerActiveStudentMicroUsd: null,
            costAsPctOfPrice: null,
          },
        ],
      });
    const result = await loadCost({}, f);
    expect(result.ok).toBe(true);
  });
});
