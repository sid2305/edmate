// The turn-queue processors (task 3.8): each job from @edmate/queue's producers becomes one write
// through the real @edmate/db adapters, scoped to the job's student x teacher.
//
// Idempotent: a job processed twice (a retry after a crash, a stalled job run again) writes once.
// - usage: the row id derives from (turnId, index); a row with that id already listed for the
//   turn means it was written.
// - message: the id is the caller's; a duplicate is reported `not_found` (no probing), so on
//   `not_found` the session's history is read back: the id there means it was written.
// - help state: an UPDATE, last write wins: running it again changes nothing.
// - trace: one per turn (unique turn_id); a trace found for the turn means it was written.
//
// A failure that a retry cannot fix (a malformed payload, a scope / not_found / invalid /
// integrity error) is thrown as `PermanentJobError`, which the worker turns into BullMQ's
// UnrecoverableError (no retries, straight to the dead-letter queue). Anything else is retried.
import {
  type Repositories,
  RepositoryError,
  sessionStateStoreFor,
  traceSinkFor,
  transcriptStoreFor,
} from '@edmate/db';
import {
  HelpStateJobSchema,
  JOB,
  MessageJobSchema,
  TraceJobSchema,
  UnmeteredJobSchema,
  UsageJobSchema,
  usageRowId,
} from '@edmate/queue';
import { describeError, type Log } from '../log.js';

/** A job as the processors see it (BullMQ's Job has more). */
export interface TurnJob {
  /** BullMQ's job id, for log lines. */
  id?: string | undefined;
  name: string;
  data: unknown;
}

export type JobOutcome = 'written' | 'already_written';

/** A failure no retry can fix. The message names the job and the reason, never payload text. */
export class PermanentJobError extends Error {
  override readonly name = 'PermanentJobError';
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
  }
}

const PERMANENT_KINDS = new Set(['scope', 'not_found', 'invalid', 'integrity']);

/** Rethrows `error` as permanent when a retry can't fix it; a `failed` (db down) stays retryable. */
export function classify(job: string, error: unknown): never {
  if (error instanceof RepositoryError && PERMANENT_KINDS.has(error.kind)) {
    throw new PermanentJobError(`${job}: ${error.message}`, { cause: error });
  }
  throw error;
}

function parse<T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  job: TurnJob,
): T {
  const r = schema.safeParse(job.data);
  if (!r.success) throw new PermanentJobError(`${job.name}: invalid job payload`);
  return r.data;
}

/** Writes once; on any failure, `exists()` decides whether an earlier run already wrote it. */
async function once(
  job: TurnJob,
  log: Log,
  exists: () => Promise<boolean>,
  write: () => Promise<void>,
): Promise<JobOutcome> {
  try {
    if (await exists()) return 'already_written';
  } catch (error) {
    return classify(job.name, error);
  }
  try {
    await write();
    return 'written';
  } catch (error) {
    // A concurrent or earlier run may have won the race (unique id or turn).
    let found = false;
    try {
      found = await exists();
    } catch (recheckError) {
      // The write's error is the one that decides the retry; the recheck's is logged, not lost.
      log({
        level: 'warn',
        event: 'job.recheck_failed',
        name: job.name,
        jobId: job.id ?? null,
        error: describeError(recheckError),
      });
    }
    if (found) return 'already_written';
    return classify(job.name, error);
  }
}

/** Processes `edmate-turn-meter` jobs: usage rows. */
export function meterProcessor(
  repos: Repositories,
  log: Log,
): (job: TurnJob) => Promise<JobOutcome> {
  return async (job) => {
    if (job.name === JOB.usage) {
      const d = parse(UsageJobSchema, job);
      const id = usageRowId(d.turnId, d.index);
      return once(
        job,
        log,
        async () =>
          (await repos.usageLedger.listForTurn(d.scope, d.turnId)).some((r) => r.id === id),
        () =>
          repos.usageLedger.record(d.scope, d.packageId, {
            id,
            turnId: d.turnId,
            source: d.source,
            usage: d.usage,
          }),
      );
    }
    if (job.name === JOB.unmetered) {
      const d = parse(UnmeteredJobSchema, job);
      const id = usageRowId(d.turnId, d.index);
      return once(
        job,
        log,
        async () =>
          (await repos.usageLedger.listForTurn(d.scope, d.turnId)).some((r) => r.id === id),
        () =>
          repos.usageLedger.recordUnmetered(d.scope, d.packageId, {
            id,
            turnId: d.turnId,
            source: d.source,
            tier: d.tier,
            reason: d.reason,
            ...(d.model === undefined ? {} : { model: d.model }),
            ...(d.tokens === undefined ? {} : { tokens: d.tokens }),
          }),
      );
    }
    throw new PermanentJobError(`unknown meter job ${JSON.stringify(job.name).slice(0, 60)}`);
  };
}

/** Processes `edmate-turn-commit` jobs: messages, the help state and the trace. */
export function commitProcessor(
  repos: Repositories,
  log: Log,
): (job: TurnJob) => Promise<JobOutcome> {
  return async (job) => {
    if (job.name === JOB.message) {
      const d = parse(MessageJobSchema, job);
      const store = transcriptStoreFor(repos, d.scope);
      const written = async () =>
        (await store.history(d.sessionId, 200)).some((m) => m.id === d.message.id);
      try {
        await store.append(d.sessionId, d.message);
        return 'written';
      } catch (error) {
        if (error instanceof RepositoryError && error.kind === 'not_found' && (await written())) {
          return 'already_written';
        }
        return classify(job.name, error);
      }
    }
    if (job.name === JOB.helpState) {
      const d = parse(HelpStateJobSchema, job);
      try {
        await sessionStateStoreFor(repos, d.scope).saveHelpState(d.sessionId, d.helpState);
        return 'written';
      } catch (error) {
        return classify(job.name, error);
      }
    }
    if (job.name === JOB.trace) {
      const d = parse(TraceJobSchema, job);
      return once(
        job,
        log,
        async () =>
          (await repos.turnTraces.findForTurn(d.scope, {
            sessionId: d.trace.sessionId,
            turnId: d.trace.turnId,
          })) !== null,
        () => traceSinkFor(repos, d.scope).record(d.trace),
      );
    }
    throw new PermanentJobError(`unknown commit job ${JSON.stringify(job.name).slice(0, 60)}`);
  };
}
