// Rate limit and rolling message limit (task 3.2, lead answer Q1 = A): in-memory sliding windows
// on the injected clock. A restart or a second instance resets them; task 3.14 replaces the daily
// count with a durable, shared store behind the same `TurnCounter` interface.
import type { Clock } from './clock.js';
import { MESSAGE_WINDOW_MS, RATE_LIMIT_WINDOW_MS } from './spec.js';

/**
 * Counts takes per key over a trailing window. `tryTake` is atomic: it checks and records in one
 * call, so two concurrent turns can never both take the last slot. A refused take is not
 * recorded. A durable implementation may return a promise.
 */
export interface TurnCounter {
  tryTake(key: string, max: number): boolean | Promise<boolean>;
}

/** The in-memory counter, with read access for tests. */
export interface SlidingWindow extends TurnCounter {
  tryTake(key: string, max: number): boolean;
  /** Live takes for `key` now. */
  count(key: string): number;
  /** Keys currently held (after the last sweep): memory stays bounded. */
  readonly keys: number;
}

/** What `admit` and `entitle` count; long-lived, built once by the composition root. */
export interface TurnLimits {
  /** Admitted turns per student (10 per 60 s). */
  rate: TurnCounter;
  /** Messages per student x package (`PackageConfig.dailyMessageLimit` per rolling 24 h). */
  messages: TurnCounter;
}

export function slidingWindow(opts: {
  clock: Pick<Clock, 'now'>;
  windowMs: number;
}): SlidingWindow {
  const { clock, windowMs } = opts;
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError(`windowMs must be a positive finite number, got ${windowMs}`);
  }
  const takes = new Map<string, number[]>();
  let lastSweep = clock.now();

  /** A take at `t` is live while `now - t < windowMs` (and always if the clock went backwards). */
  const live = (list: number[], now: number): number[] => list.filter((t) => now - t < windowMs);

  const sweep = (now: number): void => {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, list] of takes) {
      const kept = live(list, now);
      if (kept.length === 0) takes.delete(key);
      else takes.set(key, kept);
    }
  };

  const current = (key: string, now: number): number[] => {
    const kept = live(takes.get(key) ?? [], now);
    if (kept.length === 0) takes.delete(key);
    else takes.set(key, kept);
    return kept;
  };

  return {
    get keys() {
      return takes.size;
    },
    count(key) {
      return current(key, clock.now()).length;
    },
    tryTake(key, max) {
      const now = clock.now();
      sweep(now);
      if (!Number.isSafeInteger(max) || max <= 0) return false;
      const kept = current(key, now);
      if (kept.length >= max) return false;
      takes.set(key, [...kept, now]);
      return true;
    },
  };
}

/** The default in-memory limits on `clock`. */
export function createTurnLimits(clock: Pick<Clock, 'now'>): {
  rate: SlidingWindow;
  messages: SlidingWindow;
} {
  return {
    rate: slidingWindow({ clock, windowMs: RATE_LIMIT_WINDOW_MS }),
    messages: slidingWindow({ clock, windowMs: MESSAGE_WINDOW_MS }),
  };
}
