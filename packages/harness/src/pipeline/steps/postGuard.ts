// Step 9, postGuard (task 4.5): runs the post-phase guard chain (answerLeak first; 4.6-4.9 add the
// rest) over the reply the student was shown, before `done`.
//
// Results, all built here (the runner only adds its own fallback when this step throws, times out
// or returns something malformed):
//   - the gate withheld a leak, or the full model text (`raw`, which includes anything held back)
//     leaks: the chain runs on `raw` instead of the shown draft (fix round 1), so the other post
//     guards still see it (an escalate is caught) and answerLeak gets its one bounded rewrite of
//     it; anything but a rewrite every guard accepts gives ANSWER_LEAK_SAFE_HINT;
//   - chain `ok`, text unchanged: `ok`; text rewritten: `replace` with the rewrite, so the student
//     sees, and history keeps, only the checked text;
//   - chain `escalate`: forwarded with its alert and text; the runner replies with the caring
//     template (the text is never shown);
//   - chain `block` or `failed`: `replace` with the hint when answerLeak was involved, else the
//     locale's safe reply. A `failed` chain is reported (guard name and cause only).
// The runner sends `replace ''` before any replacement, so skill events and sources clear.
//
// Time: each guard's slice is the step budget less a margin, shared by both chain passes and every
// registered guard, so a full chain always ends inside the step; a rewrite gets part of its slice.
import type { ModelRequest, Usage } from '@edmate/contracts';
import {
  ANSWER_LEAK_SAFE_HINT,
  type LeakRewrite,
  type PostGuardCtx,
} from '../../guardrails/answerLeak.js';
import { type GuardChainResult, type GuardFailure, runGuardChain } from '../../guardrails/chain.js';
import type { Guard } from '../../guardrails/guard.js';
import { postGuards } from '../../guardrails/postGuards.js';
import { type CancelToken, linkCancel } from '../clock.js';
import { HarnessError } from '../errors.js';
import { compileAnswerKeys } from '../generate/answerKey.js';
import { StreamReader } from '../generate/streamReader.js';
import { STEP_SPEC } from '../spec.js';
import { runWithTimeout } from '../timeout.js';
import type { GuardTrace, PostGuardResult, StepEnv, Steps } from '../types.js';

/** The step's budget (2 s) less this margin is what the chain may use. */
export const POST_GUARD_MARGIN_MS = 200;
/** The share of a guard's slice its rewrite call may use. */
export const REWRITE_SHARE = 0.6;
/** The rewrite reply's token cap (it is a short hint). */
export const REWRITE_MAX_OUTPUT_TOKENS = 400;

/**
 * The fixed instruction for the one small-tier rewrite. It names no key: the draft already holds
 * the answer, and the matcher re-checks whatever comes back.
 */
export const REWRITE_SYSTEM =
  "You edit a tutor's reply to a student. The reply gave away the final answer. Rewrite it as a " +
  'short hint that helps the student take the next step on their own. Do not state, spell out, ' +
  'encode, translate, or confirm the final answer or the finished code. Keep the language of the ' +
  'original reply. Reply with the rewritten text only.';

/** Each guard's time slice: the chain's budget over two passes of `count` guards. */
export function postGuardSliceMs(count: number): number {
  const budget = (STEP_SPEC.postGuard.timeoutMs as number) - POST_GUARD_MARGIN_MS;
  return Math.floor(budget / (2 * Math.max(1, count)));
}

/** The post-guard chain failed closed. Guard name and cause only, never text or reason. */
export class PostGuardFailed extends HarnessError {
  override readonly name = 'PostGuardFailed';

  constructor(readonly failure: GuardFailure) {
    super(
      `post guard chain failed: ${failure.cause} (${failure.name})` +
        (failure.errorName === undefined ? '' : ` ${failure.errorName}`),
    );
  }
}

