// The lockedLeak guard (task 4.6, ADR-0007). Code only: it makes no model call, and locked text
// never enters the harness. Every check goes through `createLockedCheck`, which turns the texts
// into token-run candidates (lockedMatch.ts) and asks `RetrievalIndex.leakCheck`, which says only
// whether any of them shares an 8+ token span with the teacher's material outside the student's
// allowed modules.
//
// The same check runs wherever text could reach a student or a model (each fails closed when the
// check rejects or times out):
//   - each streamed sentence, with the last 7 tokens shown before it (generate/lockedStream.ts):
//     a hit or a failed check withholds it and everything after it;
//   - each tool output, before the model sees it (generate/toolLoop.ts): `failed('locked')`;
//   - each skill payload, before it is sent (generate/skillEvent.ts): `drop('locked')`;
//   - the whole reply, in the post-guard chain (this guard), BEFORE answerLeak so the answer
//     rewriter never receives a locked span. On a hit the WHOLE reply becomes the locked reply
//     (lead decision, task 4.6 plan answer 3: no surgical strip); that text passes this guard
//     without a check, so the guard is idempotent by construction. A failed check throws, so the
//     chain fails and postGuard sends the safe reply.
// Reports name the site or cause only, never text. lockedLeak is a verbatim backstop: see
// lockedMatch.ts for what it does not catch (judge cases, task 4.5b).
import type { RetrievalIndex } from '@edmate/contracts';
import { z } from 'zod';
import type { Clock } from '../pipeline/clock.js';
import { errorName, HarnessError } from '../pipeline/errors.js';
import { runWithTimeout } from '../pipeline/timeout.js';
import type { LockedCheck, PostGuardCtx } from './answerLeak.js';
import type { Guard, GuardRun } from './guard.js';
import { lockedCandidates } from './lockedMatch.js';

/** One leakCheck call, on the injected clock; past it the check rejects (fails closed). */
export const LOCKED_CHECK_TIMEOUT_MS = 150;

/** Where locked material was held back. */
export type LockedSite = 'stream' | 'tool' | 'skill' | 'reply';

/** Locked material was found and held back. Names the site only (never the text). */
export class LockedLeakDetected extends HarnessError {
  override readonly name = 'LockedLeakDetected';

  constructor(readonly site: LockedSite) {
    super(`locked material withheld (${site})`);
  }
}

export type LockedCheckFailure = 'timeout' | 'error' | 'invalid';

/** The index could not answer; the caller fails closed. Cause and error name only. */
export class LockedCheckFailed extends HarnessError {
  override readonly name = 'LockedCheckFailed';

  constructor(
    readonly reason: LockedCheckFailure,
    readonly errorName?: string,
  ) {
    super(`locked check failed: ${reason}` + (errorName === undefined ? '' : ` (${errorName})`));
  }
}

const ResultSchema = z.strictObject({ hit: z.boolean() });

export interface LockedCheckOptions {
  retrieval: Pick<RetrievalIndex, 'leakCheck'>;
  teacherId: string;
  /** The entitlement's allowed modules: everything else of this teacher's counts as locked. */
  allowedModuleIds: readonly string[];
  clock: Clock;
  /** The student's (scrubbed) message: their own words quoted back are not a leak. */
  studentText?: string;
  /** Default LOCKED_CHECK_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** The check every call site uses. Resolves true on a hit; rejects with LockedCheckFailed. */
export function createLockedCheck(o: LockedCheckOptions): LockedCheck {
  const teacherId = o.teacherId;
  const allowed = [...o.allowedModuleIds];
  return async (texts) => {
    const candidates = lockedCandidates(texts, o.studentText);
    if (candidates.length === 0) return false;
    const r = await runWithTimeout(
      () => o.retrieval.leakCheck(candidates, { teacherId, allowedModuleIds: [...allowed] }),
      o.timeoutMs ?? LOCKED_CHECK_TIMEOUT_MS,
      o.clock,
    );
    if (r.status === 'timeout') throw new LockedCheckFailed('timeout');
    if (r.status === 'error') throw new LockedCheckFailed('error', errorName(r.error));
    const v = ResultSchema.safeParse(r.value);
    if (!v.success) throw new LockedCheckFailed('invalid');
    return v.data.hit;
  };
}

/**
 * The built-in English locked reply (pilot decision; a locale may supply its own through
 * `FallbackReplies.lockedReply`). It names only the student's own package, when given.
 */
export function lockedReplyText(packageName?: string): string {
  const pkg = packageName === undefined ? ',' : `, ${packageName},`;
  return (
    `That isn't part of your current package${pkg} so I can't help with it here. ` +
    "Is there something from your package you'd like to work on instead?"
  );
}

const OK: GuardRun = { result: { ok: true }, usage: [] };

export function createLockedLeakGuard(): Guard<PostGuardCtx> {
  return {
    name: 'lockedLeak',
    phase: 'post',
    async run(text, x): Promise<GuardRun> {
      if (text === x.lockedReply) return OK;
      if (!(await x.lockedCheck([text]))) return OK;
      return {
        result: { ok: false, action: 'rewrite', text: x.lockedReply, reason: 'locked' },
        usage: [],
      };
    },
  };
}
