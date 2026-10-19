import type { Usage } from '@edmate/contracts';
import { usageMain, usageSmall } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { TurnAbort } from '../errors.js';
import { ceilingOf, DEFAULT_MAX_TURN_COST_MICRO_USD, TurnCost } from './costCeiling.js';

const priceAt =
  (n: number) =>
  (u: Usage): number =>
    u.inputTokens > 0 ? n : 0;

function abortCode(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(TurnAbort);
    return (e as TurnAbort).code;
  }
}

describe('TurnCost', () => {
  it('the default ceiling is 0.10 USD', () => {
    expect(DEFAULT_MAX_TURN_COST_MICRO_USD).toBe(100_000);
  });

  it('prices gateway usage and adds it up across calls and attempts', () => {
    const c = new TurnCost(priceAt(300), 1_000);
    expect(c.price(usageMain)).toEqual({ ...usageMain, costMicroUsd: 300 });
    c.price(usageMain);
    c.price(usageMain);
    expect(c.totalMicroUsd).toBe(900);
    expect(abortCode(() => c.assertWithin())).toBeUndefined();
    expect(abortCode(() => c.assertRoomForCall())).toBeUndefined();
  });

  it('a total over the ceiling after a usage → turn_cost_exceeded', () => {
    const c = new TurnCost(priceAt(600), 1_000);
    c.price(usageMain);
    expect(abortCode(() => c.assertWithin())).toBeUndefined();
    c.price(usageMain);
    expect(abortCode(() => c.assertWithin())).toBe('turn_cost_exceeded');
  });

  it('exactly at the ceiling passes after a usage but refuses a new call', () => {
    const c = new TurnCost(priceAt(1_000), 1_000);
    c.price(usageMain);
    expect(abortCode(() => c.assertWithin())).toBeUndefined();
    expect(abortCode(() => c.assertRoomForCall())).toBe('turn_cost_exceeded');
  });

  it('counts step-reported usage at its own cost (steps 3 and 4)', () => {
    const c = new TurnCost(() => 0, 20);
    c.addReported(usageSmall);
    expect(c.totalMicroUsd).toBe(15);
    c.addReported(usageSmall);
    expect(abortCode(() => c.assertRoomForCall())).toBe('turn_cost_exceeded');
  });

  it('unpriced usage fails closed: the usage keeps its own cost and the turn aborts', () => {
    const c = new TurnCost(() => undefined, 100_000);
    expect(c.price(usageMain)).toEqual(usageMain);
    expect(c.unpriced).toBe(true);
    expect(abortCode(() => c.assertWithin())).toBe('turn_cost_exceeded');
    expect(abortCode(() => c.assertRoomForCall())).toBe('turn_cost_exceeded');
  });

  it.each([
    ['a negative price', () => -1],
    ['a fractional price', () => 1.5],
    ['NaN', () => Number.NaN],
    [
      'a throwing price function',
      () => {
        throw new Error('price table down');
      },
    ],
  ])('%s counts as unpriced', (_name, price) => {
    const c = new TurnCost(price as (u: Usage) => number, 100_000);
    c.price(usageMain);
    expect(c.unpriced).toBe(true);
    expect(abortCode(() => c.assertWithin())).toBe('turn_cost_exceeded');
  });

  it('a zero ceiling refuses every call', () => {
    const c = new TurnCost(() => 0, 0);
    expect(abortCode(() => c.assertRoomForCall())).toBe('turn_cost_exceeded');
  });
});

describe('ceilingOf', () => {
  it('uses the default when unset', () => {
    expect(ceilingOf(undefined)).toEqual({ value: DEFAULT_MAX_TURN_COST_MICRO_USD, valid: true });
  });

  it('keeps a valid ceiling', () => {
    expect(ceilingOf(5_000)).toEqual({ value: 5_000, valid: true });
    expect(ceilingOf(0)).toEqual({ value: 0, valid: true });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'an invalid ceiling (%s) fails closed to 0',
    (v) => {
      expect(ceilingOf(v)).toEqual({ value: 0, valid: false });
    },
  );
});
