// The answerLeak guard (task 4.5): the first post-phase guard. Rules only; it makes no model call
// itself. It runs the shared answer-key matcher (pipeline/generate/answerKey.ts, the same one the
// stream gate uses) over the whole reply: the key as text, as a number in any form, or inside
// base64. On a hit it rewrites, following the spec ("rewrite once; else safe hint"): one bounded
// small-tier rewrite (`PostGuardCtx.rewrite`, built by the postGuard step) that must itself pass
// the matcher, else the fixed ANSWER_LEAK_SAFE_HINT. The chain's verification pass then re-checks
// the rewrite with every post guard; if anything still hits, postGuard sends the hint.
//
// Its reason is a fixed code, never the key or the text. Paraphrased answers ("the hot-ish one")
// need a judge and are task 4.5b.
import type { PedagogyDecision, TurnContext, Usage } from '@edmate/contracts';
import { LIMITS } from '@edmate/contracts';
import { compileAnswerKeys } from '../pipeline/generate/answerKey.js';
import type { CancelToken } from '../pipeline/clock.js';
import type { Guard, GuardRun } from './guard.js';

/**
 * The fixed reply when a leak can't be rewritten safely. English (pilot decision); it holds no
 * digit, number word or code, so it passes the matcher for any key and the guard is idempotent.
 */
export const ANSWER_LEAK_SAFE_HINT =
  "Let's work this out together rather than jump to the final answer. Look at the next step " +
  "yourself: what would you try, and why? Tell me and I'll check your thinking.";

/** What a rewrite returns: the new text (undefined when it failed) and the usage it spent. */
export interface LeakRewrite {
  text: string | undefined;
  usage: Usage[];
}

/**
 * Asks the index whether any of `texts` holds a locked span (ADR-0007): true on a hit. Rejects
 * when it can't tell (timeout, error, bad result); every caller fails closed on that.
 */
export type LockedCheck = (texts: readonly string[]) => Promise<boolean>;

/** The post phase's guard context (4.5; 4.6-4.9 add what their guards need). */
export interface PostGuardCtx {
  readonly ctx: TurnContext;
  readonly decision: PedagogyDecision;
  /** The student's (scrubbed) message: code-shaped keys it holds may be quoted back. */
  readonly studentText?: string;
  /** One bounded small-tier rewrite of a leaking draft; never throws. Absent: the hint. */
  readonly rewrite?: (draft: string, cancel: CancelToken) => Promise<LeakRewrite>;
  /** lockedLeak's check (4.6). Required, so a chain can't run without it by accident. */
  readonly lockedCheck: LockedCheck;
  /** The reply lockedLeak sends instead of a reply that holds locked material (4.6). */
  readonly lockedReply: string;
}

const OK: GuardRun = { result: { ok: true }, usage: [] };

export function createAnswerLeakGuard(): Guard<PostGuardCtx> {
  return {
    name: 'answerLeak',
    phase: 'post',
    async run(text, x, cancel): Promise<GuardRun> {
      const keys = compileAnswerKeys(
        x.decision.mustNotReveal,
        x.studentText === undefined ? {} : { studentText: x.studentText },
      );
      if (!keys.leaks(text)) return OK;
      let out = ANSWER_LEAK_SAFE_HINT;
      let usage: Usage[] = [];
      if (x.rewrite !== undefined) {
        try {
          const r = await x.rewrite(text, cancel);
          usage = r.usage;
          const t = r.text?.trim();
          if (
            t !== undefined &&
            t !== '' &&
            t.length <= LIMITS.modelTextMaxLength &&
            !keys.leaks(t)
          ) {
            out = t;
          }
        } catch {
          // The rewrite is best effort: the hint is always safe.
        }
      }
      return { result: { ok: false, action: 'rewrite', text: out, reason: 'answer_key' }, usage };
    },
  };
}
