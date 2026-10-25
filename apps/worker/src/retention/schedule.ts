// The retention job, scheduled (task 13.4, Phase B; mirrors `../insights/schedule.ts`). One
// BullMQ job scheduler runs `purge-old-data` daily. Each run purges three tables --
// `sessions`, `turn_traces`, `transcript` `chunks` -- using `@edmate/db`'s `retention` repo
// (task 13.4 Phase A) and the day counts in `./config.ts`. Dry run (the default everywhere until
// a human flips it) makes one call per table and changes nothing; live mode loops each table
// until a call reports fewer rows than the purge limit (see `./workers.ts`). A table that hits
// the per-run iteration cap is logged (`warn`) and picked up again on the next run -- it never
// stops the other tables, and the job still succeeds (there is nothing to retry).
import type { JobQueue } from '@edmate/queue';
import { RETENTION_PURGE_LIMIT } from '@edmate/db';
import { type ConnectionOptions, type JobsOptions, Worker } from 'bullmq';
import { onJobFailed } from '../commit/deadLetter.js';
import { describeError, type Log } from '../log.js';
import { cutoffFor, type RetentionConfig, defaultRetentionConfig } from './config.js';
import { logRetentionRun, logRetentionTable } from './logSink.js';
import {
  purgeTable,
  RetentionPurgeError,
  type RetentionBackend,
  type TablePurgeResult,
} from './workers.js';

export const RETENTION_QUEUE = 'edmate-retention';
export const RETENTION_SCHEDULER_ID = 'retention-daily';
export const RETENTION_JOB = 'purge-old-data';
/** Provisional: daily at 04:00 UTC (no locale timezone involved -- a system-wide purge). */
export const RETENTION_PATTERN = '0 4 * * *';

export const RETENTION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
};

/** What `scheduleRetention` needs from a BullMQ Queue. */
export interface SchedulerQueue {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string; tz: string },
    template: { name: string; data: Record<string, never>; opts: JobsOptions },
  ): Promise<unknown>;
}

/** Creates or updates the daily schedule (idempotent: one scheduler id). */
export async function scheduleRetention(
  queue: SchedulerQueue,
  pattern = RETENTION_PATTERN,
): Promise<void> {
  await queue.upsertJobScheduler(
    RETENTION_SCHEDULER_ID,
    { pattern, tz: 'UTC' },
    { name: RETENTION_JOB, data: {}, opts: RETENTION_JOB_OPTIONS },
  );
}

export interface RetentionJobDeps {
  /** `openDatabase().retention` (task 13.4 Phase A). */
  retention: RetentionBackend;
  config?: RetentionConfig;
  /** Must match the limit `retention`'s own methods enforce; defaults to `@edmate/db`'s constant. */
  purgeLimit?: number;
  now: () => Date;
  log: Log;
}

export interface RetentionRunSummary {
  dryRun: boolean;
  sessions: number;
  turnTraces: number;
  transcriptChunks: number;
  anyMaxIterationsHit: boolean;
}

/** The job's processor: one run, purging every configured table down to its own cutoff. */
export function retentionJob(deps: RetentionJobDeps): () => Promise<RetentionRunSummary> {
  const config = deps.config ?? defaultRetentionConfig;
  const purgeLimit = deps.purgeLimit ?? RETENTION_PURGE_LIMIT;
  return async () => {
    const now = deps.now();
    const entries = [
      ['sessions', config.days.sessions, deps.retention.purgeOldSessions] as const,
      ['turnTraces', config.days.turnTraces, deps.retention.purgeOldTraces] as const,
      ['transcriptChunks', config.days.transcriptChunks, deps.retention.purgeOldTranscriptChunks] as const,
    ];
    const cutoffs = new Map(entries.map(([table, days]) => [table, cutoffFor(now, days)]));
    if (!config.dryRun) {
      deps.log({
        level: 'warn',
        event: 'retention.live_run',
        tables: Object.fromEntries(
          [...cutoffs].map(([table, cutoff]) => [table, cutoff.toISOString()]),
        ),
      });
    }
    const tables: TablePurgeResult[] = [];
    for (const [table, , purge] of entries) {
      const cutoff = cutoffs.get(table)!;
      try {
        const result = await purgeTable(table, purge, cutoff, config.dryRun, purgeLimit);
        logRetentionTable(deps.log, result);
        tables.push(result);
      } catch (error) {
        if (error instanceof RetentionPurgeError) {
          deps.log({
            level: 'error',
            event: 'retention.purge_failed',
            table: error.table,
            deletedSoFar: error.deletedSoFar,
            calls: error.calls,
            error: describeError(error.cause),
          });
        }
        throw error;
      }
    }
    const byTable: Record<string, number> = Object.fromEntries(
      tables.map((t) => [t.table, t.count]),
    );
    const summary: RetentionRunSummary = {
      dryRun: config.dryRun,
      sessions: byTable.sessions ?? 0,
      turnTraces: byTable.turnTraces ?? 0,
      transcriptChunks: byTable.transcriptChunks ?? 0,
      anyMaxIterationsHit: tables.some((t) => t.maxIterationsHit),
    };
    logRetentionRun(deps.log, { dryRun: config.dryRun, tables });
    return summary;
  };
}

export interface RetentionWorkerOptions {
  connection: ConnectionOptions;
  deps: RetentionJobDeps;
  deadLetter: JobQueue;
  now?: () => Date;
  prefix?: string;
  autorun?: boolean;
}

/** The worker for the scheduled job; failures are logged and, when final, dead-lettered. */
export function createRetentionWorker(o: RetentionWorkerOptions): Worker {
  const job = retentionJob(o.deps);
  const worker = new Worker(RETENTION_QUEUE, () => job(), {
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
      queue: RETENTION_QUEUE,
      error: describeError(error),
    });
  });
  return worker;
}
