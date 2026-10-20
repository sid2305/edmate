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

/** Resolves when `redis` is ready; rejects with RedisNotReadyError after `timeoutMs`. */
export function whenReady(redis: ReadySource, timeoutMs: number): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      redis.removeListener('ready', onReady);
      reject(new RedisNotReadyError());
    }, timeoutMs);
    redis.once('ready', onReady);
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
