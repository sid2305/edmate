// Task 9.2b. Written and red before rateLimit.ts exists (TDD). A fake store stands in for Redis
// (lessons.md / plan: no real Redis in unit tests).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISCOVERY_RATE_WINDOW_MS,
  UNKNOWN_CLIENT,
  createDiscoveryRateLimiter,
  discoveryClientBucket,
  discoveryRateLimiter,
  redisRateLimitStore,
  resetDiscoveryRateLimiter,
  type RateLimitStore,
} from './rateLimit';

function headersOf(value: string | null): { get(name: string): string | null } {
  return { get: (name) => (name === 'x-forwarded-for' ? value : null) };
}

describe('discoveryClientBucket', () => {
  it('takes the first entry of x-forwarded-for', () => {
    expect(discoveryClientBucket(headersOf('1.2.3.4, 5.6.7.8'))).toBe('1.2.3.4');
  });

  it('trims the first entry', () => {
    expect(discoveryClientBucket(headersOf(' 1.2.3.4 , 5.6.7.8'))).toBe('1.2.3.4');
  });

  it('falls back to the shared unknown bucket when the header is missing', () => {
    expect(discoveryClientBucket(headersOf(null))).toBe(UNKNOWN_CLIENT);
  });

  it('falls back to the shared unknown bucket when the first entry is not an IP', () => {
    expect(discoveryClientBucket(headersOf('not-an-ip, 5.6.7.8'))).toBe(UNKNOWN_CLIENT);
    expect(discoveryClientBucket(headersOf(''))).toBe(UNKNOWN_CLIENT);
  });

  it('accepts an IPv6 first entry', () => {
    expect(discoveryClientBucket(headersOf('::1'))).toBe('::1');
  });
});

function fakeStore(): RateLimitStore & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async increment(key) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
}

describe('createDiscoveryRateLimiter', () => {
  it('allows requests at or under the limit', async () => {
    const store = fakeStore();
    const limiter = createDiscoveryRateLimiter({ store, limit: 2 });
    const headers = headersOf('1.1.1.1');
    expect(await limiter.allow(headers)).toBe(true);
    expect(await limiter.allow(headers)).toBe(true);
  });

  it('refuses once the window is over the limit', async () => {
    const store = fakeStore();
    const limiter = createDiscoveryRateLimiter({ store, limit: 2 });
    const headers = headersOf('1.1.1.1');
    await limiter.allow(headers);
    await limiter.allow(headers);
    expect(await limiter.allow(headers)).toBe(false);
  });

  it('counts each client bucket separately', async () => {
    const store = fakeStore();
    const limiter = createDiscoveryRateLimiter({ store, limit: 1 });
    expect(await limiter.allow(headersOf('1.1.1.1'))).toBe(true);
    expect(await limiter.allow(headersOf('2.2.2.2'))).toBe(true);
    expect(await limiter.allow(headersOf('1.1.1.1'))).toBe(false);
  });

  it('passes the configured window through to the store', async () => {
    const store = fakeStore();
    const spy = vi.spyOn(store, 'increment');
    const limiter = createDiscoveryRateLimiter({ store, windowMs: 5000 });
    await limiter.allow(headersOf('1.1.1.1'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('1.1.1.1'), 5000);
  });

  it('fails open on a store error, and logs a code only, never the IP', async () => {
    const error = new Error('boom');
    const store: RateLimitStore = { increment: () => Promise.reject(error) };
    const onStoreError = vi.fn();
    const limiter = createDiscoveryRateLimiter({ store, onStoreError });
    expect(await limiter.allow(headersOf('9.9.9.9'))).toBe(true);
    expect(onStoreError).toHaveBeenCalledWith(error);
    // The error object carries no IP; callers only ever pass its name/message to a log.
    expect(String(onStoreError.mock.calls[0]?.[0])).not.toContain('9.9.9.9');
  });

  it('defaults to the documented window', async () => {
    const store = fakeStore();
    const spy = vi.spyOn(store, 'increment');
    const limiter = createDiscoveryRateLimiter({ store });
    await limiter.allow(headersOf('1.1.1.1'));
    expect(spy).toHaveBeenCalledWith(expect.any(String), DISCOVERY_RATE_WINDOW_MS);
  });
});

describe('redisRateLimitStore', () => {
  it('increments and sets the window to expire only on the first hit', async () => {
    const calls: string[] = [];
    const redis = {
      incr: vi.fn(async (key: string) => {
        calls.push(`incr:${key}`);
        return calls.filter((c) => c === `incr:${key}`).length;
      }),
      pexpire: vi.fn(async (key: string, ms: number) => {
        calls.push(`pexpire:${key}:${ms}`);
        return 1;
      }),
    };
    const store = redisRateLimitStore(redis as never);
    expect(await store.increment('k', 1000)).toBe(1);
    expect(redis.pexpire).toHaveBeenCalledWith('k', 1000);
    expect(await store.increment('k', 1000)).toBe(2);
    expect(redis.pexpire).toHaveBeenCalledTimes(1);
  });
});

describe('discoveryRateLimiter (lazy singleton)', () => {
  afterEach(() => {
    resetDiscoveryRateLimiter();
  });

  it('fails open with no REDIS_URL, attempting no connection', async () => {
    const limiter = discoveryRateLimiter({});
    expect(await limiter.allow(headersOf('1.1.1.1'))).toBe(true);
  });

  it('memoises the limiter across calls', () => {
    const a = discoveryRateLimiter({});
    const b = discoveryRateLimiter({});
    expect(a).toBe(b);
  });
});
