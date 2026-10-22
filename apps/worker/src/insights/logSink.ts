// The weekly insights job's own structured log lines (task 11.3 Phase B; mirrors
// `../alarms/logSink.ts`'s "only the named fields reach the line" discipline). A per-teacher
// failure logs the error name only -- never teacher text, never student data -- and the run
// summary logs only counts, matching `costAlarmJob`'s own shape.
import { describeError, type Log } from '../log.js';
import type { WeeklyInsightsRunSummary } from './schedule.js';

/** One per-teacher failure: the teacher id, the week and the error's name/message only. */
export function logWeeklyInsightsTeacherFailed(
  log: Log,
  args: { teacherId: string; weekStart: string; error: unknown },
): void {
  log({
    level: 'error',
    event: 'weekly_insights.teacher_failed',
    teacherId: args.teacherId,
    weekStart: args.weekStart,
    error: describeError(args.error),
  });
}

/** The run summary: counts only, `warn` when any teacher failed, else `info`. */
export function logWeeklyInsightsRun(log: Log, summary: WeeklyInsightsRunSummary): void {
  log({
    level: summary.failed > 0 ? 'warn' : 'info',
    event: 'weekly_insights.run',
    weekStart: summary.weekStart,
    teachers: summary.teachers,
    saved: summary.saved,
    failed: summary.failed,
  });
}
