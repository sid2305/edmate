// A seeded PRNG (mulberry32) for property tests: reproducible, no dependency (1.2 decision).

export interface Prng {
  readonly seed: number;
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, n). */
  int(n: number): number;
  /** One element of a non-empty list. */
  pick<T>(xs: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
}

export function prng(seed: number): Prng {
  let a = seed | 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return {
    seed,
    next,
    int,
    pick<T>(xs: readonly T[]): T {
      if (xs.length === 0) throw new RangeError('pick from an empty list');
      return xs[int(xs.length)] as T;
    },
    chance: (p) => next() < p,
  };
}
