import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_POLICY } from '../../src/router/default-policy.js';
import {
  computeCostMicroUsd,
  loadBundledPrices,
  parsePriceTable,
  PriceTableError,
} from '../../src/pricing/index.js';

const VALID = `
# USD per 1,000,000 tokens
priced-model:
  inputUsdPerMillion: 3
  outputUsdPerMillion: 15
cheap-model:
  inputUsdPerMillion: 0.8
  outputUsdPerMillion: 4.000001
free-model:
  inputUsdPerMillion: 0
  outputUsdPerMillion: 0
`;

function problemOf(yaml: string): string {
  try {
    parsePriceTable(yaml);
  } catch (e) {
    expect(e).toBeInstanceOf(PriceTableError);
    return (e as Error).message;
  }
  throw new Error('expected parsePriceTable to throw');
}

describe('parsePriceTable', () => {
  it('parses a valid table into integer micro-USD per million tokens', () => {
    const t = parsePriceTable(VALID);
    expect(t.models()).toEqual(['priced-model', 'cheap-model', 'free-model']);
    expect(t.has('priced-model')).toBe(true);
    expect(t.has('missing-model')).toBe(false);
  });

  it('rejects a negative price, naming the model', () => {
    const msg = problemOf('bad-model:\n  inputUsdPerMillion: -1\n  outputUsdPerMillion: 1\n');
    expect(msg).toContain('bad-model');
    expect(msg).toContain('inputUsdPerMillion');
  });

  it('rejects a non-finite price, naming the model', () => {
    expect(
      problemOf('inf-model:\n  inputUsdPerMillion: .inf\n  outputUsdPerMillion: 1\n'),
    ).toContain('inf-model');
    expect(
      problemOf('nan-model:\n  inputUsdPerMillion: .nan\n  outputUsdPerMillion: 1\n'),
    ).toContain('nan-model');
  });

  it('rejects an unknown extra key, naming the model', () => {
    const msg = problemOf(
      'extra-model:\n  inputUsdPerMillion: 1\n  outputUsdPerMillion: 1\n  currency: EUR\n',
    );
    expect(msg).toContain('extra-model');
  });

  it('rejects a missing price, a string price and more than six decimals', () => {
    expect(problemOf('m1:\n  inputUsdPerMillion: 1\n')).toContain('m1');
    expect(problemOf('m2:\n  inputUsdPerMillion: "1"\n  outputUsdPerMillion: 1\n')).toContain('m2');
    expect(problemOf('m3:\n  inputUsdPerMillion: 0.0000001\n  outputUsdPerMillion: 1\n')).toContain(
      'm3',
    );
  });

  it('rejects a file that is not a mapping of models, or is empty or not YAML', () => {
    expect(problemOf('- a\n- b\n')).toMatch(/prices\.yaml/);
    expect(problemOf('')).toMatch(/prices\.yaml/);
    expect(problemOf('just a string')).toMatch(/prices\.yaml/);
    expect(problemOf('a: [unclosed')).toMatch(/not valid YAML/);
    expect(problemOf('"": {inputUsdPerMillion: 1, outputUsdPerMillion: 1}')).toMatch(
      /prices\.yaml/,
    );
  });
});

describe('computeCostMicroUsd', () => {
  const t = parsePriceTable(VALID);

  it('is exact for round numbers', () => {
    // 1,000 in x $3/M = 3,000 micro-USD; 2,000 out x $15/M = 30,000 micro-USD.
    expect(computeCostMicroUsd(t, 'priced-model', 1_000, 2_000)).toBe(33_000);
    expect(computeCostMicroUsd(t, 'priced-model', 1_000_000, 0)).toBe(3_000_000);
  });

  it('is exact for odd token counts and fractional prices (integer math, half rounds up)', () => {
    // 7 in x 0.8 = 5.6; 3 out x 4.000001 = 12.000003; total 17.600003 -> 18.
    expect(computeCostMicroUsd(t, 'cheap-model', 7, 3)).toBe(18);
    // 1 in x 0.8 = 0.8 -> 1 (a call that spent tokens never rounds down to free unless it is free).
    expect(computeCostMicroUsd(t, 'cheap-model', 1, 0)).toBe(1);
    // 1,234,567 in x 0.8 = 987,653.6; 89 out x 4.000001 = 356.000089; total 988,009.600089 -> 988,010.
    expect(computeCostMicroUsd(t, 'cheap-model', 1_234_567, 89)).toBe(988_010);
    const c = computeCostMicroUsd(t, 'cheap-model', 1_234_567, 89);
    expect(Number.isInteger(c)).toBe(true);
  });

  it('is zero for zero tokens and for a free model', () => {
    expect(computeCostMicroUsd(t, 'priced-model', 0, 0)).toBe(0);
    expect(computeCostMicroUsd(t, 'free-model', 500, 500)).toBe(0);
  });

  it('returns undefined for a model with no price', () => {
    expect(computeCostMicroUsd(t, 'missing-model', 10, 10)).toBeUndefined();
  });

  it('does not treat inherited object keys as models', () => {
    expect(t.has('constructor')).toBe(false);
    expect(computeCostMicroUsd(t, 'toString', 1, 1)).toBeUndefined();
  });

  it('rejects token counts that are not non-negative safe integers', () => {
    expect(() => computeCostMicroUsd(t, 'priced-model', -1, 0)).toThrow(RangeError);
    expect(() => computeCostMicroUsd(t, 'priced-model', 0, 1.5)).toThrow(RangeError);
    expect(() => computeCostMicroUsd(t, 'priced-model', Number.MAX_SAFE_INTEGER + 1, 0)).toThrow(
      RangeError,
    );
  });

  it('rejects a cost too large to store exactly', () => {
    const huge = parsePriceTable('m:\n  inputUsdPerMillion: 1000000\n  outputUsdPerMillion: 0\n');
    expect(() => computeCostMicroUsd(huge, 'm', Number.MAX_SAFE_INTEGER, 0)).toThrow(RangeError);
  });
});

describe('bundled prices.yaml', () => {
  it('loads, and prices every model the default policy can route to', () => {
    const t = loadBundledPrices();
    for (const route of Object.values(DEFAULT_MODEL_POLICY.tiers)) {
      expect(t.has(route.model), route.model).toBe(true);
    }
  });
});
