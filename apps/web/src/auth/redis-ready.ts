// Cold-start guard for the sign-in rate limiter (task 1.4). The Redis client runs with
// `enableOfflineQueue: false`, so a command sent before the connection is `ready` is rejected
// at once. The first sign-in after a cold start therefore waits for `ready`, for a bounded time;
// past that it fails closed (no token, no mail) instead of hanging the request.
import type { SignInCounter, SignInCounters } from './rate-limit';

/** How long a sign-in request waits for Redis to become ready. */
export const REDIS_READY_TIMEOUT_MS = 3_000;

/** The part of an ioredis client this needs. */
export interface ReadySource {
  readonly status: string;
  once(event: 'ready', listener: () => void): unknown;
  removeListener(event: 'ready', listener: () => void): unknown;
}

/** Redis did not become ready in time. Bare on purpose: no URL or host in the message. */
export class RedisNotReadyError extends Error {
  override readonly name = 'RedisNotReadyError';
  constructor() {
    super('sign-in rate limiter not ready');
  }
}

// One in-flight "ready" entry per Redis instance (task 1.4d): N concurrent sign-in requests
// during an outage previously registered N `once('ready', …)` listeners (a MaxListeners warning
// past 10); now every concurrent caller shares one entry, and only its first caller registers a
// listener.
//
// 1.4e fix round 1: a caller used to subscribe to a shared promise that never rejected, so a
// caller's own timeout only decremented a counter and left its `.then` reaction attached forever.
// During a long outage with sign-ins arriving faster than `timeoutMs`, `waiters` never reached 0,
// so the entry (and every reaction ever attached to it) lived for the whole outage: unbounded
// memory growth. Now each caller registers its own settle callback in a `Set` on the entry. The
// single `ready` listener calls every callback in the set, then drops the entry. A caller's
// timeout removes only its own callback from the set; once the set is empty, the `ready` listener
// is removed and the entry is dropped — same as when `ready` fires. Memory is bounded by callers
// currently waiting, not by every caller since the outage began.
interface PendingReady {
  readonly waiters: Set<() => void>;
  readonly dropListener: () => void;
}

const pending = new WeakMap<ReadySource, PendingReady>();

function sharedReady(redis: ReadySource): PendingReady {
  const existing = pending.get(redis);
  if (existing) return existing;
  const waiters = new Set<() => void>();
  const onReady = () => {
    pending.delete(redis);
    for (const settle of waiters) settle();
    waiters.clear();
  };
  redis.once('ready', onReady);
  const entry: PendingReady = {
    waiters,
    dropListener: () => redis.removeListener('ready', onReady),
  };
  pending.set(redis, entry);
  return entry;
}

/** Resolves when `redis` is ready; rejects with RedisNotReadyError after `timeoutMs`. */
export function whenReady(redis: ReadySource, timeoutMs: number): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  const entry = sharedReady(redis);
  return new Promise<void>((resolve, reject) => {
    const settle = () => {
      clearTimeout(timer);
      entry.waiters.delete(settle);
      resolve();
    };
    const timer = setTimeout(() => {
      entry.waiters.delete(settle);
      if (entry.waiters.size === 0) {
        entry.dropListener();
        pending.delete(redis);
      }
      reject(new RedisNotReadyError());
    }, timeoutMs);
    entry.waiters.add(settle);
  });
}

/**
 * Test-only seam: the number of callers currently waiting on `redis`'s shared ready entry, or 0
 * if there is none. Not part of the public API used by sign-in callers.
 */
export function pendingWaiterCount(redis: ReadySource): number {
  return pending.get(redis)?.waiters.size ?? 0;
}

/** Wraps both counters so every take first waits for `redis` to be ready. */
export function readyCounters(
  redis: ReadySource,
  counters: SignInCounters,
  timeoutMs: number = REDIS_READY_TIMEOUT_MS,
): SignInCounters {
  const wrap = (counter: SignInCounter): SignInCounter => ({
    async tryTake(key, max) {
      await whenReady(redis, timeoutMs);
      return counter.tryTake(key, max);
    },
  });
  return { ip: wrap(counters.ip), addr: wrap(counters.addr) };
}
