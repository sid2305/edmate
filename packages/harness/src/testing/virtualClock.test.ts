import { describe, expect, it } from 'vitest';
import { cancelSource } from '../pipeline/clock.js';
import { VIRTUAL_EPOCH_MS, virtualClock } from './virtualClock.js';

describe('virtualClock', () => {
  it('starts at the fixed epoch, or the given start', () => {
    expect(virtualClock().now()).toBe(VIRTUAL_EPOCH_MS);
    expect(virtualClock({ start: 5 }).now()).toBe(5);
  });

  it('fires timers in deadline order and moves now to each deadline', async () => {
    const clock = virtualClock({ start: 0 });
    const fired: [string, number][] = [];
    void clock.sleep(30).then(() => fired.push(['c', clock.now()]));
    void clock.sleep(10).then(() => fired.push(['a', clock.now()]));
    void clock.sleep(20).then(() => fired.push(['b', clock.now()]));
    void clock.sleep(10).then(() => fired.push(['a2', clock.now()]));
    expect(clock.pending).toBe(4);
    await clock.advance(25);
    expect(fired).toEqual([
      ['a', 10],
      ['a2', 10],
      ['b', 20],
    ]);
    expect(clock.now()).toBe(25);
    expect(clock.pending).toBe(1);
    await clock.advance(5);
    expect(fired.at(-1)).toEqual(['c', 30]);
  });

  it('a cancelled sleep resolves at once and drops its timer', async () => {
    const clock = virtualClock({ start: 0 });
    const c = cancelSource();
    let done = false;
    void clock.sleep(1_000, c.token).then(() => (done = true));
    expect(clock.pending).toBe(1);
    c.cancel();
    await clock.advance(0);
    expect(done).toBe(true);
    expect(clock.pending).toBe(0);
    expect(clock.now()).toBe(0);
  });

  it('a sleep with an already-cancelled token never registers a timer', async () => {
    const clock = virtualClock();
    const c = cancelSource();
    c.cancel();
    await clock.sleep(50, c.token);
    expect(clock.pending).toBe(0);
  });

  it('drive advances until the promise settles', async () => {
    const clock = virtualClock({ start: 0 });
    const work = (async () => {
      await clock.sleep(100);
      await clock.sleep(250);
      return clock.now();
    })();
    await expect(clock.drive(work)).resolves.toBe(350);
  });

  it('drive passes a rejection through', async () => {
    const clock = virtualClock();
    const work = clock.sleep(5).then(() => {
      throw new Error('boom');
    });
    await expect(clock.drive(work)).rejects.toThrow('boom');
  });

  it('drive reports a deadlock instead of hanging', async () => {
    const clock = virtualClock();
    const never = new Promise<void>(() => undefined);
    await expect(clock.drive(never)).rejects.toThrow(/deadlock/);
  });

  it('drive gives up after maxSteps timers', async () => {
    const clock = virtualClock();
    const forever = (async () => {
      for (;;) await clock.sleep(1);
    })();
    await expect(clock.drive(forever, { maxSteps: 50 })).rejects.toThrow(/50 timers/);
  });

  it('rejects negative and non-finite sleeps', async () => {
    const clock = virtualClock();
    await expect(clock.sleep(-1)).rejects.toThrow(RangeError);
    await expect(clock.sleep(Number.NaN)).rejects.toThrow(RangeError);
    expect(clock.pending).toBe(0);
  });
});
