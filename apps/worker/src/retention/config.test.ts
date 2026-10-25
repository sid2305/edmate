import { describe, expect, it } from 'vitest';
import { cutoffFor, defaultRetentionConfig, RETENTION_DAYS } from './config.js';

describe('defaultRetentionConfig', () => {
  it('defaults to dry run everywhere (fail closed)', () => {
    expect(defaultRetentionConfig.dryRun).toBe(true);
    expect(defaultRetentionConfig.days).toBe(RETENTION_DAYS);
  });
});

describe('cutoffFor', () => {
  it('subtracts the given number of days from now', () => {
    const now = new Date('2026-10-25T00:00:00.000Z');
    expect(cutoffFor(now, 1).toISOString()).toBe('2026-10-24T00:00:00.000Z');
    expect(cutoffFor(now, 730).toISOString()).toBe('2024-10-25T00:00:00.000Z');
  });

  it('zero days is now', () => {
    const now = new Date('2026-10-25T00:00:00.000Z');
    expect(cutoffFor(now, 0).getTime()).toBe(now.getTime());
  });
});
