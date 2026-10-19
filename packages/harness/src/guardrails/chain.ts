// Runs one phase's guards in declared order and fails closed (task 4.1).
//
// Outcomes: `ok` (every guard passed on the final text), `block` (a guard's own verdict, or a
// rewrite the verification pass would not accept), `escalate` (carries the alert) and `failed`
// (the framework could not get a trustworthy verdict: a throw, a result that fails the contracts
// schema, a guard past its time slice, a cancelled step, an empty list, an undeclared guard or
// guards out of declared order). `failed` is non-ok and must be treated like `block`; it is kept
// apart so a caller can tell "a guard said no" from "the guards broke" (e.g. 4.3's distress
// keyword fallback). The chain never throws.
//
// Verification pass ("rewrite once; else safe reply"): when any guard rewrote, every guard runs
// once more on the final text. There, any rewrite or block becomes `block` with cause
// `rewrite_unverified`; an escalate still escalates.
import { GuardResultSchema, type SafetyAlert, type Usage, UsageSchema } from '@edmate/contracts';
import { z } from 'zod';
import { cancelSource, type CancelToken, type Clock } from '../pipeline/clock.js';
import { runWithTimeout } from '../pipeline/timeout.js';
import type { GuardTrace } from '../pipeline/types.js';
import type { Guard } from './guard.js';
import { declaredIndex, type GuardPhase, isGuardPhase } from './order.js';

const GuardRunSchema = z.strictObject({
  result: GuardResultSchema,
  usage: z.array(UsageSchema),
});

/** Names and error names kept on a failure are capped (they are caller-only, never traced). */
const NAME_CAP = 100;
const EMPTY_CHAIN = '(empty chain)';
const INVALID_GUARD = '(invalid guard)';
/** What the trace and events show for an undeclared guard: never the name it claimed. */
const UNDECLARED = '(undeclared)';
const STEP_CANCELLED = Symbol('step cancelled');

/** Why the framework could not get a trustworthy verdict (outcome `failed`). */
export type GuardFailureCause =
  'empty' | 'undeclared' | 'out_of_order' | 'error' | 'invalid_result' | 'timeout' | 'cancelled';

/**
 * For the caller's background-failure reporting. Holds no raw error, reason or text: only the
 * guard name (capped) and, for `error`, the thrown value's `Error#name` or `typeof` (capped).
 */
export interface GuardFailure {
  name: string;
  cause: GuardFailureCause;
  errorName?: string;
}

/** `verdict`: a guard blocked. `rewrite_unverified`: the verification pass did not pass. */
export type GuardBlockCause = 'verdict' | 'rewrite_unverified';

/**
 * The safety-event seam (lead answer Q1): no reason or text, ever. `pass` 2 is the verification
 * pass. `cause` is set for `failed` and for a verification-pass `block`.
 */
export interface GuardOutcomeEvent {
  name: string;
  phase: GuardPhase;
  pass: 1 | 2;
  outcome: 'ok' | 'block' | 'rewrite' | 'escalate' | 'failed';
  cause?: GuardFailureCause | 'rewrite_unverified';
}

export interface GuardChainOptions {
  phase: GuardPhase;
  /** The injected clock; each guard's time slice runs on it. */
  clock: Clock;
  /** Each guard's own time slice in ms (not shared across the chain). Non-positive fails. */
  timeoutMs: number;
  /** The calling step's cancel token: it cancels the in-flight guard and fails the chain. */
  cancel?: CancelToken;
  /** Called once per guard run. A throw, or a returned promise that rejects, is ignored. */
  onGuardOutcome?(e: GuardOutcomeEvent): unknown;
}

interface ChainCommon {
  /** Trace entries ({ name, ok, action? }); no reason or text ever goes here (ADR-0003). */
  guards: GuardTrace[];
  /** Usage from every guard that returned a valid result, in run order (both passes). */
  usage: Usage[];
}

/** `text` exists only where it may be used: on `ok` and `escalate`. */
export type GuardChainResult =
  | (ChainCommon & { outcome: 'ok'; text: string })
  | (ChainCommon & { outcome: 'escalate'; text: string; alert: SafetyAlert })
  | (ChainCommon & { outcome: 'block'; cause: GuardBlockCause; blockedBy: string })
  | (ChainCommon & { outcome: 'failed'; failure: GuardFailure });

/** A guard read once at the start, so a caller mutating the list or a getter can't change it. */
interface Entry<Ctx> {
  name: string;
  run: Guard<Ctx>['run'];
  self: Guard<Ctx>;
}

type BadChain = Pick<GuardFailure, 'name' | 'cause'>;

const cap = (s: string): string => s.slice(0, NAME_CAP);

function errorNameOf(e: unknown): string {
  try {
    if (e instanceof Error) {
      const n: unknown = e.name;
      return typeof n === 'string' ? cap(n) : 'Error';
    }
    return typeof e;
  } catch {
    return 'unknown';
  }
}

function safeName(g: unknown): string {
  try {
    const n: unknown = typeof g === 'object' && g !== null ? (g as { name?: unknown }).name : 0;
    return typeof n === 'string' ? cap(n) : INVALID_GUARD;
  } catch {
    return INVALID_GUARD;
  }
}

