// Task 8.2f (added by the 8.2e review): a per-teacher limit on adding web links, so a teacher
// (or a compromised session) can't flood the ingest queue with link jobs. A fixed window per
// teacher, counted atomically in Redis -- a single Lua `EVAL` does `INCR` then `PEXPIRE` in one
// round trip, unlike `src/discovery/rateLimit.ts`'s two separate calls (fine for that advisory,
// fail-open limit, but not here): a crash or a slow network between a plain INCR and a later
// PEXPIRE could leave a key with no TTL, and a teacher who never adds another link would stay
// capped forever. The shape mirrors `packages/queue/src/turnLimits.ts`'s one-script pattern, but
// this file is its own: the plan keeps packages/queue unedited in this task, and a fixed window
// (not a sliding one) is enough for an abuse guard, not a quota.
//
// Unlike the discovery limiter, a store error here fails *closed* (the caller returns 503): this
// guards the ingest queue and egress, not page views, so an unreachable Redis should refuse new
// links rather than let them through unmetered.
import type { Redis } from 'ioredis';

export const LINK_RATE_LIMIT = 20;
export const LINK_RATE_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_PREFIX = 'edmate:studio:linkrate';

export interface LinkRateLimiter {
  /**
   * Records one attempt for `teacherId` and reports whether it is within the window's limit.
   * Rejects (never resolves false-as-error) when the store itself is unreachable, so the caller
   * can fail closed.
   */
  take(teacherId: string): Promise<boolean>;
}

const TAKE_COMMAND = 'edmateLinkRateTake';

/**
 * `KEYS[1]` the counter's key; `ARGV`: `windowMs`, `max`. One round trip: `INCR` the key, and on
 * its first hit in the window (`count === 1`) set its TTL in the same script, so the two can
 * never be split by a crash or a retry. A count over `max` still counts (so the window's cost is
 * stable under a burst) but is reported as refused.
 */
const TAKE_SCRIPT = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local max = tonumber(ARGV[2])
local count = redis.call('INCR', key)
if count == 1 then
  redis.call('PEXPIRE', key, windowMs)
end
if count > max then
  return 0
end
return 1
`;

interface WithTakeCommand {
  [TAKE_COMMAND](key: string, windowMs: string, max: string): Promise<number>;
}

function ensureCommand(redis: Redis): asserts redis is Redis & WithTakeCommand {
  const withCommand = redis as unknown as Record<string, unknown>;
  if (typeof withCommand[TAKE_COMMAND] === 'function') return;
  redis.defineCommand(TAKE_COMMAND, { numberOfKeys: 1, lua: TAKE_SCRIPT });
}

export interface RedisLinkRateLimiterOptions {
  limit?: number;
  windowMs?: number;
  prefix?: string;
}

/** The durable limiter, on a live `redis` connection the caller owns and closes. */
export function redisLinkRateLimiter(
  redis: Redis,
  opts: RedisLinkRateLimiterOptions = {},
): LinkRateLimiter {
  const limit = opts.limit ?? LINK_RATE_LIMIT;
  const windowMs = opts.windowMs ?? LINK_RATE_WINDOW_MS;
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  ensureCommand(redis);
  return {
    async take(teacherId) {
      const result = await redis[TAKE_COMMAND](`${prefix}:${teacherId}`, String(windowMs), String(limit));
      return result === 1;
    },
  };
}

/**
 * An in-memory fake for tests (rule 4: no real Redis in tests): the same fixed-window semantics,
 * with an injectable clock so a test can cross the window boundary without waiting on real time.
 */
export function fakeLinkRateLimiter(
  opts: { limit?: number; windowMs?: number; now?: () => number } = {},
): LinkRateLimiter {
  const limit = opts.limit ?? LINK_RATE_LIMIT;
  const windowMs = opts.windowMs ?? LINK_RATE_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async take(teacherId) {
      const t = now();
      const existing = windows.get(teacherId);
      const w = existing && existing.resetAt > t ? existing : { count: 0, resetAt: t + windowMs };
      w.count += 1;
      windows.set(teacherId, w);
      return Promise.resolve(w.count <= limit);
    },
  };
}

/** A fake that always rejects, for tests of the fail-closed path. */
export function failingLinkRateLimiter(error: unknown = new Error('redis unreachable')): LinkRateLimiter {
  return { take: () => Promise.reject(error) };
}
