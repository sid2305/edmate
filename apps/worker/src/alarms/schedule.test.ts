import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { LogLine } from '../log.js';
import type { CostAlarmPorts } from './costAlarm.js';
import {
  COST_ALARM_JOB,
  COST_ALARM_JOB_OPTIONS,
  COST_ALARM_PATTERN,
  COST_ALARM_QUEUE,
  COST_ALARM_SCHEDULER_ID,
  costAlarmJob,
  createCostAlarmWorker,
  scheduleCostAlarm,
} from './schedule.js';
import type { TeacherCostTotals } from './types.js';

const NOW = new Date('2026-10-18T10:00:00.000Z');
const totals = (teacherId: string, costMicroUsd = 0): TeacherCostTotals => ({
  teacherId,
  since: '2026-10-01T00:00:00.000Z',
  calls: 1,
  recorded: 1,
  unknown: 0,
  unpriced: 0,
  costMicroUsd,
  inputTokens: 1,
  outputTokens: 1,
});

function ports(failFor: string[] = []): CostAlarmPorts {
  return {
    now: () => NOW,
    usage: {
      sumForTeacherSince: ({ teacherId }) =>
        failFor.includes(teacherId)
          ? Promise.reject(new Error('usageLedger.sumForTeacherSince: failed'))
          : Promise.resolve(totals(teacherId, teacherId === 'tch_big' ? 60_000_000 : 0)),
    },
    subscriptions: { pauseFreeForTeacher: () => Promise.resolve([]) },
    sink: { notify: () => Promise.resolve() },
  };
}

describe('scheduleCostAlarm', () => {
  it('upserts one daily UTC scheduler for the check-teachers-cost job', async () => {
    const upsert = vi.fn(() => Promise.resolve());
    await scheduleCostAlarm({ upsertJobScheduler: upsert });
    expect(upsert).toHaveBeenCalledWith(
      COST_ALARM_SCHEDULER_ID,
      { pattern: COST_ALARM_PATTERN, tz: 'UTC' },
      { name: COST_ALARM_JOB, data: {}, opts: COST_ALARM_JOB_OPTIONS },
    );
    await scheduleCostAlarm({ upsertJobScheduler: upsert }, '0 * * * *');
    expect(upsert).toHaveBeenLastCalledWith(
      COST_ALARM_SCHEDULER_ID,
      { pattern: '0 * * * *', tz: 'UTC' },
      expect.anything(),
    );
  });
});

describe('costAlarmJob', () => {
  it('checks this month’s teachers and logs every per-teacher failure', async () => {
    const lines: LogLine[] = [];
    const scopes: unknown[] = [];
    const run = costAlarmJob({
      teacherIds: (scope) => {
        scopes.push(scope);
        return Promise.resolve(['tch_a', 'tch_down1', 'tch_big', 'tch_down2']);
      },
      ports: ports(['tch_down1', 'tch_down2']),
      log: (l) => lines.push(l),
    });
    expect(await run()).toEqual({ teachers: 4, checked: 2, failed: 2 });
    expect(scopes).toEqual([{ since: '2026-10-01T00:00:00.000Z' }]);
    expect(lines.filter((l) => l.event === 'cost_alarm.teacher_failed')).toEqual([
      {
        level: 'error',
        event: 'cost_alarm.teacher_failed',
        teacherId: 'tch_down1',
        monthStartIso: '2026-10-01T00:00:00.000Z',
        error: { name: 'Error', message: 'usageLedger.sumForTeacherSince: failed' },
      },
      expect.objectContaining({ teacherId: 'tch_down2', level: 'error' }),
    ]);
    expect(lines.at(-1)).toEqual({
      level: 'warn',
      event: 'cost_alarm.run',
      monthStartIso: '2026-10-01T00:00:00.000Z',
      teachers: 4,
      checked: 2,
      failed: 2,
      outcomes: { below_threshold: 1, threshold_reached: 1 },
    });
  });

  it('a clean run logs one info summary', async () => {
    const lines: LogLine[] = [];
    await costAlarmJob({
      teacherIds: () => Promise.resolve([]),
      ports: ports(),
      log: (l) => lines.push(l),
    })();
    expect(lines).toEqual([
      expect.objectContaining({ level: 'info', event: 'cost_alarm.run', teachers: 0, failed: 0 }),
    ]);
  });

  it('a failed teacher list fails the job (BullMQ retries it; the failed handler logs it)', async () => {
    const run = costAlarmJob({
      teacherIds: () => Promise.reject(new Error('db down')),
      ports: ports(),
      log: () => undefined,
    });
    await expect(run()).rejects.toThrow('db down');
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

describe('createCostAlarmWorker', () => {
  it('builds the worker without connecting; failed and error events are logged', async () => {
    const lines: LogLine[] = [];
    const dead: unknown[] = [];
    const worker = createCostAlarmWorker({
      connection: new FakeRedis() as never,
      prefix: 'edmate-test',
      now: () => NOW,
      deadLetter: { add: (_n, d) => Promise.resolve(dead.push(d)) },
      deps: { teacherIds: () => Promise.resolve([]), ports: ports(), log: (l) => lines.push(l) },
    });
    try {
      expect(worker.name).toBe(COST_ALARM_QUEUE);
      expect(worker.isRunning()).toBe(false);
      worker.emit(
        'failed',
        { id: 'j1', name: COST_ALARM_JOB, queueName: COST_ALARM_QUEUE, data: {}, attemptsMade: 3, opts: { attempts: 3 } } as never,
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
    const worker = createCostAlarmWorker({
      connection: new FakeRedis() as never,
      deadLetter: { add: () => Promise.resolve() },
      deps: { teacherIds: () => Promise.resolve([]), ports: ports(), log: () => undefined },
    });
    await worker.close();
  });
});
