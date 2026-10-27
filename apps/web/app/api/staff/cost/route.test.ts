// Task 13.5 Phase B: the staff cost dashboard API over fake `usageLedger`, `subscriptions`,
// `packages` and `packageVersions` repos (no database; rule 4). Staff-only access itself is
// `withRole` + ROUTE_POLICY (route-coverage.test.ts), not retested here -- this file checks the
// join, the derived fields (never NaN/Infinity) and the error mapping.
import type { PackageConfig } from '@edmate/contracts';
import { RepositoryError, type Repositories } from '@edmate/db';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import type { Principal, RoleContext } from '../../../../src/auth/guard';
import { createStaffCostHandlers } from './handlers';

const ORIGIN = 'http://localhost:8080';
const PATH = '/api/staff/cost';
const STAFF: Principal = { userId: 'stf_1', role: 'staff' };
const NOW = new Date('2026-10-25T00:00:00.000Z').getTime();

const ctx = (principal: Principal = STAFF): RoleContext => ({
  principal,
  params: Promise.resolve({}),
});
const get = (query = ''): NextRequest =>
  new NextRequest(`${ORIGIN}${PATH}${query}`, { method: 'GET' });
async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

function config(
  o: Partial<PackageConfig> & { id: string; name: string; teacherId: string; agentId: string },
): PackageConfig {
  return {
    version: 1,
    moduleIds: [],
    helpCeiling: 'full',
    finalAnswers: 'show',
    lockedReply: 'locked',
    trialDays: 0,
    dailyMessageLimit: 20,
    liveClassesPerMonth: 2,
    skills: [],
    pricePerMonth: { amountMinor: 1999, currency: 'USD' },
    ...o,
  } as PackageConfig;
}

function memory() {
  const usageLedger = {
    costByPackageSince: vi.fn(async () => [
      {
        teacherId: 'tch_a',
        packageId: 'pkg_1',
        calls: 10,
        recorded: 8,
        unknown: 1,
        unpriced: 1,
        costMicroUsd: 500_000,
        distinctTurns: 5,
      },
      {
        teacherId: 'tch_a',
        packageId: 'pkg_2',
        calls: 0,
        recorded: 0,
        unknown: 0,
        unpriced: 0,
        costMicroUsd: 0,
        distinctTurns: 0,
      },
    ]),
  };
  const subscriptions = {
    activeCountByPackage: vi.fn(async () => [
      { teacherId: 'tch_a', packageId: 'pkg_1', activeStudents: 4 },
      { teacherId: 'tch_a', packageId: 'pkg_3', activeStudents: 2 },
    ]),
  };
  const packages = {
    listForTeacher: vi.fn(async () => [
      {
        packageId: 'pkg_1',
        agentId: 'agt_1',
        liveVersion: 2,
        config: config({
          id: 'pkg_1',
          name: 'Latest Draft Name',
          teacherId: 'tch_a',
          agentId: 'agt_1',
        }),
      },
      {
        packageId: 'pkg_2',
        agentId: 'agt_1',
        liveVersion: null,
        config: config({ id: 'pkg_2', name: 'No Live Yet', teacherId: 'tch_a', agentId: 'agt_1' }),
      },
      {
        packageId: 'pkg_3',
        agentId: 'agt_1',
        liveVersion: 1,
        config: config({ id: 'pkg_3', name: 'Pkg Three', teacherId: 'tch_a', agentId: 'agt_1' }),
      },
    ]),
  };
  const packageVersions = {
    get: vi.fn(async (_scope: unknown, ref: { packageId: string; version: number }) => {
      if (ref.packageId === 'pkg_1') {
        return config({
          id: 'pkg_1',
          name: 'Live Name',
          teacherId: 'tch_a',
          agentId: 'agt_1',
          pricePerMonth: { amountMinor: 2000, currency: 'USD' },
        });
      }
      if (ref.packageId === 'pkg_3') {
        return config({
          id: 'pkg_3',
          name: 'Pkg Three',
          teacherId: 'tch_a',
          agentId: 'agt_1',
          pricePerMonth: { amountMinor: 0, currency: 'USD' },
        });
      }
      return null;
    }),
  };
  const logs: string[] = [];
  const repos = { usageLedger, subscriptions, packages, packageVersions } as unknown as Pick<
    Repositories,
    'usageLedger' | 'subscriptions' | 'packages' | 'packageVersions'
  >;
  const h = createStaffCostHandlers({
    repos: () => repos,
    log: (line) => logs.push(line),
    now: () => NOW,
  });
  return { h, logs, usageLedger, subscriptions, packages, packageVersions };
}

