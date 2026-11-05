// Step 3, phase 2 (tasks 4.3, 4.4): the `pre` guard chain on the scrubbed text, concurrent with
// route and buildContext. Phase 1, the PII scrub, is `scrub.ts` (4.2).
import type { Message } from '@edmate/contracts';
import { blockReplyFor } from '../../guardrails/blockReplies.js';
import { runGuardChain, type GuardFailure } from '../../guardrails/chain.js';
import {
  buildDistressClassifierRequest,
  createDistressDetectGuard,
  type DistressVerdict,
  DISTRESS_CLASSIFIER_TIMEOUT_MS,
  DISTRESS_CONTEXT_TURNS,
  DistressVerdictSchema,
} from '../../guardrails/distressDetect.js';
import { distressKeywordMatch } from '../../guardrails/distressKeywords.js';
import { createJailbreakGuard } from '../../guardrails/jailbreak.js';
import { matchJailbreak } from '../../guardrails/jailbreakPatterns.js';
import { createModerationInGuard } from '../../guardrails/moderationIn.js';
import { matchModeration } from '../../guardrails/moderationPatterns.js';
import type { PreGuardBlock, PreGuardCtx } from '../../guardrails/preGuardCtx.js';
import { GuardRegistry } from '../../guardrails/registry.js';
import {
  buildJailbreakClassifierRequest,
  buildModerationClassifierRequest,
  classifierAbout,
  type JailbreakVerdict,
  JailbreakVerdictSchema,
  type ModerationVerdict,
  ModerationVerdictSchema,
  prefetchClassifier,
} from '../../guardrails/safetyClassifier.js';
import { errorName, HarnessError } from '../errors.js';
import { blockedTurnNote, isWithheld, withheldCode } from '../policies.js';
import { runWithTimeout, type TimedResult } from '../timeout.js';
import type { Entitled, PreGuardResult, StepEnv, Steps } from '../types.js';

/** Each pre guard's own time slice. Step 3's whole budget is 400 ms, scrub included. */
export const PRE_GUARD_SLICE_MS = 300;
/** The earlier-messages read for the classifier must not eat the guards' budget. */
export const HISTORY_TIMEOUT_MS = 50;
const HISTORY_LIMIT = 12;
/**
 * The strike-count read's own window (task 4.4e, B-12): mirrors `packages/db`'s
 * `HISTORY_MAX_LIMIT` by value, not by import (harness can't import `packages/db`). Strikes
 * older than this window fall out of the count; see the task handoff for the decision.
 */
export const STRIKE_HISTORY_LIMIT = 200;

/** The chain could not give a trustworthy verdict. Holds the guard name and cause, never text. */
export class PreGuardChainFailedError extends Error {
  override readonly name = 'PreGuardChainFailedError';
  constructor(readonly failure: GuardFailure) {
    super(`preGuard: guard chain failed (${failure.name}: ${failure.cause})`);
  }
}

/** Every pre guard (GUARD_ORDER decides their order): distressDetect, moderationIn, jailbreak. */
export function defaultPreGuardRegistry(): GuardRegistry<PreGuardCtx> {
  const registry = new GuardRegistry<PreGuardCtx>('pre');
  registry.register(createDistressDetectGuard());
  registry.register(createModerationInGuard());
  registry.register(createJailbreakGuard());
  return registry;
}

/**
 * The student's last few messages this session, oldest first, for the distress classifier
 * (lead answer 8). Best effort: a failed, slow or malformed read gives [] and the classifier
 * still sees the message itself; the miss is reported (`env.report`, cause and error name only).
 * History is saved scrubbed (commit stores the scrubbed input).
 */
