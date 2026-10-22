// Task 8.6 Phase C: the monthly AI-cost estimate per subscriber (scope decision 5): typical = half
// the daily limit on 20 days, maximum = the full limit on 30 days; exact integers, no rounding.
import { describe, expect, it } from 'vitest';
import {
  COST_WARNING_SHARE_PERCENT,
  costWarning,
  ESTIMATE_DAYS,
  monthlyEstimate,
  PACKAGE_LIMITS,
} from './costEstimate';

describe('monthlyEstimate', () => {
  it('a free package: typical and max, no share of price', () => {
    expect(monthlyEstimate(21_000, 10, 0)).toEqual({
      typicalMicroUsd: 21_000 * 5 * 20,
      maxMicroUsd: 21_000 * 10 * 30,
    });
    expect(monthlyEstimate(21_000, 10, 0)).not.toHaveProperty('shareOfPrice');
  });

  it('a paid package carries the max as a whole percent of the price, rounded up', () => {
    // 20/day at 21,000 micro-USD a turn: max 12.6 USD; price 29 USD -> 43.4% -> 44.
    expect(monthlyEstimate(21_000, 20, 2900)).toEqual({
      typicalMicroUsd: 4_200_000,
      maxMicroUsd: 12_600_000,
      shareOfPrice: 44,
    });
    // Exactly 25%: not rounded past it.
    expect(monthlyEstimate(10_000, 10, 1200).shareOfPrice).toBe(25);
  });

  it('an odd daily limit keeps the typical figure an exact integer', () => {
    expect(monthlyEstimate(3, 1, 0)).toEqual({ typicalMicroUsd: 30, maxMicroUsd: 90 });
  });

  it('zero cost per turn is zero', () => {
    expect(monthlyEstimate(0, 20, 2900)).toEqual({
      typicalMicroUsd: 0,
      maxMicroUsd: 0,
      shareOfPrice: 0,
    });
  });

  it.each([
    [-1, 10, 0],
    [1.5, 10, 0],
    [Number.NaN, 10, 0],
    [1, -1, 0],
    [1, 2.5, 0],
    [1, 10, -5],
    [1, 10, 0.5],
    [Number.MAX_SAFE_INTEGER, 100, 0],
  ])('refuses a bad input (%s, %s, %s) loudly', (turn, daily, price) => {
    expect(() => monthlyEstimate(turn, daily, price)).toThrow(RangeError);
  });

  it('names its day counts', () => {
    expect(ESTIMATE_DAYS).toEqual({ typical: 20, max: 30 });
  });
});

describe('PACKAGE_LIMITS', () => {
  it('holds the plan Q4-Q6 numbers, frozen', () => {
    expect(PACKAGE_LIMITS).toEqual({
      nameMaxLength: 80,
      priceMinMinor: 100,
      priceMaxMinor: 100_000,
      trialDaysMax: 30,
      dailyMessagesMin: 1,
      dailyMessagesMax: 100,
      dailyMessagesDefault: 20,
      liveClassesMax: 8,
    });
    expect(Object.isFrozen(PACKAGE_LIMITS)).toBe(true);
  });
});

describe('costWarning', () => {
  it('warns only above the threshold on a paid package', () => {
    expect(COST_WARNING_SHARE_PERCENT).toBe(25);
    expect(costWarning({ typicalMicroUsd: 1, maxMicroUsd: 2, shareOfPrice: 26 })).toBe(true);
    expect(costWarning({ typicalMicroUsd: 1, maxMicroUsd: 2, shareOfPrice: 25 })).toBe(false);
    expect(costWarning({ typicalMicroUsd: 1, maxMicroUsd: 2 })).toBe(false);
  });
});
