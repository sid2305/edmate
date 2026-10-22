// The weekly insights worker's pure core (task 11.3 Phase B). Computes the Monday (UTC) of the
// most recently *finished* week and, for each teacher, saves that week's insights by calling
// `repos.insights.computeAndSaveWeek` -- the repository's only write (Phase A). This module never
// reads an insights row, never builds a payload and never calls `saveWeek` directly: there is no
// public `saveWeek` to call, and no student data passes through here at all.
import type { TeacherScope } from '@edmate/db';

/** What `weeklyInsightsForTeacher`/`weeklyInsightsRun` need from `repos.insights`. */
export interface InsightsBackend {
  computeAndSaveWeek(scope: TeacherScope, weekStart: string): Promise<unknown>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Monday (`YYYY-MM-DD`, UTC) of the week that finished at the most recent UTC midnight
 * Monday on or before `now`. A run on a Monday (any time of day, including just after midnight)
 * reports the week that just ended; a mid-week run (hand re-run) reports the same, still-finished,
 * previous week -- never the current or a future week.
 */
export function finishedWeekStart(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error('weekly insights: invalid date');
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // ISO weekday distance back to Monday: Sunday (0) is 6 days after the prior Monday.
  const isoDayIndex = (now.getUTCDay() + 6) % 7;
  const currentMonday = dayStart - isoDayIndex * DAY_MS;
  const finishedMonday = new Date(currentMonday - 7 * DAY_MS);
  return finishedMonday.toISOString().slice(0, 10);
}

/** Computes and saves one teacher's finished week. Throws on failure; the caller logs it. */
export async function weeklyInsightsForTeacher(
  backend: InsightsBackend,
  teacherId: string,
  weekStart: string,
): Promise<void> {
  await backend.computeAndSaveWeek({ teacherId }, weekStart);
}