export async function recentStudentTurns(env: StepEnv): Promise<string[]> {
  const r = await runWithTimeout(
    () => env.deps.transcripts.history(env.input.sessionId, HISTORY_LIMIT),
    HISTORY_TIMEOUT_MS,
    env.deps.clock,
  );
  if (r.status !== 'ok' || !Array.isArray(r.value)) {
    const cause =
      r.status === 'ok' ? 'malformed' : r.status === 'timeout' ? 'timeout' : errorName(r.error);
    env.report(new HarnessError(`preGuard: earlier student messages unavailable (${cause})`));
    return [];
  }
  return (
    (r.value as unknown[])
      .filter(
        (m): m is Message =>
          typeof m === 'object' &&
          m !== null &&
          (m as Message).role === 'student' &&
          typeof (m as Message).text === 'string',
      )
      // A blocked message reads as a note with its code, never its text (fix round 2, LOW 5).
      .map((m) => (isWithheld(m) ? blockedTurnNote(m.text) : m.text))
      .slice(-DISTRESS_CONTEXT_TURNS)
  );
}

/**
 * All of the teacher's package names (fix round MEDIUM 5), from `PipelineDeps.teacherPackageNames`
 * (server-side, by the entitlement's teacher), plus the student's own. Best effort within
 * HISTORY_TIMEOUT_MS: a missing dep gives the own name; a failed, slow or malformed read gives the
 * own name too and is reported (cause and error name only).
 */
export async function teacherPackageNames(env: StepEnv, s: Entitled): Promise<string[]> {
  const own = s.pkg.name;
  const read = env.deps.teacherPackageNames;
  if (read === undefined) return [own];
  const r = await runWithTimeout(
    () => read(s.entitlement.teacherId),
    HISTORY_TIMEOUT_MS,
    env.deps.clock,
  );
  if (r.status !== 'ok' || !Array.isArray(r.value)) {
    const cause =
      r.status === 'ok' ? 'malformed' : r.status === 'timeout' ? 'timeout' : errorName(r.error);
    env.report(new HarnessError(`preGuard: package names unavailable (${cause})`));
    return [own];
  }
  const names = (r.value as unknown[]).filter((n): n is string => typeof n === 'string');
  return [...new Set([own, ...names])];
}

/**
 * How many prior jailbreak-coded withheld student messages are in this session's history (task
 * 4.4e, B-12): the strike count. Best effort within HISTORY_TIMEOUT_MS: a failed, slow or
 * malformed read gives 0 (fail open on the consequence only; the guards themselves still run as
 * today) and is reported (cause and error name only).
 */
export async function priorJailbreakStrikes(env: StepEnv): Promise<number> {
  const r = await runWithTimeout(
    () => env.deps.transcripts.history(env.input.sessionId, STRIKE_HISTORY_LIMIT),
    HISTORY_TIMEOUT_MS,
    env.deps.clock,
  );
  if (r.status !== 'ok' || !Array.isArray(r.value)) {
    const cause =
      r.status === 'ok' ? 'malformed' : r.status === 'timeout' ? 'timeout' : errorName(r.error);
    env.report(new HarnessError(`preGuard: prior jailbreak strikes unavailable (${cause})`));
    return 0;
  }
  return (r.value as unknown[]).filter(
    (m): boolean =>
      typeof m === 'object' &&
      m !== null &&
      (m as Message).role === 'student' &&
      typeof (m as Message).text === 'string' &&
      isWithheld(m as Message) &&
      (withheldCode((m as Message).text) ?? '').startsWith('jailbreak_'),
  ).length;
}

/**
 * Starts distressDetect's classifier call now, concurrently with the other two pre guards (task
 * 4.4b), when its own hard-keyword check (the same pure function the guard itself calls) finds
 * no hard hit — a hard hit never needs a model call, by either path. `runWithTimeout` never
 * rejects, so this needs no rejection handler of its own.
 */
function prefetchDistress(
  env: StepEnv,
  ctx: PreGuardCtx,
  text: string,
  classifierTimeoutMs: number,
): Promise<TimedResult<DistressVerdict>> | undefined {
  if (distressKeywordMatch(text).level === 'hard') return undefined;
  return (async () => {
    const earlier = await ctx.recentStudentTurns;
    return runWithTimeout(
      () =>
        env.gateway.generateObject(
          buildDistressClassifierRequest(text, earlier),
          DistressVerdictSchema,
        ),
      classifierTimeoutMs,
      env.deps.clock,
    );
  })();
}

