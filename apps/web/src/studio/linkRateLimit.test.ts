// Task 8.2f: the per-teacher link rate limit. Rule 4 -- no real Redis here; the fake exercises
// the window semantics the Lua script promises, and a stub Redis-like object proves
// `redisLinkRateLimiter` wires the one-script command correctly without a live server (the script
// itself is exercised against real Redis only by hand/ops, same as turnLimits.ts's int test).
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import {
  LINK_RATE_LIMIT,
  failingLinkRateLimiter,
  fakeLinkRateLimiter,
  redisLinkRateLimiter,
} from './linkRateLimit';

describe('fakeLinkRateLimiter', () => {
  it('allows up to the limit per teacher, then refuses', async () => {
    const limiter = fakeLinkRateLimiter({ limit: 3, windowMs: 1000, now: () => 0 });
    expect(await limiter.take('t_1')).toBe(true);
    expect(await limiter.take('t_1')).toBe(true);
    expect(await limiter.take('t_1')).toBe(true);
    expect(await limiter.take('t_1')).toBe(false);
  });

  it('counts each teacher separately', async () => {
    const limiter = fakeLinkRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(await limiter.take('t_1')).toBe(true);
    expect(await limiter.take('t_2')).toBe(true);
    expect(await limiter.take('t_1')).toBe(false);
  });

  it('resets once the window has passed', async () => {
    let t = 0;
    const limiter = fakeLinkRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(await limiter.take('t_1')).toBe(true);
    expect(await limiter.take('t_1')).toBe(false);
    t = 1001;
    expect(await limiter.take('t_1')).toBe(true);
  });

  it('defaults to 20 per hour', async () => {
    const limiter = fakeLinkRateLimiter({ now: () => 0 });
    for (let i = 0; i < LINK_RATE_LIMIT; i += 1) expect(await limiter.take('t_1')).toBe(true);
    expect(await limiter.take('t_1')).toBe(false);
  });
});

describe('failingLinkRateLimiter', () => {
  it('rejects, so the caller can fail closed', async () => {
    const limiter = failingLinkRateLimiter(new Error('nope'));
    await expect(limiter.take('t_1')).rejects.toThrow('nope');
  });
});

describe('redisLinkRateLimiter', () => {
  function stubRedis() {
    const defined: { name: string; opts: unknown }[] = [];
    const calls: unknown[][] = [];
    let reply = 1;
    const redis = {
      defineCommand: vi.fn((name: string, opts: unknown) => {
        defined.push({ name, opts });
        (redis as unknown as Record<string, unknown>)[name] = vi.fn(
          async (...args: unknown[]) => {
            calls.push(args);
            return reply;
          },
        );
      }),
    } as unknown as Redis;
    return {
      redis,
      defined,
      calls,
      setReply: (r: number) => {
        reply = r;
      },
    };
  }

  it('defines the one-script command exactly once, even across two limiters', () => {
    const s = stubRedis();
    redisLinkRateLimiter(s.redis, { prefix: 'p' });
    redisLinkRateLimiter(s.redis, { prefix: 'p' });
    expect(s.defined).toHaveLength(1);
    expect(s.defined[0]!.opts).toMatchObject({ numberOfKeys: 1 });
  });

  it('calls the script with the namespaced key, window and limit, and reports true on 1', async () => {
    const s = stubRedis();
    const limiter = redisLinkRateLimiter(s.redis, {
      prefix: 'edmate:studio:linkrate',
      windowMs: 3_600_000,
      limit: 20,
    });
    s.setReply(1);
    await expect(limiter.take('t_asha')).resolves.toBe(true);
    expect(s.calls[0]).toEqual(['edmate:studio:linkrate:t_asha', '3600000', '20']);
  });

  it('reports false when the script returns 0 (over the limit)', async () => {
    const s = stubRedis();
    const limiter = redisLinkRateLimiter(s.redis);
    s.setReply(0);
    await expect(limiter.take('t_asha')).resolves.toBe(false);
  });
});
