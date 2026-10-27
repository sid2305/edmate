// The regate sweep, scheduled (task 13.regate, Phase B). A BullMQ job scheduler runs
// `edmate-regate-sweep` every 15 minutes (lead answer Q1); modelled byte-for-byte on
// `apps/worker/src/alarms/schedule.ts`'s cost alarm.
import type { JobQueue } from '@edmate/queue';
import { type ConnectionOptions, type JobsOptions, Worker } from 'bullmq';
import { onJobFailed } from '../commit/deadLetter.js';
import { describeError } from '../log.js';
import { regateSweepJob, type RegateSweepDeps, type RegateSweepSummary } from './sweep.js';

export const REGATE_QUEUE = 'edmate-regate-sweep';
export const REGATE_SCHEDULER_ID = 'regate-sweep-every-15-minutes';
export const REGATE_JOB = 'regate.sweep';
export const REGATE_PATTERN = '*/15 * * * *';

export const REGATE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
};

/** What `scheduleRegateSweep` needs from a BullMQ Queue. */
export interface SchedulerQueue {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string; tz: string },
    template: { name: string; data: Record<string, never>; opts: JobsOptions },
  ): Promise<unknown>;
}

/** Creates or updates the 15-minute schedule (idempotent: one scheduler id). */
export async function scheduleRegateSweep(
  queue: SchedulerQueue,
  pattern = REGATE_PATTERN,
): Promise<void> {
  await queue.upsertJobScheduler(
    REGATE_SCHEDULER_ID,
    { pattern, tz: 'UTC' },
    { name: REGATE_JOB, data: {}, opts: REGATE_JOB_OPTIONS },
  );
}

export interface RegateSweepWorkerOptions {
  connection: ConnectionOptions;
  deps: RegateSweepDeps;
  deadLetter: JobQueue;
  now?: () => Date;
  prefix?: string;
  autorun?: boolean;
}

/** The worker for the scheduled job; failures are logged and, when final, dead-lettered. */
export function createRegateSweepWorker(o: RegateSweepWorkerOptions): Worker {
  const job = regateSweepJob(o.deps);
  const worker = new Worker(REGATE_QUEUE, () => job(), {
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
      queue: REGATE_QUEUE,
      error: describeError(error),
    });
  });
  return worker;
}

export type { RegateSweepSummary };
