import { describe, expect, it } from 'vitest';
import { virtualClock } from '../testing/virtualClock.js';
import type { CancelToken } from './clock.js';
import { runWithTimeout } from './timeout.js';

describe('runWithTimeout', () => {
  it('returns the value and drops the timer when the work wins', async () => {
    const clock = virtualClock({ start: 0 });
    let token: CancelToken | undefined;
    const r = await clock.drive(
      runWithTimeout(
        async (cancel) => {
          token = cancel;
          await clock.sleep(40);
          return 'v';
        },
        50,
        clock,
      ),
    );
    expect(r).toEqual({ status: 'ok', value: 'v', ms: 40 });
    expect(clock.pending).toBe(0);
    expect(token?.cancelled).toBe(true);
  });

  it('reports a thrown error with its elapsed time', async () => {
    const clock = virtualClock({ start: 0 });
    const boom = new Error('boom');
    const r = await clock.drive(
      runWithTimeout(
        async () => {
          await clock.sleep(5);
          throw boom;
        },
        50,
        clock,
      ),
    );
    expect(r).toEqual({ status: 'error', error: boom, ms: 5 });
  });

  it('reports a synchronous throw as an error', async () => {
    const clock = virtualClock({ start: 0 });
    const r = await clock.drive(
      runWithTimeout(
        () => {
          throw new Error('sync');
        },
        50,
        clock,
      ),
    );
    expect(r.status).toBe('error');
  });

  it('times out at exactly ms, cancels the work and ignores its late result', async () => {
    const clock = virtualClock({ start: 0 });
    let token: CancelToken | undefined;
    let finished = false;
    const r = await clock.drive(
      runWithTimeout(
        async (cancel) => {
          token = cancel;
          await new Promise<void>((resolve) => cancel.onCancel(resolve));
          finished = true;
          return 'late';
        },
        50,
        clock,
      ),
    );
    expect(r).toEqual({ status: 'timeout', ms: 50 });
    expect(token?.cancelled).toBe(true);
    expect(finished).toBe(true);
    expect(clock.now()).toBe(50);
  });

  it('swallows a late rejection after a timeout (no unhandled rejection)', async () => {
    const clock = virtualClock({ start: 0 });
    let rejectLate: ((e: unknown) => void) | undefined;
    const r = await clock.drive(
      runWithTimeout(
        () =>
          new Promise<never>((_, reject) => {
            rejectLate = reject;
          }),
        10,
        clock,
      ),
    );
    expect(r.status).toBe('timeout');
    rejectLate?.(new Error('late'));
    await clock.advance(0);
  });

  it('a zero or negative budget times out without running the work', async () => {
    const clock = virtualClock({ start: 0 });
    let ran = false;
    const r = await runWithTimeout(
      () => {
        ran = true;
        return Promise.resolve(1);
      },
      0,
      clock,
    );
    expect(r).toEqual({ status: 'timeout', ms: 0 });
    expect(ran).toBe(false);
  });
});
