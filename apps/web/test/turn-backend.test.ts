// 9.4a Phase D: the memory backend's `deadlineSafeClock` (test/turn-backend.ts) -- both `sleep`
// branches and the `now()` jump cap. No real timers: the wrapped "real" clock is a fake that
// records what it was asked for.
import type { Clock } from '@edmate/harness';
import { describe, expect, it } from 'vitest';
import { deadlineSafeClock, MAX_CLOCK_JUMP_MS, MAX_REAL_SLEEP_MS } from './turn-backend';

function fakeReal(start = 1_000) {
  let wall = start;
  const sleeps: number[] = [];
  const real: Clock = {
    now: () => wall,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
  return { real, sleeps, advance: (ms: number) => void (wall += ms) };
}

describe('deadlineSafeClock.sleep', () => {
  it('with no cancel token, really sleeps for the asked time, bounded', async () => {
    const { real, sleeps } = fakeReal();
    const clock = deadlineSafeClock(real);
    await clock.sleep(100);
    await clock.sleep(MAX_REAL_SLEEP_MS + 5_000);
    await clock.sleep(-5);
    expect(sleeps).toEqual([100, MAX_REAL_SLEEP_MS, 0]);
  });

  it('a non-finite ms (NaN, Infinity) clamps to 0, never sleeps for real forever (9.4e item 9)', async () => {
    const { real, sleeps } = fakeReal();
    const clock = deadlineSafeClock(real);
    await clock.sleep(NaN);
    await clock.sleep(Infinity);
    await clock.sleep(-Infinity);
    expect(sleeps).toEqual([0, MAX_REAL_SLEEP_MS, 0]);
  });

  it('with a cancel token, never sleeps for real and resolves only when cancelled', async () => {
    const { real, sleeps } = fakeReal();
    const clock = deadlineSafeClock(real);
    let fire: (() => void) | undefined;
    let settled = false;
    const sleeping = clock.sleep(5, { onCancel: (fn) => void (fire = fn) }).then(() => {
      settled = true;
    });
    // Flush microtasks: a 5 ms deadline must not have resolved on its own.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(sleeps).toEqual([]);
    expect(fire).toBeDefined();
    fire?.();
    await sleeping;
    expect(settled).toBe(true);
    expect(sleeps).toEqual([]);
  });
});

describe('deadlineSafeClock.now', () => {
  it('follows the real clock, but never jumps more than the cap per call', () => {
    const { real, advance } = fakeReal(1_000);
    const clock = deadlineSafeClock(real);
    expect(clock.now()).toBe(1_000);
    advance(5);
    expect(clock.now()).toBe(1_005);
    advance(10_000);
    expect(clock.now()).toBe(1_005 + MAX_CLOCK_JUMP_MS);
    // Still monotonic when the real clock goes backwards.
    advance(-20_000);
    expect(clock.now()).toBe(1_005 + MAX_CLOCK_JUMP_MS);
  });
});
