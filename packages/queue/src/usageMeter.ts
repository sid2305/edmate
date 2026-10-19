// UsageMeter on the meter queue (task 3.8). `record` (the frozen port, used by the harness `meter`
// step) and `recordUnmetered` (so the same adapter is @edmate/gateway's MeterSink, task 2.4)
// resolve once the job is enqueued, never on the database write. A failed enqueue rejects, so
// the caller reports it (the meter step is `failed`; the gateway logs `metering.failed`).
//
// Each write of a turn gets the next index (0, 1, …) at call time; the job id and the ledger row
// id derive from (turnId, index), so a retried job never writes a second row.
import type { Entitlement, Usage, UsageMeter } from '@edmate/contracts';
import {
  bindScope,
  JOB,
  type JobQueue,
  type JobScope,
  jobId,
  jobOptions,
  type UnmeteredJob,
  UnmeteredJobSchema,
  type UsageJob,
  UsageJobSchema,
} from './queues.js';

export interface UsageContext {
  readonly teacherId: string;
  readonly packageId: string;
  readonly studentId: string;
  readonly turnId: string;
  readonly source: Entitlement['source'];
}

/** Same shape as @edmate/gateway's UnmeteredUsage. */
export interface UnmeteredInput extends UsageContext {
  readonly reason: 'no_usage_reported' | `unpriced_model:${string}`;
  readonly tier: Usage['tier'];
  readonly model?: string;
  readonly tokens?: { readonly inputTokens: number; readonly outputTokens: number };
}

export interface QueuedUsageMeter extends UsageMeter {
  recordUnmetered(u: UnmeteredInput): Promise<void>;
}

/** How many turns' counters one adapter keeps; the composition root builds one per turn. */
export const MAX_TRACKED_TURNS = 1_000;

export function queuedUsageMeter(queue: JobQueue, scope: JobScope): QueuedUsageMeter {
  const bound = bindScope(scope, 'queuedUsageMeter');
  const next = new Map<string, number>();

  function billing(ctx: UsageContext, method: string) {
    if (ctx.teacherId !== bound.teacherId || ctx.studentId !== bound.studentId) {
      // Never bill another pair, as usageMeterFor refuses it (@edmate/db).
      throw new TypeError(`${method}: the context is not this meter's student x teacher`);
    }
    const index = next.get(ctx.turnId) ?? 0;
    next.delete(ctx.turnId);
    next.set(ctx.turnId, index + 1);
    if (next.size > MAX_TRACKED_TURNS) next.delete(next.keys().next().value as string);
    return {
      scope: bound,
      packageId: ctx.packageId,
      turnId: ctx.turnId,
      source: ctx.source,
      index,
    };
  }

  return {
    async record(usage, ctx) {
      const data: UsageJob = UsageJobSchema.parse({ ...billing(ctx, 'record'), usage });
      await queue.add(JOB.usage, data, jobOptions(jobId.usage(data.turnId, data.index), JOB.usage));
    },
    async recordUnmetered(u) {
      const data: UnmeteredJob = UnmeteredJobSchema.parse({
        ...billing(u, 'recordUnmetered'),
        tier: u.tier,
        reason: u.reason,
        ...(u.model === undefined ? {} : { model: u.model }),
        ...(u.tokens === undefined
          ? {}
          : { tokens: { inputTokens: u.tokens.inputTokens, outputTokens: u.tokens.outputTokens } }),
      });
      await queue.add(
        JOB.unmetered,
        data,
        jobOptions(jobId.usage(data.turnId, data.index), JOB.unmetered),
      );
    },
  };
}
