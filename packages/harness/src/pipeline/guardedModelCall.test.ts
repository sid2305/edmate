import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { cancelSource } from './clock.js';
import { callGuarded, type GuardedCallErrors } from './guardedModelCall.js';
import { virtualClock } from '../testing/virtualClock.js';

const schema = z.strictObject({ ok: z.literal(true) });

class CancelledError extends Error {
  override readonly name = 'CancelledError';
}
class TimedOutError extends Error {
  override readonly name = 'TimedOutError';
  readonly ms: number;
  constructor(ms: number) {
    super(`timed out after ${ms} ms`);
    this.ms = ms;
  }
}
class InvalidError extends Error {
  override readonly name = 'InvalidError';
}

function errors(): GuardedCallErrors {
  return {
    cancelled: () => new CancelledError(),
    timedOut: (ms) => new TimedOutError(ms),
    invalid: () => new InvalidError(),
  };
}

describe('callGuarded', () => {
  it('returns the parsed value when the call resolves with a valid answer', async () => {
    const clock = virtualClock();
    const cancel = cancelSource();
    const value = await callGuarded(
      cancel.token,
      clock,
      () => Promise.resolve({ ok: true }),
      schema,
      100,
      errors(),
    );
    expect(value).toEqual({ ok: true });
  });

  it('throws cancelled() with no call made when already cancelled', async () => {
    const clock = virtualClock();
    const cancel = cancelSource();
    cancel.cancel();
    let calls = 0;
    await expect(
      callGuarded(
        cancel.token,
        clock,
        () => {
          calls++;
          return Promise.resolve({ ok: true });
        },
        schema,
        100,
        errors(),
      ),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(calls).toBe(0);
  });

  it('throws cancelled() when cancelled mid-call', async () => {
    const clock = virtualClock();
    const cancel = cancelSource();
    const p = callGuarded(
      cancel.token,
      clock,
      () => new Promise(() => undefined),
      schema,
      100,
      errors(),
    );
    cancel.cancel();
    await expect(p).rejects.toBeInstanceOf(CancelledError);
  });

  it('throws timedOut(ms) on its own deadline', async () => {
    const clock = virtualClock();
    const cancel = cancelSource();
    const p = callGuarded(
      cancel.token,
      clock,
      () => new Promise(() => undefined),
      schema,
      100,
      errors(),
    );
    await clock.advance(100);
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimedOutError);
    expect((err as TimedOutError).ms).toBe(100);
  });

  it('rethrows a call error as-is', async () => {
    const clock = virtualClock();
    const cancel = cancelSource();
    const boom = new Error('gateway failed');
    await expect(
      callGuarded(cancel.token, clock, () => Promise.reject(boom), schema, 100, errors()),
    ).rejects.toBe(boom);
  });

  it('throws invalid() when the resolved value fails the schema', async () => {
    const clock = virtualClock();
    const cancel = cancelSource();
    await expect(
      callGuarded(cancel.token, clock, () => Promise.resolve({ ok: false }), schema, 100, errors()),
    ).rejects.toBeInstanceOf(InvalidError);
  });
});
