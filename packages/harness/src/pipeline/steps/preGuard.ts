// Step 3, phase 2 (tasks 4.3, 4.4): the `pre` guard chain on the scrubbed text, concurrent with
// route and buildContext. Phase 1, the PII scrub, is `scrub.ts` (4.2).
import type { Message } from '@edmate/contracts';
import { blockReplyFor } from '../../guardrails/blockReplies.js';
import { runGuardChain, type GuardFailure } from '../../guardrails/chain.js';
import {
  createDistressDetectGuard,
  DISTRESS_CONTEXT_TURNS,
} from '../../guardrails/distressDetect.js';
import { createJailbreakGuard } from '../../guardrails/jailbreak.js';
import { createModerationInGuard } from '../../guardrails/moderationIn.js';
import type { PreGuardBlock, PreGuardCtx } from '../../guardrails/preGuardCtx.js';
import { GuardRegistry } from '../../guardrails/registry.js';
import { errorName, HarnessError } from '../errors.js';
import { isWithheld } from '../policies.js';
import { runWithTimeout } from '../timeout.js';
import type { Entitled, PreGuardResult, StepEnv, Steps } from '../types.js';

/** Each pre guard's own time slice. Step 3's whole budget is 400 ms, scrub included. */
export const PRE_GUARD_SLICE_MS = 300;
/** The earlier-messages read for the classifier must not eat the guards' budget. */
export const HISTORY_TIMEOUT_MS = 50;
const HISTORY_LIMIT = 12;

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
  return (r.value as unknown[])
    .filter(
      (m): m is Message =>
        typeof m === 'object' &&
        m !== null &&
        (m as Message).role === 'student' &&
        typeof (m as Message).text === 'string' &&
        !isWithheld(m as Message),
    )
    .map((m) => m.text)
    .slice(-DISTRESS_CONTEXT_TURNS);
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

export function createPreGuardStep(
  registry: GuardRegistry<PreGuardCtx>,
): (env: StepEnv, s: Entitled) => Promise<PreGuardResult> {
  return async (env, s) => {
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
      blocks: new Map<string, PreGuardBlock>(),
    };
    const chain = await runGuardChain(registry.ordered(), env.input.text ?? '', ctx, {
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
