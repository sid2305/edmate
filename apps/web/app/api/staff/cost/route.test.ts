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
const get = (query = ''): NextRequest => new NextRequest(`${ORIGIN}${PATH}${query}`, { method: 'GET' });
async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

function config(o: Partial<PackageConfig> & { id: string; name: string; teacherId: string; agentId: string }): PackageConfig {
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
      { teacherId: 'tch_a', packageId: 'pkg_1', calls: 10, recorded: 8, unknown: 1, unpriced: 1, costMicroUsd: 500_000, distinctTurns: 5 },
      { teacherId: 'tch_a', packageId: 'pkg_2', calls: 0, recorded: 0, unknown: 0, unpriced: 0, costMicroUsd: 0, distinctTurns: 0 },
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
      { packageId: 'pkg_1', agentId: 'agt_1', liveVersion: 2, config: config({ id: 'pkg_1', name: 'Latest Draft Name', teacherId: 'tch_a', agentId: 'agt_1' }) },
      { packageId: 'pkg_2', agentId: 'agt_1', liveVersion: null, config: config({ id: 'pkg_2', name: 'No Live Yet', teacherId: 'tch_a', agentId: 'agt_1' }) },
      { packageId: 'pkg_3', agentId: 'agt_1', liveVersion: 1, config: config({ id: 'pkg_3', name: 'Pkg Three', teacherId: 'tch_a', agentId: 'agt_1' }) },
    ]),
  };
  const packageVersions = {
    get: vi.fn(async (_scope: unknown, ref: { packageId: string; version: number }) => {
      if (ref.packageId === 'pkg_1') {
        return config({ id: 'pkg_1', name: 'Live Name', teacherId: 'tch_a', agentId: 'agt_1', pricePerMonth: { amountMinor: 2000, currency: 'USD' } });
      }
      if (ref.packageId === 'pkg_3') {
        return config({ id: 'pkg_3', name: 'Pkg Three', teacherId: 'tch_a', agentId: 'agt_1', pricePerMonth: { amountMinor: 0, currency: 'USD' } });
      }
      return null;
    }),
  };
  const logs: string[] = [];
  const repos = { usageLedger, subscriptions, packages, packageVersions } as unknown as Pick<
    Repositories,
    'usageLedger' | 'subscriptions' | 'packages' | 'packageVersions'
  >;
  const h = createStaffCostHandlers({ repos: () => repos, log: (line) => logs.push(line), now: () => NOW });
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
    m.usageLedger.costByPackageSince.mockRejectedValueOnce(new RepositoryError('failed', 'usageLedger.costByPackageSince'));
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    expect(await codeOf(res)).toBe('provider_error');
  });

  it('an unexpected throw logs only the error name', async () => {
    const m = memory();
    m.subscriptions.activeCountByPackage.mockRejectedValueOnce(new TypeError('secret detail person@example.test'));
    const res = await m.h.list(get(), ctx());
    expect(res.status).toBe(500);
    expect(m.logs).toEqual(['[staff] cost.list failed: TypeError']);
  });
});