describe('GET: the staff cost dashboard', () => {
  it('joins cost and active-count rows by (teacherId, packageId), no-store', async () => {
    const m = memory();
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { rows: Array<Record<string, unknown>> };
    expect(body.rows.map((r) => r.packageId)).toEqual(['pkg_1', 'pkg_2', 'pkg_3']);
  });

  it('pkg_1: live-version name and price win over the newest draft, cost/turn and cost/student derived', async () => {
    const m = memory();
    const res = await m.h.list(get(), ctx());
    const body = (await res.json()) as { rows: Array<Record<string, unknown>> };
    const row = body.rows.find((r) => r.packageId === 'pkg_1')!;
    expect(row.packageName).toBe('Live Name');
    expect(row.activeStudents).toBe(4);
    expect(row.costMicroUsd).toBe(500_000);
    expect(row.costPerTurnMicroUsd).toBe(100_000);
    expect(row.costPerActiveStudentMicroUsd).toBe(125_000);
    expect(row.pricePerMonth).toEqual({ amountMinor: 2000, currency: 'USD' });
    // (500_000 / 1e6) / (2000 / 100) * 100 = 0.5 / 20 * 100 = 2.5
    expect(row.costAsPctOfPrice).toBeCloseTo(2.5);
  });

  it('pkg_2: no live version yet, no active students, no usage -- every derived field is null, never NaN/Infinity', async () => {
    const m = memory();
    const res = await m.h.list(get(), ctx());
    const body = (await res.json()) as { rows: Array<Record<string, unknown>> };
    const row = body.rows.find((r) => r.packageId === 'pkg_2')!;
    expect(row.packageName).toBe('No Live Yet');
    expect(row.activeStudents).toBe(0);
    expect(row.costMicroUsd).toBe(0);
    expect(row.costPerTurnMicroUsd).toBeNull();
    expect(row.costPerActiveStudentMicroUsd).toBeNull();
    expect(row.pricePerMonth).toBeNull();
    expect(row.costAsPctOfPrice).toBeNull();
  });

  it('pkg_3: active students but no cost rows yet, and a zero price -- costAsPctOfPrice is null, not divide-by-zero', async () => {
    const m = memory();
    const res = await m.h.list(get(), ctx());
    const body = (await res.json()) as { rows: Array<Record<string, unknown>> };
    const row = body.rows.find((r) => r.packageId === 'pkg_3')!;
    expect(row.activeStudents).toBe(2);
    expect(row.costMicroUsd).toBe(0);
    expect(row.costPerActiveStudentMicroUsd).toBe(0);
    expect(row.pricePerMonth).toEqual({ amountMinor: 0, currency: 'USD' });
    expect(row.costAsPctOfPrice).toBeNull();
  });

  it('defaults to a 30-day window when since/until are absent', async () => {
    const m = memory();
    await m.h.list(get(), ctx());
    expect(m.usageLedger.costByPackageSince).toHaveBeenCalledWith({
      since: new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString(),
      until: new Date(NOW).toISOString(),
    });
  });

  it('a malformed since/until is 400 validation', async () => {
    const m = memory();
    const res = await m.h.list(get('?since=not-a-date&until=also-not'), ctx());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('validation');
  });

  it('a repository throw is 500 provider_error, with no raw error text', async () => {
    const m = memory();
    m.usageLedger.costByPackageSince.mockRejectedValueOnce(
      new RepositoryError('failed', 'usageLedger.costByPackageSince'),
    );
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    expect(await codeOf(res)).toBe('provider_error');
  });

  it('an unexpected throw logs only the error name', async () => {
    const m = memory();
    m.subscriptions.activeCountByPackage.mockRejectedValueOnce(
      new TypeError('secret detail person@example.test'),
    );
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    expect(m.logs).toEqual(['[staff] cost.list failed: TypeError']);
  });

  // 13.5a finding 5: a `scope`-kind RepositoryError from the repo can only be this route's own
  // bug (its Query schema already validated since/until), not bad user input -- 500, not 400.
  it('a scope-kind repository error is 500 provider_error, not 400', async () => {
    const m = memory();
    m.usageLedger.costByPackageSince.mockRejectedValueOnce(
      new RepositoryError('scope', 'usageLedger.costByPackageSince'),
    );
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    expect(await codeOf(res)).toBe('provider_error');
  });

  // 13.5a finding 3: a since/until span beyond MAX_SPAN_MS (366 days) is 400, a span just under
  // the cap still succeeds.
  describe('max span cap', () => {
    const since = '2020-01-01T00:00:00.000Z';

    it('a span over 366 days is 400 validation', async () => {
      const m = memory();
      const until = new Date(new Date(since).getTime() + 367 * 24 * 60 * 60 * 1000).toISOString();
      const res = await m.h.list(get(`?since=${since}&until=${until}`), ctx());
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe('validation');
    });

    it('a span of exactly 366 days still succeeds', async () => {
      const m = memory();
      const until = new Date(new Date(since).getTime() + 366 * 24 * 60 * 60 * 1000).toISOString();
      const res = await m.h.list(get(`?since=${since}&until=${until}`), ctx());
      expect(res.status).toBe(200);
    });
  });

  // 13.5a finding 4: the per-teacher and per-package reads below the top-level Promise.all are
  // parallelized too, but the joined rows must still be correct (behaviour-preserving).
  it('still joins correctly across two teachers x two packages-with-a-live-version after parallelizing the per-teacher/per-package reads', async () => {
    const usageLedger = {
      costByPackageSince: vi.fn(async () => [
        {
          teacherId: 'tch_a',
          packageId: 'pkg_1',
          calls: 2,
          recorded: 2,
          unknown: 0,
          unpriced: 0,
          costMicroUsd: 100,
          distinctTurns: 1,
        },
        {
          teacherId: 'tch_b',
          packageId: 'pkg_2',
          calls: 3,
          recorded: 3,
          unknown: 0,
          unpriced: 0,
          costMicroUsd: 200,
          distinctTurns: 2,
        },
      ]),
    };
    const subscriptions = {
      activeCountByPackage: vi.fn(async () => [
        { teacherId: 'tch_a', packageId: 'pkg_1', activeStudents: 1 },
        { teacherId: 'tch_b', packageId: 'pkg_2', activeStudents: 2 },
      ]),
    };
    const packages = {
      listForTeacher: vi.fn(async (scope: { teacherId: string }) =>
        scope.teacherId === 'tch_a'
          ? [
              {
                packageId: 'pkg_1',
                agentId: 'agt_1',
                liveVersion: 1,
                config: config({ id: 'pkg_1', name: 'A1', teacherId: 'tch_a', agentId: 'agt_1' }),
              },
            ]
          : [
              {
                packageId: 'pkg_2',
                agentId: 'agt_1',
                liveVersion: 1,
                config: config({ id: 'pkg_2', name: 'B2', teacherId: 'tch_b', agentId: 'agt_1' }),
              },
            ],
      ),
    };
    const packageVersions = {
      get: vi.fn(async (_scope: unknown, ref: { packageId: string; version: number }) =>
        ref.packageId === 'pkg_1'
          ? config({
              id: 'pkg_1',
              name: 'Live A1',
              teacherId: 'tch_a',
              agentId: 'agt_1',
              pricePerMonth: { amountMinor: 1000, currency: 'USD' },
            })
          : config({
              id: 'pkg_2',
              name: 'Live B2',
              teacherId: 'tch_b',
              agentId: 'agt_1',
              pricePerMonth: { amountMinor: 2000, currency: 'USD' },
            }),
      ),
    };
    const repos = { usageLedger, subscriptions, packages, packageVersions } as unknown as Pick<
      Repositories,
      'usageLedger' | 'subscriptions' | 'packages' | 'packageVersions'
    >;
    const h = createStaffCostHandlers({ repos: () => repos, now: () => NOW });
    const res = await h.list(get(), ctx());
    const body = (await res.json()) as { rows: Array<Record<string, unknown>> };
    expect(body.rows).toEqual([
      {
        teacherId: 'tch_a',
        packageId: 'pkg_1',
        packageName: 'Live A1',
        activeStudents: 1,
        costMicroUsd: 100,
        calls: 2,
        unknown: 0,
        unpriced: 0,
        costPerTurnMicroUsd: 100,
        costPerActiveStudentMicroUsd: 100,
        pricePerMonth: { amountMinor: 1000, currency: 'USD' },
        costAsPctOfPrice: 0.001,
      },
      {
        teacherId: 'tch_b',
        packageId: 'pkg_2',
        packageName: 'Live B2',
        activeStudents: 2,
        costMicroUsd: 200,
        calls: 3,
        unknown: 0,
        unpriced: 0,
        costPerTurnMicroUsd: 100,
        costPerActiveStudentMicroUsd: 100,
        pricePerMonth: { amountMinor: 2000, currency: 'USD' },
        costAsPctOfPrice: 0.001,
      },
    ]);
  });
});