/** The bounded rewrite answerLeak calls: small tier, fixed instruction, never throws. */
function rewriter(env: StepEnv, budgetMs: number) {
  return async (draft: string, cancel: CancelToken): Promise<LeakRewrite> => {
    const usage: Usage[] = [];
    const req: ModelRequest = {
      tier: 'small',
      system: REWRITE_SYSTEM,
      messages: [{ role: 'user', content: draft }],
      maxOutputTokens: REWRITE_MAX_OUTPUT_TOKENS,
    };
    try {
      env.usage.checkBeforeCall();
    } catch (error) {
      env.report(error);
      return { text: undefined, usage };
    }
    const r = await runWithTimeout(
      async (slice) => {
        const reader = new StreamReader(
          env.gateway.stream(req),
          linkCancel(slice, cancel),
          env.report,
          env.track,
        );
        let text = '';
        try {
          for (let c = await reader.next(); c !== undefined; c = await reader.next()) {
            if (c.type === 'text') text += c.text;
            else if (c.type === 'usage') usage.push(c.usage);
            else return undefined; // a tool call: no tools were offered
          }
        } finally {
          reader.close();
        }
        return text;
      },
      budgetMs,
      env.deps.clock,
    );
    if (r.status === 'error') env.report(r.error);
    return { text: r.status === 'ok' ? r.value : undefined, usage };
  };
}

const answerLeakHit = (g: GuardTrace): boolean => g.name === 'answerLeak' && !g.ok;

/** The postGuard step over `guards` (default: the registered post-phase guards). */
export function createPostGuard(
  guards: readonly Guard<PostGuardCtx>[] = postGuards.ordered(),
): Steps['postGuard'] {
  return async (env, { ctx, decision, draft, raw, withheld }): Promise<PostGuardResult> => {
    const studentText = env.input.text;
    const own = studentText === undefined ? {} : { studentText };
    const hint = (guards: GuardTrace[], usage: Usage[]): PostGuardResult => ({
      result: 'replace',
      text: ANSWER_LEAK_SAFE_HINT,
      guards,
      usage,
    });

    // A leak the gate held back, or one in text the student never saw: the chain judges all the
    // model wrote, and only a checked rewrite (or the hint) may reach the student.
    const leaked =
      withheld === true ||
      (raw !== undefined &&
        raw !== draft &&
        compileAnswerKeys(decision.mustNotReveal, own).leaks(raw));
    const subject = leaked ? (raw ?? draft) : draft;

    const slice = postGuardSliceMs(guards.length);
    const x: PostGuardCtx = {
      ctx,
      decision,
      ...own,
      rewrite: rewriter(env, Math.floor(slice * REWRITE_SHARE)),
    };
    const r: GuardChainResult = await runGuardChain(guards, subject, x, {
      phase: 'post',
      clock: env.deps.clock,
      timeoutMs: slice,
      cancel: env.cancel,
    });
    const { guards: trace, usage } = r;
    switch (r.outcome) {
      case 'ok':
        // A known leak that no guard rewrote is never shown: fail to the hint.
        if (leaked && r.text === subject) return hint(trace, usage);
        return r.text === draft
          ? { result: 'ok', guards: trace, usage }
          : { result: 'replace', text: r.text, guards: trace, usage };
      case 'escalate':
        return { result: 'escalate', alert: r.alert, text: r.text, guards: trace, usage };
      case 'failed':
        env.report(new PostGuardFailed(r.failure));
        if (leaked || r.failure.name === 'answerLeak' || trace.some(answerLeakHit)) {
          return hint(trace, usage);
        }
        break;
      case 'block':
        if (leaked || r.blockedBy === 'answerLeak' || trace.some(answerLeakHit)) {
          return hint(trace, usage);
        }
        break;
    }
    const text = env.deps.fallbackReplies.safeReply(env.input.lang);
    return { result: 'replace', text, guards: trace, usage };
  };
}

export const postGuard: Steps['postGuard'] = createPostGuard();
