// Task 9.4a (Phase A): a per-student limit on starting new chat sessions, so a student (or a
// compromised session) can't flood the sessions table and the agent behind it. A fixed window per
// student, counted atomically in Redis: one Lua `EVAL` does `INCR` then `PEXPIRE` in a single round
// trip, so a crash between the two can never leave a key with no TTL (a student capped forever).
// The shape mirrors `src/studio/linkRateLimit.ts`, but this file is its own (the plan keeps the two
// guards independent).
//
// A store error fails *closed*: `take` rejects and the route refuses the start (503). This guards
// real session-row creation and the agent calls that follow, not a page view.
//
// This is not the per-message limit inside a session (`packages/queue/src/turnLimits.ts`); that one
// is unchanged.
import type { Redis } from 'ioredis';

/** Session starts allowed per student per window (lead answer, 22 Oct 2026). */
export const SESSION_START_LIMIT = 20;
/** The fixed window, in milliseconds: 10 minutes. */
export const SESSION_START_WINDOW_MS = 10 * 60_000;
const DEFAULT_PREFIX = 'edmate:turn:sessionstart';

export interface SessionRateLimiter {
  /**
   * Records one session start for `studentId` and reports whether it is within the window's limit.
   * Rejects when the store itself is unreachable, so the caller can fail closed.
   */
  take(studentId: string): Promise<boolean>;
}

const TAKE_COMMAND = 'edmateSessionStartTake';

/**
 * `KEYS[1]` the counter's key; `ARGV`: `windowMs`, `max`. `INCR` the key and, on its first hit in
 * the window, set its TTL in the same script. A count over `max` still counts but is refused.
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

export interface RedisSessionRateLimiterOptions {
  limit?: number;
  windowMs?: number;
  prefix?: string;
}

/** The durable limiter, on a live `redis` connection the caller owns and closes. */
export function redisSessionRateLimiter(
  redis: Redis,
  opts: RedisSessionRateLimiterOptions = {},
): SessionRateLimiter {
  const limit = opts.limit ?? SESSION_START_LIMIT;
  const windowMs = opts.windowMs ?? SESSION_START_WINDOW_MS;
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  ensureCommand(redis);
  return {
    async take(studentId) {
      const result = await redis[TAKE_COMMAND](`${prefix}:${studentId}`, String(windowMs), String(limit));
      return result === 1;
    },
  };
}

/**
 * An in-memory fake for tests (rule 4: no real Redis in tests): the same fixed-window semantics,
 * with an injectable clock so a test can cross the window boundary without waiting.
 */
export function fakeSessionRateLimiter(
  opts: { limit?: number; windowMs?: number; now?: () => number } = {},
): SessionRateLimiter {
  const limit = opts.limit ?? SESSION_START_LIMIT;
  const windowMs = opts.windowMs ?? SESSION_START_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async take(studentId) {
      const t = now();
      const existing = windows.get(studentId);
      const w = existing && existing.resetAt > t ? existing : { count: 0, resetAt: t + windowMs };
      w.count += 1;
      windows.set(studentId, w);
      return Promise.resolve(w.count <= limit);
    },
  };
}

/** A fake that always rejects, for tests of the fail-closed path. */
export function failingSessionRateLimiter(
  error: unknown = new Error('redis unreachable'),
): SessionRateLimiter {
  return { take: () => Promise.reject(error) };
}
