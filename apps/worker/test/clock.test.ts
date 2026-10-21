// Task 3.9d: the slack test clock the worker's real-clock turn tests run on.
import { cancelSource } from '@edmate/harness';
import { describe, expect, it } from 'vitest';
import { slackClock, STEP_BUDGET_SLACK } from './clock.js';

describe('slackClock (3.9d)', () => {
  it('uses a 10x slack, like apps/cli (3.9b)', () => {
    expect(STEP_BUDGET_SLACK).toBe(10);
  });

  it('slows sleep and now() together by the factor, and still cancels early', async () => {
    const clock = slackClock(10);
    expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1000);

    const t0 = Date.now();
    const c0 = clock.now();
    await clock.sleep(5);
    const real = Date.now() - t0;
    expect(real).toBeGreaterThanOrEqual(45);
    // now() moved about a tenth of the real time: a budget minus a now() delta stays consistent.
    const virtual = clock.now() - c0;
    expect(virtual).toBeGreaterThanOrEqual(4);
    expect(virtual).toBeLessThanOrEqual(Math.ceil(real / 10) + 1);

    const source = cancelSource();
    const t1 = Date.now();
    const slept = clock.sleep(60_000, source.token);
    source.cancel();
    await slept;
    expect(Date.now() - t1).toBeLessThan(1000);
  });

  it('a sleep whose token is already cancelled returns at once', async () => {
    const source = cancelSource();
    source.cancel();
    const t0 = Date.now();
    await slackClock(10).sleep(60_000, source.token);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
