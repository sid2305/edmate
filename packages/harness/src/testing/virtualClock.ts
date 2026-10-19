// A virtual clock for pipeline tests: time only moves when the test advances it, so timeouts and
// concurrency are exact and no real timer, fake timer or wall-clock wait is used.
import type { Cancel, Clock } from '../pipeline/clock.js';

/** 2026-10-17T10:00:00.000Z: the default start, so timestamps in traces are stable. */
export const VIRTUAL_EPOCH_MS = Date.UTC(2026, 9, 17, 10, 0, 0);

/**
 * Microtask turns in one flush pass; enough for most of the pipeline's await chains. Raised from
 * 200 in task 4.6: each streamed sentence now waits for a locked check, so a long reply's chain at
 * one virtual instant is longer (too few turns made the clock fire a timeout the code never
 * reached).
 *
 * This single pass is no longer the whole budget (4.6b): a fixed number here was itself a magic
 * number the 4.6 review flagged, and a long reply made of many model chunks (one streamed sentence
 * per chunk, so one awaited locked check per chunk, with no tool call or real timer in between)
 * can still need more microtask turns than any one fixed pass can promise. `drive` below instead
 * flushes until quiet: on a still-pending promise with no timer due, it keeps taking another pass
 * of this size, up to `QUIET_FLUSH_PASSES` more, before it calls it a deadlock.
 */
const FLUSH_TURNS = 2_000;
/** Extra flush passes `drive` spends on a still-pending promise with no timer due (4.6b). */
const QUIET_FLUSH_PASSES = 50;

export interface VirtualClock extends Clock {
  /** Timers not yet fired or cancelled. */
  readonly pending: number;
  /** Moves time forward by `ms`, firing due timers in deadline order with microtasks flushed between. */
  advance(ms: number): Promise<void>;
  /**
   * Fires timers one deadline at a time until `promise` settles. Rejects with a "deadlock" error
   * when the promise is pending and no timer is left, so a broken test fails instead of hanging.
   */
  drive<T>(promise: Promise<T>, opts?: { maxSteps?: number }): Promise<T>;
}

interface Timer {
  at: number;
  seq: number;
  resolve: () => void;
}

async function flush(turns = FLUSH_TURNS): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

export function virtualClock(opts: { start?: number } = {}): VirtualClock {
  let now = opts.start ?? VIRTUAL_EPOCH_MS;
  let seq = 0;
  const timers: Timer[] = [];

  const nextTimer = (): Timer | undefined =>
    timers.reduce<Timer | undefined>(
      (best, t) =>
        best === undefined || t.at < best.at || (t.at === best.at && t.seq < best.seq) ? t : best,
      undefined,
    );

  const fire = (t: Timer): void => {
    timers.splice(timers.indexOf(t), 1);
    now = Math.max(now, t.at);
    t.resolve();
  };

  return {
    get pending() {
      return timers.length;
    },
    now: () => now,
    sleep(ms: number, cancel?: Cancel): Promise<void> {
      if (!Number.isFinite(ms) || ms < 0) {
        return Promise.reject(new RangeError(`sleep needs a finite ms >= 0, got ${ms}`));
      }
      return new Promise<void>((resolve) => {
        const timer: Timer = { at: now + ms, seq: seq++, resolve };
        timers.push(timer);
        cancel?.onCancel(() => {
          const i = timers.indexOf(timer);
          if (i >= 0) timers.splice(i, 1);
          resolve();
        });
      });
    },
    async advance(ms: number): Promise<void> {
      const target = now + ms;
      await flush();
      for (let t = nextTimer(); t !== undefined && t.at <= target; t = nextTimer()) {
        fire(t);
        await flush();
      }
      now = Math.max(now, target);
      await flush();
    },
    async drive<T>(promise: Promise<T>, o: { maxSteps?: number } = {}): Promise<T> {
      const maxSteps = o.maxSteps ?? 100_000;
      let settled = false;
      const watched = promise.finally(() => {
        settled = true;
      });
      watched.catch(() => undefined); // the caller awaits `watched` below
      for (let steps = 0; ; steps++) {
        await flush();
        // Flush until quiet (4.6b): a long chain of awaits with no timer due yet is not
        // necessarily a deadlock, only a chain longer than one pass. Keep flushing while there is
        // still no timer and the promise has not settled, up to QUIET_FLUSH_PASSES more passes,
        // before concluding it really is stuck.
        for (let quiet = 0; !settled && nextTimer() === undefined && quiet < QUIET_FLUSH_PASSES; quiet++) {
          await flush();
        }
        if (settled) return watched;
        const t = nextTimer();
        if (t === undefined) {
          throw new Error('virtualClock.drive: deadlock (promise pending and no timers left)');
        }
        if (steps >= maxSteps) {
          throw new Error(`virtualClock.drive: still pending after ${maxSteps} timers`);
        }
        fire(t);
      }
    },
  };
}