/**
 * The registered distressDetect guard's own classifier deadline, resolved once when the step is
 * created (task 4.4i): a registry built with a custom `classifierTimeoutMs` must get it on the
 * prefetch path too, not the default. Falls back to DISTRESS_CLASSIFIER_TIMEOUT_MS when the
 * registry has no distress guard, or its value isn't a finite number above 0.
 */
function distressPrefetchTimeoutMs(registry: GuardRegistry<PreGuardCtx>): number {
  const guard = registry.ordered().find((g) => g.name === 'distressDetect') as
    | { classifierTimeoutMs?: unknown }
    | undefined;
  const ms = guard?.classifierTimeoutMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? ms
    : DISTRESS_CLASSIFIER_TIMEOUT_MS;
}

/**
 * moderationIn's own rule check (`matchModeration`, including its `sexual` sub-check against
 * the earlier messages) by itself, decoupled from whether a classifier call is fired. Shared by
 * `prefetchModeration` (its own decisiveness) and `prefetchJailbreak` (chain-order: a guard
 * earlier than jailbreak that is rule-decisive must also stop jailbreak's prefetch, fix round 1).
 */
async function moderationRuleDecisive(ctx: PreGuardCtx, text: string): Promise<boolean> {
  let hit = matchModeration(text);
  if (hit?.code === 'sexual') hit = matchModeration(text, await ctx.recentStudentTurns);
  return hit?.decisive === true;
}

/**
 * Starts moderationIn's classifier call now, concurrently with the other two pre guards (task
 * 4.4b), re-running the guard's own rule check to decide whether a decisive hit will make the
 * call unnecessary. Resolves to `undefined` when moderationIn's own rule is decisive, or when
 * `earlierDecisive` (distressDetect's rule, chain order) already is — a guard earlier in chain
 * order never needs this guard's classifier call either (fix round 1). The returned promise
 * always has a rejection handler attached (it may be discarded unused by a short-circuit earlier
 * in the chain).
 */
function prefetchModeration(
  env: StepEnv,
  ctx: PreGuardCtx,
  text: string,
  earlierDecisive: boolean,
): Promise<ModerationVerdict | undefined> {
  const p = (async (): Promise<ModerationVerdict | undefined> => {
    if (earlierDecisive) return undefined;
    if (await moderationRuleDecisive(ctx, text)) return undefined;
    const earlier = await ctx.recentStudentTurns;
    return prefetchClassifier(
      'moderationIn',
      ctx,
      env.cancel,
      buildModerationClassifierRequest(text, earlier, classifierAbout(ctx)),
      ModerationVerdictSchema,
    );
  })();
  p.catch(() => {});
  return p;
}

/**
 * Starts jailbreak's classifier call now, concurrently with the other two pre guards (task
 * 4.4b), re-running the guard's own rule check (`matchJailbreak`) to decide whether a decisive
 * hit will make the call unnecessary. Resolves to `undefined` when it is, or when
 * `earlierDecisive` (distressDetect's or moderationIn's rule, chain order) resolves `true` — a
 * guard earlier in chain order that is rule-decisive must also stop this prefetch (fix round 1;
 * before this fix, `preGuard.test.ts`'s own call counts were right but the evals' hard-distress
 * and moderation-block cases showed extra jailbreak/moderation calls, because this function only
 * ever checked its own rule, never an earlier guard's). The returned promise always has a
 * rejection handler attached (it may be discarded unused by a short-circuit earlier in the
 * chain).
 */
