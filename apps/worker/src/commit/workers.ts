// The BullMQ workers for the turn queues (task 3.8). Retries come from each job's options
// (@edmate/queue RETRY: 5 attempts, exponential backoff); a permanent error skips them. Every
// failure goes to the `failed` handler (logged; dead-lettered when final).
//
// The commit worker runs one job at a time, so a session's help-state saves are applied in the
// order they were enqueued (last write wins). A save retried after a later one succeeded can still
// land last; the next turn's save corrects it.
import type { Repositories } from '@edmate/db';
import { COMMIT_QUEUE, type JobQueue, METER_QUEUE } from '@edmate/queue';
import { type ConnectionOptions, UnrecoverableError, Worker } from 'bullmq';
import { describeError, type Log } from '../log.js';
import { onJobFailed } from './deadLetter.js';
import {
  commitProcessor,
  type JobOutcome,
  meterProcessor,
  PermanentJobError,
  type TurnJob,
} from './processors.js';

/** Turns a PermanentJobError into BullMQ's UnrecoverableError (no more attempts). */
export function permanentToUnrecoverable(
  process: (job: TurnJob) => Promise<JobOutcome>,
): (job: TurnJob) => Promise<JobOutcome> {
  return async (job) => {
    try {
      return await process(job);
    } catch (error) {
      if (error instanceof PermanentJobError) throw new UnrecoverableError(error.message);
      throw error;
    }
  };
}

export interface TurnWorkersOptions {
  connection: ConnectionOptions;
  repos: Repositories;
  deadLetter: JobQueue;
  log: Log;
  now?: () => Date;
  /** BullMQ key prefix (tests isolate themselves with one). */
  prefix?: string;
  autorun?: boolean;
}

export function createTurnWorkers(o: TurnWorkersOptions): { meter: Worker; commit: Worker } {
  const common = {
    connection: o.connection,
    autorun: o.autorun ?? false,
    ...(o.prefix === undefined ? {} : { prefix: o.prefix }),
  };
  const meter = new Worker(METER_QUEUE, permanentToUnrecoverable(meterProcessor(o.repos)), {
    ...common,
    concurrency: 4,
  });
  const commit = new Worker(COMMIT_QUEUE, permanentToUnrecoverable(commitProcessor(o.repos)), {
    ...common,
    concurrency: 1,
  });
  const failed = onJobFailed({
    deadLetter: o.deadLetter,
    log: o.log,
    now: o.now ?? (() => new Date()),
  });
  for (const w of [meter, commit]) {
    w.on('failed', (job, error) => {
      void failed(job, error);
    });
    w.on('error', (error) => {
      o.log({ level: 'error', event: 'worker.error', queue: w.name, error: describeError(error) });
    });
  }
  return { meter, commit };
}
