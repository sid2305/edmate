import { EventEmitter } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogLine } from '../log.js';
import {
  WEEKLY_INSIGHTS_JOB,
  WEEKLY_INSIGHTS_JOB_OPTIONS,
  WEEKLY_INSIGHTS_PATTERN,
  WEEKLY_INSIGHTS_QUEUE,
  WEEKLY_INSIGHTS_SCHEDULER_ID,
  createWeeklyInsightsWorker,
  insightsContentDir,
  insightsTimezone,
  scheduleWeeklyInsights,
  weeklyInsightsJob,
} from './schedule.js';

const NOW = new Date('2026-10-19T07:00:00.000Z');
const REPO_CONTENT = join(resolve(import.meta.dirname, '../../../..'), 'content');

function insights(failFor: string[] = []): { computeAndSaveWeek: (s: unknown, w: unknown) => Promise<unknown> } {
  return {
    computeAndSaveWeek: (scope) => {
      const teacherId = (scope as { teacherId: string }).teacherId;
      return failFor.includes(teacherId)
        ? Promise.reject(new Error('insights.computeAndSaveWeek: failed'))
        : Promise.resolve({ week: '2026-10-12', payload: {}, updatedAt: 'x' });
    },
  };
}

describe('insightsContentDir', () => {
  it('is EDMATE_CONTENT_DIR when set, else the repo content dir', () => {
    expect(insightsContentDir({ EDMATE_CONTENT_DIR: '/app/content' })).toBe('/app/content');
    expect(insightsContentDir({})).toBe(resolve(process.cwd(), '../../content'));
  });
});

describe('insightsTimezone', () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it('reads the US locale pack timezone from the repo content (never hardcoded)', () => {
    expect(insightsTimezone(REPO_CONTENT)).toBe('America/New_York');
  });

  it('throws when there is no US locale pack to read a timezone from', () => {
    tmp = mkdtempSync(join(tmpdir(), 'edmate-insights-tz-'));
    mkdirSync(join(tmp, 'locales'), { recursive: true });
    copyFileSync(join(REPO_CONTENT, 'locales', 'global.yaml'), join(tmp, 'locales', 'global.yaml'));
    expect(() => insightsTimezone(tmp!)).toThrow(/no "US" locale pack/);
  });
});

describe('scheduleWeeklyInsights', () => {
  it('upserts one weekly Monday-07:00 scheduler, tz passed in (not hardcoded)', async () => {
    const upsert = vi.fn(() => Promise.resolve());
    await scheduleWeeklyInsights({ upsertJobScheduler: upsert }, 'America/New_York');
    expect(upsert).toHaveBeenCalledWith(
      WEEKLY_INSIGHTS_SCHEDULER_ID,
      { pattern: WEEKLY_INSIGHTS_PATTERN, tz: 'America/New_York' },
      { name: WEEKLY_INSIGHTS_JOB, data: {}, opts: WEEKLY_INSIGHTS_JOB_OPTIONS },
    );
  });
});

describe('weeklyInsightsJob', () => {
  it('saves the finished week for each teacher with recent usage, logging each failure', async () => {
    const lines: LogLine[] = [];
    const scopes: unknown[] = [];
    const run = weeklyInsightsJob({
      teacherIds: (scope) => {
        scopes.push(scope);
        return Promise.resolve(['tch_a', 'tch_down', 'tch_b']);
      },
      insights: insights(['tch_down']),
      now: () => NOW,
      log: (l) => lines.push(l),
    });
    expect(await run()).toEqual({ weekStart: '2026-10-12', teachers: 3, saved: 2, failed: 1 });
    expect(scopes).toEqual([{ since: '2026-10-12T07:00:00.000Z' }]);
    expect(lines).toContainEqual({
      level: 'error',
      event: 'weekly_insights.teacher_failed',
      teacherId: 'tch_down',
      weekStart: '2026-10-12',
      error: { name: 'Error', message: 'insights.computeAndSaveWeek: failed' },
    });
    expect(lines.at(-1)).toEqual({
      level: 'warn',
      event: 'weekly_insights.run',
      weekStart: '2026-10-12',
      teachers: 3,
      saved: 2,
      failed: 1,
    });
  });

  it('a clean run logs one info summary and never calls computeAndSaveWeek twice for the same id', async () => {
    const calls: string[] = [];
    const lines: LogLine[] = [];
    const run = weeklyInsightsJob({
      teacherIds: () => Promise.resolve(['tch_a', 'tch_a']),
      insights: {
        computeAndSaveWeek: (scope) => {
          calls.push((scope as { teacherId: string }).teacherId);
          return Promise.resolve({ week: '2026-10-12', payload: {}, updatedAt: 'x' });
        },
      },
      now: () => NOW,
      log: (l) => lines.push(l),
    });
    expect(await run()).toEqual({ weekStart: '2026-10-12', teachers: 2, saved: 1, failed: 0 });
    expect(calls).toEqual(['tch_a']);
    expect(lines).toEqual([
      expect.objectContaining({ level: 'info', event: 'weekly_insights.run', saved: 1, failed: 0 }),
    ]);
  });

  it('a failed teacher list fails the job (BullMQ retries it)', async () => {
    const run = weeklyInsightsJob({
      teacherIds: () => Promise.reject(new Error('db down')),
      insights: insights(),
      now: () => NOW,
      log: () => undefined,
    });
    await expect(run()).rejects.toThrow('db down');
  });
});

/** A Redis stand-in that never opens a socket (rule 4), as in alarms/schedule.test.ts. */
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

describe('createWeeklyInsightsWorker', () => {
  it('builds the worker without connecting; failed and error events are logged', async () => {
    const lines: LogLine[] = [];
    const dead: unknown[] = [];
    const worker = createWeeklyInsightsWorker({
      connection: new FakeRedis() as never,
      prefix: 'edmate-test',
      now: () => NOW,
      deadLetter: { add: (_n, d) => Promise.resolve(dead.push(d)) },
      deps: {
        teacherIds: () => Promise.resolve([]),
        insights: insights(),
        now: () => NOW,
        log: (l) => lines.push(l),
      },
    });
    try {
      expect(worker.name).toBe(WEEKLY_INSIGHTS_QUEUE);
      expect(worker.isRunning()).toBe(false);
      worker.emit(
        'failed',
        {
          id: 'j1',
          name: WEEKLY_INSIGHTS_JOB,
          queueName: WEEKLY_INSIGHTS_QUEUE,
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
