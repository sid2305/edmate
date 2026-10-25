import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { LogLine } from '../log.js';
import type { RetentionResult } from '@edmate/db';
import {
  RETENTION_JOB,
  RETENTION_JOB_OPTIONS,
  RETENTION_PATTERN,
  RETENTION_QUEUE,
  RETENTION_SCHEDULER_ID,
  createRetentionWorker,
  retentionJob,
  scheduleRetention,
} from './schedule.js';
import { RetentionPurgeError, type RetentionBackend } from './workers.js';

const NOW = new Date('2026-10-25T04:00:00.000Z');

function backend(results: Partial<Record<keyof RetentionBackend, RetentionResult[]>>): RetentionBackend {
  const queues: Record<string, RetentionResult[]> = {
    purgeOldSessions: [...(results.purgeOldSessions ?? [{ count: 0, dryRun: true }])],
    purgeOldTraces: [...(results.purgeOldTraces ?? [{ count: 0, dryRun: true }])],
    purgeOldTranscriptChunks: [...(results.purgeOldTranscriptChunks ?? [{ count: 0, dryRun: true }])],
  };
  const take = (key: keyof RetentionBackend) => () => {
    const q = queues[key]!;
    return Promise.resolve(q.length > 1 ? q.shift()! : q[0]!);
  };
  return {
    purgeOldSessions: take('purgeOldSessions'),
    purgeOldTraces: take('purgeOldTraces'),
    purgeOldTranscriptChunks: take('purgeOldTranscriptChunks'),
  };
}

describe('scheduleRetention', () => {
  it('upserts one daily UTC scheduler', async () => {
    const upsert = vi.fn(() => Promise.resolve());
    await scheduleRetention({ upsertJobScheduler: upsert });
    expect(upsert).toHaveBeenCalledWith(
      RETENTION_SCHEDULER_ID,
      { pattern: RETENTION_PATTERN, tz: 'UTC' },
      { name: RETENTION_JOB, data: {}, opts: RETENTION_JOB_OPTIONS },
    );
  });
});

