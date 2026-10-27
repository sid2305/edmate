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

// One in-flight "ready" promise per Redis instance (task 1.4d): N concurrent sign-in requests
// during an outage previously registered N `once('ready', …)` listeners (a MaxListeners warning
// past 10); now every concurrent caller awaits the same shared promise, and only its first
// caller registers a listener.
//
// 1.4e: that shared promise ignored every caller but the first's own `timeoutMs`. So the shared
// promise itself now has no timeout of its own and only resolves (it never rejects, which also
// means there is no risk of an un-awaited rejection on it turning into an unhandled rejection).
// Each caller races it against its own timer, which rejects with RedisNotReadyError after that
// caller's own `timeoutMs`. The `ready` listener is removed, and the entry is dropped, once the
// last still-waiting caller has either resolved or timed out.
interface PendingReady {
  readonly promise: Promise<void>;
  readonly dropListener: () => void;
  waiters: number;
}

const pending = new WeakMap<ReadySource, PendingReady>();

function sharedReady(redis: ReadySource): PendingReady {
  const existing = pending.get(redis);
  if (existing) return existing;
  let resolveShared: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveShared = resolve;
  });
  const onReady = () => {
    pending.delete(redis);
    resolveShared();
  };
  redis.once('ready', onReady);
  const entry: PendingReady = {
    promise,
    dropListener: () => redis.removeListener('ready', onReady),
    waiters: 0,
  };
  pending.set(redis, entry);
  return entry;
}

/** Resolves when `redis` is ready; rejects with RedisNotReadyError after `timeoutMs`. */
export function whenReady(redis: ReadySource, timeoutMs: number): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  const entry = sharedReady(redis);
  entry.waiters += 1;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      entry.waiters -= 1;
      if (entry.waiters === 0) {
        entry.dropListener();
        pending.delete(redis);
      }
      reject(new RedisNotReadyError());
    }, timeoutMs);
    void entry.promise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
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
