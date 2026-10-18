// The monthly cost alarm's own types (task 2.5). Local to the worker, not contracts: the frozen
// AlertSink is typed to SafetyAlert (a student and a session), which a teacher-wide cost event
// does not have. The repository shapes below mirror @edmate/db's `usageLedger.sumForTeacherSince`
// and `subscriptions.pauseFreeForTeacher`, so the composition root passes those methods directly.

/** @edmate/db TeacherUsageTotals: a teacher's non-eval usage since a date. */
export interface TeacherCostTotals {
  teacherId: string;
  since: string;
  calls: number;
  recorded: number;
  /** Calls whose usage was not reported: their cost is missing from `costMicroUsd`, not zero. */
  unknown: number;
  /** Calls on a model with no price: their cost is missing from `costMicroUsd`, not zero. */
  unpriced: number;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/** @edmate/db PauseFreeOptions. */
export interface PauseFreeOptions {
  monthStart: string;
  reason: string;
}

/** @edmate/db PausedSubscription. */
export interface PausedSubscription {
  subscriptionId: string;
  packageId: string;
  previousStatus: 'trial' | 'active' | 'past_due';
}

export interface CostUsageReader {
  sumForTeacherSince(scope: { teacherId: string }, since: string): Promise<TeacherCostTotals>;
}

export interface FreeSubscriptionPauser {
  pauseFreeForTeacher(
    scope: { teacherId: string },
    options: PauseFreeOptions,
  ): Promise<PausedSubscription[]>;
}

/**
 * - `threshold_reached`: the month's known cost is at or above the threshold. Free packages are
 *   paused; staff and the teacher are told. Paid students keep access until staff decide.
 * - `cost_incomplete`: below the threshold, but some calls have no cost (unknown or unpriced), so
 *   the real total may be higher. Staff only; nothing is paused.
 */
export type CostAlarmKind = 'threshold_reached' | 'cost_incomplete';

/** What the alarm tells staff (and, at the threshold, the teacher). No student ids, no free text. */
export interface CostAlarmEvent {
  readonly kind: CostAlarmKind;
  readonly recipients: readonly ('staff' | 'teacher')[];
  readonly teacherId: string;
  readonly monthStartIso: string;
  /** The sum over priced calls only. */
  readonly costMicroUsd: number;
  readonly thresholdMicroUsd: number;
  /** Never folded into `costMicroUsd`. */
  readonly unknownCalls: number;
  readonly unpricedCalls: number;
  /** Paused by this run (a subscription the alarm paused earlier this month is not repeated). */
  readonly pausedSubscriptionIds: readonly string[];
  readonly pausedPackageIds: readonly string[];
  /** True when the pause itself failed: staff must act by hand. */
  readonly pauseFailed: boolean;
}

/** Delivers a cost alarm. The default is a log line (`logSink.ts`); real delivery comes later. */
export interface CostAlarmSink {
  notify(e: CostAlarmEvent): Promise<void>;
}
