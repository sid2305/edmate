// Pure, no DB (task 3.17). Numbers below are hand-computed from BKT_DEFAULTS (pInit 0.2,
// pLearn 0.15, pSlip 0.1, pGuess 0.2):
//   correct:   pObs = p(1-pSlip) / (p(1-pSlip) + (1-p)*pGuess)
//   incorrect: pObs = p*pSlip    / (p*pSlip    + (1-p)*(1-pGuess))
//   next p = pObs + (1-pObs) * pLearn
import { describe, expect, it } from 'vitest';
import { applyBkt, BKT_DEFAULTS, foldMastery } from '../src/mastery.js';

describe('applyBkt', () => {
  it('starts an unseen topic at pInit, n 1, and moves up on a correct answer', () => {
    const r = applyBkt(undefined, true, '2026-10-19T10:00:00.000Z');
    const pObs = (0.2 * 0.9) / (0.2 * 0.9 + 0.8 * 0.2);
    const expected = pObs + (1 - pObs) * 0.15;
    expect(r.n).toBe(1);
    expect(r.p).toBeCloseTo(expected, 10);
    expect(r.updatedAt).toBe('2026-10-19T10:00:00.000Z');
  });

  it('moves down (but not to zero) on a wrong answer, from the same prior', () => {
    const r = applyBkt(undefined, false, '2026-10-19T10:00:00.000Z');
    const pObs = (0.2 * 0.1) / (0.2 * 0.1 + 0.8 * 0.8);
    const expected = pObs + (1 - pObs) * 0.15;
    expect(r.p).toBeCloseTo(expected, 10);
    expect(r.p).toBeLessThan(0.2);
  });

  it('accumulates n and carries the prior p forward, in order', () => {
    const a = applyBkt(undefined, true, '2026-10-19T10:00:00.000Z');
    const b = applyBkt(a, true, '2026-10-19T10:05:00.000Z');
    expect(b.n).toBe(2);
    expect(b.p).toBeGreaterThan(a.p);
    expect(b.updatedAt).toBe('2026-10-19T10:05:00.000Z');
  });

  it('is deterministic: the same prior, outcome and ts always give the same entry', () => {
    const prior = { p: 0.42, n: 3, updatedAt: '2026-10-18T00:00:00.000Z' };
    const a = applyBkt(prior, true, '2026-10-19T10:00:00.000Z');
    const b = applyBkt(prior, true, '2026-10-19T10:00:00.000Z');
    expect(a).toEqual(b);
  });

  it('never leaves [0, 1], even at the edges', () => {
    const atOne = applyBkt({ p: 1, n: 1, updatedAt: '2026-10-19T10:00:00.000Z' }, true, 'x');
    const atZero = applyBkt({ p: 0, n: 1, updatedAt: '2026-10-19T10:00:00.000Z' }, false, 'x');
    for (const r of [atOne, atZero]) {
      expect(r.p).toBeGreaterThanOrEqual(0);
      expect(r.p).toBeLessThanOrEqual(1);
    }
  });

  it('custom params change the update (not just the defaults)', () => {
    const k = { pInit: 0.5, pLearn: 0, pSlip: 0, pGuess: 0 };
    // No slip, no guess, no learning: a correct answer proves mastery outright; p stays put.
    expect(applyBkt(undefined, true, 'x', k).p).toBeCloseTo(1, 10);
    expect(applyBkt(undefined, false, 'x', k).p).toBeCloseTo(0, 10);
  });

  // Review fix round (3.17): a NaN or out-of-range BktParams (or a computation that yields NaN)
  // throws instead of silently falling back to pInit — a silent fallback would score a buggy
  // caller's events as if the student had no prior knowledge at all, with no sign anything was
  // wrong.
  it('throws when a BktParams field is NaN', () => {
    const k = { ...BKT_DEFAULTS, pInit: Number.NaN };
    expect(() => applyBkt(undefined, true, 'x', k)).toThrow(/pInit/);
  });

  it('throws when a BktParams field is out of [0, 1]', () => {
    const k = { ...BKT_DEFAULTS, pSlip: 1.5 };
    expect(() => applyBkt(undefined, true, 'x', k)).toThrow(/pSlip/);
  });

  it('throws when the prior mastery entry carries a non-finite p', () => {
    const prior = { p: Number.NaN, n: 1, updatedAt: 'x' };
    expect(() => applyBkt(prior, true, 'x')).toThrow(/prior/);
  });

  it('throws rather than silently defaulting when the update itself computes to NaN', () => {
    // pBefore 0 with pGuess 0 and pSlip 0: the posterior is 0/0 on a correct answer.
    const k = { pInit: 0, pLearn: 0.15, pSlip: 0, pGuess: 0 };
    expect(() => applyBkt(undefined, true, 'x', k)).toThrow(/finite/);
  });
});

describe('BKT_DEFAULTS', () => {
  it('matches the build plan', () => {
    expect(BKT_DEFAULTS).toEqual({ pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.2 });
  });
});

describe('foldMastery', () => {
  it('applies each topic independently, in the order given, leaving other topics untouched', () => {
    const start = { top_a: { p: 0.9, n: 5, updatedAt: '2026-10-01T00:00:00.000Z' } };
    const next = foldMastery(start, [
      { topicId: 'top_b', correct: true, ts: '2026-10-19T10:00:00.000Z' },
      { topicId: 'top_b', correct: true, ts: '2026-10-19T10:05:00.000Z' },
    ]);
    expect(next.top_a).toEqual(start.top_a);
    expect(next.top_b?.n).toBe(2);
  });

  it('is a pure function: it never mutates the mastery map it was given', () => {
    const start = { top_a: { p: 0.5, n: 1, updatedAt: '2026-10-01T00:00:00.000Z' } };
    const frozenStart = structuredClone(start);
    foldMastery(start, [{ topicId: 'top_a', correct: true, ts: '2026-10-19T10:00:00.000Z' }]);
    expect(start).toEqual(frozenStart);
  });

  it('an empty event list returns an equal (but fresh) copy', () => {
    const start = { top_a: { p: 0.5, n: 1, updatedAt: '2026-10-01T00:00:00.000Z' } };
    const next = foldMastery(start, []);
    expect(next).toEqual(start);
    expect(next).not.toBe(start);
  });
});