function readEntry<Ctx>(phase: GuardPhase, g: Guard<Ctx>): Entry<Ctx> | BadChain {
  try {
    if (typeof g !== 'object' || g === null) return { name: INVALID_GUARD, cause: 'undeclared' };
    const name: unknown = g.name;
    const run: unknown = g.run;
    const ownPhase: unknown = g.phase;
    if (typeof name !== 'string') return { name: INVALID_GUARD, cause: 'undeclared' };
    if (typeof run !== 'function' || ownPhase !== phase || declaredIndex(phase, name) < 0) {
      return { name: cap(name), cause: 'undeclared' };
    }
    return { name, run: run as Guard<Ctx>['run'], self: g };
  } catch {
    return { name: INVALID_GUARD, cause: 'undeclared' };
  }
}

/** Reads every guard once and checks the list may run in `phase` as given. */
function snapshot<Ctx>(phase: GuardPhase, guards: readonly Guard<Ctx>[]): Entry<Ctx>[] | BadChain {
  const list = [...guards];
  if (!isGuardPhase(phase)) {
    return { name: list.length > 0 ? safeName(list[0]) : EMPTY_CHAIN, cause: 'undeclared' };
  }
  if (list.length === 0) return { name: EMPTY_CHAIN, cause: 'empty' };
  const entries: Entry<Ctx>[] = [];
  let last = -1;
  for (const g of list) {
    const e = readEntry(phase, g);
    if (!('run' in e)) return e;
    const at = declaredIndex(phase, e.name);
    if (at <= last) return { name: e.name, cause: 'out_of_order' };
    last = at;
    entries.push(e);
  }
  return entries;
}

/**
 * Runs `guards` (pass `registry.ordered()`) over `initialText`. `rewrite` replaces the text and
 * the chain goes on with it; `block`, `escalate` and any failure stop it. Never rejects.
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

  const notify = (e: GuardOutcomeEvent): void => {
    try {
      const r: unknown = opts.onGuardOutcome?.(e);
      if (typeof r === 'object' && r !== null) {
        const then: unknown = (r as { then?: unknown }).then;
        if (typeof then === 'function') then.call(r, undefined, () => undefined);
      }
    } catch {
      // An observer failure must not change a safety outcome or make the chain throw.
    }
  };

  const fail = (pass: 1 | 2, failure: GuardFailure): GuardChainResult => {
    const shown = failure.cause === 'undeclared' ? UNDECLARED : failure.name;
    trace.push({ name: shown, ok: false, action: 'failed' });
    notify({ name: shown, phase, pass, outcome: 'failed', cause: failure.cause });
    return { outcome: 'failed', failure, guards: trace, usage };
  };

  const entries = snapshot(phase, guards);
  if (!Array.isArray(entries)) return fail(1, entries);

  const runOne = (e: Entry<Ctx>, input: string) =>
    runWithTimeout(
      async (slice) => {
        // The guard's token fires on its slice ending or on the step being cancelled.
        const linked = cancelSource();
        slice.onCancel(linked.cancel);
        const stepStop = new Promise<never>((_resolve, reject) => {
          opts.cancel?.onCancel(() => {
            linked.cancel();
            reject(STEP_CANCELLED);
          });
        });
        stepStop.catch(() => undefined);
        const raw = await Promise.race([e.run.call(e.self, input, ctx, linked.token), stepStop]);
        return GuardRunSchema.safeParse(raw);
      },
      opts.timeoutMs,
      opts.clock,
    );

  /** One pass over every guard: a final result, or whether any guard rewrote. */
  const runPass = async (pass: 1 | 2): Promise<GuardChainResult | boolean> => {
    let rewrote = false;
    for (const e of entries) {
      const { name } = e;
      if (stepCancelled()) return fail(pass, { name, cause: 'cancelled' });

      const timed = await runOne(e, text);
      if (timed.status === 'timeout') return fail(pass, { name, cause: 'timeout' });
      if (timed.status === 'error') {
        if (timed.error === STEP_CANCELLED) return fail(pass, { name, cause: 'cancelled' });
        return fail(pass, { name, cause: 'error', errorName: errorNameOf(timed.error) });
      }
      if (!timed.value.success) return fail(pass, { name, cause: 'invalid_result' });

      const { result, usage: spent } = timed.value.data;
      usage.push(...spent);
      // The step may have been cancelled while the guard ran: its verdict comes too late to trust.
      if (stepCancelled()) return fail(pass, { name, cause: 'cancelled' });

      if (result.ok) {
        trace.push({ name, ok: true });
        notify({ name, phase, pass, outcome: 'ok' });
        continue;
      }
      if (pass === 2 && result.action !== 'escalate') {
        trace.push({ name, ok: false, action: 'block' });
        notify({ name, phase, pass, outcome: 'block', cause: 'rewrite_unverified' });
        return {
          outcome: 'block',
          cause: 'rewrite_unverified',
          blockedBy: name,
          guards: trace,
          usage,
        };
      }
      trace.push({ name, ok: false, action: result.action });
      notify({ name, phase, pass, outcome: result.action });
      switch (result.action) {
        case 'rewrite':
          text = result.text;
          rewrote = true;
          continue;
        case 'block':
          return { outcome: 'block', cause: 'verdict', blockedBy: name, guards: trace, usage };
        case 'escalate':
          return { outcome: 'escalate', alert: result.alert, text, guards: trace, usage };
      }
    }
    return rewrote;
  };

  const first = await runPass(1);
  if (typeof first !== 'boolean') return first;
  if (first) {
    const second = await runPass(2);
    if (typeof second !== 'boolean') return second;
  }
  return { outcome: 'ok', text, guards: trace, usage };
}
