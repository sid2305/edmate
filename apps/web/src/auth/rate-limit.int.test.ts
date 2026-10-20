// Task 1.4: the sign-in limiter on 3.14's `redisTurnCounter` against the real compose/CI Redis.
// Both limits must hold across two connections (two web processes), and Redis must hold no
// plaintext address or IP.
//
// Locally:
//   docker compose -f docker/compose.yaml -f apps/worker/test/compose.port.yaml up -d redis
// CI provides Redis. Without it the suite skips locally and fails in CI (the 3.14 pattern).
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADDRESS_LIMIT, createSignInLimiter, IP_LIMIT, redisSignInCounters } from './rate-limit';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379';
const SECRET = 'test-only-'.padEnd(40, 'x');

async function reachable(): Promise<boolean> {
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
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
if (!up) process.stderr.write(`[@edmate/web] sign-in rate-limit integration ${SKIP}\n`);

describe.skipIf(!up)(`sign-in limiter on Redis${up ? '' : ` (${SKIP})`}`, () => {
  const conns: Redis[] = [];
  let admin: Redis;

  /** The production connection options; with no offline queue, wait for `ready` before use. */
  async function limiterOn(prefix: string) {
    const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    conns.push(redis);
    if (redis.status !== 'ready') await new Promise((resolve) => redis.once('ready', resolve));
    return createSignInLimiter({
      secret: SECRET,
      trustHost: true,
      counters: redisSignInCounters(redis, { prefix }),
    });
  }

  async function keysUnder(prefix: string): Promise<string[]> {
    return admin.keys(`${prefix}:*`);
  }

  beforeAll(async () => {
    admin = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
    await admin.ping();
  });

  afterAll(async () => {
    await Promise.all(conns.map((c) => c.quit()));
    await admin.quit();
  });

  const fresh = () => `edmate-test-signin-${randomBytes(4).toString('hex')}`;
  const xff = (ip: string) => new Headers({ 'x-forwarded-for': ip });

  it('holds the per-address limit across two connections', async () => {
    const prefix = fresh();
    const a = await limiterOn(prefix);
    const b = await limiterOn(prefix);
    const results: boolean[] = [];
    for (let i = 0; i < ADDRESS_LIMIT + 1; i += 1) {
      const limiter = i % 2 === 0 ? a : b;
      results.push(await limiter.allow({ email: `student1+${i}@example.test`, headers: xff(`198.51.100.${i + 1}`) }));
    }
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it('holds the per-IP limit across two connections, including concurrent takes', async () => {
    const prefix = fresh();
    const a = await limiterOn(prefix);
    const b = await limiterOn(prefix);
    const results = await Promise.all(
      Array.from({ length: IP_LIMIT + 10 }, (_, i) =>
        (i % 2 === 0 ? a : b).allow({ email: `student${i}@example.test`, headers: xff('203.0.113.9') }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(IP_LIMIT);
  });

  it('stores only HMAC keys: no address or IP in Redis keys or members', async () => {
    const prefix = fresh();
    const limiter = await limiterOn(prefix);
    await limiter.allow({ email: 'student7@example.test', headers: xff('198.51.100.77') });
    const keys = await keysUnder(prefix);
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatch(new RegExp(`^${prefix}:(ip|addr):[0-9a-f]{64}$`));
      const members = await admin.zrange(key, '0', '-1');
      expect(members.join()).not.toMatch(/student|example|198\.51/);
      expect(await admin.pttl(key)).toBeGreaterThan(3_500_000);
    }
  });

  it('fails closed (rejects) when Redis is unreachable', async () => {
    const dead = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    const limiter = createSignInLimiter({ secret: SECRET, trustHost: true, counters: redisSignInCounters(dead) });
    await expect(limiter.allow({ email: 'a@example.test', headers: xff('198.51.100.1') })).rejects.toThrow();
    dead.disconnect();
  });
});
