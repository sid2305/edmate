// Task 13.5 Phase B: the staff cost dashboard API (ROUTE_POLICY `/api/staff/**`: GET, staff only).
// Joins two unscoped, cross-teacher reads (13.5 Phase A: `usageLedger.costByPackageSince`,
// `subscriptions.activeCountByPackage`) by `(teacherId, packageId)`, then reads each package's
// name and live-version price (`packages.listForTeacher`, `packageVersions.get`, both teacher-
// scoped reads reused here with the row's own `teacherId` -- an internal value from the ledger,
// never client input). No write path, no money movement: the route is read-only. Repository
// errors and any unexpected throw map to a fixed code; only the error's name is logged, never a
// cost or price figure (not sensitive, but keeps the log line the same shape as every other staff
// route here).
import type { Money } from '@edmate/contracts';
import { RepositoryError, type Repositories } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { describeError } from '../../../../src/auth/describe-error';
import { apiError } from '../../../../src/auth/errors';
import type { RoleContext } from '../../../../src/auth/guard';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const IsoDate = z.iso.datetime();
const Query = z.strictObject({ since: IsoDate, until: IsoDate });

/** One package's cost dashboard row (web-local shape; see plan Open question 2). */
export interface CostRow {
  teacherId: string;
  packageId: string;
  packageName: string;
  activeStudents: number;
  costMicroUsd: number;
  calls: number;
  unknown: number;
  unpriced: number;
  costPerTurnMicroUsd: number | null;
  costPerActiveStudentMicroUsd: number | null;
  pricePerMonth: Money | null;
  costAsPctOfPrice: number | null;
}

export interface StaffCostBackend {
  repos(): Pick<Repositories, 'usageLedger' | 'subscriptions' | 'packages' | 'packageVersions'>;
  /** One line per unexpected failure (name only); defaults to console.error. */
  log?(line: string): void;
  /** Overridable clock for the default 30-day window; defaults to `Date.now`. */
  now?(): number;
}

/**
 * The join itself (13.5 Phase B): cost + active-count rows, by `(teacherId, packageId)`, plus
 * each package's name and live-version price. Shared by the API route and the server page (same
 * default-window read) so there is exactly one place this logic lives.
 */
export async function loadCostRows(
  repos: Pick<Repositories, 'usageLedger' | 'subscriptions' | 'packages' | 'packageVersions'>,
  window: { since: string; until: string },
): Promise<CostRow[]> {
  const [costRows, activeRows] = await Promise.all([
    repos.usageLedger.costByPackageSince(window),
    repos.subscriptions.activeCountByPackage(),
  ]);

  const activeByKey = new Map(activeRows.map((r) => [key(r.teacherId, r.packageId), r.activeStudents]));
  const refs = new Map<string, { teacherId: string; packageId: string }>();
  for (const r of costRows) refs.set(key(r.teacherId, r.packageId), r);
  for (const r of activeRows) refs.set(key(r.teacherId, r.packageId), r);
  const costByKey = new Map(costRows.map((r) => [key(r.teacherId, r.packageId), r]));

  // One `packages.listForTeacher` call per distinct teacher appearing in either result -- a
  // handful of teachers at pilot scale, not one call per package.
  const teacherIds = [...new Set([...refs.values()].map((r) => r.teacherId))];
  const packagesByTeacher = new Map<
    string,
    Awaited<ReturnType<Repositories['packages']['listForTeacher']>>
  >();
  for (const teacherId of teacherIds) {
    packagesByTeacher.set(teacherId, await repos.packages.listForTeacher({ teacherId }));
  }

  const rows: CostRow[] = [];
  for (const ref of refs.values()) {
    const k = key(ref.teacherId, ref.packageId);
    const cost = costByKey.get(k);
    const activeStudents = activeByKey.get(k) ?? 0;
    const teacherPackages = packagesByTeacher.get(ref.teacherId) ?? [];
    const pkg = teacherPackages.find((p) => p.packageId === ref.packageId);
    let packageName = pkg?.config.name ?? ref.packageId;
    let pricePerMonth: Money | null = null;
    if (pkg && pkg.liveVersion !== null) {
      const live = await repos.packageVersions.get(
        { teacherId: ref.teacherId },
        { packageId: ref.packageId, version: pkg.liveVersion },
      );
      if (live) {
        packageName = live.name;
        pricePerMonth = live.pricePerMonth;
      }
    }
    const costMicroUsd = cost?.costMicroUsd ?? 0;
    const distinctTurns = cost?.distinctTurns ?? 0;
    const costPerTurnMicroUsd = distinctTurns > 0 ? costMicroUsd / distinctTurns : null;
    const costPerActiveStudentMicroUsd = activeStudents > 0 ? costMicroUsd / activeStudents : null;
    const costAsPctOfPrice =
      pricePerMonth !== null && pricePerMonth.amountMinor > 0
        ? ((costMicroUsd / 1_000_000) / (pricePerMonth.amountMinor / 100)) * 100
        : null;
    rows.push({
      teacherId: ref.teacherId,
      packageId: ref.packageId,
      packageName,
      activeStudents,
      costMicroUsd,
      calls: cost?.calls ?? 0,
      unknown: cost?.unknown ?? 0,
      unpriced: cost?.unpriced ?? 0,
      costPerTurnMicroUsd,
      costPerActiveStudentMicroUsd,
      pricePerMonth,
      costAsPctOfPrice,
    });
  }
  rows.sort((a, b) => a.teacherId.localeCompare(b.teacherId) || a.packageId.localeCompare(b.packageId));
  return rows;
}

/** The default 30-day window ending now, ISO; the page and the route's query defaults share it. */
export function defaultWindow(nowMs: number): { since: string; until: string } {
  return { since: new Date(nowMs - THIRTY_DAYS_MS).toISOString(), until: new Date(nowMs).toISOString() };
}

const MSG = {
  validation: 'Check the request and try again.',
  failed: 'Something went wrong. Try again.',
} as const;

const ok = (body: unknown) =>
  Response.json(body, { status: 200, headers: { 'cache-control': 'no-store' } });
const validation = () => apiError('validation', MSG.validation, 400);

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

const key = (teacherId: string, packageId: string) => `${teacherId}\u0000${packageId}`;

export function createStaffCostHandlers(backend: StaffCostBackend): { list: Handler } {
  const log = backend.log ?? ((line: string) => console.error(line));
  const now = backend.now ?? (() => Date.now());
  const failed = (op: string, error: unknown) => {
    log(`[staff] cost.${op} failed: ${describeError(error)}`);
    return apiError('provider_error', MSG.failed, 500);
  };

  return {
    list: async (req, _ctx) => {
      const url = new URL(req.url);
      const sinceRaw = url.searchParams.get('since');
      const untilRaw = url.searchParams.get('until');
      const fallback = defaultWindow(now());
      const since = sinceRaw ?? fallback.since;
      const until = untilRaw ?? fallback.until;
      const parsed = Query.safeParse({ since, until });
      if (!parsed.success) return validation();

      try {
        const rows = await loadCostRows(backend.repos(), parsed.data);
        return ok({ rows });
      } catch (error) {
        if (error instanceof RepositoryError) {
          if (error.kind === 'invalid' || error.kind === 'scope') return validation();
        }
        return failed('list', error);
      }
    },
  };
}
