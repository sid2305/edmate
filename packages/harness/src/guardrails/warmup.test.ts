// warmPreGuardPatterns (task 3.9c): pure, synchronous warm-up, no timing assertion here -- see
// warmup.coldStart.test.ts for the budget-outcome test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchModeration } from './moderationPatterns.js';
import { warmPreGuardPatterns } from './warmup.js';

describe('warmPreGuardPatterns', () => {
  it('does not throw and returns undefined', () => {
    expect(warmPreGuardPatterns()).toBeUndefined();
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
// swallowed and never blocks startup, by mocking each matcher to throw in turn.
describe('warmPreGuardPatterns swallows a throwing matcher', () => {
  afterEach(() => {
    vi.doUnmock('./distressKeywords.js');
    vi.doUnmock('./moderationPatterns.js');
    vi.doUnmock('./jailbreakPatterns.js');
    vi.resetModules();
  });

  it('a throwing distressKeywordMatch never blocks the warm-up', async () => {
    vi.doMock('./distressKeywords.js', () => ({
      distressKeywordMatch: () => {
        throw new Error('boom');
      },
    }));
    const { warmPreGuardPatterns: warm } = await import('./warmup.js');
    expect(warm()).toBeUndefined();
  });

  it('a throwing matchModeration never blocks the warm-up', async () => {
    vi.doMock('./moderationPatterns.js', () => ({
      matchModeration: () => {
        throw new Error('boom');
      },
    }));
    const { warmPreGuardPatterns: warm } = await import('./warmup.js');
    expect(warm()).toBeUndefined();
  });

  it('a throwing matchJailbreak never blocks the warm-up', async () => {
    vi.doMock('./jailbreakPatterns.js', () => ({
      matchJailbreak: () => {
        throw new Error('boom');
      },
    }));
    const { warmPreGuardPatterns: warm } = await import('./warmup.js');
    expect(warm()).toBeUndefined();
  });
});
