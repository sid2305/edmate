// Task 8.6a: the per-turn AI cost estimate behind the package builder's cost card.
import type { ModelPolicy } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import * as gateway from '../../src/index.js';
import {
  loadBundledPrices,
  parsePriceTable,
  TURN_TOKEN_ASSUMPTIONS,
  turnCostMicroUsd,
  UnpricedModelError,
  type TurnTokenAssumptions,
} from '../../src/pricing/index.js';
import { MODEL_MIX } from '../../src/router/index.js';

const PRICES = parsePriceTable(`
big:
  inputUsdPerMillion: 2
  outputUsdPerMillion: 10
small:
  inputUsdPerMillion: 1
  outputUsdPerMillion: 5
odd:
  inputUsdPerMillion: 0.3
  outputUsdPerMillion: 0.7
`);

function policy(main: string, small: string): ModelPolicy {
  return {
    tiers: {
      main: { provider: 'anthropic', model: main },
      small: { provider: 'anthropic', model: small },
    },
  };
}

const ASSUME: TurnTokenAssumptions = {
  mainInputTokens: 5_000,
  mainOutputTokens: 500,
  smallCallsPerTurn: 4,
  smallInputTokensPerCall: 1_200,
  smallOutputTokensPerCall: 60,
};

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected a throw');
}

describe('TURN_TOKEN_ASSUMPTIONS (provisional, Q3)', () => {
  it('holds the plan numbers and is frozen', () => {
    expect(TURN_TOKEN_ASSUMPTIONS).toEqual(ASSUME);
    expect(Object.isFrozen(TURN_TOKEN_ASSUMPTIONS)).toBe(true);
  });
});

describe('turnCostMicroUsd', () => {
  it('sums one main call and the small calls to an exact integer micro-USD', () => {
    // main: 5000 x 2 + 500 x 10 = 15,000; small: (1200 x 1 + 60 x 5) x 4 = 6,000.
    expect(turnCostMicroUsd(policy('big', 'small'), PRICES, ASSUME)).toBe(21_000);
  });

  it('uses TURN_TOKEN_ASSUMPTIONS by default', () => {
    expect(turnCostMicroUsd(policy('big', 'small'), PRICES)).toBe(21_000);
  });

  it('rounds each call half up, as metering does', () => {
    // main: 3 x 0.3 = 0.9 -> 1; each small call: 1 x 0.3 = 0.3 -> 0.
    const a: TurnTokenAssumptions = {
      mainInputTokens: 3,
      mainOutputTokens: 0,
      smallCallsPerTurn: 2,
      smallInputTokensPerCall: 1,
      smallOutputTokensPerCall: 0,
    };
    expect(turnCostMicroUsd(policy('odd', 'odd'), PRICES, a)).toBe(1);
  });

  it('a turn with no small calls costs only the main call', () => {
    expect(
      turnCostMicroUsd(policy('big', 'small'), PRICES, { ...ASSUME, smallCallsPerTurn: 0 }),
    ).toBe(15_000);
  });

  it('a main model missing from the price table throws UnpricedModelError, never 0', () => {
    const e = caught(() => turnCostMicroUsd(policy('nope-main', 'small'), PRICES, ASSUME));
    expect(e).toBeInstanceOf(UnpricedModelError);
    expect(e).toMatchObject({ name: 'UnpricedModelError', model: 'nope-main' });
    expect((e as Error).message).toBe('no price for model nope-main');
  });

  it('a small model missing from the price table throws too', () => {
    const e = caught(() => turnCostMicroUsd(policy('big', 'nope-small'), PRICES, ASSUME));
    expect(e).toMatchObject({ name: 'UnpricedModelError', model: 'nope-small' });
  });

  it('an unpriced small model throws even when the turn makes no small calls', () => {
    expect(() =>
      turnCostMicroUsd(policy('big', 'nope-small'), PRICES, { ...ASSUME, smallCallsPerTurn: 0 }),
    ).toThrow(UnpricedModelError);
  });

  it.each(['main', 'small'] as const)('a policy without a %s tier is rejected', (missing) => {
    const tiers = { ...policy('big', 'small').tiers };
    delete tiers[missing];
    expect(() => turnCostMicroUsd({ tiers }, PRICES, ASSUME)).toThrow(
      `policy has no ${missing} tier`,
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects smallCallsPerTurn %s',
    (n) => {
      expect(() =>
        turnCostMicroUsd(policy('big', 'small'), PRICES, { ...ASSUME, smallCallsPerTurn: n }),
      ).toThrow(RangeError);
    },
  );

  it('rejects negative token counts', () => {
    expect(() =>
      turnCostMicroUsd(policy('big', 'small'), PRICES, { ...ASSUME, mainInputTokens: -1 }),
    ).toThrow(RangeError);
  });

  it('rejects a total too large to store exactly', () => {
    const huge: TurnTokenAssumptions = {
      ...ASSUME,
      smallCallsPerTurn: Number.MAX_SAFE_INTEGER,
      smallInputTokensPerCall: 1_000_000,
    };
    expect(() => turnCostMicroUsd(policy('big', 'small'), PRICES, huge)).toThrow(
      'turn cost is too large to store exactly',
    );
  });
});

describe('the bundled price table', () => {
  it.each(['free', 'paid'] as const)('prices every model in MODEL_MIX.%s', (t) => {
    const prices = loadBundledPrices();
    for (const route of Object.values(MODEL_MIX[t].tiers)) {
      expect(prices.has(route.model), route.model).toBe(true);
    }
    expect(turnCostMicroUsd(MODEL_MIX[t], prices)).toBeGreaterThan(0);
  });

  it('prices claude-sonnet-5 at $2 in / $10 out per million (lead answer Q1)', () => {
    expect(loadBundledPrices().scaled('claude-sonnet-5')).toEqual({
      input: 2_000_000n,
      output: 10_000_000n,
    });
  });

  it('a paid-mix turn costs $0.021 with the provisional assumptions', () => {
    expect(turnCostMicroUsd(MODEL_MIX.paid, loadBundledPrices())).toBe(21_000);
  });
});

describe('package exports', () => {
  it('exports the mix and the estimate from the package root', () => {
    expect(gateway.MODEL_MIX).toBe(MODEL_MIX);
    expect(gateway.turnCostMicroUsd).toBe(turnCostMicroUsd);
    expect(gateway.TURN_TOKEN_ASSUMPTIONS).toBe(TURN_TOKEN_ASSUMPTIONS);
    expect(gateway.UnpricedModelError).toBe(UnpricedModelError);
  });
});
