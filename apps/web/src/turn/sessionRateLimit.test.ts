// Task 9.4a Phase A: the per-student session-start limit. Rule 4 -- no real Redis here; the fake
// exercises the fixed-window semantics the Lua script promises, and a stub Redis-like object proves
// `redisSessionRateLimiter` wires the one-script command without a live server.
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import {
  SESSION_START_LIMIT,
  SESSION_START_WINDOW_MS,
  failingSessionRateLimiter,
  fakeSessionRateLimiter,
  redisSessionRateLimiter,
} from './sessionRateLimit';

describe('session start limit defaults', () => {
  it('is 20 starts per 10 minutes', () => {
    expect(SESSION_START_LIMIT).toBe(20);
    expect(SESSION_START_WINDOW_MS).toBe(10 * 60_000);
  });
});

describe('fakeSessionRateLimiter', () => {
  it('allows up to the limit per student, then refuses', async () => {
    const limiter = fakeSessionRateLimiter({ limit: 3, windowMs: 1000, now: () => 0 });
    for (let i = 0; i < 3; i += 1) expect(await limiter.take('stu_1')).toBe(true);
    expect(await limiter.take('stu_1')).toBe(false);
    expect(await limiter.take('stu_1')).toBe(false);
  });

  it('counts each student separately', async () => {
    const limiter = fakeSessionRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(await limiter.take('stu_1')).toBe(true);
    expect(await limiter.take('stu_2')).toBe(true);
    expect(await limiter.take('stu_1')).toBe(false);
    expect(await limiter.take('stu_2')).toBe(false);
  });

  it('stays capped until the window ends, then resets', async () => {
    let t = 0;
    const limiter = fakeSessionRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(await limiter.take('stu_1')).toBe(true);
    t = 999;
    expect(await limiter.take('stu_1')).toBe(false);
    t = 1000;
    expect(await limiter.take('stu_1')).toBe(true);
  });

  it('defaults to 20 per 10 minutes', async () => {
    let t = 0;
    const limiter = fakeSessionRateLimiter({ now: () => t });
    for (let i = 0; i < SESSION_START_LIMIT; i += 1) expect(await limiter.take('stu_1')).toBe(true);
    expect(await limiter.take('stu_1')).toBe(false);
    t = SESSION_START_WINDOW_MS;
    expect(await limiter.take('stu_1')).toBe(true);
  });

  it('uses the real clock when none is given', async () => {
    const limiter = fakeSessionRateLimiter({ limit: 1 });
    expect(await limiter.take('stu_1')).toBe(true);
    expect(await limiter.take('stu_1')).toBe(false);
  });
});

describe('failingSessionRateLimiter', () => {
  it('rejects, so the caller can fail closed', async () => {
    await expect(failingSessionRateLimiter(new Error('nope')).take('stu_1')).rejects.toThrow('nope');
    await expect(failingSessionRateLimiter().take('stu_1')).rejects.toThrow('redis unreachable');
  });
});

describe('redisSessionRateLimiter', () => {
  function stubRedis() {
    const defined: { name: string; opts: unknown }[] = [];
    const calls: unknown[][] = [];
    let reply: unknown = 1;
    const redis = {
      defineCommand: vi.fn((name: string, opts: unknown) => {
        defined.push({ name, opts });
        (redis as unknown as Record<string, unknown>)[name] = vi.fn(async (...args: unknown[]) => {
          calls.push(args);
          if (reply instanceof Error) throw reply;
          return reply;
        });
      }),
    } as unknown as Redis;
    return {
      redis,
      defined,
      calls,
      setReply: (r: unknown) => {
        reply = r;
      },
    };
  }

  it('defines the one-script command exactly once, even across two limiters', () => {
    const s = stubRedis();
    redisSessionRateLimiter(s.redis);
    redisSessionRateLimiter(s.redis);
    expect(s.defined).toHaveLength(1);
    expect(s.defined[0]!.opts).toMatchObject({ numberOfKeys: 1 });
    expect((s.defined[0]!.opts as { lua: string }).lua).toMatch(/INCR[\s\S]*PEXPIRE/);
  });

  it('calls the script with the default namespaced key, window and limit; 1 is allowed', async () => {
    const s = stubRedis();
    const limiter = redisSessionRateLimiter(s.redis);
    await expect(limiter.take('stu_1')).resolves.toBe(true);
    expect(s.calls[0]).toEqual(['edmate:turn:sessionstart:stu_1', '600000', '20']);
  });

  it('honours custom options', async () => {
    const s = stubRedis();
    const limiter = redisSessionRateLimiter(s.redis, { prefix: 'p', windowMs: 5, limit: 2 });
    await limiter.take('stu_2');
    expect(s.calls[0]).toEqual(['p:stu_2', '5', '2']);
  });

  it('reports false when the script returns 0 (over the limit)', async () => {
    const s = stubRedis();
    const limiter = redisSessionRateLimiter(s.redis);
    s.setReply(0);
    await expect(limiter.take('stu_1')).resolves.toBe(false);
  });

  it('rejects when Redis fails, so the caller fails closed', async () => {
    const s = stubRedis();
    const limiter = redisSessionRateLimiter(s.redis);
    s.setReply(new Error('ECONNREFUSED'));
    await expect(limiter.take('stu_1')).rejects.toThrow('ECONNREFUSED');
  });
});
