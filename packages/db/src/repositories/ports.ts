import type { TranscriptStore, UsageMeter } from '@edmate/contracts';
import { RepositoryError } from './errors.js';
import type { Repositories } from './index.js';
import { studentScope, type StudentScope } from './scope.js';
import type { UnmeteredEntry, UsageSource } from './usage-ledger.js';

/**
 * The frozen TranscriptStore port has no scope parameter, so the scope is a required constructor
 * argument: the caller (web route or worker) builds one store per turn from the signed-in student
 * and the agent's teacher. Another pair's session reads as empty and appending to it is
 * `not_found`.
 */
export function transcriptStoreFor(repos: Repositories, scope: StudentScope): TranscriptStore {
  const bound = studentScope(scope, 'transcriptStoreFor');
  return {
    history: (sessionId, limit) => repos.messages.history(bound, sessionId, limit),
    append: (sessionId, m) => repos.messages.append(bound, sessionId, m),
  };
}

/** The metering context: the same fields as the frozen UsageMeter.record's ctx. */
export interface UsageMeterContext {
  teacherId: string;
  packageId: string;
  studentId: string;
  turnId: string;
  source: UsageSource;
}

/** What `recordUnmetered` takes: the context plus the unmetered call's tier, reason and figures. */
export type UnmeteredUsageInput = UsageMeterContext & Omit<UnmeteredEntry, 'turnId' | 'source'>;

/**
 * A UsageMeter for one student x teacher, plus `recordUnmetered`. Together they are the sink that
 * `@edmate/gateway`'s metering wrapper (task 2.4) writes to; the composition root (3.7) builds one
 * per turn and passes it to `createMeteredGateway`. A context naming another teacher or student
 * is a `scope` error, so a wrong context can never bill another pair.
 */
export interface ScopedUsageMeter extends UsageMeter {
  recordUnmetered(u: UnmeteredUsageInput): Promise<void>;
}

export function usageMeterFor(repos: Repositories, scope: StudentScope): ScopedUsageMeter {
  const bound = studentScope(scope, 'usageMeterFor');
  const check = (ctx: { teacherId: string; studentId: string }, method: string) => {
    if (ctx.teacherId !== bound.teacherId || ctx.studentId !== bound.studentId) {
      throw new RepositoryError('scope', method);
    }
  };
  return {
    async record(u, ctx) {
      check(ctx, 'usageMeterFor.record');
      await repos.usageLedger.record(bound, ctx.packageId, {
        turnId: ctx.turnId,
        source: ctx.source,
        usage: u,
      });
    },
    async recordUnmetered(u) {
      check(u, 'usageMeterFor.recordUnmetered');
      const entry: UnmeteredEntry = {
        turnId: u.turnId,
        source: u.source,
        tier: u.tier,
        reason: u.reason,
        ...(u.model === undefined ? {} : { model: u.model }),
        ...(u.tokens === undefined ? {} : { tokens: u.tokens }),
      };
      await repos.usageLedger.recordUnmetered(bound, u.packageId, entry);
    },
  };
}
