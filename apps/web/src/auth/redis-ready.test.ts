// Task 1.4: with `enableOfflineQueue: false`, ioredis rejects every command until the connection
// is `ready`. The sign-in counters wait for `ready` with a bounded timeout, then fail closed.
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  pendingWaiterCount,
  readyCounters,
  RedisNotReadyError,
  REDIS_READY_TIMEOUT_MS,
  whenReady,
} from './redis-ready';

function fakeRedis(status: string) {
  return Object.assign(new EventEmitter(), { status });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('whenReady', () => {
  it('resolves at once when the connection is already ready', async () => {
    const redis = fakeRedis('ready');
    await expect(whenReady(redis, 10)).resolves.toBeUndefined();
    expect(redis.listenerCount('ready')).toBe(0);
  });

  it('waits for ready on a cold start, then removes its listener', async () => {
    const redis = fakeRedis('connecting');
    const p = whenReady(redis, 1_000);
    expect(redis.listenerCount('ready')).toBe(1);
    redis.status = 'ready';
    redis.emit('ready');
    await expect(p).resolves.toBeUndefined();
    expect(redis.listenerCount('ready')).toBe(0);
  });

  it('times out with a bare RedisNotReadyError and removes its listener', async () => {
    vi.useFakeTimers();
    const redis = fakeRedis('reconnecting');
    const p = whenReady(redis, 500);
    const check = expect(p).rejects.toBeInstanceOf(RedisNotReadyError);
    await vi.advanceTimersByTimeAsync(500);
    await check;
    expect(redis.listenerCount('ready')).toBe(0);
    await expect(p).rejects.toThrow('sign-in rate limiter not ready');
  });

  it('the default bound is a few seconds, not forever', () => {
    expect(REDIS_READY_TIMEOUT_MS).toBeGreaterThan(0);
    expect(REDIS_READY_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('20 concurrent callers register exactly one listener and all resolve together', async () => {
    const redis = fakeRedis('connecting');
    const onceSpy = vi.spyOn(redis, 'once');
    const calls = Array.from({ length: 20 }, () => whenReady(redis, 1_000));
    expect(onceSpy).toHaveBeenCalledTimes(1);
    expect(redis.listenerCount('ready')).toBe(1);
    redis.status = 'ready';
    redis.emit('ready');
    await expect(Promise.all(calls)).resolves.toEqual(new Array(20).fill(undefined));
    expect(redis.listenerCount('ready')).toBe(0);
  });

  it('a second caller with a shorter timeout rejects at its own deadline while the first still waits', async () => {
    vi.useFakeTimers();
    const redis = fakeRedis('connecting');
    const first = whenReady(redis, 1_000);
    const second = whenReady(redis, 200);
    const checkSecond = expect(second).rejects.toBeInstanceOf(RedisNotReadyError);
    await vi.advanceTimersByTimeAsync(200);
    await checkSecond;
    expect(redis.listenerCount('ready')).toBe(1); // first is still waiting
    redis.status = 'ready';
    redis.emit('ready');
    await expect(first).resolves.toBeUndefined();
  });

  it('a second caller with a longer timeout resolves if ready fires after the first deadline but before its own', async () => {
    vi.useFakeTimers();
    const redis = fakeRedis('connecting');
    const first = whenReady(redis, 200);
    const second = whenReady(redis, 1_000);
    const checkFirst = expect(first).rejects.toBeInstanceOf(RedisNotReadyError);
    await vi.advanceTimersByTimeAsync(200);
    await checkFirst;
    expect(redis.listenerCount('ready')).toBe(1); // second is still waiting, listener stays
    redis.status = 'ready';
    redis.emit('ready');
    await expect(second).resolves.toBeUndefined();
  });

  it('a second outage after the first resolves registers a fresh listener (not stuck cached)', async () => {
    const redis = fakeRedis('connecting');
    const first = whenReady(redis, 1_000);
    redis.status = 'ready';
    redis.emit('ready');
    await expect(first).resolves.toBeUndefined();
    redis.status = 'connecting';
    const onceSpy = vi.spyOn(redis, 'once');
    const second = whenReady(redis, 1_000);
    expect(onceSpy).toHaveBeenCalledTimes(1);
    redis.status = 'ready';
    redis.emit('ready');
    await expect(second).resolves.toBeUndefined();
  });
  it('when every waiter times out before ready, nothing resolves late and no listener is left', async () => {
    vi.useFakeTimers();
    const redis = fakeRedis('connecting');
    const first = whenReady(redis, 100);
    const second = whenReady(redis, 200);
    const checkFirst = expect(first).rejects.toBeInstanceOf(RedisNotReadyError);
    const checkSecond = expect(second).rejects.toBeInstanceOf(RedisNotReadyError);
    await vi.advanceTimersByTimeAsync(200);
    await checkFirst;
    await checkSecond;
    expect(redis.listenerCount('ready')).toBe(0);
    expect(pendingWaiterCount(redis)).toBe(0);
    redis.status = 'ready';
    redis.emit('ready');
    // Nothing to assert resolving late: both promises already settled (rejected) above. A late
    // `ready` emit must not throw or resolve either promise again.
    await expect(first).rejects.toBeInstanceOf(RedisNotReadyError);
    await expect(second).rejects.toBeInstanceOf(RedisNotReadyError);
  });

  it('a new caller after the last timeout gets a fresh listener and resolves on the next ready', async () => {
    vi.useFakeTimers();
    const redis = fakeRedis('connecting');
    const first = whenReady(redis, 100);
    const checkFirst = expect(first).rejects.toBeInstanceOf(RedisNotReadyError);
    await vi.advanceTimersByTimeAsync(100);
    await checkFirst;
    expect(redis.listenerCount('ready')).toBe(0);

    const onceSpy = vi.spyOn(redis, 'once');
    const second = whenReady(redis, 1_000);
    expect(onceSpy).toHaveBeenCalledTimes(1);
    expect(redis.listenerCount('ready')).toBe(1);
    redis.status = 'ready';
    redis.emit('ready');
    await expect(second).resolves.toBeUndefined();
    expect(redis.listenerCount('ready')).toBe(0);
  });

  it('bounded memory: overlapping waves of callers never grow the waiting set beyond who is in flight', async () => {
    vi.useFakeTimers();
    const redis = fakeRedis('connecting');
    const waveSize = 100;
    const waves = 10;
    let maxObserved = 0;
    const pendingPromises: Array<Promise<unknown>> = [];

    for (let wave = 0; wave < waves; wave++) {
      for (let i = 0; i < waveSize; i++) {
        const p = whenReady(redis, 50);
        pendingPromises.push(p.catch(() => undefined));
      }
      maxObserved = Math.max(maxObserved, pendingWaiterCount(redis));
      // Advance past this wave's timeout before starting the next wave, so each wave's callers
      // leave the waiting set before the next wave joins.
      await vi.advanceTimersByTimeAsync(50);
      expect(pendingWaiterCount(redis)).toBe(0);
    }

    expect(maxObserved).toBeLessThanOrEqual(waveSize);
    await Promise.all(pendingPromises);
    expect(redis.listenerCount('ready')).toBe(0);
  });
});

describe('readyCounters', () => {
  it('each take waits for ready, then delegates', async () => {
    const redis = fakeRedis('connecting');
    const ip = { tryTake: vi.fn(async () => true) };
    const addr = { tryTake: vi.fn(async () => false) };
    const counters = readyCounters(redis, { ip, addr }, 1_000);
    const p = counters.ip.tryTake('k1', 50);
    expect(ip.tryTake).not.toHaveBeenCalled();
    redis.status = 'ready';
    redis.emit('ready');
    await expect(p).resolves.toBe(true);
    await expect(counters.addr.tryTake('k2', 5)).resolves.toBe(false);
    expect(ip.tryTake).toHaveBeenCalledWith('k1', 50);
    expect(addr.tryTake).toHaveBeenCalledWith('k2', 5);
  });

  it('never calls the counter when Redis is not ready in time (fail closed)', async () => {
    vi.useFakeTimers();
    const redis = fakeRedis('connecting');
    const ip = { tryTake: vi.fn(async () => true) };
    const counters = readyCounters(redis, { ip, addr: ip });
    const check = expect(counters.ip.tryTake('k', 1)).rejects.toBeInstanceOf(RedisNotReadyError);
    await vi.advanceTimersByTimeAsync(REDIS_READY_TIMEOUT_MS);
    await check;
    expect(ip.tryTake).not.toHaveBeenCalled();
  });
});
