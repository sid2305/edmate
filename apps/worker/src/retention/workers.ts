// The retention job's pure core (task 13.4, Phase B; mirrors `../insights/weeklyInsights.ts`).
// `purgeTable` calls one `@edmate/db` retention method for one table: a dry run makes exactly one
// call (the count is already unlimited and nothing is written either way, so looping would never
// change it); a live run calls again until a call reports fewer rows than the purge limit
// (`@edmate/db`'s `RETENTION_PURGE_LIMIT`), summing the counts, capped at
// `MAX_ITERATIONS_PER_TABLE` so one run can never loop forever -- hitting the cap is reported back
// (the caller logs it) rather than looping past it or throwing.
import type { RetentionResult } from '@edmate/db';

/** At most this many purge calls per table in one run (a sane upper bound, not expected to be hit). */
export const MAX_ITERATIONS_PER_TABLE = 1000;

/** What `purgeTable`/`retentionJob` need from `@edmate/db`'s `retention` repo, per table. */
export type PurgeMethod = (cutoff: Date, dryRun: boolean, limit: number) => Promise<RetentionResult>;

/** What the job needs from `openDatabase().retention` (task 13.4 Phase A). */
export interface RetentionBackend {
  purgeOldSessions: PurgeMethod;
  purgeOldTraces: PurgeMethod;
  purgeOldTranscriptChunks: PurgeMethod;
}

export interface TablePurgeResult {
  table: string;
  count: number;
  dryRun: boolean;
  calls: number;
  maxIterationsHit: boolean;
}

/**
 * A later purge call failed after earlier calls in the same table already deleted rows.
 * `deletedSoFar` and `calls` cover only the calls that succeeded before the failure, so the
 * caller can log what was actually deleted rather than losing the count to the thrown error.
 */
export class RetentionPurgeError extends Error {
  readonly table: string;
  readonly deletedSoFar: number;
  readonly calls: number;

  constructor(table: string, deletedSoFar: number, calls: number, cause: unknown) {
    super(
      `retention purge failed for "${table}" on call ${calls} (${deletedSoFar} row(s) already deleted)`,
      { cause },
    );
    this.name = 'RetentionPurgeError';
    this.table = table;
    this.deletedSoFar = deletedSoFar;
    this.calls = calls;
  }
}

/**
 * Purges one table down to `cutoff`. `purgeLimit` must match the limit the underlying
 * `@edmate/db` method actually enforces (its own default is `RETENTION_PURGE_LIMIT`) -- it is how
 * this loop recognises "that call cleared everything there was", and it is passed into every live
 * call so the loop's limit and the database's limit can never drift apart. A call that throws
 * after earlier calls succeeded raises `RetentionPurgeError`, carrying the rows already deleted.
 */
export async function purgeTable(
  table: string,
  purge: PurgeMethod,
  cutoff: Date,
  dryRun: boolean,
  purgeLimit: number,
): Promise<TablePurgeResult> {
  if (dryRun) {
    const result = await purge(cutoff, true, purgeLimit);
    return { table, count: result.count, dryRun: true, calls: 1, maxIterationsHit: false };
  }
  let count = 0;
  let calls = 0;
  let maxIterationsHit = false;
  for (;;) {
    calls += 1;
    let result: RetentionResult;
    try {
      result = await purge(cutoff, false, purgeLimit);
    } catch (cause) {
      throw new RetentionPurgeError(table, count, calls, cause);
    }
    count += result.count;
    if (result.count < purgeLimit) break;
    if (calls >= MAX_ITERATIONS_PER_TABLE) {
      maxIterationsHit = true;
      break;
    }
  }
  return { table, count, dryRun: false, calls, maxIterationsHit };
}
