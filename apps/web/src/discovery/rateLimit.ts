// Task 9.2b: request-level rate limiting on the public /teachers pages (deferred from the 9.2a
// security review). A fixed window per client IP, about 60 requests a minute, counted in Redis
// the same way `src/turn/runtime.ts` and `src/studio/runtime.ts` already do -- a lazily built
// `ioredis` client on `REDIS_URL`, never a client borrowed from `src/auth/**` (no client is
// exported out of that module; see the task handoff's Decisions for why this stays a read-only
// import of the sign-in limiter's own Redis-via-REDIS_URL pattern, not its connection object).
//
// Unlike the sign-in limiter (`src/auth/rate-limit.ts`), which fails closed, this limit protects
// database load on data that is already public and already published: a Redis outage fails OPEN
// (the page still serves) and is logged by code only, never the client's IP (lead decision, 22
// Oct 2026, risk: medium -- see the handoff).
import { isIP } from 'node:net';
import { Redis } from 'ioredis';

/** Requests allowed per client bucket per window. */
export const DISCOVERY_RATE_LIMIT = 60;
export const DISCOVERY_RATE_WINDOW_MS = 60_000;
export const DISCOVERY_RATE_PREFIX = 'edmate:discovery:rl';
/** The one shared bucket for a missing or unparseable client IP (fails toward limiting). */
export const UNKNOWN_CLIENT = 'unknown';

export interface HeaderReader {
  get(name: string): string | null;
}

export interface RateLimitStore {
  /** The count after incrementing `key`'s fixed window; the window expires on its first hit. */
  increment(key: string, windowMs: number): Promise<number>;
}

export interface DiscoveryRateLimiter {
  /** False only when the store is reachable and the window's count is over the limit. */
  allow(headers: HeaderReader): Promise<boolean>;
}

/**
 * The first `x-forwarded-for` entry (the brief's choice; the sign-in limiter instead trusts the
 * rightmost, proxy-appended entry, because that one is security-enforcing and this one is not).
 * Missing, or not a bare IP literal, goes to the shared `unknown` bucket.
 */
export function discoveryClientBucket(headers: HeaderReader): string {
  const header = headers.get('x-forwarded-for');
  if (header === null) return UNKNOWN_CLIENT;
  const first = (header.split(',')[0] ?? '').trim();
  return isIP(first) === 0 ? UNKNOWN_CLIENT : first;
}

/** Error name only (never the message or cause): they can quote a host or, here, an IP. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'non-error';
}

export interface DiscoveryRateLimiterOptions {
  store: RateLimitStore;
  limit?: number;
  windowMs?: number;
  prefix?: string;
  /** Called, code only, when the store rejects; the limiter then fails open (returns true). */
  onStoreError?: (error: unknown) => void;
}

/** A fixed-window limiter over `store`; a store failure fails open (see module doc above). */
export function createDiscoveryRateLimiter(opts: DiscoveryRateLimiterOptions): DiscoveryRateLimiter {
  const limit = opts.limit ?? DISCOVERY_RATE_LIMIT;
  const windowMs = opts.windowMs ?? DISCOVERY_RATE_WINDOW_MS;
  const prefix = opts.prefix ?? DISCOVERY_RATE_PREFIX;
  return {
    async allow(headers) {
      const bucket = discoveryClientBucket(headers);
      try {
        const count = await opts.store.increment(`${prefix}:${bucket}`, windowMs);
        return count <= limit;
      } catch (error) {
        opts.onStoreError?.(error);
        return true;
      }
    },
  };
}

/** Plain `INCR`/`PEXPIRE`: the simplest correct fixed window for an advisory, non-security limit. */
export function redisRateLimitStore(redis: Redis): RateLimitStore {
  return {
    async increment(key, windowMs) {
      const count = await redis.incr(key);
      if (count === 1) await redis.pexpire(key, windowMs);
      return count;
    },
  };
}

let limiter: DiscoveryRateLimiter | undefined;

/**
 * The lazily built, process-wide limiter. No `REDIS_URL` fails open immediately -- no connection
 * is ever attempted -- matching the "protects DB load, not a security boundary" decision. Built
 * once; `resetDiscoveryRateLimiter` is for tests only.
 */
export function discoveryRateLimiter(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DiscoveryRateLimiter {
  if (limiter) return limiter;
  const url = env.REDIS_URL?.trim();
  if (!url) {
    limiter = { allow: () => Promise.resolve(true) };
    return limiter;
  }
  const redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on('error', (error: unknown) => console.error(`[discovery] redis ${errorName(error)}`));
  limiter = createDiscoveryRateLimiter({
    store: redisRateLimitStore(redis),
    onStoreError: (error) => console.error(`[discovery] rate_limit_unavailable ${errorName(error)}`),
  });
  return limiter;
}

/** Test-only: clears the process-wide singleton so the next call rebuilds it. */
export function resetDiscoveryRateLimiter(): void {
  limiter = undefined;
}
