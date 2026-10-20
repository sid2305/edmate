// Sign-in link rate limits (task 1.4): per client IP and per address, checked before any token or
// mail exists. Counting runs on 3.14's Redis sliding window (`redisTurnCounter`); keys are HMACs
// of the bucket, so Redis never holds a plaintext address or IP.
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { redisTurnCounter } from '@edmate/queue';
import type { Redis } from 'ioredis';

/** Requests per address per window. */
export const ADDRESS_LIMIT = 5;
/** Requests per client IP per window: generous, because a classroom often shares one NAT IP. */
export const IP_LIMIT = 50;
export const SIGNIN_WINDOW_MS = 60 * 60 * 1000;
export const SIGNIN_PREFIX = 'edmate:signin';
/** The one shared bucket for a missing, unparseable or untrusted client IP (fails toward limiting). */
export const UNKNOWN_IP = 'unknown';

/** The counter shape `redisTurnCounter` implements (`TurnCounter` from @edmate/harness). */
export interface SignInCounter {
  tryTake(key: string, max: number): boolean | Promise<boolean>;
}

export interface SignInCounters {
  ip: SignInCounter;
  addr: SignInCounter;
}

export interface SignInLimits {
  address: number;
  ip: number;
}

export interface HeaderReader {
  get(name: string): string | null;
}

export interface SignInLimiter {
  /** False when either limit is reached; rejects if a counter does (the caller fails closed). */
  allow(input: { email: string; headers: HeaderReader }): Promise<boolean>;
}

/** HMAC-SHA256(secret, `kind:value`) in hex. */
export function hmacKey(secret: string, kind: 'ip' | 'addr', value: string): string {
  return createHmac('sha256', secret).update(`${kind}:${value}`).digest('hex');
}

/** The address counted: trimmed, lower-cased, `+tag` dropped from the local part. */
export function addressBucket(email: string): string {
  const normal = email.trim().toLowerCase();
  const at = normal.lastIndexOf('@');
  if (at < 0) return normal;
  const local = normal.slice(0, at);
  const base = local.split('+')[0] as string;
  return `${base === '' ? local : base}${normal.slice(at)}`;
}

/** The 8 groups of an address `isIP` already accepted as IPv6 (no zone). */
function ipv6Groups(ip: string): number[] {
  let text = ip;
  // An embedded dotted IPv4 tail (`::ffff:1.2.3.4`) becomes two hex groups.
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const [a, b, c, d] = last.split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((g) => parseInt(g, 16)));
  const [head, rest] = text.split('::') as [string, string | undefined];
  if (rest === undefined) return parse(head);
  const left = parse(head);
  const right = parse(rest);
  return [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
}

/** IPv4 as is; IPv6 cut to its /64 (IPv4-mapped IPv6 counts as the IPv4); anything else `unknown`. */
export function ipBucket(raw: string | null): string {
  const ip = (raw ?? '').trim();
  const zoneless = ip.split('%')[0] as string;
  const version = isIP(zoneless);
  if (version === 4) return zoneless;
  if (version !== 6) return UNKNOWN_IP;
  const groups = ipv6Groups(zoneless.toLowerCase());
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    const [hi, lo] = [groups[6] as number, groups[7] as number];
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/**
 * The client IP bucket. Behind Caddy (`trustHost`), the rightmost `X-Forwarded-For` entry is the
 * peer Caddy saw; entries to its left come from the client and are ignored. Untrusted, missing or
 * unparseable → `unknown`.
 */
export function clientIp(headers: HeaderReader, trustHost: boolean): string {
  if (!trustHost) return UNKNOWN_IP;
  const header = headers.get('x-forwarded-for');
  if (header === null) return UNKNOWN_IP;
  const entries = header.split(',');
  return ipBucket(entries[entries.length - 1] as string);
}

export interface SignInLimiterOptions {
  /** AUTH_SECRET: keys the HMAC. */
  secret: string;
  trustHost: boolean;
  counters: SignInCounters;
  limits?: SignInLimits;
}

/** Checks the IP first, then the address. A refusal by the second does not refund the first. */
export function createSignInLimiter(opts: SignInLimiterOptions): SignInLimiter {
  if (opts.secret === '') throw new RangeError('the sign-in limiter needs a secret');
  const limits = opts.limits ?? { address: ADDRESS_LIMIT, ip: IP_LIMIT };
  return {
    async allow({ email, headers }) {
      const ipKey = hmacKey(opts.secret, 'ip', clientIp(headers, opts.trustHost));
      if (!(await opts.counters.ip.tryTake(ipKey, limits.ip))) return false;
      const addrKey = hmacKey(opts.secret, 'addr', addressBucket(email));
      return opts.counters.addr.tryTake(addrKey, limits.address);
    },
  };
}

/** The two one-hour counters on `redis` (a connection the caller owns), under `edmate:signin`. */
export function redisSignInCounters(
  redis: Redis,
  opts: { prefix?: string; now?: () => number } = {},
): SignInCounters {
  const prefix = opts.prefix ?? SIGNIN_PREFIX;
  const common = { windowMs: SIGNIN_WINDOW_MS, ...(opts.now === undefined ? {} : { now: opts.now }) };
  return {
    ip: redisTurnCounter(redis, { ...common, prefix: `${prefix}:ip` }),
    addr: redisTurnCounter(redis, { ...common, prefix: `${prefix}:addr` }),
  };
}
