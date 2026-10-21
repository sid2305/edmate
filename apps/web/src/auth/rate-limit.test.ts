import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  addressBucket,
  ADDRESS_LIMIT,
  clientIp,
  createSignInLimiter,
  hmacKey,
  ipBucket,
  IP_LIMIT,
  redisSignInCounters,
  SIGNIN_PREFIX,
  SIGNIN_WINDOW_MS,
  type SignInCounter,
  UNKNOWN_IP,
} from './rate-limit';

// Built at runtime; obviously a test value.
const SECRET = 'test-only-'.padEnd(40, 'x');

/** An in-memory counter with no window: enough to count takes per key, and it records the keys. */
function memoryCounter() {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const counter: SignInCounter = {
    tryTake(key, max) {
      keys.push(key);
      const n = counts.get(key) ?? 0;
      if (n >= max) return false;
      counts.set(key, n + 1);
      return true;
    },
  };
  return { counter, keys, counts };
}

function setup(opts: { trustHost?: boolean; limits?: { address: number; ip: number } } = {}) {
  const ip = memoryCounter();
  const addr = memoryCounter();
  const limiter = createSignInLimiter({
    secret: SECRET,
    trustHost: opts.trustHost ?? true,
    counters: { ip: ip.counter, addr: addr.counter },
    ...(opts.limits ? { limits: opts.limits } : {}),
  });
  return { limiter, ip, addr };
}

function headers(xff?: string): Headers {
  return new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff });
}

async function takes(n: number, fn: (i: number) => Promise<boolean>): Promise<boolean[]> {
  const out: boolean[] = [];
  for (let i = 0; i < n; i += 1) out.push(await fn(i));
  return out;
}

describe('limits', () => {
  it('are 5 per address and 50 per IP in a one-hour window', () => {
    expect(ADDRESS_LIMIT).toBe(5);
    expect(IP_LIMIT).toBe(50);
    expect(SIGNIN_WINDOW_MS).toBe(3_600_000);
    expect(SIGNIN_PREFIX).toBe('edmate:signin');
  });
});

