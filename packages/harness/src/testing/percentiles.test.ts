// 13.2: nearest-rank percentiles for load-test latency samples. Fixed arrays only, no timing.
import { describe, expect, it } from 'vitest';
import { percentile } from './percentiles.js';

describe('percentile', () => {
  const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);

  it('finds p50, p95 and p99 of 1..100 by nearest rank', () => {
    expect(percentile(oneToHundred, 50)).toBe(50);
    expect(percentile(oneToHundred, 95)).toBe(95);
    expect(percentile(oneToHundred, 99)).toBe(99);
  });

  it('returns the only value for a single-element array at any percentile', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('throws on an empty array', () => {
    expect(() => percentile([], 50)).toThrow();
  });
});
