// Tests for the hard wall-clock ceiling on the load/validate path (task 3.10, fix round 1).
//
// No mocking: in this package's own test run there is no `dist` build, so the compiled worker
// file genuinely does not exist next to this module, and `checkSafeRegexGuarded` takes its
// documented fast, synchronous, in-process fallback -- the same branch production takes only if
// a worker could never be started. This is the one real (unmocked) case these tests can exercise;
// it also doubles as the repro check: it must return fast, not after the ceiling.
import { afterEach, describe, expect, it, vi } from 'vitest';
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

// Fix round (3.10a review item 2): a missing compiled worker outside this package's own tests --
// a production runtime (a bundler dropped `dist/**`, a relocated standalone copy left it behind,
// ...), dev-from-source on a developer's own machine, or any other non-test context -- must not
// reuse the fast in-process fallback above -- that branch has no wall-clock limit, so it fails
// open on exactly the path this guard exists to protect. The guard keys off `VITEST === 'true'`
// (set only by this package's own `vitest run`), not `NODE_ENV === 'production'`, so every one of
// those contexts fails closed, not only a production one: report every pattern unsafe instead,
// and log the gap once rather than once per pattern checked.
describe("checkSafeRegexGuarded (no compiled worker file, outside this package's own tests: fails closed)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('T3: VITEST and NODE_ENV both unset -> fails closed, and logs the gap exactly once', () => {
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', '');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(checkSafeRegexGuarded('a')).toEqual([
      "the compiled safe-regex worker is missing outside this package's own tests (failing closed)",
    ]);
    expect(checkSafeRegexGuarded('b')).toEqual([
      "the compiled safe-regex worker is missing outside this package's own tests (failing closed)",
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('failing closed');
  });

  it('T3b: VITEST=false, NODE_ENV=production -> still fails closed (not just the literal NODE_ENV check)', () => {
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('NODE_ENV', 'production');

    expect(checkSafeRegexGuarded('a')).toEqual([
      "the compiled safe-regex worker is missing outside this package's own tests (failing closed)",
    ]);
  });
});

// T4: inside this package's own vitest run (VITEST === 'true', the real environment every test in
// this file runs under unless stubbed otherwise), the missing-worker case above still uses the
// fast in-process fallback -- no regression to the dev/test convenience the first describe block
// in this file already exercises without any stubbing at all.
describe("checkSafeRegexGuarded (no compiled worker file, inside this package's own tests: in-process fallback)", () => {
  it('T4: VITEST explicitly stubbed back to "true" still takes the fast in-process path', () => {
    vi.stubEnv('VITEST', 'true');
    expect(checkSafeRegexGuarded('a')).toEqual([]);
    vi.unstubAllEnvs();
  });
});
