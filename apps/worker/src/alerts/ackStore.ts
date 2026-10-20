// Alert acknowledgements in Redis (task 4.3): `<prefix>alert:ack:<alertId>`, kept 30 days. Real,
// not a stub, so every alert pages on-call until someone acknowledges it; a later trust-console
// task calls `acknowledge`.

import type { AckStore } from './types.js';

/** What the store needs from an ioredis client. */
export interface AckRedis {
  set(key: string, value: string, secondsToken: 'EX', seconds: number): Promise<unknown>;
  exists(key: string): Promise<number>;
}

export const ALERT_ACK_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Contracts ids: 1-128 of A-Z a-z 0-9 _ - (so nothing else can reach a Redis key). */
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function redisAckStore(
  redis: AckRedis,
  opts: { keyPrefix?: string; ttlSeconds?: number } = {},
): AckStore {
  const prefix = opts.keyPrefix ?? 'edmate:';
  const ttl = opts.ttlSeconds ?? ALERT_ACK_TTL_SECONDS;
  const key = (alertId: string): string => {
    if (!ID.test(alertId)) throw new TypeError('redisAckStore: invalid alert id');
    return `${prefix}alert:ack:${alertId}`;
  };
  return {
    async acknowledge(alertId) {
      await redis.set(key(alertId), '1', 'EX', ttl);
    },
    async isAcknowledged(alertId) {
      return (await redis.exists(key(alertId))) > 0;
    },
  };
}
