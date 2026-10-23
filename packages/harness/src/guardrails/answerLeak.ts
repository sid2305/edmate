// The answerLeak guard (task 4.5): the first post-phase guard. Rules only; it makes no model call
// itself. It runs the shared answer-key matcher (pipeline/generate/answerKey.ts, the same one the
// stream gate uses) over the whole reply: the key as text, as a number in any form, or inside
// base64. On a hit it rewrites, following the spec ("rewrite once; else safe hint"): one bounded
// small-tier rewrite (`PostGuardCtx.rewrite`, built by the postGuard step) that must itself pass
// the matcher, else the fixed ANSWER_LEAK_SAFE_HINT. The chain's verification pass then re-checks
// the rewrite with every post guard; if anything still hits, postGuard sends the hint.
//
// Answer context (5.6b): the matcher gets the active practice items and the practice keys, so the
// model may restate an item's prompt and exact option listing; a label key, the correct option's
// text or position, or ruling out every wrong option still leaks.
//
// Its reason is a fixed code, never the key or the text. Paraphrased answers ("the hot-ish one")
// need a judge and are task 4.5b.
import type { PedagogyDecision, SourceRef, TurnContext, Usage } from '@edmate/contracts';
import { LIMITS } from '@edmate/contracts';
import { type AnswerKeyOptions, compileAnswerKeys } from '../pipeline/generate/answerKey.js';
import type { ItemContext } from '../pipeline/generate/itemContext.js';
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

/** One grounding judge request (4.7): a fixed instruction and the delimited data. */
export interface JudgeRequest {
  system: string;
  user: string;
}

/** What the judge call returns: its raw text (undefined when the call failed) and usage. */
export interface JudgeReply {
  text: string | undefined;
  usage: Usage[];
}

/** One bounded small-tier judge call (4.7), built by the postGuard step; never throws. */
export type GroundingJudge = (req: JudgeRequest, cancel: CancelToken) => Promise<JudgeReply>;

/** The post phase's guard context (4.5; 4.6-4.9 add what their guards need). */
export interface PostGuardCtx {
  readonly ctx: TurnContext;
  readonly decision: PedagogyDecision;
  /** The student's (scrubbed) message: code-shaped keys it holds may be quoted back. */
  readonly studentText?: string;
  /**
   * The active practice items (5.6b): the loaded one and every one issued this turn. A re-show of
   * an item's prompt or exact option listing is exempt; the keys derived from it (the correct
   * option's text and position, ruling out every wrong option) are guarded.
   */
  readonly items?: readonly ItemContext[];
  /** Practice keys (5.6b, design 4): never quoted back as the student's own code. */
  readonly practiceKeys?: readonly string[];
  /** One bounded small-tier rewrite of a leaking draft; never throws. Absent: the hint. */
  readonly rewrite?: (draft: string, cancel: CancelToken) => Promise<LeakRewrite>;
  /** lockedLeak's check (4.6). Required, so a chain can't run without it by accident. */
  readonly lockedCheck: LockedCheck;
  /** The reply lockedLeak sends instead of a reply that holds locked material (4.6). */
  readonly lockedReply: string;
  /**
   * decide's numbered sources, in `[n]` order (4.7, grounding's citation check). Absent: one per
   * retrieved chunk.
   */
  readonly sources?: readonly SourceRef[];
  /** grounding's judge (4.7). Absent: every judged reply fails closed to the ask-teacher reply. */
  readonly judge?: GroundingJudge;
  /** The reply grounding sends for an ungrounded reply (4.7). Absent: the built-in English one. */
  readonly askTeacherReply?: string;
  /** Fixed texts every post guard passes as they are: the safe and distress replies (4.7). */
  readonly fixedTexts?: readonly string[];
  /**
   * The locale's safe reply: grounding sends it when its judge is unavailable (4.7 fix round 1).
   * Absent: ANSWER_LEAK_SAFE_HINT.
   */
  readonly safeReply?: string;
  /**
   * adviceGuard's judge (4.8): one bounded small-tier call, built by the postGuard step. Absent:
   * a reply the judge would see fails closed to adviceGuard's fixed fallback.
   */
  readonly adviceJudge?: GroundingJudge;
  /** adviceGuard's one bounded small-tier rewrite (4.8); never throws. Absent: the fallback. */
  readonly adviceRewrite?: (req: JudgeRequest, cancel: CancelToken) => Promise<LeakRewrite>;
  /** The prompt-pack frame's generic disclaimer (4.8). Absent: adviceGuard's built-in copy. */
  readonly genericDisclaimer?: string;
  /** The locale's redirect reply (4.8): adviceGuard's fallback on a redirect turn. */
  readonly redirectReply?: string;
  /** True while the chain runs its verification pass (4.8: adviceGuard makes no judge call then). */
  readonly verifying?: () => boolean;
}

const OK: GuardRun = { result: { ok: true }, usage: [] };

/**
 * The matcher options a post guard judges with (5.6b): the answer context, and the student's text
 * unless `student` is false (text that is not a reply, such as a retrieved chunk).
 */
export function answerKeyOptions(
  x: Pick<PostGuardCtx, 'studentText' | 'items' | 'practiceKeys'>,
  student = true,
): AnswerKeyOptions {
  return {
    ...(x.studentText === undefined || !student ? {} : { studentText: x.studentText }),
    ...(x.items === undefined ? {} : { items: x.items }),
    ...(x.practiceKeys === undefined ? {} : { practiceKeys: x.practiceKeys }),
  };
}

export function createAnswerLeakGuard(): Guard<PostGuardCtx> {
  return {
    name: 'answerLeak',
    phase: 'post',
    async run(text, x, cancel): Promise<GuardRun> {
      // The platform's fixed texts (4.8: e.g. adviceGuard's fallback) pass as they are.
      if (x.fixedTexts?.includes(text) === true) return OK;
      // One matcher judges the draft and re-checks the rewrite, with the same answer context.
      const keys = compileAnswerKeys(x.decision.mustNotReveal, answerKeyOptions(x));
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
