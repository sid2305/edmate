// Step 3, phase 2 (task 4.3): the `pre` guard chain on the scrubbed text, concurrent with route
// and buildContext. Phase 1, the PII scrub, is `scrub.ts` (4.2).
import type { Message } from '@edmate/contracts';
import { runGuardChain, type GuardFailure } from '../../guardrails/chain.js';
import { createDistressDetectGuard, DISTRESS_CONTEXT_TURNS } from '../../guardrails/distressDetect.js';
import type { PreGuardCtx } from '../../guardrails/preGuardCtx.js';
import { GuardRegistry } from '../../guardrails/registry.js';
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

/** The pre guards that exist so far. moderationIn and jailbreak register here in 4.4. */
export function defaultPreGuardRegistry(): GuardRegistry<PreGuardCtx> {
  const registry = new GuardRegistry<PreGuardCtx>('pre');
  registry.register(createDistressDetectGuard());
  return registry;
}

/**
 * The student's last few messages this session, oldest first, for the distress classifier
 * (lead answer 8). Best effort: a failed, slow or malformed read gives [] and the classifier
 * still sees the message itself. History is saved scrubbed (commit stores the scrubbed input).
 */
export async function recentStudentTurns(env: StepEnv): Promise<string[]> {
  const r = await runWithTimeout(
    () => env.deps.transcripts.history(env.input.sessionId, HISTORY_LIMIT),
    HISTORY_TIMEOUT_MS,
    env.deps.clock,
  );
  if (r.status !== 'ok' || !Array.isArray(r.value)) return [];
  return (r.value as unknown[])
    .filter(
      (m): m is Message =>
        typeof m === 'object' &&
        m !== null &&
        (m as Message).role === 'student' &&
        typeof (m as Message).text === 'string',
    )
    .map((m) => m.text)
    .slice(-DISTRESS_CONTEXT_TURNS);
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
      recentStudentTurns: await recentStudentTurns(env),
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
      case 'block':
        return { result: 'block', guards, usage };
      case 'failed':
        // Thrown, not `block`: the runner then runs its own distress keyword check (4.1 review).
        throw new PreGuardChainFailedError(chain.failure);
    }
  };
}

/** Phase 2: the `pre` guards (distressDetect; moderationIn and jailbreak in 4.4). */
export const preGuard: Steps['preGuard'] = createPreGuardStep(defaultPreGuardRegistry());
