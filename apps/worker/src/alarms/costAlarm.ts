// The monthly cost alarm per teacher (task 2.5). Sums the teacher's usage for the calendar month
// in UTC (evals excluded; they are billed to Edmate) and, at or above the threshold, pauses the
// teacher's free subscriptions and alerts staff and the teacher. Paid subscriptions are never
// paused: paid students keep access until a staff decision.
//
// Idempotent within a month: the repository skips any subscription it already paused since the
// month started, so a staff unpause holds; the alert itself repeats on every run over threshold.
// When the job runs is the composition root's business (scheduling is infra, not this module).
import type {
  CostAlarmEvent,
  CostAlarmSink,
  CostUsageReader,
  FreeSubscriptionPauser,
  PausedSubscription,
  TeacherCostTotals,
} from './types.js';

/**
 * Provisional platform-wide threshold: 50 USD per teacher per calendar month (lead, 18 Oct 2026).
 * Override with `thresholdMicroUsd`; 7.6 revisits the number with real cost data.
 */
export const COST_ALARM_THRESHOLD_MICRO_USD = 50_000_000;

export interface CostAlarmPorts {
  usage: CostUsageReader;
  subscriptions: FreeSubscriptionPauser;
  sink: CostAlarmSink;
  now: () => Date;
  /** Defaults to COST_ALARM_THRESHOLD_MICRO_USD. A positive safe integer. */
  thresholdMicroUsd?: number;
}

export interface CostAlarmResult {
  teacherId: string;
  outcome: 'below_threshold' | CostAlarmEvent['kind'];
  totals: TeacherCostTotals;
  /** Paused by this run. */
  paused: PausedSubscription[];
}

/** The contracts' id format, checked here because the worker has no zod. */
const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The first instant of `now`'s calendar month in UTC, as an ISO string. */
export function monthStartUtc(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error('cost alarm: invalid date');
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

const count = (n: unknown): boolean => Number.isSafeInteger(n) && (n as number) >= 0;

/** Totals that are not this teacher's, or not whole non-negative numbers, are never acted on. */
function checkTotals(t: TeacherCostTotals, teacherId: string): TeacherCostTotals {
  const numbers = [t.calls, t.recorded, t.unknown, t.unpriced, t.costMicroUsd];
  if (t.teacherId !== teacherId || !numbers.every(count)) {
    throw new Error('cost alarm: refused totals that do not match the teacher or are not counts');
  }
  return t;
}

function event(
  kind: CostAlarmEvent['kind'],
  teacherId: string,
  monthStartIso: string,
  totals: TeacherCostTotals,
  thresholdMicroUsd: number,
  paused: PausedSubscription[],
  pauseFailed: boolean,
): CostAlarmEvent {
  return {
    kind,
    recipients: kind === 'threshold_reached' ? ['staff', 'teacher'] : ['staff'],
    teacherId,
    monthStartIso,
    costMicroUsd: totals.costMicroUsd,
    thresholdMicroUsd,
    unknownCalls: totals.unknown,
    unpricedCalls: totals.unpriced,
    pausedSubscriptionIds: paused.map((p) => p.subscriptionId),
    pausedPackageIds: [...new Set(paused.map((p) => p.packageId))],
    pauseFailed,
  };
}

/**
 * Checks one teacher's month. Throws on a bad teacher id or threshold (before any read), on a
 * failed read, and on a failed pause or alert, so the caller's job is retried; a failed pause is
 * still alerted first (`pauseFailed: true`) so staff can act by hand.
 */
export async function checkTeacherCost(
  teacherId: string,
  ports: CostAlarmPorts,
): Promise<CostAlarmResult> {
  if (typeof teacherId !== 'string' || !ID.test(teacherId)) {
    throw new Error('cost alarm: invalid teacher id');
  }
  const threshold = ports.thresholdMicroUsd ?? COST_ALARM_THRESHOLD_MICRO_USD;
  if (!Number.isSafeInteger(threshold) || threshold <= 0) {
    throw new Error('cost alarm: the threshold must be a positive whole number of micro-USD');
  }
  const scope = { teacherId };
  const monthStart = monthStartUtc(ports.now());
  const totals = checkTotals(await ports.usage.sumForTeacherSince(scope, monthStart), teacherId);

  if (totals.costMicroUsd < threshold) {
    // The known cost is below the line; calls with no cost mean the real total may not be.
    if (totals.unknown + totals.unpriced === 0) {
      return { teacherId, outcome: 'below_threshold', totals, paused: [] };
    }
    await ports.sink.notify(
      event('cost_incomplete', teacherId, monthStart, totals, threshold, [], false),
    );
    return { teacherId, outcome: 'cost_incomplete', totals, paused: [] };
  }

  const reason =
    `cost alarm ${monthStart.slice(0, 7)}: ${totals.costMicroUsd} micro-USD >= ` +
    `threshold ${threshold} micro-USD`;
  let paused: PausedSubscription[];
  try {
    paused = await ports.subscriptions.pauseFreeForTeacher(scope, { monthStart, reason });
  } catch (pauseError) {
    try {
      await ports.sink.notify(
        event('threshold_reached', teacherId, monthStart, totals, threshold, [], true),
      );
    } catch {
      // The pause error is the one to surface; the retry alerts again.
    }
    throw pauseError;
  }
  await ports.sink.notify(
    event('threshold_reached', teacherId, monthStart, totals, threshold, paused, false),
  );
  return { teacherId, outcome: 'threshold_reached', totals, paused };
}

export interface CostAlarmRun {
  results: CostAlarmResult[];
  failures: { teacherId: string; error: unknown }[];
}

/** Checks each teacher once, in order; one teacher's failure is reported and the rest still run. */
export async function checkTeachersCost(
  teacherIds: readonly string[],
  ports: CostAlarmPorts,
): Promise<CostAlarmRun> {
  const run: CostAlarmRun = { results: [], failures: [] };
  for (const teacherId of new Set(teacherIds)) {
    try {
      run.results.push(await checkTeacherCost(teacherId, ports));
    } catch (error) {
      run.failures.push({ teacherId, error });
    }
  }
  return run;
}
