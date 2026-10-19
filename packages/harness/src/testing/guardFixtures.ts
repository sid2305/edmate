// A fake guard for guard-framework and guard-task tests (4.1-4.9). No model call.
import type { GuardResult, Usage } from '@edmate/contracts';
import type { Guard } from '../guardrails/guard.js';
import type { GuardPhase } from '../guardrails/order.js';

export interface FakeGuard<Ctx> extends Guard<Ctx> {
  /** Every call's input text and ctx, in order. */
  readonly calls: { text: string; ctx: Ctx }[];
}

export type FakeGuardBehaviour<Ctx> =
  GuardResult | ((text: string, ctx: Ctx) => GuardResult | Promise<GuardResult>);

export interface FakeGuardOptions {
  /** Usage returned on every call. */
  usage?: Usage[];
  /** A shared call-order log: the guard pushes its name each time it runs. */
  spy?: string[];
}

export function fakeGuard<Ctx>(
  name: string,
  phase: GuardPhase,
  behaviour: FakeGuardBehaviour<Ctx>,
  opts: FakeGuardOptions = {},
): FakeGuard<Ctx> {
  const calls: { text: string; ctx: Ctx }[] = [];
  return {
    name,
    phase,
    calls,
    async run(text, ctx) {
      calls.push({ text, ctx });
      opts.spy?.push(name);
      const result = typeof behaviour === 'function' ? await behaviour(text, ctx) : behaviour;
      return { result, usage: [...(opts.usage ?? [])] };
    },
  };
}
