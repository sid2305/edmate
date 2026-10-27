import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { LogLine } from '../log.js';
import type { RegateSweepDeps } from './sweep.js';
import {
  createRegateSweepWorker,
  REGATE_JOB,
  REGATE_JOB_OPTIONS,
  REGATE_PATTERN,
  REGATE_QUEUE,
  REGATE_SCHEDULER_ID,
  scheduleRegateSweep,
} from './schedule.js';

function deps(overrides: Partial<RegateSweepDeps> = {}): RegateSweepDeps {
  return {
    candidates: () => Promise.resolve([]),
    repos: {
      styleCards: { latest: () => Promise.resolve(null) },
      courses: { ensureDefault: vi.fn() },
      publish: { startRun: vi.fn(), finishRun: vi.fn() },
    } as never,
    pins: () => Promise.resolve({ ok: false, reason: 'content_missing' }),
    enqueue: () => Promise.resolve(),
    log: () => undefined,
    ...overrides,
  };
}

describe('scheduleRegateSweep', () => {
  it('upserts one scheduler, every 15 minutes UTC, for the regate.sweep job', async () => {
    const upsert = vi.fn(() => Promise.resolve());
    await scheduleRegateSweep({ upsertJobScheduler: upsert });
    expect(upsert).toHaveBeenCalledWith(
      REGATE_SCHEDULER_ID,
      { pattern: REGATE_PATTERN, tz: 'UTC' },
      { name: REGATE_JOB, data: {}, opts: REGATE_JOB_OPTIONS },
    );
    await scheduleRegateSweep({ upsertJobScheduler: upsert }, '*/5 * * * *');
    expect(upsert).toHaveBeenLastCalledWith(
      REGATE_SCHEDULER_ID,
      { pattern: '*/5 * * * *', tz: 'UTC' },
      expect.anything(),
    );
  });
});

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

describe('createRegateSweepWorker', () => {
  it('builds the worker without connecting; failed and error events are logged', async () => {
    const lines: LogLine[] = [];
    const dead: unknown[] = [];
    const worker = createRegateSweepWorker({
      connection: new FakeRedis() as never,
      prefix: 'edmate-test',
      now: () => new Date('2026-10-27T00:00:00.000Z'),
      deadLetter: { add: (_n, d) => Promise.resolve(dead.push(d)) },
      deps: deps({ log: (l) => lines.push(l) }),
    });
    try {
      expect(worker.name).toBe(REGATE_QUEUE);
      expect(worker.isRunning()).toBe(false);
      worker.emit(
        'failed',
        {
          id: 'j1',
          name: REGATE_JOB,
          queueName: REGATE_QUEUE,
          data: {},
          attemptsMade: 3,
          opts: { attempts: 3 },
        } as never,
        new Error('db down'),
        'active',
      );
      worker.emit('error', new Error('redis gone'));
      await vi.waitFor(() => expect(dead).toHaveLength(1));
      expect(lines.map((l) => l.event)).toEqual(['worker.error', 'job.dead_lettered']);
    } finally {
      await worker.close();
    }
  });

  it('defaults: no prefix, the real clock', async () => {
    const worker = createRegateSweepWorker({
      connection: new FakeRedis() as never,
      deadLetter: { add: () => Promise.resolve() },
      deps: deps(),
    });
    await worker.close();
  });
});
