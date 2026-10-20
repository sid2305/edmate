// Step 9, postGuard (task 4.5): runs the post-phase guard chain (lockedLeak, then answerLeak, then
// grounding; 4.8-4.9 add the rest) over the reply the student was shown, before `done`.
//
// Locked material (4.6) comes first:
//   - the stream's locked check withheld text (`locked`): no chain runs on that text (no rewrite
//     may see it); a hit gives the locked reply, a check that could not answer the safe reply (the
//     hint when an answer leak was also withheld);
//   - otherwise lockedLeak checks the whole reply first in the chain; a hit replaces the WHOLE
//     reply with the locked reply (no surgical strip), so answerLeak's rewrite never receives
//     locked text. Each hit is reported to background by name (LockedLeakDetected), no text.
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
// Grounding (4.7): this step builds its judge (one bounded small-tier call, remembered per request
// for the turn, so the verification pass never pays twice), the locale's ask-teacher reply and
// the fixed texts every guard passes. When grounding replaced the reply with the reason code
// `ungrounded` (read from the guard's own result, never by comparing text) and the chain then
// passed, the result carries `escalateToTeacher` and the runner opens the TeacherQuestion.
//
// Advice (4.8): this step builds adviceGuard's judge and its one rewrite (both bounded small-tier
// calls inside adviceGuard's slice; the rewrite is skipped for the fixed fallback when too little
// of the slice is left), the disclaimer's generic text from the pinned prompt-pack set, the
// locale's redirect reply, and tells the guard when the chain is on its verification pass (it
// runs its rules only then). adviceGuard's fallback and redirect reply join the fixed texts every
// guard passes. adviceGuard never escalates. adviceGuard weighs as a rules-only guard on a turn
// where nothing could send its reply to the judge (no decision request, signal or hard hit), so
// the other guards keep their time on ordinary turns.
//
// A verification-pass block by lockedLeak (a rewrite that came back holding locked material)
// gives the locked reply, as a first-pass hit does.
//
// Time (4.7, lead answer 1): slices are weighted (postGuards.ts). Right before each guard runs,
// its slice is its weight's share of the budget still left, with pass 2 (every guard at
// PASS2_WEIGHT) held in reserve, so a full chain always ends inside the step. The rewrite and the
// judge get part of their own guard's slice.
import { LIMITS, type ModelRequest, type TurnContext, type Usage } from '@edmate/contracts';
import {
  ANSWER_LEAK_SAFE_HINT,
  type GroundingJudge,
  type JudgeReply,
  type JudgeRequest,
  type LeakRewrite,
  type PostGuardCtx,
} from '../../guardrails/answerLeak.js';
import {
  ADVICE_REASONS,
  adviceFallbackText,
  adviceRedirectReplyText,
  adviceSignal,
  decisionRequest,
  disclaimerFor,
  personalDirective,
} from '../../guardrails/adviceGuard.js';
import {
  type GuardChainResult,
  type GuardFailure,
  type GuardSliceRequest,
  runGuardChain,
} from '../../guardrails/chain.js';
import type { Guard, GuardRun } from '../../guardrails/guard.js';
import { askTeacherReplyText, GROUNDING_REASONS } from '../../guardrails/grounding.js';
import { LockedLeakDetected } from '../../guardrails/lockedLeak.js';
import { postGuards } from '../../guardrails/postGuards.js';
import { type CancelToken, linkCancel } from '../clock.js';
import { resolvePromptPackSet } from '../../pedagogy/promptPacks.js';
import { AdviceJudgeUnavailable, GroundingJudgeUnavailable, HarnessError } from '../errors.js';
import { compileAnswerKeys } from '../generate/answerKey.js';
import { StreamReader } from '../generate/streamReader.js';
import { LAST_RESORT_DISTRESS_REPLY } from '../replies.js';
import { STEP_SPEC } from '../spec.js';
import { runWithTimeout } from '../timeout.js';
import type { GuardTrace, PostGuardResult, StepEnv, Steps } from '../types.js';
import { lockedCheckFor, lockedReplyFor } from './locked.js';

