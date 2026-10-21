// Task 1.4: with `enableOfflineQueue: false`, ioredis rejects every command until the connection
// is `ready`. The sign-in counters wait for `ready` with a bounded timeout, then fail closed.
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readyCounters, RedisNotReadyError, REDIS_READY_TIMEOUT_MS, whenReady } from './redis-ready';

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
