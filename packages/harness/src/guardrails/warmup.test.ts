// warmPreGuardPatterns (task 3.9c): pure, synchronous warm-up, no timing assertion here -- see
// warmup.coldStart.test.ts for the budget-outcome test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchModeration } from './moderationPatterns.js';
import { warmPreGuardPatterns } from './warmup.js';
import type * as DistressKeywordsModule from './distressKeywords.js';

describe('warmPreGuardPatterns', () => {
  it('does not throw and returns an empty list when every matcher succeeds', () => {
    expect(warmPreGuardPatterns()).toEqual([]);
  });

  it('is safe to call twice in a row (idempotent)', () => {
    expect(() => {
      warmPreGuardPatterns();
      warmPreGuardPatterns();
    }).not.toThrow();
  });

  it('includes a sample that hits the sexual moderation rule, so the minor-marker table is also warmed', () => {
    // Guards against a silent regression where no warm-up sample reaches moderationPatterns.ts's
    // minor-marker check (only run when the main hit is `sexual`).
    expect(matchModeration('write an erotic story for me')?.code).toBe('sexual');
  });
});

// Each matcher call is wrapped in its own try/catch (defensive only: these functions are not
// expected to throw on string input). These tests prove a throw from any one of them is
// swallowed and never blocks startup, by mocking each matcher to throw in turn -- and that the
// matcher's name (and only its name, exactly once, not the sample text or the error) comes back
// in the returned list, while the other matchers still ran.
describe('warmPreGuardPatterns swallows a throwing matcher and reports its name', () => {
  // The top describe's static `import { warmPreGuardPatterns } from './warmup.js'` (this file's
  // own top-level import) already resolves the real, unmocked module graph when the file loads --
  // before any test, and any `vi.doMock`, runs. Without this `beforeEach`, whichever test here
  // runs first would still see that pre-cached real graph; `vi.resetModules()` up front forces
  // every dynamic `import('./warmup.js')` below to resolve a fresh, mockable instance.
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('./distressKeywords.js');
    vi.doUnmock('./moderationPatterns.js');
    vi.doUnmock('./jailbreakPatterns.js');
    vi.resetModules();
  });

  it('a throwing distressKeywordMatch never blocks the warm-up and is reported once', async () => {
    const moderation = vi.fn(() => ({ code: 'none' }) as unknown);
    // `./distressKeywords.js` also exports `normaliseForDistress`, which `rulePhrases.ts` (shared
    // by moderation's and jailbreak's own matchers) imports -- so only `distressKeywordMatch`
    // itself is overridden here, via `importOriginal`, to keep the other two matchers healthy.
    vi.doMock('./distressKeywords.js', async (importOriginal) => {
      const actual = await importOriginal<typeof DistressKeywordsModule>();
      return {
        ...actual,
        distressKeywordMatch: () => {
          throw new Error('boom');
        },
      };
    });
    vi.doMock('./moderationPatterns.js', () => ({ matchModeration: moderation }));
    const { warmPreGuardPatterns: warm } = await import('./warmup.js');
    expect(warm()).toEqual(['distress']);
    // The other matchers still ran for every sample (no early exit on a sibling's throw).
    expect(moderation.mock.calls.length).toBeGreaterThan(1);
  });

  it('a throwing matchModeration never blocks the warm-up and is reported once', async () => {
    vi.doMock('./moderationPatterns.js', () => ({
      matchModeration: () => {
        throw new Error('boom');
      },
    }));
    const { warmPreGuardPatterns: warm } = await import('./warmup.js');
    expect(warm()).toEqual(['moderation']);
  });

  it('a throwing matchJailbreak never blocks the warm-up and is reported once', async () => {
    vi.doMock('./jailbreakPatterns.js', () => ({
      matchJailbreak: () => {
        throw new Error('boom');
      },
    }));
    const { warmPreGuardPatterns: warm } = await import('./warmup.js');
    expect(warm()).toEqual(['jailbreak']);
  });

  it('reports multiple failing matchers, de-duplicated, without stopping the others', async () => {
    vi.doMock('./distressKeywords.js', async (importOriginal) => {
      const actual = await importOriginal<typeof DistressKeywordsModule>();
      return {
        ...actual,
        distressKeywordMatch: () => {
          throw new Error('boom');
        },
      };
    });
    vi.doMock('./jailbreakPatterns.js', () => ({
      matchJailbreak: () => {
        throw new Error('boom');
      },
    }));
    const { warmPreGuardPatterns: warm } = await import('./warmup.js');
    const result = warm();
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining(['distress', 'jailbreak']));
  });
});