function prefetchJailbreak(
  env: StepEnv,
  ctx: PreGuardCtx,
  text: string,
  earlierDecisive: Promise<boolean>,
): Promise<JailbreakVerdict | undefined> {
  const p = (async (): Promise<JailbreakVerdict | undefined> => {
    if (await earlierDecisive) return undefined;
    const packageNames = await ctx.packageNames;
    const hit = matchJailbreak(text, { packageNames, currentPackageName: ctx.currentPackageName });
    if (hit?.decisive === true) return undefined;
    const earlier = await ctx.recentStudentTurns;
    return prefetchClassifier(
      'jailbreak',
      ctx,
      env.cancel,
      buildJailbreakClassifierRequest(text, earlier, classifierAbout(ctx)),
      JailbreakVerdictSchema,
    );
  })();
  p.catch(() => {});
  return p;
}

export function createPreGuardStep(
  registry: GuardRegistry<PreGuardCtx>,
): (env: StepEnv, s: Entitled) => Promise<PreGuardResult> {
  const distressTimeoutMs = distressPrefetchTimeoutMs(registry);
  return async (env, s) => {
    const text = env.input.text ?? '';
    const ctx: PreGuardCtx = {
      locale: s.locale,
      entitlement: s.entitlement,
      sessionId: env.input.sessionId,
      lang: env.input.lang,
      gateway: env.gateway,
      ids: env.deps.ids,
      clock: env.deps.clock,
      // Read concurrently with the guards; a guard waits for it only before its classifier.
      recentStudentTurns: recentStudentTurns(env),
      turnId: env.turnId,
      safetyEvents: env.deps.safetyEvents,
      packageNames: teacherPackageNames(env, s),
      currentPackageName: s.pkg.name,
      priorJailbreakStrikes: priorJailbreakStrikes(env),
      blocks: new Map<string, PreGuardBlock>(),
    };
    // Concurrency (task 4.4b): fire the three classifier calls now, concurrently with each
    // other and with the guards' own rule checks, rather than letting the guard chain start
    // them one after another. A guard's classifier is prefetched only when its own rule check
    // is not decisive *and* no guard earlier in chain order (distressDetect, then moderationIn,
    // then jailbreak) is decisive by rule (fix round 1) — so rule-decided cases keep today's
    // exact call counts. The only extra calls are the accepted trade-off: an earlier guard
    // short-circuits by a *classifier* verdict, not a rule (lead review item 1).
    const distressRuleDecisive = distressKeywordMatch(text).level === 'hard';
    const jailbreakEarlierDecisive = (async () =>
      distressRuleDecisive || (await moderationRuleDecisive(ctx, text)))();
    ctx.classifierCalls = {
      distress: prefetchDistress(env, ctx, text, distressTimeoutMs),
      moderation: prefetchModeration(env, ctx, text, distressRuleDecisive),
      jailbreak: prefetchJailbreak(env, ctx, text, jailbreakEarlierDecisive),
    };
    const chain = await runGuardChain(registry.ordered(), text, ctx, {
      phase: 'pre',
      clock: env.deps.clock,
      timeoutMs: PRE_GUARD_SLICE_MS,
      cancel: env.cancel,
    });
    const { guards, usage } = chain;
    switch (chain.outcome) {
      case 'ok':
        return { result: 'ok', guards, usage };
      case 'escalate':
        return { result: 'escalate', alert: chain.alert, guards, usage };
      case 'block': {
        // The blocking guard's code picks the student's reply (4.4, lead answer 2); a block with
        // no code (a guard that left none) gets the runner's generic guard_blocked error.
        const b = ctx.blocks.get(chain.blockedBy);
        if (b === undefined) return { result: 'block', guards, usage };
        return {
          result: 'block',
          guards,
          usage,
          reply: blockReplyFor(b.code),
          code: b.code,
          ...(b.alert === undefined ? {} : { alert: b.alert }),
        };
      }
      case 'failed':
        // Thrown, not `block`: the runner then runs its own distress keyword check (4.1 review).
        throw new PreGuardChainFailedError(chain.failure);
    }
  };
}

/** Phase 2: the `pre` guards (distressDetect, moderationIn, jailbreak). */
export const preGuard: Steps['preGuard'] = createPreGuardStep(defaultPreGuardRegistry());
