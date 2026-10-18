import { describe, expect, it } from 'vitest';
import { manualClock } from './clock.js';

describe('manualClock', () => {
  it('resolves sleep without a real wait', async () => {
    const clock = manualClock();
    const started = Date.now();
    await clock.sleep(10_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('records every requested ms in call order', async () => {
    const clock = manualClock();
    await clock.sleep(5);
    await clock.sleep(1_500);
    await clock.sleep(0);
    expect(clock.sleeps).toEqual([5, 1_500, 0]);
  });

  it('keeps separate clocks independent', async () => {
    const a = manualClock();
    const b = manualClock();
    await a.sleep(1);
    expect(b.sleeps).toEqual([]);
  });
});
