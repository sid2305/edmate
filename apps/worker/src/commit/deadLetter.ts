// Failed jobs (task 3.8). Every failure is logged. A job that failed for good (its attempts used
// up, or a permanent error) is copied to `edmate-dead-letter` for someone to look at: BullMQ has
// no dead-letter queue of its own, and its failed set is easy to lose track of.
//
// A dead-letter entry keeps references only: the job's ids (scope, session, turn, message id and
// role, package, index), the error's name and message and the attempt count. Never a payload's
// free text (message text, sources) or the help state (the answer key). Entries expire after
// FAILED_JOB_TTL_SECONDS: `pruneDeadLetters` removes older ones (they wait, never complete, so
// BullMQ's own removeOn* options don't reach them). Log lines never carry a payload either.
import { DEAD_LETTER_QUEUE, FAILED_JOB_TTL_SECONDS, type JobQueue } from '@edmate/queue';
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

/** The ids a dead-letter entry keeps from a job's payload, as far as they are present. */
export interface DeadLetterRefs {
  studentId?: string;
  teacherId?: string;
  sessionId?: string;
  turnId?: string;
  messageId?: string;
  role?: string;
  packageId?: string;
  index?: number;
  /** A safety alert's id (task 4.3); never its excerpt. */
  alertId?: string;
  /** An ingest job's document id (task 8.2); that job has no `scope` wrapper. */
  documentId?: string;
}

export interface DeadLetterEntry {
  queue: string;
  name: string;
  jobId: string;
  attemptsMade: number;
  error: { name: string; message: string };
  failedAt: string;
  refs: DeadLetterRefs;
}

export const DEAD_LETTER_JOB = 'dead';

const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/**
 * The references a dead-letter entry keeps: a whitelist of id fields, read defensively (the
 * payload may be the malformed one that failed). Anything else in the payload is dropped.
 */
export function deadLetterRefs(data: unknown): DeadLetterRefs {
  const d = record(data);
  const scope = record(d.scope);
  const message = record(d.message);
  const trace = record(d.trace);
  const alert = record(d.alert);
  const refs: DeadLetterRefs = {};
  const str = (key: Exclude<keyof DeadLetterRefs, 'index'>, value: unknown) => {
    if (typeof value === 'string') refs[key] = value.slice(0, 128);
  };
  str('studentId', scope.studentId ?? alert.studentId);
  str('teacherId', scope.teacherId ?? alert.teacherId ?? d.teacherId);
  str('sessionId', d.sessionId ?? trace.sessionId ?? alert.sessionId);
  str('turnId', d.turnId ?? trace.turnId);
  str('messageId', message.id);
  str('role', message.role);
  str('packageId', d.packageId);
  str('alertId', alert.id);
  str('documentId', d.documentId);
  if (Number.isSafeInteger(d.index)) refs.index = d.index as number;
  return refs;
}

/** The options of a dead-letter job: kept for FAILED_JOB_TTL_SECONDS whatever happens to it. */
export function deadLetterOptions(jobId: string) {
  return {
    jobId,
    removeOnComplete: { age: FAILED_JOB_TTL_SECONDS },
    removeOnFail: { age: FAILED_JOB_TTL_SECONDS },
  };
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
      refs: deadLetterRefs(job.data),
    };
    try {
      await deps.deadLetter.add(
        DEAD_LETTER_JOB,
        entry,
        deadLetterOptions(`${job.queueName}.${jobId}`),
      );
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

/** What `pruneDeadLetters` needs from a BullMQ Queue. */
export interface PrunableQueue {
  clean(graceMs: number, limit: number, type: 'wait'): Promise<string[]>;
}

/** How many expired entries one prune removes at most; the next run takes the rest. */
export const PRUNE_BATCH = 1_000;

/**
 * Removes dead-letter entries older than FAILED_JOB_TTL_SECONDS. Never rejects: a failure is
 * logged and the next run tries again. Returns how many it removed.
 */
export async function pruneDeadLetters(queue: PrunableQueue, log: Log): Promise<number> {
  try {
    const removed = await queue.clean(FAILED_JOB_TTL_SECONDS * 1_000, PRUNE_BATCH, 'wait');
    if (removed.length > 0) {
      log({ level: 'info', event: 'dead_letter.pruned', removed: removed.length });
    }
    return removed.length;
  } catch (error) {
    log({ level: 'error', event: 'dead_letter.prune_failed', error: describeError(error) });
    return 0;
  }
}
