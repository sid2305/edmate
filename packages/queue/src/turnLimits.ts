// Durable, shared `TurnCounter`/`TurnLimits` (task 3.14) on Redis: the in-memory sliding windows
// from `@edmate/harness` (task 3.2) reset on every restart and are per-process; this adapter keeps
// the exact same sliding-window-log semantics, but in Redis, so the count survives a restart and
// is shared across every web process pointed at the same Redis. `admit.ts`/`entitle.ts` need no
// change: both already call `TurnCounter#tryTake` through `PipelineDeps.limits`, and this
// implements that interface unchanged (3.2's decision log: "the interface allows an async
// `tryTake`" — built for exactly this swap).
//
// One Lua script, run as a single `EVAL` (via `redis.defineCommand`), so a take is atomic: no
// check-then-write race across two round trips, even from two separate connections/processes
// racing on the same key. `now` is passed in by the caller (never `redis.call('TIME')`, never
// `Date.now()` inside the script) so every Redis node's count is comparable regardless of clock
// skew, and so tests can drive the window without waiting on real time (the same shape as
// `slidingWindow`'s injected `clock.now()`).
import { type TurnCounter, type TurnLimits, MESSAGE_WINDOW_MS, RATE_LIMIT_WINDOW_MS } from '@edmate/harness';
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/** The in-memory counter's default namespace, so keys can't collide with BullMQ's own keyspace. */
const DEFAULT_PREFIX = 'edmate:turnlimit';

const TAKE_COMMAND = 'edmateTurnLimitTake';

/**
 * `KEYS[1]` the counter's key; `ARGV`: `windowMs`, `max`, `now`, a unique member for this take.
 *
 * `ZREMRANGEBYSCORE key -inf (now-windowMs)` (plain, inclusive upper bound) drops every take at or
 * before `now - windowMs` — a take is live while `now - t < windowMs`, so one made exactly
 * `windowMs` ago has left the window and one made `windowMs - 1` ms ago is still in it, the same
 * boundary `slidingWindow`'s `live()` draws. `ZCARD` counts what is left; below `max` the take is
 * recorded (`ZADD`) and the key's TTL is reset to `windowMs` (bounded memory: a key with no more
 * live takes expires on its own, no sweep needed); at or above `max` the take is refused and
 * nothing is written — a refused take is never recorded, matching `tryTake`'s contract.
 */
const TAKE_SCRIPT = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local max = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', tostring(now - windowMs))
local count = redis.call('ZCARD', key)
if count < max then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, windowMs)
  return 1
end
return 0
`;

interface WithTakeCommand {
  [TAKE_COMMAND](key: string, windowMs: string, max: string, now: string, member: string): Promise<number>;
}

/** Defines the Lua command on `redis` once (idempotent: ioredis just reassigns on a repeat call). */
function ensureCommand(redis: Redis): asserts redis is Redis & WithTakeCommand {
  const withCommand = redis as unknown as Record<string, unknown>;
  if (typeof withCommand[TAKE_COMMAND] === 'function') return;
  redis.defineCommand(TAKE_COMMAND, { numberOfKeys: 1, lua: TAKE_SCRIPT });
}

export interface RedisTurnCounterOptions {
  /** The trailing window, in milliseconds (must be a positive finite number). */
  windowMs: number;
  /** Namespaces this counter's keys; defaults to `edmate:turnlimit`. */
  prefix?: string;
  /** Defaults to `Date.now`; tests inject a fake clock so the window needs no real time to pass. */
  now?: () => number;
}

/**
 * A durable, shared `TurnCounter` on `redis` (a live connection the caller owns and closes, the
 * same convention as `createTurnQueues`): one Lua `EVAL` per `tryTake`, atomic, over the exact
 * sliding-window-log algorithm `slidingWindow` already tests. A Redis error propagates (rejects)
 * rather than resolving `true`/`false`: `admit`/`entitle`'s policies already turn any step failure
 * into a retryable `rate_limited`/`no_access` (task 3.2), so a brief Redis outage fails the turn
 * closed, never open.
 */
export function redisTurnCounter(redis: Redis, opts: RedisTurnCounterOptions): TurnCounter {
  const { windowMs } = opts;
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError(`windowMs must be a positive finite number, got ${windowMs}`);
  }
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  const now = opts.now ?? Date.now;
  ensureCommand(redis);

  return {
    async tryTake(key, max) {
      // A bad max refuses without a round trip (fail closed), matching slidingWindow.
      if (!Number.isSafeInteger(max) || max <= 0) return false;
      const t = now();
      const member = `${t}-${randomBytes(8).toString('hex')}`;
      const result = await redis[TAKE_COMMAND](`${prefix}:${key}`, String(windowMs), String(max), String(t), member);
      return result === 1;
    },
  };
}

/**
 * The durable `TurnLimits` on `redis`: `rate` on `RATE_LIMIT_WINDOW_MS`, `messages` on
 * `MESSAGE_WINDOW_MS` (both from `@edmate/harness`), each in its own sub-namespace under `prefix`
 * so the two counters' keys can never collide even if a caller reused the same string for both.
 */
export function redisTurnLimits(
  redis: Redis,
  opts: { prefix?: string; now?: () => number } = {},
): TurnLimits {
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  return {
    rate: redisTurnCounter(redis, {
      windowMs: RATE_LIMIT_WINDOW_MS,
      prefix: `${prefix}:rate`,
      ...(opts.now === undefined ? {} : { now: opts.now }),
    }),
    messages: redisTurnCounter(redis, {
      windowMs: MESSAGE_WINDOW_MS,
      prefix: `${prefix}:messages`,
      ...(opts.now === undefined ? {} : { now: opts.now }),
    }),
  };
}
