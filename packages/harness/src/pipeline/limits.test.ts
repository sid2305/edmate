import { describe, expect, it } from 'vitest';
import { virtualClock } from '../testing/virtualClock.js';
import { createTurnLimits, slidingWindow } from './limits.js';
import { MESSAGE_WINDOW_MS, RATE_LIMIT_TURNS, RATE_LIMIT_WINDOW_MS } from './spec.js';

describe('slidingWindow', () => {
  it('allows max takes per trailing window, then refuses without counting the refusal', async () => {
    const clock = virtualClock();
    const w = slidingWindow({ clock, windowMs: 1_000 });
    expect([1, 2, 3].map(() => w.tryTake('k', 3))).toEqual([true, true, true]);
    expect(w.tryTake('k', 3)).toBe(false);
    expect(w.tryTake('k', 3)).toBe(false);
    expect(w.count('k')).toBe(3);
    await clock.advance(999);
    expect(w.tryTake('k', 3)).toBe(false);
    await clock.advance(1);
    // Exactly windowMs later the first takes have left the window.
    expect(w.count('k')).toBe(0);
    expect(w.tryTake('k', 3)).toBe(true);
  });

  it('slides: each take expires windowMs after it was made', async () => {
    const clock = virtualClock();
    const w = slidingWindow({ clock, windowMs: 100 });
    expect(w.tryTake('k', 2)).toBe(true); // t=0
    await clock.advance(50);
    expect(w.tryTake('k', 2)).toBe(true); // t=50
    expect(w.tryTake('k', 2)).toBe(false);
    await clock.advance(50); // t=100: the t=0 take expired
    expect(w.tryTake('k', 2)).toBe(true);
    expect(w.tryTake('k', 2)).toBe(false);
    await clock.advance(49); // t=149: the t=50 take is still live
    expect(w.tryTake('k', 2)).toBe(false);
    await clock.advance(1);
    expect(w.tryTake('k', 2)).toBe(true);
  });

  it('keeps keys apart', () => {
    const w = slidingWindow({ clock: virtualClock(), windowMs: 100 });
    expect(w.tryTake('a', 1)).toBe(true);
    expect(w.tryTake('a', 1)).toBe(false);
    expect(w.tryTake('b', 1)).toBe(true);
    expect(w.count('c')).toBe(0);
  });

  it('a max of 0 refuses everything; a bad max refuses too (fail closed)', () => {
    const w = slidingWindow({ clock: virtualClock(), windowMs: 100 });
    expect(w.tryTake('a', 0)).toBe(false);
    expect(w.tryTake('a', -1)).toBe(false);
    expect(w.tryTake('a', Number.NaN)).toBe(false);
    expect(w.tryTake('a', 1.5)).toBe(false);
    expect(w.count('a')).toBe(0);
    expect(w.keys).toBe(0);
  });

  it('prunes: 10,000 one-off keys are gone after the window', async () => {
    const clock = virtualClock();
    const w = slidingWindow({ clock, windowMs: 1_000 });
    for (let i = 0; i < 10_000; i++) expect(w.tryTake(`k${i}`, 1)).toBe(true);
    expect(w.keys).toBe(10_000);
    await clock.advance(1_000);
    expect(w.tryTake('fresh', 1)).toBe(true);
    expect(w.keys).toBe(1);
    expect(w.count('k0')).toBe(0);
  });

  it('a clock that goes backwards does not let extra takes through', () => {
    let now = 10_000;
    const w = slidingWindow({ clock: { now: () => now }, windowMs: 1_000 });
    expect(w.tryTake('k', 1)).toBe(true);
    now = 9_000;
    expect(w.tryTake('k', 1)).toBe(false);
    now = 11_000;
    expect(w.tryTake('k', 1)).toBe(true);
  });

  it('rejects a bad window at construction', () => {
    expect(() => slidingWindow({ clock: virtualClock(), windowMs: 0 })).toThrow(RangeError);
    expect(() => slidingWindow({ clock: virtualClock(), windowMs: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe('createTurnLimits', () => {
  it('rate: 10 per 60 s; messages: a 24 h window', async () => {
    expect(RATE_LIMIT_TURNS).toBe(10);
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(MESSAGE_WINDOW_MS).toBe(86_400_000);
    const clock = virtualClock();
    const l = createTurnLimits(clock);
    for (let i = 0; i < 10; i++) expect(l.rate.tryTake('s', RATE_LIMIT_TURNS)).toBe(true);
    expect(l.rate.tryTake('s', RATE_LIMIT_TURNS)).toBe(false);
    expect(l.messages.tryTake('s:p', 1)).toBe(true);
    await clock.advance(RATE_LIMIT_WINDOW_MS);
    expect(l.rate.tryTake('s', RATE_LIMIT_TURNS)).toBe(true);
    expect(l.messages.tryTake('s:p', 1)).toBe(false);
    await clock.advance(MESSAGE_WINDOW_MS);
    expect(l.messages.tryTake('s:p', 1)).toBe(true);
  });
});