describe('retentionJob', () => {
  it('dry run makes exactly one call per table and reports their counts, changing nothing', async () => {
    const lines: LogLine[] = [];
    const run = retentionJob({
      retention: backend({
        purgeOldSessions: [{ count: 5, dryRun: true }],
        purgeOldTraces: [{ count: 9, dryRun: true }],
        purgeOldTranscriptChunks: [{ count: 2, dryRun: true }],
      }),
      now: () => NOW,
      log: (l) => lines.push(l),
    });
    expect(await run()).toEqual({
      dryRun: true,
      sessions: 5,
      turnTraces: 9,
      transcriptChunks: 2,
      anyMaxIterationsHit: false,
    });
    expect(lines.filter((l) => l.event === 'retention.table')).toHaveLength(3);
    expect(lines.at(-1)).toEqual(
      expect.objectContaining({ level: 'info', event: 'retention.run', dryRun: true }),
    );
  });

  it('live mode loops a table until a call reports fewer rows than the purge limit', async () => {
    const run = retentionJob({
      retention: backend({
        purgeOldSessions: [
          { count: 2, dryRun: false },
          { count: 2, dryRun: false },
          { count: 1, dryRun: false },
        ],
      }),
      config: {
        days: { sessions: 730, turnTraces: 90, transcriptChunks: 730 },
        dryRun: false,
      },
      purgeLimit: 2,
      now: () => NOW,
      log: () => undefined,
    });
    const summary = await run();
    expect(summary.sessions).toBe(5);
    expect(summary.dryRun).toBe(false);
    expect(summary.anyMaxIterationsHit).toBe(false);
  });

  it('a table whose every call reports the full limit hits the per-run cap, warns, but the job still succeeds', async () => {
    const lines: LogLine[] = [];
    // The fake always returns { count: 2 } once its queue is down to one entry (never < purgeLimit),
    // so this table runs to MAX_ITERATIONS_PER_TABLE and is reported as capped.
    const run = retentionJob({
      retention: backend({ purgeOldTraces: [{ count: 2, dryRun: false }] }),
      config: { days: { sessions: 730, turnTraces: 90, transcriptChunks: 730 }, dryRun: false },
      purgeLimit: 2,
      now: () => NOW,
      log: (l) => lines.push(l),
    });
    const summary = await run();
    expect(summary.anyMaxIterationsHit).toBe(true);
    expect(lines.some((l) => l.event === 'retention.table' && l.level === 'warn')).toBe(true);
    expect(lines.at(-1)).toEqual(expect.objectContaining({ level: 'warn', event: 'retention.run' }));
  }, 10_000);

  it('a dry run logs no live-run warning', async () => {
    const lines: LogLine[] = [];
    const run = retentionJob({
      retention: backend({}),
      now: () => NOW,
      log: (l) => lines.push(l),
    });
    await run();
    expect(lines.filter((l) => l.event === 'retention.live_run')).toHaveLength(0);
  });

  it('a live run logs exactly one live-run warning naming the tables and their cutoffs', async () => {
    const lines: LogLine[] = [];
    const run = retentionJob({
      retention: backend({}),
      config: { days: { sessions: 730, turnTraces: 90, transcriptChunks: 730 }, dryRun: false },
      now: () => NOW,
      log: (l) => lines.push(l),
    });
    await run();
    const warnings = lines.filter((l) => l.event === 'retention.live_run');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual(
      expect.objectContaining({
        level: 'warn',
        event: 'retention.live_run',
        tables: expect.objectContaining({
          sessions: expect.any(String),
          turnTraces: expect.any(String),
          transcriptChunks: expect.any(String),
        }),
      }),
    );
  });

  it('logs retention.purge_failed with the rows already deleted before the job fails', async () => {
    const lines: LogLine[] = [];
    let calls = 0;
    const failingPurge = () => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('db connection lost'));
      return Promise.resolve({ count: 5, dryRun: false });
    };
    const run = retentionJob({
      retention: {
        purgeOldSessions: failingPurge,
        purgeOldTraces: () => Promise.resolve({ count: 0, dryRun: false }),
        purgeOldTranscriptChunks: () => Promise.resolve({ count: 0, dryRun: false }),
      },
      config: { days: { sessions: 730, turnTraces: 90, transcriptChunks: 730 }, dryRun: false },
      purgeLimit: 5,
      now: () => NOW,
      log: (l) => lines.push(l),
    });
    await expect(run()).rejects.toBeInstanceOf(RetentionPurgeError);
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        event: 'retention.purge_failed',
        table: 'sessions',
        deletedSoFar: 5,
        calls: 2,
      }),
    );
  });
});

/** A Redis stand-in that never opens a socket (rule 4), as in insights/schedule.test.ts. */
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

describe('createRetentionWorker', () => {
  it('builds the worker without connecting; failed and error events are logged', async () => {
    const lines: LogLine[] = [];
    const dead: unknown[] = [];
    const worker = createRetentionWorker({
      connection: new FakeRedis() as never,
      prefix: 'edmate-test',
      now: () => NOW,
      deadLetter: { add: (_n, d) => Promise.resolve(dead.push(d)) },
      deps: {
        retention: backend({}),
        now: () => NOW,
        log: (l) => lines.push(l),
      },
    });
    try {
      expect(worker.name).toBe(RETENTION_QUEUE);
      expect(worker.isRunning()).toBe(false);
      worker.emit(
        'failed',
        {
          id: 'j1',
          name: RETENTION_JOB,
          queueName: RETENTION_QUEUE,
          data: {},
          attemptsMade: 3,
          opts: { attempts: 3 },
        } as never,
        new Error('db down'),
        'active',
      );
      worker.emit('error', new Error('redis gone'));
      expect(dead).toHaveLength(1);
      expect(lines.some((l) => l.event === 'worker.error')).toBe(true);
    } finally {
      await worker.close(true);
    }
  });
});