/** The step's budget (2 s) less this margin is what the chain may use. */
export const POST_GUARD_MARGIN_MS = 200;
/** What the chain may use: the step budget less the margin. */
export const POST_GUARD_BUDGET_MS =
  (STEP_SPEC.postGuard.timeoutMs as number) - POST_GUARD_MARGIN_MS;
/** The share of answerLeak's slice its rewrite call may use (the rest is rules: microseconds). */
export const REWRITE_SHARE = 0.8;
/** The rewrite reply's token cap (it is a short hint). */
export const REWRITE_MAX_OUTPUT_TOKENS = 400;
/** The grounding judge's own timeout (lead answer 1; configurable, tuned live in 7.x). */
export const GROUNDING_JUDGE_TIMEOUT_MS = 600;
/** The share of grounding's slice its judge call may use, when that is under the timeout. */
export const JUDGE_SHARE = 0.9;
/** The judge's reply is one small JSON object. */
export const GROUNDING_JUDGE_MAX_OUTPUT_TOKENS = 20;
/** Every guard's weight on the verification pass (it re-checks; the calls are mostly done). */
export const PASS2_WEIGHT = 1;
/** adviceGuard's judge timeout: the same as grounding's (4.8 plan Q3; tuned live in 7.x). */
export const ADVICE_JUDGE_TIMEOUT_MS = GROUNDING_JUDGE_TIMEOUT_MS;
/** adviceGuard's rewrite runs only when at least this much of its slice is left (lead answer 11). */
export const ADVICE_REWRITE_MIN_MS = 200;
/** What adviceGuard's rewrite leaves unused at the end of its slice, so the guard returns in time. */
export const ADVICE_SLICE_MARGIN_MS = 10;

/**
 * The fixed instruction for the one small-tier rewrite. It names no key: the draft already holds
 * the answer, and the matcher re-checks whatever comes back.
 */
export const REWRITE_SYSTEM =
  "You edit a tutor's reply to a student. The reply gave away the final answer. Rewrite it as a " +
  'short hint that helps the student take the next step on their own. Do not state, spell out, ' +
  'encode, translate, or confirm the final answer or the finished code. Keep the language of the ' +
  'original reply. Reply with the rewritten text only.';

/**
 * A guard's slice (lead answer 1): its weight's share of `remainingMs` against the weights still
 * to run, with pass 2 (PASS2_WEIGHT per guard) held in reserve on pass 1. Each slice is at most its
 * share of what is left, so the whole chain always ends inside the budget.
 */