describe('createSignInLimiter', () => {
  it('refuses the 6th request for one address, from different IPs', async () => {
    const { limiter } = setup();
    const results = await takes(6, (i) =>
      limiter.allow({ email: 'student1@example.test', headers: headers(`198.51.100.${i + 1}`) }),
    );
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it('folds +tags and case into one address bucket', async () => {
    const { limiter } = setup();
    const variants = [
      'student1@example.test',
      'student1+a@example.test',
      'STUDENT1@example.test',
      'Student1+b@Example.Test',
      'student1+c+d@example.test',
      'student1+e@example.test',
    ];
    const results = await takes(6, (i) => limiter.allow({ email: variants[i]!, headers: headers('198.51.100.7') }));
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it('keeps different addresses apart', async () => {
    const { limiter } = setup();
    await takes(5, () => limiter.allow({ email: 'student1@example.test', headers: headers('198.51.100.1') }));
    expect(await limiter.allow({ email: 'student2@example.test', headers: headers('198.51.100.1') })).toBe(true);
  });

  it('refuses the 51st request from one IP, any addresses', async () => {
    const { limiter } = setup();
    const results = await takes(51, (i) =>
      limiter.allow({ email: `student${i}@example.test`, headers: headers('203.0.113.9') }),
    );
    expect(results.slice(0, 50).every(Boolean)).toBe(true);
    expect(results[50]).toBe(false);
  });

  it('checks the IP first: an IP refusal never touches the address counter', async () => {
    const { limiter, addr } = setup({ limits: { address: 5, ip: 1 } });
    await limiter.allow({ email: 'student1@example.test', headers: headers('203.0.113.9') });
    expect(addr.keys).toHaveLength(1);
    expect(await limiter.allow({ email: 'student1@example.test', headers: headers('203.0.113.9') })).toBe(false);
    expect(addr.keys).toHaveLength(1);
  });

  it('counts an IPv6 /64 as one IP', async () => {
    const { limiter } = setup({ limits: { address: 100, ip: 2 } });
    expect(await limiter.allow({ email: 'a@example.test', headers: headers('2001:db8:1:2::1') })).toBe(true);
    expect(await limiter.allow({ email: 'b@example.test', headers: headers('2001:db8:1:2:ffff::9') })).toBe(true);
    expect(await limiter.allow({ email: 'c@example.test', headers: headers('2001:db8:1:2:aa:bb:cc:dd') })).toBe(false);
    expect(await limiter.allow({ email: 'd@example.test', headers: headers('2001:db8:1:3::1') })).toBe(true);
  });

  it('uses the rightmost X-Forwarded-For entry; spoofed left entries do not change the bucket', async () => {
    const { limiter } = setup({ limits: { address: 100, ip: 2 } });
    expect(await limiter.allow({ email: 'a@example.test', headers: headers('10.0.0.1, 198.51.100.4') })).toBe(true);
    expect(await limiter.allow({ email: 'b@example.test', headers: headers('10.0.0.2,198.51.100.4') })).toBe(true);
    expect(await limiter.allow({ email: 'c@example.test', headers: headers('203.0.113.1, 198.51.100.4') })).toBe(
      false,
    );
  });

  it('puts a missing, garbled or untrusted IP in one shared unknown bucket', async () => {
    const trusted = setup({ limits: { address: 100, ip: 2 } });
    expect(await trusted.limiter.allow({ email: 'a@example.test', headers: headers() })).toBe(true);
    expect(await trusted.limiter.allow({ email: 'b@example.test', headers: headers('not-an-ip') })).toBe(true);
    expect(await trusted.limiter.allow({ email: 'c@example.test', headers: headers('') })).toBe(false);

    const untrusted = setup({ trustHost: false, limits: { address: 100, ip: 2 } });
    await untrusted.limiter.allow({ email: 'a@example.test', headers: headers('198.51.100.1') });
    await untrusted.limiter.allow({ email: 'b@example.test', headers: headers('198.51.100.2') });
    expect(await untrusted.limiter.allow({ email: 'c@example.test', headers: headers('198.51.100.3') })).toBe(false);
  });

  it('passes only HMAC keys to the counters: no address or IP in plaintext', async () => {
    const { limiter, ip, addr } = setup();
    await limiter.allow({ email: 'Student1+x@example.test', headers: headers('198.51.100.23') });
    expect(ip.keys).toEqual([hmacKey(SECRET, 'ip', '198.51.100.23')]);
    expect(addr.keys).toEqual([hmacKey(SECRET, 'addr', 'student1@example.test')]);
    for (const key of [...ip.keys, ...addr.keys]) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toMatch(/student|example|198\.51/);
    }
  });

  it('lets a counter rejection propagate (fail closed)', async () => {
    const down = new Error('redis down');
    const limiter = createSignInLimiter({
      secret: SECRET,
      trustHost: true,
      counters: { ip: { tryTake: () => Promise.reject(down) }, addr: memoryCounter().counter },
    });
    await expect(limiter.allow({ email: 'a@example.test', headers: headers('198.51.100.1') })).rejects.toBe(down);
    const limiter2 = createSignInLimiter({
      secret: SECRET,
      trustHost: true,
      counters: { ip: memoryCounter().counter, addr: { tryTake: () => Promise.reject(down) } },
    });
    await expect(limiter2.allow({ email: 'a@example.test', headers: headers('198.51.100.1') })).rejects.toBe(down);
  });

  it('refuses an empty secret', () => {
    expect(() =>
      createSignInLimiter({
        secret: '',
        trustHost: true,
        counters: { ip: memoryCounter().counter, addr: memoryCounter().counter },
      }),
    ).toThrow(RangeError);
  });
});

describe('hmacKey', () => {
  it('is HMAC-SHA256(secret, kind:value) in hex, and kinds never collide', () => {
    expect(hmacKey(SECRET, 'ip', 'x')).toBe(createHmac('sha256', SECRET).update('ip:x').digest('hex'));
    expect(hmacKey(SECRET, 'ip', 'x')).not.toBe(hmacKey(SECRET, 'addr', 'x'));
    expect(hmacKey(SECRET, 'ip', 'x')).not.toBe(hmacKey(`${SECRET}y`, 'ip', 'x'));
  });
});

describe('addressBucket', () => {
  it.each([
    ['a@example.test', 'a@example.test'],
    ['A+tag@Example.TEST', 'a@example.test'],
    ['a+b+c@example.test', 'a@example.test'],
    ['+only@example.test', '+only@example.test'],
    ['  a@example.test ', 'a@example.test'],
    ['no-at-sign', 'no-at-sign'],
  ])('%j → %j', (input, expected) => {
    expect(addressBucket(input)).toBe(expected);
  });
});

describe('ipBucket', () => {
  it.each([
    ['198.51.100.7', '198.51.100.7'],
    [' 198.51.100.7 ', '198.51.100.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:0DB8:0001:0002::1', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['::', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['::ffff:198.51.100.7', '198.51.100.7'],
    ['::FFFF:198.51.100.7', '198.51.100.7'],
    ['64:ff9b::198.51.100.7', '64:ff9b:0:0::/64'],
    ['2001:db8:1:2:3:4:198.51.100.7', '2001:db8:1:2::/64'],
    ['', UNKNOWN_IP],
    ['not-an-ip', UNKNOWN_IP],
    ['198.51.100.7:443', UNKNOWN_IP],
    ['[2001:db8::1]', UNKNOWN_IP],
    ['999.1.1.1', UNKNOWN_IP],
  ])('%j → %j', (input, expected) => {
    expect(ipBucket(input)).toBe(expected);
  });

  it('maps null to unknown', () => {
    expect(ipBucket(null)).toBe(UNKNOWN_IP);
  });
});

describe('clientIp', () => {
  it('reads the rightmost entry only when the host is trusted', () => {
    expect(clientIp(headers('10.0.0.1, 198.51.100.4'), true)).toBe('198.51.100.4');
    expect(clientIp(headers('198.51.100.4'), false)).toBe(UNKNOWN_IP);
    expect(clientIp(headers(), true)).toBe(UNKNOWN_IP);
    expect(clientIp(headers('198.51.100.4,'), true)).toBe(UNKNOWN_IP);
  });
});

describe('redisSignInCounters', () => {
  /** Just enough of ioredis for redisTurnCounter: defineCommand plus the defined command. */
  function fakeRedis() {
    const calls: unknown[][] = [];
    const redis = {
      defineCommand: vi.fn((name: string) => {
        (redis as Record<string, unknown>)[name] = async (...args: unknown[]) => {
          calls.push(args);
          return 1;
        };
      }),
    };
    return { redis, calls };
  }

  it('builds two hour-window counters under edmate:signin:ip and edmate:signin:addr', async () => {
    const { redis, calls } = fakeRedis();
    const counters = redisSignInCounters(redis as never, { now: () => 1_000 });
    expect(await counters.ip.tryTake('k1', 50)).toBe(true);
    expect(await counters.addr.tryTake('k2', 5)).toBe(true);
    expect(calls.map((c) => c.slice(0, 4))).toEqual([
      ['edmate:signin:ip:k1', '3600000', '50', '1000'],
      ['edmate:signin:addr:k2', '3600000', '5', '1000'],
    ]);
  });

  it('takes a prefix override (tests)', async () => {
    const { redis, calls } = fakeRedis();
    const counters = redisSignInCounters(redis as never, { prefix: 'edmate-test-x' });
    await counters.ip.tryTake('k', 1);
    expect(String(calls[0]?.[0])).toBe('edmate-test-x:ip:k');
  });
});
