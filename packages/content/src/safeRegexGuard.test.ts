// Tests for the hard wall-clock ceiling on the load/validate path (task 3.10, fix round 1).
//
// No mocking: in this package's own test run there is no `dist` build, so the compiled worker
// file genuinely does not exist next to this module, and `checkSafeRegexGuarded` takes its
// documented fast, synchronous, in-process fallback -- the same branch production takes only if
// a worker could never be started. This is the one real (unmocked) case these tests can exercise;
// it also doubles as the repro check: it must return fast, not after the ceiling.
import { describe, expect, it } from 'vitest';
import { checkSafeRegexGuarded } from './safeRegexGuard.js';

describe('checkSafeRegexGuarded (no compiled worker file: in-process fallback)', () => {
  it('returns the in-process result for a safe pattern, fast', () => {
    const start = performance.now();
    expect(checkSafeRegexGuarded('a')).toEqual([]);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('returns the in-process result for a structurally unsafe pattern, fast', () => {
    const start = performance.now();
    expect(checkSafeRegexGuarded('(a+)+$')).toEqual([
      'nests a quantifier inside a repeated group',
    ]);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('catches the two repro patterns from the security review, fast, without running them', () => {
    const start = performance.now();
    expect(checkSafeRegexGuarded('(x|xx)'.repeat(25) + 'z')).toEqual([
      'repeats an alternation whose branches can start the same way',
    ]);
    expect(checkSafeRegexGuarded('(a|aa)'.repeat(25) + 'z')).toEqual([
      'repeats an alternation whose branches can start the same way',
    ]);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
