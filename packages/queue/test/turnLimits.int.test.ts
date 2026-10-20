// Task 3.14 on the compose Redis: `redisTurnCounter`/`redisTurnLimits` behind the real server, so
// durability-across-connections, cross-process sharing and atomicity under concurrency can only be
// shown against the real thing (the same convention `apps/worker/test/commit.int.test.ts` uses for
// Postgres + Redis, and `packages/db`'s `*.int.test.ts` suites use for Postgres alone).
//
// Locally:
//   docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml \
//     -f apps/worker/test/compose.port.yaml up -d postgres redis
// CI provides Redis. Without it the suite skips locally and fails in CI (see `reachable` below).
import { randomBytes } from 'node:crypto';
import { MESSAGE_WINDOW_MS, RATE_LIMIT_TURNS, RATE_LIMIT_WINDOW_MS } from '@edmate/harness';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { redisTurnCounter, redisTurnLimits } from '../src/turnLimits.js';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379';
const TIMEOUT_MS = 5_000;

async function reachable(): Promise<boolean> {
  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

const up = await reachable();
if (!up && process.env.CI === 'true') {
  throw new Error('CI=true but Redis (TEST_REDIS_URL) is unreachable');
}
const SKIP = 'SKIPPED: no Redis at TEST_REDIS_URL (default 127.0.0.1:56379); see the header';
if (!up) process.stderr.write(`[@edmate/queue] turnLimits integration ${SKIP}\n`);

/** A fresh prefix per test, so suites never see one another's keys. */
function freshPrefix(): string {
  return `edmate-test-${randomBytes(4).toString('hex')}`;
}

describe.skipIf(!up)(`redisTurnCounter / redisTurnLimits on Redis${up ? '' : ` (${SKIP})`}`, () => {
  let conns: Redis[] = [];
  let admin: Redis;

  function connect(): Redis {
    const r = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    conns.push(r);
    return r;
  }

  beforeAll(() => {
    admin = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  });

  afterEach(async () => {
    // A test that simulates a restart already closed its own connection; quitting it twice
    // throws, so a connection already gone (status 'end') is just disconnected instead.
    await Promise.all(
      conns.map((c) => (c.status === 'end' ? Promise.resolve(c.disconnect()) : c.quit())),
    );
    conns = [];
  });

  afterAll(async () => {
    const keys = await admin.keys('edmate-test-*');
    if (keys.length > 0) await admin.del(...keys);
    await admin.quit();
  });

  it(
    'allows max takes per trailing window, then refuses without counting the refusal',
    async () => {
      const prefix = freshPrefix();
      let t = 1_000_000;
      const redis = connect();
      const counter = redisTurnCounter(redis, { windowMs: 1_000, prefix, now: () => t });
      expect(await counter.tryTake('k', 3)).toBe(true);
      expect(await counter.tryTake('k', 3)).toBe(true);
      expect(await counter.tryTake('k', 3)).toBe(true);
      expect(await counter.tryTake('k', 3)).toBe(false);
      expect(await counter.tryTake('k', 3)).toBe(false);
      t += 999;
      expect(await counter.tryTake('k', 3)).toBe(false);
      t += 1;
      // Exactly windowMs later the first takes have left the window.
      expect(await counter.tryTake('k', 3)).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'slides: each take expires windowMs after it was made',
    async () => {
      const prefix = freshPrefix();
      let t = 0;
      const redis = connect();
      const counter = redisTurnCounter(redis, { windowMs: 100, prefix, now: () => t });
      expect(await counter.tryTake('k', 2)).toBe(true); // t=0
      t += 50;
      expect(await counter.tryTake('k', 2)).toBe(true); // t=50
      expect(await counter.tryTake('k', 2)).toBe(false);
      t += 50; // t=100: the t=0 take expired
      expect(await counter.tryTake('k', 2)).toBe(true);
      expect(await counter.tryTake('k', 2)).toBe(false);
      t += 49; // t=149: the t=50 take is still live
      expect(await counter.tryTake('k', 2)).toBe(false);
      t += 1;
      expect(await counter.tryTake('k', 2)).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'a take at now-windowMs-1 does not count; one at now-windowMs+1 does',
    async () => {
      const prefix = freshPrefix();
      const windowMs = 1_000;
      const redis = connect();
      const counter = redisTurnCounter(redis, { windowMs, prefix, now: () => 0 });
      expect(await counter.tryTake('k', 1)).toBe(true); // the one take, at t=0
      const late = redisTurnCounter(redis, { windowMs, prefix, now: () => windowMs - 1 });
      // now - t = windowMs - 1 < windowMs: still live, so the only slot is full.
      expect(await late.tryTake('k', 1)).toBe(false);
      const after = redisTurnCounter(redis, { windowMs, prefix, now: () => windowMs + 1 });
      // now - t = windowMs + 1 > windowMs: expired, the slot is free again.
      expect(await after.tryTake('k', 1)).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'keeps keys apart',
    async () => {
      const prefix = freshPrefix();
      const redis = connect();
      const counter = redisTurnCounter(redis, { windowMs: 1_000, prefix, now: () => 0 });
      expect(await counter.tryTake('a', 1)).toBe(true);
      expect(await counter.tryTake('a', 1)).toBe(false);
      expect(await counter.tryTake('b', 1)).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'a max of 0 refuses everything; a bad max refuses too (fail closed), with no round trip',
    async () => {
      const prefix = freshPrefix();
      const redis = connect();
      const counter = redisTurnCounter(redis, { windowMs: 1_000, prefix, now: () => 0 });
      expect(await counter.tryTake('a', 0)).toBe(false);
      expect(await counter.tryTake('a', -1)).toBe(false);
      expect(await counter.tryTake('a', Number.NaN)).toBe(false);
      expect(await counter.tryTake('a', 1.5)).toBe(false);
      // No key was ever written: a later valid take still sees a clean slate.
      expect(await counter.tryTake('a', 1)).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'rejects a bad window at construction',
    () => {
      const redis = connect();
      expect(() => redisTurnCounter(redis, { windowMs: 0 })).toThrow(RangeError);
      expect(() => redisTurnCounter(redis, { windowMs: Number.NaN })).toThrow(RangeError);
    },
    TIMEOUT_MS,
  );

  it(
    'durable across a restart: a second, independent connection sees the same count',
    async () => {
      const prefix = freshPrefix();
      const first = connect();
      const counterOnFirst = redisTurnCounter(first, { windowMs: 60_000, prefix, now: () => 0 });
      expect(await counterOnFirst.tryTake('stu_1', 3)).toBe(true);
      expect(await counterOnFirst.tryTake('stu_1', 3)).toBe(true);
      expect(await counterOnFirst.tryTake('stu_1', 3)).toBe(true);
      await first.quit(); // simulates a process restart: this connection is gone.

      const second = connect(); // a fresh, independent connection to the same Redis.
      const counterOnSecond = redisTurnCounter(second, { windowMs: 60_000, prefix, now: () => 0 });
      // The budget (3) is already spent: the count survived the connection going away.
      expect(await counterOnSecond.tryTake('stu_1', 3)).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    'shared across processes: two live connections see the same, global count for one key',
    async () => {
      const prefix = freshPrefix();
      const a = redisTurnCounter(connect(), { windowMs: 60_000, prefix, now: () => 0 });
      const b = redisTurnCounter(connect(), { windowMs: 60_000, prefix, now: () => 0 });
      expect(await a.tryTake('stu_1', 2)).toBe(true);
      // b's connection sees a's take: one global count per key, not per connection.
      expect(await b.tryTake('stu_1', 2)).toBe(true);
      expect(await a.tryTake('stu_1', 2)).toBe(false);
      expect(await b.tryTake('stu_1', 2)).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    'atomic under concurrency: max + k concurrent takes on two connections grant exactly max',
    async () => {
      const prefix = freshPrefix();
      const max = 5;
      const extra = 7;
      const a = redisTurnCounter(connect(), { windowMs: 60_000, prefix, now: () => 0 });
      const b = redisTurnCounter(connect(), { windowMs: 60_000, prefix, now: () => 0 });
      const calls: Promise<boolean>[] = [];
      for (let i = 0; i < max + extra; i++) {
        calls.push(Promise.resolve((i % 2 === 0 ? a : b).tryTake('stu_race', max)));
      }
      const results = await Promise.all(calls);
      expect(results.filter(Boolean)).toHaveLength(max);
      expect(results.filter((r) => !r)).toHaveLength(extra);
    },
    TIMEOUT_MS,
  );

  it(
    'bounded memory: a key with no live takes expires from Redis (TTL set on every write)',
    async () => {
      const prefix = freshPrefix();
      const windowMs = 200; // a real (wall-clock) window: PEXPIRE runs on Redis's own clock.
      const redis = connect();
      const counter = redisTurnCounter(redis, { windowMs, prefix });
      expect(await counter.tryTake('stu_ttl', 1)).toBe(true);
      const redisKey = `${prefix}:stu_ttl`;
      const ttl = await redis.pttl(redisKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(windowMs);
      await new Promise((r) => setTimeout(r, windowMs + 300));
      expect(await redis.exists(redisKey)).toBe(0);
    },
    TIMEOUT_MS,
  );

  it(
    'a refused take is never recorded: no TTL is set and the key is untouched',
    async () => {
      const prefix = freshPrefix();
      const redis = connect();
      const counter = redisTurnCounter(redis, { windowMs: 1_000, prefix, now: () => 0 });
      expect(await counter.tryTake('stu_refuse', 1)).toBe(true);
      expect(await counter.tryTake('stu_refuse', 1)).toBe(false); // refused, not recorded
      expect(await redis.zcard(`${prefix}:stu_refuse`)).toBe(1); // still exactly one member
    },
    TIMEOUT_MS,
  );

  it(
    'redisTurnLimits: rate (10 per 60 s) and messages (a rolling 24 h window) on real Redis',
    async () => {
      const prefix = freshPrefix();
      let t = 0;
      const redis = connect();
      const limits = redisTurnLimits(redis, { prefix, now: () => t });
      expect(RATE_LIMIT_TURNS).toBe(10);
      for (let i = 0; i < 10; i++) expect(await limits.rate.tryTake('s', RATE_LIMIT_TURNS)).toBe(true);
      expect(await limits.rate.tryTake('s', RATE_LIMIT_TURNS)).toBe(false);
      expect(await limits.messages.tryTake('s:p', 1)).toBe(true);
      t += RATE_LIMIT_WINDOW_MS;
      expect(await limits.rate.tryTake('s', RATE_LIMIT_TURNS)).toBe(true);
      expect(await limits.messages.tryTake('s:p', 1)).toBe(false);
      t += MESSAGE_WINDOW_MS;
      expect(await limits.messages.tryTake('s:p', 1)).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'defaults: no prefix falls back to edmate:turnlimit; no opts/now falls back to Date.now',
    async () => {
      const redis = connect();
      const defaultCounter = redisTurnCounter(redis, { windowMs: 1_000 });
      const key = `default-${randomBytes(4).toString('hex')}`;
      try {
        expect(await defaultCounter.tryTake(key, 1)).toBe(true);
        expect(await defaultCounter.tryTake(key, 1)).toBe(false);

        const defaultLimits = redisTurnLimits(redis);
        const limitsKey = `default-limits-${randomBytes(4).toString('hex')}`;
        expect(await defaultLimits.rate.tryTake(limitsKey, 1)).toBe(true);
        expect(await defaultLimits.messages.tryTake(limitsKey, 1)).toBe(true);
      } finally {
        await admin.del(`edmate:turnlimit:${key}`);
        const limitsKey2 = await admin.keys('edmate:turnlimit:*');
        if (limitsKey2.length > 0) await admin.del(...limitsKey2);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'rate and messages never collide even when called with the same raw key',
    async () => {
      const prefix = freshPrefix();
      const redis = connect();
      const limits = redisTurnLimits(redis, { prefix, now: () => 0 });
      expect(await limits.rate.tryTake('same', 1)).toBe(true);
      // If the two counters shared one namespace this would see rate's take and refuse.
      expect(await limits.messages.tryTake('same', 1)).toBe(true);
    },
    TIMEOUT_MS,
  );
});
