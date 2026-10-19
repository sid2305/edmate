// The monthly cost alarm, scheduled (task 3.8; 2.5 left scheduling to the composition root).
// A BullMQ job scheduler runs `check-teachers-cost` daily. Each run lists the teachers with
// non-eval usage this month and checks each one; every per-teacher failure is logged (level
// error) with the teacher id and the error's name and message. A teacher that failed is checked
// again on the next run (no separate retry queue). A run that cannot even list the teachers fails
// the job, so BullMQ retries it and the failed handler logs it.
import type { JobQueue } from '@edmate/queue';
import { type ConnectionOptions, type JobsOptions, Worker } from 'bullmq';
import { onJobFailed } from '../commit/deadLetter.js';
import { describeError, type Log } from '../log.js';
import { checkTeachersCost, type CostAlarmPorts, monthStartUtc } from './costAlarm.js';

export const COST_ALARM_QUEUE = 'edmate-cost-alarm';
export const COST_ALARM_SCHEDULER_ID = 'cost-alarm-daily';
export const COST_ALARM_JOB = 'check-teachers-cost';
/** Provisional: daily at 03:30 UTC (7.6 revisits the cadence with the threshold). */
export const COST_ALARM_PATTERN = '30 3 * * *';

export const COST_ALARM_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
};

/** What `scheduleCostAlarm` needs from a BullMQ Queue. */
export interface SchedulerQueue {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string; tz: string },
    template: { name: string; data: Record<string, never>; opts: JobsOptions },
  ): Promise<unknown>;
}

/** Creates or updates the daily schedule (idempotent: one scheduler id). */
export async function scheduleCostAlarm(
  queue: SchedulerQueue,
  pattern = COST_ALARM_PATTERN,
): Promise<void> {
  await queue.upsertJobScheduler(
    COST_ALARM_SCHEDULER_ID,
    { pattern, tz: 'UTC' },
    { name: COST_ALARM_JOB, data: {}, opts: COST_ALARM_JOB_OPTIONS },
  );
}

export interface CostAlarmJobDeps {
  /** @edmate/db `usageLedger.teacherIdsWithUsageSince`. */
  teacherIds(scope: { since: string }): Promise<string[]>;
  ports: CostAlarmPorts;
  log: Log;
}

export interface CostAlarmRunSummary {
  teachers: number;
  checked: number;
  failed: number;
}

/** The job's processor: one run over this month's teachers. */
export function costAlarmJob(deps: CostAlarmJobDeps): () => Promise<CostAlarmRunSummary> {
  return async () => {
    const monthStartIso = monthStartUtc(deps.ports.now());
    const teacherIds = await deps.teacherIds({ since: monthStartIso });
    const run = await checkTeachersCost(teacherIds, deps.ports);
    for (const f of run.failures) {
      deps.log({
        level: 'error',
        event: 'cost_alarm.teacher_failed',
        teacherId: f.teacherId,
        monthStartIso,
        error: describeError(f.error),
      });
    }
    const summary = {
      teachers: teacherIds.length,
      checked: run.results.length,
      failed: run.failures.length,
    };
    deps.log({
      level: summary.failed > 0 ? 'warn' : 'info',
      event: 'cost_alarm.run',
      monthStartIso,
      ...summary,
      outcomes: countOutcomes(run.results.map((r) => r.outcome)),
    });
    return summary;
  };
}

function countOutcomes(outcomes: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of outcomes) out[o] = (out[o] ?? 0) + 1;
  return out;
}

export interface CostAlarmWorkerOptions {
  connection: ConnectionOptions;
  deps: CostAlarmJobDeps;
  deadLetter: JobQueue;
  now?: () => Date;
  prefix?: string;
  autorun?: boolean;
}

/** The worker for the scheduled job; failures are logged and, when final, dead-lettered. */
export function createCostAlarmWorker(o: CostAlarmWorkerOptions): Worker {
  const job = costAlarmJob(o.deps);
  const worker = new Worker(COST_ALARM_QUEUE, () => job(), {
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
    o.deps.log({ level: 'error', event: 'worker.error', queue: COST_ALARM_QUEUE, error: describeError(error) });
  });
  return worker;
}
