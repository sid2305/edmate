import type { SafetyAlert } from '@edmate/contracts';
import { demoSafetyAlert } from '@edmate/contracts/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { ALERT_ACK_TTL_SECONDS, type AckRedis, redisAckStore } from './ackStore.js';
import { logAlertNotifier } from './logSink.js';

const alert: SafetyAlert = { ...demoSafetyAlert, excerptRedacted: 'EXCERPT-CANARY text' };

describe('logAlertNotifier (the stand-in until a delivery vendor is chosen)', () => {
  it('one JSON line with ids, kind, level, audience and time; never the excerpt', async () => {
    const lines: string[] = [];
    await logAlertNotifier((l) => lines.push(l)).notify(alert, 'on_call');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      level: 'warn',
      event: 'safety_alert',
      audience: 'on_call',
      alertId: alert.id,
      kind: alert.kind,
      alertLevel: alert.level,
      studentId: alert.studentId,
      teacherId: alert.teacherId,
      sessionId: alert.sessionId,
      createdAt: alert.createdAt,
    });
    expect(lines[0]).not.toContain('CANARY');
    expect(lines[0]).not.toContain('excerpt');
  }, 1_000);

  it('writes to console.warn by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await logAlertNotifier().notify(alert, 'trust_team');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).not.toContain('CANARY');
    } finally {
      warn.mockRestore();
    }
  }, 1_000);
});

function fakeRedis(): AckRedis & { keys: Map<string, number> } {
  const keys = new Map<string, number>();
  return {
    keys,
    set: (k, _v, _ex, seconds) => {
      keys.set(k, seconds);
      return Promise.resolve('OK');
    },
    exists: (k) => Promise.resolve(keys.has(k) ? 1 : 0),
  };
}

describe('redisAckStore', () => {
  it('acknowledge sets a key with a 30-day expiry; isAcknowledged reads it', async () => {
    const redis = fakeRedis();
    const store = redisAckStore(redis);
    expect(await store.isAcknowledged('alert_1')).toBe(false);
    await store.acknowledge('alert_1');
    expect(await store.isAcknowledged('alert_1')).toBe(true);
    expect(redis.keys.get('edmate:alert:ack:alert_1')).toBe(ALERT_ACK_TTL_SECONDS);
  }, 1_000);

  it('takes a key prefix and ttl', async () => {
    const redis = fakeRedis();
    await redisAckStore(redis, { keyPrefix: 't:', ttlSeconds: 5 }).acknowledge('a1');
    expect([...redis.keys]).toEqual([['t:alert:ack:a1', 5]]);
  }, 1_000);

  it('refuses an id that is not a contracts id (no key injection)', async () => {
    const store = redisAckStore(fakeRedis());
    await expect(store.acknowledge('a b')).rejects.toThrow(TypeError);
    await expect(store.isAcknowledged('x'.repeat(129))).rejects.toThrow(TypeError);
  }, 1_000);
});
