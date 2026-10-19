import { EventEmitter } from 'node:events';
import type { Repositories } from '@edmate/db';
import { COMMIT_QUEUE, METER_QUEUE } from '@edmate/queue';
import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { LogLine } from '../log.js';
import { PermanentJobError } from './processors.js';
import { createTurnWorkers, permanentToUnrecoverable } from './workers.js';

/** A Redis stand-in that never opens a socket (rule 4), as in worker.test.ts. */
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

describe('permanentToUnrecoverable', () => {
  it('passes results and retryable errors through; a permanent error stops the retries', async () => {
    const ok = permanentToUnrecoverable(() => Promise.resolve('written'));
    expect(await ok({ name: 'x', data: {} })).toBe('written');
    const down = new Error('db down');
    await expect(permanentToUnrecoverable(() => Promise.reject(down))({ name: 'x', data: {} })).rejects.toBe(
      down,
    );
    const e = await permanentToUnrecoverable(() =>
      Promise.reject(new PermanentJobError('message.append: invalid job payload')),
    )({ name: 'x', data: {} }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnrecoverableError);
    expect((e as Error).message).toBe('message.append: invalid job payload');
  });
});

describe('createTurnWorkers', () => {
  it('builds the meter and commit workers without connecting; failures are logged', async () => {
    const lines: LogLine[] = [];
    const dead: unknown[] = [];
    const redis = new FakeRedis();
    const { meter, commit } = createTurnWorkers({
      connection: redis as never,
      repos: {} as Repositories,
      deadLetter: { add: (_n, d) => Promise.resolve(dead.push(d)) },
      log: (l) => lines.push(l),
      now: () => new Date('2026-10-18T10:00:00.000Z'),
      prefix: 'edmate-test',
    });
    try {
      expect([meter.name, commit.name]).toEqual([METER_QUEUE, COMMIT_QUEUE]);
      expect(meter.isRunning() || commit.isRunning()).toBe(false);
      expect(commit.opts.concurrency).toBe(1);
      expect(commit.opts.prefix).toBe('edmate-test');
      commit.emit(
        'failed',
        { id: 'm.message', name: 'message.append', queueName: COMMIT_QUEUE, data: {}, attemptsMade: 5, opts: { attempts: 5 } } as never,
        new Error('db down'),
        'active',
      );
      meter.emit('error', new Error('redis gone'));
      await vi.waitFor(() => expect(dead).toHaveLength(1));
      expect(lines.map((l) => [l.event, l.queue])).toEqual([
        ['worker.error', METER_QUEUE],
        ['job.dead_lettered', COMMIT_QUEUE],
      ]);
      expect(redis.connect).not.toHaveBeenCalled();
    } finally {
      await Promise.all([meter.close(), commit.close()]);
    }
  });

  it('defaults: no prefix, the real clock', async () => {
    const { meter, commit } = createTurnWorkers({
      connection: new FakeRedis() as never,
      repos: {} as Repositories,
      deadLetter: { add: () => Promise.resolve() },
      log: () => undefined,
    });
    expect(meter.opts.prefix).toBeUndefined();
    await Promise.all([meter.close(), commit.close()]);
  });
});