export function postGuardSliceMs(
  remainingMs: number,
  weights: readonly number[],
  at: Pick<GuardSliceRequest, 'pass' | 'index'>,
): number {
  if (!(remainingMs > 0)) return 0;
  if (at.pass === 2) return Math.floor(remainingMs / Math.max(1, weights.length - at.index));
  const ahead = weights.slice(at.index).reduce((a, b) => a + b, 0);
  const own = weights[at.index] ?? PASS2_WEIGHT;
  const share = Math.max(own, ahead + PASS2_WEIGHT * weights.length);
  return Math.floor((remainingMs * own) / share);
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

/**
 * One bounded small-tier call with no tools: its text, or undefined when it failed, timed out,
 * called a tool, or the turn is at its cost ceiling (reported). Never throws.
 */
async function smallCall(
  env: StepEnv,
  req: ModelRequest,
  budgetMs: number,
  cancel: CancelToken,
): Promise<LeakRewrite> {
  const usage: Usage[] = [];
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
}

/** The bounded rewrite answerLeak calls: small tier, fixed instruction, never throws. */
function rewriter(env: StepEnv, budgetMs: () => number) {
  return (draft: string, cancel: CancelToken): Promise<LeakRewrite> =>
    smallCall(
      env,
      {
        tier: 'small',
        system: REWRITE_SYSTEM,
        messages: [{ role: 'user', content: draft }],
        maxOutputTokens: REWRITE_MAX_OUTPUT_TOKENS,
      },
      budgetMs(),
      cancel,
    );
}

/**
 * A judge (grounding's, adviceGuard's): small tier, the guard's fixed rubric, never throws.
 * Remembered per request for the turn, so the verification pass re-checks the same text without a
 * second call (its usage was already counted, so a remembered answer carries none).
 */
function judgeFor(env: StepEnv, budgetMs: () => number): GroundingJudge {
  const seen = new Map<string, Promise<JudgeReply>>();
  return async (req, cancel) => {
    const key = JSON.stringify([req.system, req.user]);
    const known = seen.get(key);
    if (known !== undefined) return { text: (await known).text, usage: [] };
    const call = smallCall(
      env,
      {
        tier: 'small',
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        maxOutputTokens: GROUNDING_JUDGE_MAX_OUTPUT_TOKENS,
      },
      budgetMs(),
      cancel,
    );
    seen.set(key, call);
    return call;
  };
}

/**
 * adviceGuard's one rewrite: small tier, its fixed instruction, never throws. With under
 * ADVICE_REWRITE_MIN_MS left it makes no call (the guard then sends its fixed fallback).
 */
function adviceRewriter(env: StepEnv, budgetMs: () => number) {
  return async (req: JudgeRequest, cancel: CancelToken): Promise<LeakRewrite> => {
    const ms = budgetMs();
    if (ms < ADVICE_REWRITE_MIN_MS) return { text: undefined, usage: [] };
    return smallCall(
      env,
      {
        tier: 'small',
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        maxOutputTokens: REWRITE_MAX_OUTPUT_TOKENS,
      },
      ms,
      cancel,
    );
  };
}

/** A fixed text from the locale is usable when it is non-empty and within the model-text cap. */
function usable(text: unknown): text is string {
  return typeof text === 'string' && text.trim() !== '' && text.length <= LIMITS.modelTextMaxLength;
}

/** The ask-teacher reply: the locale's, else the built-in English one. A failure never hides it. */
export function askTeacherReplyFor(env: StepEnv): string {
  try {
    const text: unknown = env.deps.fallbackReplies.askTeacher?.(env.input.lang);
    if (usable(text)) return text;
  } catch (error) {
    env.report(error);
  }
  return askTeacherReplyText();
}

/** The redirect reply: the locale's, else the built-in English one. A failure never hides it. */
export function redirectReplyFor(env: StepEnv): string {
  try {
    const text: unknown = env.deps.fallbackReplies.redirect?.(env.input.lang);
    if (usable(text)) return text;
  } catch (error) {
    env.report(error);
  }
  return adviceRedirectReplyText();
}

/**
 * The pinned prompt-pack set's generic disclaimer; none (adviceGuard then uses its built-in copy
 * of frame@1.0.0's text) when it can't be read. Not reported: generate resolved this same set
 * before postGuard runs and fails the turn when it can't, so a miss here is a step test's.
 */
function genericDisclaimerFor(env: StepEnv, ctx: TurnContext): string | undefined {
  try {
    const set = resolvePromptPackSet(env.deps.promptPacks, ctx.agent.promptPackVersion);
    const text: unknown = set.frame['generic-disclaimer'];
    return usable(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Whether anything in this turn could send the reply to adviceGuard's judge or rewrite. */
function adviceMayCall(text: string, studentText: string | undefined): boolean {
  return personalDirective(text) || decisionRequest(studentText ?? '') || adviceSignal(text);
}

/** A locale text, when it is usable; a throw is reported and gives none. */
function localeText(env: StepEnv, get: () => unknown): string | undefined {
  try {
    const text = get();
    return usable(text) ? text : undefined;
  } catch (error) {
    env.report(error);
    return undefined;
  }
}

/**
 * The safe reply (grounding's reply when its judge is unavailable) and the fixed texts every post
 * guard passes as they are: the safe and distress replies (lead answer 3).
 */
function fixedTextsFor(env: StepEnv, ctx: TurnContext): { safe?: string; texts: string[] } {
  const { safeReply, distress } = env.deps.fallbackReplies;
  const lang = env.input.lang;
  const safe = localeText(env, () => safeReply(lang));
  const care = localeText(env, () => distress(lang, ctx.locale));
  const texts = [LAST_RESORT_DISTRESS_REPLY];
  for (const t of [safe, care]) if (t !== undefined) texts.push(t);
  return safe === undefined ? { texts } : { safe, texts };
}

/** The guards whose reason codes (never their text) the step reads. */
const WATCHED: ReadonlySet<string> = new Set(['grounding', 'adviceGuard']);

/**
 * Wraps grounding and adviceGuard so the step reads their reason codes (never their text): for
 * grounding's escalation and both judges' outage metrics.
 */
function watched(g: Guard<PostGuardCtx>, reasons: Map<string, string[]>): Guard<PostGuardCtx> {
  if (!WATCHED.has(g.name)) return g;
  const own: string[] = [];
  reasons.set(g.name, own);
  return {
    name: g.name,
    phase: g.phase,
    async run(text, x, cancel): Promise<GuardRun> {
      const r = await g.run(text, x, cancel);
      // The chain validates the result; this only reads a string reason if there is one.
      const res: unknown = (r as { result?: unknown } | null | undefined)?.result;
      if (typeof res === 'object' && res !== null && 'reason' in res) {
        const reason: unknown = res.reason;
        if (typeof reason === 'string') own.push(reason);
      }
      return r;
    },
  };
}

const answerLeakHit = (g: GuardTrace): boolean => g.name === 'answerLeak' && !g.ok;
/** A locked hit: on the first pass a rewrite, on the verification pass a block (4.8). */
const lockedLeakHit = (g: GuardTrace): boolean =>
  g.name === 'lockedLeak' && !g.ok && (g.action === 'rewrite' || g.action === 'block');

/** The postGuard step over `guards` (default: the registered post-phase guards). */
export function createPostGuard(
  guards: readonly Guard<PostGuardCtx>[] = postGuards.ordered(),
): Steps['postGuard'] {
  return async (
    env,
    { ctx, decision, draft, raw, withheld, locked, sources },
  ): Promise<PostGuardResult> => {
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
    const lockedReply = lockedReplyFor(env, ctx);

    // The stream withheld locked text, or could not check it: nothing it held is judged or
    // rewritten here (a rewrite would send it to a model).
    if (locked !== undefined) {
      const trace: GuardTrace[] = [
        { name: 'lockedLeak', ok: false, action: locked === 'hit' ? 'rewrite' : 'failed' },
      ];
      if (locked === 'hit')
        return { result: 'replace', text: lockedReply, guards: trace, usage: [] };
      if (leaked) return hint(trace, []);
      const text = env.deps.fallbackReplies.safeReply(env.input.lang);
      return { result: 'replace', text, guards: trace, usage: [] };
    }

    // Each guard's slice is worked out right before it runs; the rewrite and the judge read it.
    // adviceGuard weighs as rules-only when nothing this turn could reach its judge or rewrite.
    const adviceRules = !adviceMayCall(subject, studentText);
    const weights = guards.map((g) =>
      g.name === 'adviceGuard' && adviceRules ? PASS2_WEIGHT : postGuards.weight(g.name),
    );
    const clock = env.deps.clock;
    const started = clock.now();
    const slices = new Map<string, number>();
    const sliceStarts = new Map<string, number>();
    let pass: 1 | 2 = 1;
    const sliceOf = (at: GuardSliceRequest): number => {
      pass = at.pass;
      const left = POST_GUARD_BUDGET_MS - (clock.now() - started);
      const ms = postGuardSliceMs(left, weights, at);
      slices.set(at.name, ms);
      sliceStarts.set(at.name, clock.now());
      return ms;
    };
    const share = (name: string, part: number): number =>
      Math.floor((slices.get(name) ?? 0) * part);
    /** What is left of a guard's slice, less a margin so the guard returns inside it. */
    const leftOf = (name: string): number =>
      (slices.get(name) ?? 0) -
      (clock.now() - (sliceStarts.get(name) ?? clock.now())) -
      ADVICE_SLICE_MARGIN_MS;
    const reasons = new Map<string, string[]>();
    const fixed = fixedTextsFor(env, ctx);
    const genericDisclaimer = genericDisclaimerFor(env, ctx);
    const redirectReply = redirectReplyFor(env);
    const disclaimer = disclaimerFor(
      genericDisclaimer === undefined ? { ctx } : { ctx, genericDisclaimer },
    );
    const fixedTexts = [...fixed.texts, adviceFallbackText(disclaimer), redirectReply];
    const x: PostGuardCtx = {
      ctx,
      decision,
      ...own,
      rewrite: rewriter(env, () => share('answerLeak', REWRITE_SHARE)),
      lockedCheck: lockedCheckFor(env, ctx),
      lockedReply,
      ...(sources === undefined ? {} : { sources }),
      judge: judgeFor(env, () =>
        Math.min(GROUNDING_JUDGE_TIMEOUT_MS, share('grounding', JUDGE_SHARE)),
      ),
      askTeacherReply: askTeacherReplyFor(env),
      fixedTexts,
      ...(fixed.safe === undefined ? {} : { safeReply: fixed.safe }),
      adviceJudge: judgeFor(env, () =>
        Math.min(ADVICE_JUDGE_TIMEOUT_MS, share('adviceGuard', JUDGE_SHARE)),
      ),
      adviceRewrite: adviceRewriter(env, () => leftOf('adviceGuard')),
      ...(genericDisclaimer === undefined ? {} : { genericDisclaimer }),
      redirectReply,
      verifying: () => pass === 2,
    };
    const r: GuardChainResult = await runGuardChain(
      guards.map((g) => watched(g, reasons)),
      subject,
      x,
      { phase: 'post', clock: env.deps.clock, timeoutMs: sliceOf, cancel: env.cancel },
    );
    const { guards: trace, usage } = r;
    if (trace.some(lockedLeakHit)) env.report(new LockedLeakDetected('reply'));
    const grounding = reasons.get('grounding') ?? [];
    // Metrics, code only: a judge gave no answer and the turn got a fixed reply.
    if (grounding.includes(GROUNDING_REASONS.judgeUnavailable)) {
      env.report(new GroundingJudgeUnavailable());
    }
    if (reasons.get('adviceGuard')?.includes(ADVICE_REASONS.judgeUnavailable) === true) {
      env.report(new AdviceJudgeUnavailable());
    }
    switch (r.outcome) {
      case 'ok': {
        // A known leak that no guard rewrote is never shown: fail to the hint.
        if (leaked && r.text === subject) return hint(trace, usage);
        if (r.text === draft) return { result: 'ok', guards: trace, usage };
        const escalate = grounding.includes(GROUNDING_REASONS.ungrounded);
        return {
          result: 'replace',
          text: r.text,
          ...(escalate ? { escalateToTeacher: true as const } : {}),
          ...(grounding.length > 0 ? { groundingRewrote: true as const } : {}),
          guards: trace,
          usage,
        };
      }
      case 'escalate':
        return { result: 'escalate', alert: r.alert, text: r.text, guards: trace, usage };
      case 'failed':
        env.report(new PostGuardFailed(r.failure));
        if (leaked || r.failure.name === 'answerLeak' || trace.some(answerLeakHit)) {
          return hint(trace, usage);
        }
        break;
      case 'block':
        // A rewrite (adviceGuard's, 4.8) that came back holding locked material.
        if (r.blockedBy === 'lockedLeak') {
          return { result: 'replace', text: lockedReply, guards: trace, usage };
        }
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
