// Failed jobs (task 3.8). Every failure is logged. A job that failed for good (its attempts used
// up, or a permanent error) is copied to `edmate-dead-letter`, where it stays until someone looks:
// BullMQ has no dead-letter queue of its own, and its failed set is easy to lose track of.
//
// The help state's payload holds the answer key: its dead-letter entry keeps the ids and drops
// the value (the next turn saves a fresh one anyway). Log lines never carry a payload.
import { DEAD_LETTER_QUEUE, JOB, type JobQueue } from '@edmate/queue';
import { describeError, type Log } from '../log.js';

/** What the failed handler needs from a BullMQ Job. */
export interface FailedJob {
  id?: string | undefined;
  name: string;
  queueName: string;
  data: unknown;
  attemptsMade: number;
  opts: { attempts?: number | undefined };
}

export interface DeadLetterEntry {
  queue: string;
  name: string;
  jobId: string;
  attemptsMade: number;
  error: { name: string; message: string };
  failedAt: string;
  /** The job's payload, except a help state's value. */
  data: unknown;
}

export const DEAD_LETTER_JOB = 'dead';

/** The payload as the dead-letter entry keeps it: a help state's value is dropped. */
export function deadLetterData(name: string, data: unknown): unknown {
  if (name !== JOB.helpState || typeof data !== 'object' || data === null) return data;
  const kept = { ...(data as Record<string, unknown>) };
  delete kept.helpState;
  return { ...kept, helpStateDropped: true };
}

/** True when BullMQ will not retry: a permanent error, or the last attempt. */
export function isFinal(job: FailedJob, error: Error): boolean {
  return error.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
}

export interface FailedHandlerDeps {
  deadLetter: JobQueue;
  log: Log;
  now: () => Date;
}

/**
 * The worker's `failed` handler. Never rejects: a failing dead-letter write is itself logged
 * (`dead_letter.failed`, level error) with the job's ids, so the job is still findable.
 */
export function onJobFailed(deps: FailedHandlerDeps) {
  return async (job: FailedJob | undefined, error: Error): Promise<void> => {
    const err = describeError(error);
    if (job === undefined) {
      deps.log({ level: 'error', event: 'job.failed', jobId: null, error: err });
      return;
    }
    const jobId = job.id ?? '';
    const ids = { queue: job.queueName, name: job.name, jobId, attemptsMade: job.attemptsMade };
    if (!isFinal(job, error)) {
      deps.log({ level: 'warn', event: 'job.failed_will_retry', ...ids, error: err });
      return;
    }
    const entry: DeadLetterEntry = {
      ...ids,
      error: err,
      failedAt: deps.now().toISOString(),
      data: deadLetterData(job.name, job.data),
    };
    try {
      await deps.deadLetter.add(DEAD_LETTER_JOB, entry, {
        jobId: `${job.queueName}.${jobId}`,
        removeOnComplete: false,
        removeOnFail: false,
      });
      deps.log({
        level: 'error',
        event: 'job.dead_lettered',
        ...ids,
        deadLetterQueue: DEAD_LETTER_QUEUE,
        error: err,
      });
    } catch (dlqError) {
      deps.log({
        level: 'error',
        event: 'dead_letter.failed',
        ...ids,
        error: err,
        deadLetterError: describeError(dlqError),
      });
    }
  };
}
