// The per-turn cost ceiling (task 3.7, lead answer Q2). Every usage the turn sees adds to one
// running total: step-reported usage (steps 3 and 4) at its own cost, and every model call through
// the turn gateway, priced as it streams, including a failed primary attempt.
//
// Checks: after each usage (total > ceiling → abort) and before each new model call (total ≥
// ceiling → abort, no call). Usage arrives at the end of a call, so one call can overshoot the
// ceiling by at most its own cost, which `maxOutputTokens` bounds. Unpriced usage fails closed:
// the turn aborts with `turn_cost_exceeded` (2.4's meter records it as unpriced, loudly).
import type { Usage } from '@edmate/contracts';
import { TurnAbort } from '../errors.js';

/** Provisional: 0.10 USD per turn (lead answer Q2); the root may inject another; revisit at 7.6. */
export const DEFAULT_MAX_TURN_COST_MICRO_USD = 100_000;

/** The usage's cost in integer micro-USD, or `undefined` when the model has no price. */
export type PriceUsage = (u: Usage) => number | undefined;

const isCost = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/**
 * The ceiling to use: the default when unset; 0 when invalid (fail closed: every call is refused,
 * and the runner reports the bad value).
 */
export function ceilingOf(value: number | undefined): { value: number; valid: boolean } {
  if (value === undefined) return { value: DEFAULT_MAX_TURN_COST_MICRO_USD, valid: true };
  return isCost(value) ? { value, valid: true } : { value: 0, valid: false };
}

export class TurnCost {
  private total = 0;
  private sawUnpriced = false;

  constructor(
    private readonly priceUsage: PriceUsage,
    readonly maxMicroUsd: number,
  ) {}

  get totalMicroUsd(): number {
    return this.total;
  }

  /** True once any gateway usage had no valid price. */
  get unpriced(): boolean {
    return this.sawUnpriced;
  }

  /**
   * Gateway usage (its chunks carry `costMicroUsd: 0`), priced and counted. Never throws: an
   * unknown, invalid or throwing price marks the turn unpriced and keeps the usage's own cost.
   */
  price(u: Usage): Usage {
    return this.priceOne(u).usage;
  }

  /** As `price`, and says whether this usage got a valid price (unpriced is never metered). */
  priceOne(u: Usage): { usage: Usage; priced: boolean } {
    let cost: number | undefined;
    try {
      cost = this.priceUsage(u);
    } catch {
      cost = undefined;
    }
    if (!isCost(cost)) {
      this.sawUnpriced = true;
      this.total += u.costMicroUsd;
      return { usage: { ...u }, priced: false };
    }
    this.total += cost;
    return { usage: { ...u, costMicroUsd: cost }, priced: true };
  }

  /** Usage a step reported in its result, at the cost the step gave it. */
  addReported(u: Usage): void {
    this.total += u.costMicroUsd;
  }

  /** After a usage: aborts when the turn is unpriced or over the ceiling. */
  assertWithin(): void {
    if (this.sawUnpriced) throw new TurnAbort('turn_cost_exceeded', 'usage for an unpriced model');
    if (this.total > this.maxMicroUsd) throw new TurnAbort('turn_cost_exceeded');
  }

  /** Before a model call: aborts when the turn is unpriced or already at or over the ceiling. */
  assertRoomForCall(): void {
    this.assertWithin();
    if (this.total >= this.maxMicroUsd) throw new TurnAbort('turn_cost_exceeded');
  }
}
