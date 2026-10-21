// The safety-event worker (task 4.4, ADR-0006): each `safety_event.record` job from
// @edmate/queue's queuedSafetyEventSink becomes one safety_events row, through the db repository
// scoped to the job's student x teacher (the row's session must be theirs).
//
// - Idempotent: the row id derives from (turn, guard), so a job run twice writes once.
// - Retries come from the job's options (RETRY: 5 attempts, exponential backoff); a malformed
//   payload or a permanent repository error (scope, not_found, invalid, integrity) is not retried
//   and goes straight to the dead-letter queue (ids only).
// - Log lines carry ids, the guard, the code and the source: never text (there is none to carry).
// Lives beside the alert worker: both are student-safety plumbing (risk-paths: safety-reviewer).
import type { Repositories } from '@edmate/db';
import { JOB, type JobQueue, SAFETY_EVENT_QUEUE, SafetyEventJobSchema } from '@edmate/queue';
import { type ConnectionOptions, Worker } from 'bullmq';
import { onJobFailed } from '../commit/deadLetter.js';
import { classify, PermanentJobError, type TurnJob } from '../commit/processors.js';
import { permanentToUnrecoverable } from '../commit/workers.js';
import { describeError, type Log } from '../log.js';

export type SafetyEventOutcome = 'written' | 'already_written';
export type SafetyEventRepo = Pick<Repositories['safetyEvents'], 'record'>;

export function safetyEventProcessor(
  repo: SafetyEventRepo,
  log: Log,
): (job: TurnJob) => Promise<SafetyEventOutcome> {
  return async (job) => {
    if (job.name !== JOB.safetyEventRecord) {
      throw new PermanentJobError(
        `unknown safety-event job ${JSON.stringify(job.name).slice(0, 60)}`,
      );
    }
    const parsed = SafetyEventJobSchema.safeParse(job.data);
    if (!parsed.success) throw new PermanentJobError(`${job.name}: invalid job payload`);
    const d = parsed.data;
    let written: boolean;
    try {
      ({ written } = await repo.record(d.scope, {
        sessionId: d.sessionId,
        turnId: d.turnId,
        guard: d.guard,
        code: d.code,
        source: d.source,
      }));
    } catch (error) {
      return classify(job.name, error);
    }
    const outcome: SafetyEventOutcome = written ? 'written' : 'already_written';
    log({
      level: 'info',
      event: 'safety_event.recorded',
      jobId: job.id ?? null,
      sessionId: d.sessionId,
      turnId: d.turnId,
      guard: d.guard,
      code: d.code,
      source: d.source,
      outcome,
    });
    return outcome;
  };
}

export interface SafetyEventWorkerOptions {
  connection: ConnectionOptions;
  repos: { safetyEvents: SafetyEventRepo };
  deadLetter: JobQueue;
  log: Log;
  now?: () => Date;
  /** BullMQ key prefix (tests isolate themselves with one). */
  prefix?: string;
  autorun?: boolean;
}

export function createSafetyEventWorker(
  o: SafetyEventWorkerOptions,
): Worker<unknown, SafetyEventOutcome> {
  const worker = new Worker<unknown, SafetyEventOutcome>(
    SAFETY_EVENT_QUEUE,
    permanentToUnrecoverable<TurnJob, SafetyEventOutcome>(
      safetyEventProcessor(o.repos.safetyEvents, o.log),
    ),
    {
      connection: o.connection,
      autorun: o.autorun ?? false,
      ...(o.prefix === undefined ? {} : { prefix: o.prefix }),
      concurrency: 4,
    },
  );
  const failed = onJobFailed({
    deadLetter: o.deadLetter,
    log: o.log,
    now: o.now ?? (() => new Date()),
  });
  worker.on('failed', (job, error) => {
    void failed(job, error);
  });
  worker.on('error', (error) => {
    o.log({
      level: 'error',
      event: 'worker.error',
      queue: worker.name,
      error: describeError(error),
    });
  });
  return worker;
}
