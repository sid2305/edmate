// Task 9.2b. Written and red before rateLimit.ts exists (TDD). A fake store stands in for Redis
// (lessons.md / plan: no real Redis in unit tests).
import { afterEach, describe, expect, it, vi } from 'vitest';

// 9.2e item 6: a mocked `ioredis` constructor so the "no hang on a Redis outage" assertion can
// check the options object passed to `new Redis(...)`, without ever opening a real connection.
const redisCtor = vi.hoisted(() => vi.fn());
vi.mock('ioredis', () => ({
  Redis: class {
    constructor(...args: unknown[]) {
      redisCtor(...args);
    }
    on() {
      // no-op: the real client's error listener is irrelevant here.
    }
    defineCommand(name: string, _opts: unknown) {
      void _opts;
      (this as unknown as Record<string, unknown>)[name] = () => Promise.resolve(1);
    }
  },
}));

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
  // 9.2b fix round (security review HIGH): Caddy appends the real peer IP, so only the rightmost
  // x-forwarded-for entry is trustworthy; entries to its left are client-controlled.
  it('takes the rightmost (proxy-appended) entry of x-forwarded-for', () => {
    expect(discoveryClientBucket(headersOf('1.2.3.4, 5.6.7.8'))).toBe('5.6.7.8');
  });

  it('puts "<fake>, <real>" in the same bucket as "<real>" alone', () => {
    expect(discoveryClientBucket(headersOf('9.9.9.9, 5.6.7.8'))).toBe(
      discoveryClientBucket(headersOf('5.6.7.8')),
    );
  });

  it('trims the rightmost entry', () => {
    expect(discoveryClientBucket(headersOf('1.2.3.4 ,  5.6.7.8 '))).toBe('5.6.7.8');
  });

  it('falls back to the shared unknown bucket when the header is missing', () => {
    expect(discoveryClientBucket(headersOf(null))).toBe(UNKNOWN_CLIENT);
  });

  it('falls back to the shared unknown bucket when the rightmost entry is empty or not an IP', () => {
    expect(discoveryClientBucket(headersOf(''))).toBe(UNKNOWN_CLIENT);
    expect(discoveryClientBucket(headersOf('5.6.7.8, not-an-ip'))).toBe(UNKNOWN_CLIENT);
    expect(discoveryClientBucket(headersOf('5.6.7.8,'))).toBe(UNKNOWN_CLIENT);
  });

  it('ignores a non-IP fake first entry when the rightmost entry is a real IP', () => {
    expect(discoveryClientBucket(headersOf('not-an-ip, 5.6.7.8'))).toBe('5.6.7.8');
  });

  it('accepts an IPv6 rightmost entry', () => {
    expect(discoveryClientBucket(headersOf('1.2.3.4, ::1'))).toBe('::1');
  });
});

describe('rotating the fake first x-forwarded-for entry', () => {
  it('does not create new buckets, so the limit still applies', async () => {
    const store = fakeStore();
    const limiter = createDiscoveryRateLimiter({ store, limit: 3 });
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await limiter.allow(headersOf(`10.0.0.${i}, 5.6.7.8`)));
    }
    expect(results).toEqual([true, true, true, false, false]);
    expect(store.counts.size).toBe(1);
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
  // 9.2e item 6: INCR+PEXPIRE is now one atomic EVAL, not two separate round trips, so a store
  // that only simulates a single Redis command (the defined Lua command) exercises the real
  // "no gap between count and TTL" guarantee, not just two calls happening to run in order.
  function fakeEvalRedis() {
    let defined: ((key: string, windowMs: string) => Promise<number> | number) | undefined;
    const ttls = new Map<string, number>();
    const counts = new Map<string, number>();
    const redis: Record<string, unknown> = {
      defineCommand: vi.fn((name: string, opts: { lua: string }) => {
        expect(opts.lua).toContain('INCR');
        expect(opts.lua).toContain('PEXPIRE');
        defined = (key: string, windowMs: string) => {
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          if (count === 1) ttls.set(key, Number(windowMs));
          return count;
        };
        redis[name] = defined;
      }),
    };
    return { redis, ttls, counts };
  }

  it('increments and sets the window to expire only on the first hit, via one atomic command', async () => {
    const { redis, ttls } = fakeEvalRedis();
    const store = redisRateLimitStore(redis as never);
    expect(await store.increment('k', 1000)).toBe(1);
    expect(ttls.get('k')).toBe(1000);
    expect(await store.increment('k', 1000)).toBe(2);
    expect(ttls.size).toBe(1);
  });

  it('defines the Lua command only once even across repeat calls', async () => {
    const { redis } = fakeEvalRedis();
    redisRateLimitStore(redis as never);
    redisRateLimitStore(redis as never);
    expect(
      (redis as { defineCommand: ReturnType<typeof vi.fn> }).defineCommand,
    ).toHaveBeenCalledTimes(1);
  });

  it('two near-simultaneous increments on the same key still set the TTL exactly once', async () => {
    const { redis, ttls } = fakeEvalRedis();
    const store = redisRateLimitStore(redis as never);
    const [a, b] = await Promise.all([store.increment('k', 1000), store.increment('k', 1000)]);
    expect([a, b].sort()).toEqual([1, 2]);
    expect(ttls.size).toBe(1);
  });
});

describe('discoveryRateLimiter (lazy singleton) Redis options', () => {
  afterEach(() => {
    resetDiscoveryRateLimiter();
    redisCtor.mockClear();
  });

  it('passes connectTimeout and commandTimeout so a store failure cannot hang ~10s before failing open', () => {
    discoveryRateLimiter({ REDIS_URL: 'redis://localhost:6379' });
    expect(redisCtor).toHaveBeenCalledWith(
      'redis://localhost:6379',
      expect.objectContaining({
        connectTimeout: expect.any(Number),
        commandTimeout: expect.any(Number),
      }),
    );
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
