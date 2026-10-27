// The stuck-`processing` sweep, scheduled (task 8.2i Phase B; lead answers Q1-Q3). A worker that
// crashed, was redeployed or lost its connection mid-attempt can leave a document's row in
// `processing` forever, with no further write coming: every 15 minutes, this job finds every
// document still `processing` after `STUCK_PROCESSING_MINUTES`, across every teacher
// (`@edmate/db`'s `ingestSweepRepo(db).staleProcessing`), and marks each one `failed` with
// `provider_error` through the same atomic compare-and-set `failWith` uses
// (`documents.failIfStorageKey`) -- the sweeper can't know *why* a job's worker died mid-flight,
// so a generic retryable-sounding code is honest; the student-facing effect is the same
// "failed, can retry" state `updateStatus` already supports.
//
// A page that comes back `updated: false` already moved on since the read (another writer -- a
// still-alive worker's own `failWith`/`updateStatus`, or a replace -- got there first); that is
// logged `skipped`, not an error. A per-row `failIfStorageKey` throw (a genuine db error) is
// logged and the run continues to the next row -- one stuck document's db error must not stop the
// whole sweep -- but the run still fails at the end (so BullMQ retries it; the failed handler logs
// it), same "log every failure, still fail the job" shape as `alarms/schedule.ts`'s cost alarm.
//
// Modelled byte-for-byte on `apps/worker/src/alarms/schedule.ts`: one file for the queue/job
// constants, the schedule function, the job processor and the worker factory (this job is simple
// enough for one file, unlike `retention/`'s 4-file split).
import { INGEST_SWEEP_LIMIT, type Repositories, type StaleProcessingDocument } from '@edmate/db';
import type { JobQueue } from '@edmate/queue';
import { type ConnectionOptions, type JobsOptions, Worker } from 'bullmq';
import { onJobFailed } from '../commit/deadLetter.js';
import { describeError, type Log } from '../log.js';

export const INGEST_SWEEP_QUEUE = 'edmate-ingest-sweep';
export const INGEST_SWEEP_SCHEDULER_ID = 'ingest-sweep-every-15-minutes';
export const INGEST_SWEEP_JOB = 'ingest.sweep';
/** Lead answer Q1: every 15 minutes. */
export const INGEST_SWEEP_PATTERN = '*/15 * * * *';

export const INGEST_SWEEP_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
};

/** Lead answer Q1: 30 minutes in `processing` counts as stuck. */
export const STUCK_PROCESSING_MINUTES = 30;

/** At most this many pages per run, so one run can never loop forever. */
export const MAX_ITERATIONS = 1000;

/** The fixed failure code the sweep writes (lead answer Q2). */
export const INGEST_SWEEP_FAILURE_REASON = 'provider_error';

/** What `ingestSweepJob` needs; a narrow, fake-able interface (rule 4: no real db in tests). */
export interface IngestSweepDeps {
  /** `ingestSweepRepo(db).staleProcessing`. */
  staleProcessing(cutoff: Date, limit?: number): Promise<StaleProcessingDocument[]>;
  documents: Pick<Repositories['documents'], 'failIfStorageKey'>;
  now?: () => Date;
  log: Log;
}

export interface IngestSweepRunSummary {
  marked: number;
  skipped: number;
  cutoff: string;
  pages: number;
}

/** The sweep's processor: one run over every currently stuck document. */
export function ingestSweepJob(deps: IngestSweepDeps): () => Promise<IngestSweepRunSummary> {
  return async () => {
    const now = deps.now?.() ?? new Date();
    const cutoff = new Date(now.getTime() - STUCK_PROCESSING_MINUTES * 60_000);

    let marked = 0;
    let skipped = 0;
    let pages = 0;
    let anyFailed = false;

    for (let i = 0; i < MAX_ITERATIONS; i += 1) {
      const rows = await deps.staleProcessing(cutoff, INGEST_SWEEP_LIMIT);
      pages += 1;
      if (rows.length === 0) break;

      for (const row of rows) {
        try {
          const result = await deps.documents.failIfStorageKey(
            { teacherId: row.teacherId },
            row.id,
            row.storageKey,
            INGEST_SWEEP_FAILURE_REASON,
          );
          if (result.updated) {
            marked += 1;
          } else {
            skipped += 1;
            deps.log({
              level: 'warn',
              event: 'ingest_sweep.candidate_skipped',
              documentId: row.id,
              teacherId: row.teacherId,
            });
          }
        } catch (error) {
          anyFailed = true;
          deps.log({
            level: 'error',
            event: 'ingest_sweep.candidate_failed',
            documentId: row.id,
            teacherId: row.teacherId,
            error: describeError(error),
          });
        }
      }

      if (rows.length < INGEST_SWEEP_LIMIT) break;
      if (i === MAX_ITERATIONS - 1) {
        deps.log({ level: 'error', event: 'ingest_sweep.max_iterations', pages });
      }
    }

    const summary = { marked, skipped, cutoff: cutoff.toISOString(), pages };
    deps.log({
      level: anyFailed || skipped > 0 ? 'warn' : 'info',
      event: 'ingest_sweep.run',
      ...summary,
    });
    if (anyFailed) {
      throw new Error('ingest_sweep: one or more rows failed; see ingest_sweep.candidate_failed');
    }
    return summary;
  };
}

/** What `scheduleIngestSweep` needs from a BullMQ Queue. */
export interface SchedulerQueue {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string; tz: string },
    template: { name: string; data: Record<string, never>; opts: JobsOptions },
  ): Promise<unknown>;
}

/** Creates or updates the 15-minute schedule (idempotent: one scheduler id). */
export async function scheduleIngestSweep(
  queue: SchedulerQueue,
  pattern = INGEST_SWEEP_PATTERN,
): Promise<void> {
  await queue.upsertJobScheduler(
    INGEST_SWEEP_SCHEDULER_ID,
    { pattern, tz: 'UTC' },
    { name: INGEST_SWEEP_JOB, data: {}, opts: INGEST_SWEEP_JOB_OPTIONS },
  );
}

export interface IngestSweepWorkerOptions {
  connection: ConnectionOptions;
  deps: IngestSweepDeps;
  deadLetter: JobQueue;
  now?: () => Date;
  prefix?: string;
  autorun?: boolean;
}

/** The worker for the scheduled job; failures are logged and, when final, dead-lettered. */
export function createIngestSweepWorker(o: IngestSweepWorkerOptions): Worker {
  const job = ingestSweepJob(o.deps);
  const worker = new Worker(INGEST_SWEEP_QUEUE, () => job(), {
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
      queue: INGEST_SWEEP_QUEUE,
      error: describeError(error),
    });
  });
  return worker;
}
