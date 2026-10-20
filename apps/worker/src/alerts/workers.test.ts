import { EventEmitter } from 'node:events';
import { ALERT_QUEUE, alertBackoffMs } from '@edmate/queue';
import { describe, expect, it, vi } from 'vitest';
import type { LogLine } from '../log.js';
import { ALERT_MAX_STALLED, createAlertWorker } from './workers.js';

/** A Redis stand-in that never opens a socket (rule 4), as in commit/workers.test.ts. */
class FakeRedis extends EventEmitter {
  status = 'connecting';
  options = {};
  connect = vi.fn(async () => undefined);
  quit = vi.fn(async () => 'OK');
  disconnect = vi.fn(() => {
    this.status = 'end';
    this.emit('close');
    this.emit('end');
  });
  duplicate = vi.fn(() => new FakeRedis());
}

const deps = (dead: unknown[] = []) => ({
  notifier: { notify: () => Promise.resolve() },
  ackStore: { acknowledge: () => Promise.resolve(), isAcknowledged: () => Promise.resolve(false) },
  queue: { add: () => Promise.resolve() },
  deadLetter: { add: (_n: string, d: unknown) => Promise.resolve(dead.push(d)) },
});

describe('createAlertWorker', () => {
  it('builds the alert worker without connecting: capped backoff, stalls retried', async () => {
    const redis = new FakeRedis();
    const w = createAlertWorker({ connection: redis as never, log: () => undefined, ...deps() });
    try {
      expect(w.name).toBe(ALERT_QUEUE);
      expect(w.isRunning()).toBe(false);
      expect(w.opts.maxStalledCount).toBe(ALERT_MAX_STALLED);
      const strategy = w.opts.settings?.backoffStrategy;
      expect([1, 6, 50].map((n) => strategy?.(n))).toEqual([
        alertBackoffMs(1),
        alertBackoffMs(6),
        30_000,
      ]);
      expect(redis.connect).not.toHaveBeenCalled();
    } finally {
      await w.close();
    }
  }, 5_000);

  it('takes a test backoff and prefix; failures are logged, a malformed job dead-lettered', async () => {
    const lines: LogLine[] = [];
    const dead: unknown[] = [];
    const w = createAlertWorker({
      connection: new FakeRedis() as never,
      log: (l) => lines.push(l),
      now: () => new Date('2026-10-19T10:00:00.000Z'),
      backoff: { startMs: 10, maxMs: 40 },
      prefix: 'edmate-test',
      escalateAfterMs: 50,
      ...deps(dead),
    });
    try {
      expect(w.opts.prefix).toBe('edmate-test');
      expect(w.opts.settings?.backoffStrategy?.(5)).toBe(40);
      w.emit(
        'failed',
        {
          id: 'a.alert',
          name: 'alert.raise',
          queueName: ALERT_QUEUE,
          data: { alert: { id: 'alert_1', excerptRedacted: 'CANARY' } },
          attemptsMade: 1,
          opts: { attempts: 1_000_000 },
        } as never,
        new Error('UnrecoverableError'),
        'active',
      );
      const unrecoverable = new Error('alert.raise: invalid job payload');
      unrecoverable.name = 'UnrecoverableError';
      w.emit(
        'failed',
        {
          id: 'b.alert',
          name: 'alert.raise',
          queueName: ALERT_QUEUE,
          data: { alert: { id: 'alert_2', excerptRedacted: 'CANARY' } },
          attemptsMade: 1,
          opts: { attempts: 1_000_000 },
        } as never,
        unrecoverable,
        'active',
      );
      w.emit('error', new Error('redis gone'));
      await vi.waitFor(() => expect(dead).toHaveLength(1));
      expect(lines.map((l) => l.event)).toEqual([
        'job.failed_will_retry',
        'worker.error',
        'job.dead_lettered',
      ]);
      expect(JSON.stringify([lines, dead])).not.toContain('CANARY');
    } finally {
      await w.close();
    }
  }, 5_000);
});
