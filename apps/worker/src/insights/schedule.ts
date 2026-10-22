// The weekly insights job, scheduled (task 11.3 Phase B; mirrors `../alarms/schedule.ts`). One
// BullMQ job scheduler runs `compute-weekly-insights` every Monday at 07:00 in the US locale
// pack's own timezone (read from `@edmate/content`'s `loadLocalePacks`, never hardcoded -- the
// US pack is the only one active while the India pack is parked, 21 Oct standing rule). Each run
// lists the teachers with usage in the past 7 days (`usageLedger.teacherIdsWithUsageSince`, the
// same method the cost alarm uses -- no new "list teachers" read) and saves each one's finished
// week. A per-teacher failure is logged (error name only, never teacher text or student data) and
// does not stop the run; that teacher is picked up again on the next weekly run.
import { join, resolve as resolvePath } from 'node:path';
import { loadLocalePacks } from '@edmate/content';
import type { JobQueue } from '@edmate/queue';
import { type ConnectionOptions, type JobsOptions, Worker } from 'bullmq';
import { onJobFailed } from '../commit/deadLetter.js';
import { describeError, type Log } from '../log.js';
import { logWeeklyInsightsRun, logWeeklyInsightsTeacherFailed } from './logSink.js';
import { finishedWeekStart, type InsightsBackend, weeklyInsightsForTeacher } from './weeklyInsights.js';

export const WEEKLY_INSIGHTS_QUEUE = 'edmate-weekly-insights';
export const WEEKLY_INSIGHTS_SCHEDULER_ID = 'weekly-insights-monday';
export const WEEKLY_INSIGHTS_JOB = 'compute-weekly-insights';
/** Monday 07:00, in the US pack's own timezone (`insightsTimezone` below). */
export const WEEKLY_INSIGHTS_PATTERN = '0 7 * * 1';
/** The US locale pack's market code (the only active pack; India is parked). */
export const WEEKLY_INSIGHTS_MARKET = 'US';

export const WEEKLY_INSIGHTS_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
};

type Env = Readonly<Record<string, string | undefined>>;

/** `EDMATE_CONTENT_DIR`, else the repo's `content/` (the worker runs from apps/worker in dev). */
export function insightsContentDir(env: Env): string {
  return env.EDMATE_CONTENT_DIR?.trim() || resolvePath(process.cwd(), '../../content');
}

/** The US locale pack's `timezone` field, for the cron schedule. Throws if the pack is missing. */
export function insightsTimezone(contentDir: string): string {
  const { packs } = loadLocalePacks(join(contentDir, 'locales'));
  const us = packs.get(WEEKLY_INSIGHTS_MARKET);
  if (!us) {
    throw new Error(`weekly insights: no "${WEEKLY_INSIGHTS_MARKET}" locale pack to read a timezone from`);
  }
  return us.timezone;
}

/** What `scheduleWeeklyInsights` needs from a BullMQ Queue. */
export interface SchedulerQueue {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string; tz: string },
    template: { name: string; data: Record<string, never>; opts: JobsOptions },
  ): Promise<unknown>;
}

/** Creates or updates the weekly schedule (idempotent: one scheduler id). */
export async function scheduleWeeklyInsights(
  queue: SchedulerQueue,
  tz: string,
  pattern = WEEKLY_INSIGHTS_PATTERN,
): Promise<void> {
  await queue.upsertJobScheduler(
    WEEKLY_INSIGHTS_SCHEDULER_ID,
    { pattern, tz },
    { name: WEEKLY_INSIGHTS_JOB, data: {}, opts: WEEKLY_INSIGHTS_JOB_OPTIONS },
  );
}

export interface WeeklyInsightsJobDeps {
  /** @edmate/db `usageLedger.teacherIdsWithUsageSince`. */
  teacherIds(scope: { since: string }): Promise<string[]>;
  insights: InsightsBackend;
  now: () => Date;
  log: Log;
}

export interface WeeklyInsightsRunSummary {
  weekStart: string;
  teachers: number;
  saved: number;
  failed: number;
}

/** The job's processor: one run over the finished week, for every teacher with recent usage. */
export function weeklyInsightsJob(deps: WeeklyInsightsJobDeps): () => Promise<WeeklyInsightsRunSummary> {
  return async () => {
    const now = deps.now();
    const weekStart = finishedWeekStart(now);
    const sinceIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const teacherIds = await deps.teacherIds({ since: sinceIso });
    let saved = 0;
    let failed = 0;
    for (const teacherId of new Set(teacherIds)) {
      try {
        await weeklyInsightsForTeacher(deps.insights, teacherId, weekStart);
        saved += 1;
      } catch (error) {
        failed += 1;
        logWeeklyInsightsTeacherFailed(deps.log, { teacherId, weekStart, error });
      }
    }
    const summary = { weekStart, teachers: teacherIds.length, saved, failed };
    logWeeklyInsightsRun(deps.log, summary);
    return summary;
  };
}

export interface WeeklyInsightsWorkerOptions {
  connection: ConnectionOptions;
  deps: WeeklyInsightsJobDeps;
  deadLetter: JobQueue;
  now?: () => Date;
  prefix?: string;
  autorun?: boolean;
}

/** The worker for the scheduled job; failures are logged and, when final, dead-lettered. */
export function createWeeklyInsightsWorker(o: WeeklyInsightsWorkerOptions): Worker {
  const job = weeklyInsightsJob(o.deps);
  const worker = new Worker(WEEKLY_INSIGHTS_QUEUE, () => job(), {
    connection: o.connection,
    autorun: o.autorun ?? false,
    concurrency: 1,
    ...(o.prefix === undefined ? {} : { prefix: o.prefix }),
  });
  const failed = onJobFailed({
    deadLetter: o.deadLetter,
    log: o.deps.log,
    now: o.now ?? (() => new Date()),
  });
  worker.on('failed', (j, error) => {
    void failed(j, error);
  });
  worker.on('error', (error) => {
    o.deps.log({
      level: 'error',
      event: 'worker.error',
      queue: WEEKLY_INSIGHTS_QUEUE,
      error: describeError(error),
    });
  });
  return worker;
}
