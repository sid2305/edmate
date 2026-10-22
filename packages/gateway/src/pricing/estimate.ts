// The AI cost of one student turn, in integer micro-USD (task 8.6a). The package builder's cost card
// multiplies this by a package's message limits to show a typical and an at-most monthly cost.
// Each call is priced with computeCostMicroUsd (cost.ts), rounded half up per call as metering does.
// A model with no price throws UnpricedModelError: an estimate that silently counted it as $0
// would look cheaper than it is.
import type { ModelPolicy } from '@edmate/contracts';
import { computeCostMicroUsd } from './cost.js';
import type { PriceTable } from './load.js';

/** Token counts for one student turn: one main-tier reply plus some small-tier calls. */
export interface TurnTokenAssumptions {
  readonly mainInputTokens: number;
  readonly mainOutputTokens: number;
  /** Router, guards and classifiers: small-tier calls made per turn. */
  readonly smallCallsPerTurn: number;
  readonly smallInputTokensPerCall: number;
  readonly smallOutputTokensPerCall: number;
}

/**
 * PROVISIONAL (task 8.6 plan, Q3): replace with task 7.6's measured cost per turn once a live sweep
 * has run. The main call carries the system prompt, style card, retrieved course text and recent
 * history (about 5,000 tokens in, a 500-token reply); four small calls (router, input guard, output
 * guard, classifier) each read about 1,200 tokens and answer in about 60.
 */
export const TURN_TOKEN_ASSUMPTIONS: TurnTokenAssumptions = Object.freeze({
  mainInputTokens: 5_000,
  mainOutputTokens: 500,
  smallCallsPerTurn: 4,
  smallInputTokensPerCall: 1_200,
  smallOutputTokensPerCall: 60,
});

/** A model in the policy has no price in the table. Carries the model id only. */
export class UnpricedModelError extends Error {
  override readonly name = 'UnpricedModelError';
  constructor(readonly model: string) {
    super(`no price for model ${model}`);
  }
}

function modelOf(policy: ModelPolicy, tier: 'main' | 'small'): string {
  const route = policy.tiers[tier];
  if (route === undefined) throw new RangeError(`policy has no ${tier} tier`);
  return route.model;
}

function callCost(prices: PriceTable, model: string, input: number, output: number): number {
  const cost = computeCostMicroUsd(prices, model, input, output);
  if (cost === undefined) throw new UnpricedModelError(model);
  return cost;
}

/** One turn's cost in integer micro-USD under `policy`. Throws on an unpriced model. */
export function turnCostMicroUsd(
  policy: ModelPolicy,
  prices: PriceTable,
  assumptions: TurnTokenAssumptions = TURN_TOKEN_ASSUMPTIONS,
): number {
  const a = assumptions;
  if (!Number.isSafeInteger(a.smallCallsPerTurn) || a.smallCallsPerTurn < 0) {
    throw new RangeError('smallCallsPerTurn must be a non-negative safe integer');
  }
  const main = callCost(prices, modelOf(policy, 'main'), a.mainInputTokens, a.mainOutputTokens);
  const small = callCost(
    prices,
    modelOf(policy, 'small'),
    a.smallInputTokensPerCall,
    a.smallOutputTokensPerCall,
  );
  const total = BigInt(main) + BigInt(small) * BigInt(a.smallCallsPerTurn);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('turn cost is too large to store exactly');
  }
  return Number(total);
}
