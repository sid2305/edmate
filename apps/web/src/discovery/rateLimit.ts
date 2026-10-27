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

/** Connect/command timeouts so a Redis outage fails open in milliseconds, not ~10 s (9.2e item 6). */
const REDIS_CONNECT_TIMEOUT_MS = 1000;
const REDIS_COMMAND_TIMEOUT_MS = 1000;

const TAKE_COMMAND = 'edmateDiscoveryRateLimitTake';

/**
 * `KEYS[1]` the bucket's key; `ARGV`: `windowMs`. One atomic `EVAL` for `INCR` then, only on the
 * first hit, `PEXPIRE` -- mirrors `packages/queue/src/turnLimits.ts`'s Lua-script pattern (no
 * `redis.call('TIME')`, the fixed-window algorithm itself is unchanged) so a crash or a slow tick
 * between two separate round trips can never leave the key with no TTL.
 */
const TAKE_SCRIPT = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local count = redis.call('INCR', key)
if count == 1 then
  redis.call('PEXPIRE', key, windowMs)
end
return count
`;

interface WithTakeCommand {
  [TAKE_COMMAND](key: string, windowMs: string): Promise<number>;
}

/** Defines the Lua command on `redis` once (idempotent: ioredis just reassigns on a repeat call). */
function ensureCommand(redis: Redis): asserts redis is Redis & WithTakeCommand {
  const withCommand = redis as unknown as Record<string, unknown>;
  if (typeof withCommand[TAKE_COMMAND] === 'function') return;
  redis.defineCommand(TAKE_COMMAND, { numberOfKeys: 1, lua: TAKE_SCRIPT });
}

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
 * The rightmost `x-forwarded-for` entry, exactly like the sign-in limiter's `clientIp`
 * (`src/auth/rate-limit.ts`): behind Caddy that entry is the peer Caddy saw; entries to its left
 * come from the client and are ignored, so rotating a fake first entry can't mint new buckets
 * (9.2b fix round, security review HIGH). The logic is mirrored rather than imported so this
 * module doesn't pull in the sign-in limiter's queue dependency. Missing, empty, or not a bare IP
 * literal goes to the shared `unknown` bucket.
 */
export function discoveryClientBucket(headers: HeaderReader): string {
  const header = headers.get('x-forwarded-for');
  if (header === null) return UNKNOWN_CLIENT;
  const entries = header.split(',');
  const last = (entries[entries.length - 1] ?? '').trim();
  return isIP(last) === 0 ? UNKNOWN_CLIENT : last;
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
export function createDiscoveryRateLimiter(
  opts: DiscoveryRateLimiterOptions,
): DiscoveryRateLimiter {
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

/**
 * One atomic `EVAL` (`INCR` plus a conditional `PEXPIRE` on the first hit) -- see `TAKE_SCRIPT`
 * above. Still the simplest correct fixed window for an advisory, non-security limit; only the
 * two-round-trip race is removed.
 */
export function redisRateLimitStore(redis: Redis): RateLimitStore {
  ensureCommand(redis);
  return {
    async increment(key, windowMs) {
      return redis[TAKE_COMMAND](key, String(windowMs));
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
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
  });
  redis.on('error', (error: unknown) => console.error(`[discovery] redis ${errorName(error)}`));
  limiter = createDiscoveryRateLimiter({
    store: redisRateLimitStore(redis),
    onStoreError: (error) =>
      console.error(`[discovery] rate_limit_unavailable ${errorName(error)}`),
  });
  return limiter;
}

/** Test-only: clears the process-wide singleton so the next call rebuilds it. */
export function resetDiscoveryRateLimiter(): void {
  limiter = undefined;
}
