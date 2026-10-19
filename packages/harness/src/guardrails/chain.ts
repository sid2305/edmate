// Runs one phase's guards in declared order and fails closed (task 4.1).
// A throw, a result that fails the contracts schema, a guard past its time slice, a cancelled
// step and a guard the phase does not declare all stop the chain with `outcome: 'block'`.
// The chain never throws, so the calling step's own failure policy still applies on top.
import { GuardResultSchema, type SafetyAlert, type Usage, UsageSchema } from '@edmate/contracts';
import { z } from 'zod';
import type { CancelToken, Clock } from '../pipeline/clock.js';
import { runWithTimeout } from '../pipeline/timeout.js';
import type { GuardTrace } from '../pipeline/types.js';
import type { Guard } from './guard.js';
import { declaredIndex, type GuardPhase, isGuardPhase } from './order.js';

const GuardRunSchema = z.strictObject({
  result: GuardResultSchema,
  usage: z.array(UsageSchema),
});

/** Why the chain blocked on its own (a guard's own `block` verdict is not a failure). */
export type GuardFailureCause =
  'undeclared' | 'out_of_order' | 'error' | 'invalid_result' | 'timeout' | 'cancelled';

/**
 * For the caller's background-failure reporting only. `error` is the raw thrown value and may
 * quote model output: never put it in a trace, event or alert.
 */
export interface GuardFailure {
  name: string;
  cause: GuardFailureCause;
  error?: unknown;
}

/** The safety-event seam (lead answer Q1): name, phase and outcome only, never reason or text. */
export interface GuardOutcomeEvent {
  name: string;
  phase: GuardPhase;
  outcome: 'ok' | 'block' | 'rewrite' | 'escalate';
}

export interface GuardChainOptions {
  phase: GuardPhase;
  /** The injected clock; each guard's time slice runs on it. */
  clock: Clock;
  /** Each guard's own time slice in ms (not shared across the chain). Non-positive blocks. */
  timeoutMs: number;
  /** The calling step's cancel token: once it fires, no further guard result is trusted. */
  cancel?: CancelToken;
  /** Called once per guard that ran (or failed closed). A throw here is ignored. */
  onGuardOutcome?(e: GuardOutcomeEvent): void;
}

interface ChainBase {
  /** The text after every rewrite so far. Use it only when `outcome` is `ok`. */
  text: string;
  /** Trace entries ({ name, ok, action? }); no reason or text ever goes here (ADR-0003). */
  guards: GuardTrace[];
  /** Usage from every guard that returned a valid result, in run order. */
  usage: Usage[];
  /** Set only when the chain blocked because something broke (fail closed). */
  failure?: GuardFailure;
}

export type GuardChainResult =
  | (ChainBase & { outcome: 'ok' | 'block' })
  | (ChainBase & { outcome: 'escalate'; alert: SafetyAlert });

const nameOf = (g: unknown): string => {
  const n = typeof g === 'object' && g !== null ? (g as { name?: unknown }).name : undefined;
  return typeof n === 'string' ? n : '(invalid guard)';
};

/** The first guard that may not run in `phase` at its position, or undefined when all may. */
function checkChain(
  phase: GuardPhase,
  guards: readonly Guard<unknown>[],
): Pick<GuardFailure, 'name' | 'cause'> | undefined {
  if (!isGuardPhase(phase)) {
    return { name: guards.length > 0 ? nameOf(guards[0]) : String(phase), cause: 'undeclared' };
  }
  let last = -1;
  for (const g of guards) {
    const name = nameOf(g);
    const declared =
      typeof g === 'object' &&
      g !== null &&
      typeof g.run === 'function' &&
      g.phase === phase &&
      declaredIndex(phase, name) >= 0;
    if (!declared) return { name, cause: 'undeclared' };
    const at = declaredIndex(phase, name);
    if (at <= last) return { name, cause: 'out_of_order' };
    last = at;
  }
  return undefined;
}

/**
 * Runs `guards` (pass `registry.ordered()`) over `initialText`. `rewrite` replaces the text and
 * the chain goes on with it; `block` and `escalate` stop it. Never rejects.
 */
export async function runGuardChain<Ctx>(
  guards: readonly Guard<Ctx>[],
  initialText: string,
  ctx: Ctx,
  opts: GuardChainOptions,
): Promise<GuardChainResult> {
  const { phase } = opts;
  let text = initialText;
  const trace: GuardTrace[] = [];
  const usage: Usage[] = [];

  // A function, not an inline read: the token changes while guards run.
  const stepCancelled = (): boolean => opts.cancel?.cancelled === true;
  const notify = (name: string, outcome: GuardOutcomeEvent['outcome']): void => {
    try {
      opts.onGuardOutcome?.({ name, phase, outcome });
    } catch {
      // An observer failure must not change a safety outcome or make the chain throw.
    }
  };
  const failClosed = (failure: GuardFailure): GuardChainResult => {
    trace.push({ name: failure.name, ok: false, action: 'block' });
    notify(failure.name, 'block');
    return { outcome: 'block', text, guards: trace, usage, failure };
  };

  const bad = checkChain(phase, guards);
  if (bad !== undefined) return failClosed(bad);

  for (const guard of guards) {
    const { name } = guard;
    if (stepCancelled()) return failClosed({ name, cause: 'cancelled' });

    const input = text;
    const timed = await runWithTimeout(
      async (cancel) => GuardRunSchema.safeParse(await guard.run(input, ctx, cancel)),
      opts.timeoutMs,
      opts.clock,
    );
    if (timed.status === 'timeout') return failClosed({ name, cause: 'timeout' });
    if (timed.status === 'error') return failClosed({ name, cause: 'error', error: timed.error });
    if (!timed.value.success) return failClosed({ name, cause: 'invalid_result' });

    const { result, usage: spent } = timed.value.data;
    usage.push(...spent);
    // The step may have been cancelled while the guard ran: its verdict comes too late to trust.
    if (stepCancelled()) return failClosed({ name, cause: 'cancelled' });

    if (result.ok) {
      trace.push({ name, ok: true });
      notify(name, 'ok');
      continue;
    }
    trace.push({ name, ok: false, action: result.action });
    notify(name, result.action);
    switch (result.action) {
      case 'rewrite':
        text = result.text;
        continue;
      case 'block':
        return { outcome: 'block', text, guards: trace, usage };
      case 'escalate':
        return { outcome: 'escalate', alert: result.alert, text, guards: trace, usage };
    }
  }
  return { outcome: 'ok', text, guards: trace, usage };
}
