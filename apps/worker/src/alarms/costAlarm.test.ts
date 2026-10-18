// Task 2.5: the monthly per-teacher cost alarm, on fake ports (no Postgres, no model or payment
// calls). The real repository methods it calls are tested on Postgres in packages/db.
import { describe, expect, it } from 'vitest';
import {
  checkTeacherCost,
  checkTeachersCost,
  COST_ALARM_THRESHOLD_MICRO_USD,
  type CostAlarmPorts,
  monthStartUtc,
} from './costAlarm.js';
import type {
  CostAlarmEvent,
  CostAlarmSink,
  PausedSubscription,
  PauseFreeOptions,
  TeacherCostTotals,
} from './types.js';

const NOW = new Date('2026-10-18T09:30:00.000Z');
const OCT = '2026-10-01T00:00:00.000Z';
const T = 'tch_a';

function totals(over: Partial<TeacherCostTotals> = {}): TeacherCostTotals {
  return {
    teacherId: T,
    since: OCT,
    calls: 10,
    recorded: 10,
    unknown: 0,
    unpriced: 0,
    costMicroUsd: 1_000,
    inputTokens: 100,
    outputTokens: 200,
    ...over,
  };
}

/** Fake repositories and sink that record every call. */
function fakes(
  o: {
    cost?: Partial<TeacherCostTotals> | ((teacherId: string) => TeacherCostTotals);
    paused?: PausedSubscription[] | ((call: number) => PausedSubscription[]);
    pauseError?: Error;
    sumError?: Error;
    notifyError?: Error;
    threshold?: number;
  } = {},
) {
  const sums: { scope: unknown; since: string }[] = [];
  const pauses: { scope: unknown; options: PauseFreeOptions }[] = [];
  const events: CostAlarmEvent[] = [];
  const sink: CostAlarmSink = {
    notify(e) {
      events.push(e);
      return o.notifyError ? Promise.reject(o.notifyError) : Promise.resolve();
    },
  };
  const ports: CostAlarmPorts = {
    usage: {
      sumForTeacherSince(scope, since) {
        sums.push({ scope, since });
        if (o.sumError) return Promise.reject(o.sumError);
        const c = o.cost;
        return Promise.resolve(
          typeof c === 'function'
            ? c(scope.teacherId)
            : totals({ ...c, teacherId: scope.teacherId }),
        );
      },
    },
    subscriptions: {
      pauseFreeForTeacher(scope, options) {
        pauses.push({ scope, options });
        if (o.pauseError) return Promise.reject(o.pauseError);
        const p = o.paused;
        return Promise.resolve(typeof p === 'function' ? p(pauses.length) : (p ?? []));
      },
    },
    sink,
    now: () => NOW,
    ...(o.threshold === undefined ? {} : { thresholdMicroUsd: o.threshold }),
  };
  return { ports, sums, pauses, events };
}

const FREE_1: PausedSubscription = {
  subscriptionId: 'sub_1a',
  packageId: 'pkg_free',
  previousStatus: 'active',
};
const FREE_2: PausedSubscription = {
  subscriptionId: 'sub_2a',
  packageId: 'pkg_free',
  previousStatus: 'trial',
};
const FREE_3: PausedSubscription = {
  subscriptionId: 'sub_3a',
  packageId: 'pkg_free_2',
  previousStatus: 'past_due',
};

describe('monthStartUtc: calendar month in UTC', () => {
  it.each([
    ['2026-10-18T09:30:00.000Z', '2026-10-01T00:00:00.000Z'],
    ['2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
    ['2026-09-30T23:59:59.999Z', '2026-09-01T00:00:00.000Z'],
    // Offsets: still October locally at UTC-5 but November in UTC, and the reverse at UTC+5:30.
    ['2026-10-31T20:00:00.000-05:00', '2026-11-01T00:00:00.000Z'],
    ['2026-11-01T03:00:00.000+05:30', '2026-10-01T00:00:00.000Z'],
    ['2027-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'],
    ['2028-02-29T12:00:00.000Z', '2028-02-01T00:00:00.000Z'],
  ])('%s → %s', (now, start) => {
    expect(monthStartUtc(new Date(now))).toBe(start);
  });

  it('rejects an invalid date', () => {
    expect(() => monthStartUtc(new Date('nope'))).toThrow(/invalid date/);
  });
});

describe('checkTeacherCost', () => {
  it('the provisional default threshold is 50 USD a month', () => {
    expect(COST_ALARM_THRESHOLD_MICRO_USD).toBe(50_000_000);
  });

  it('below the threshold with every cost known: no notify, no pause', async () => {
    const f = fakes({ cost: { costMicroUsd: COST_ALARM_THRESHOLD_MICRO_USD - 1 } });
    const out = await checkTeacherCost(T, f.ports);
    expect(out).toEqual({
      teacherId: T,
      outcome: 'below_threshold',
      totals: totals({ costMicroUsd: COST_ALARM_THRESHOLD_MICRO_USD - 1 }),
      paused: [],
    });
    expect(f.sums).toEqual([{ scope: { teacherId: T }, since: OCT }]);
    expect(f.pauses).toEqual([]);
    expect(f.events).toEqual([]);
  });

  it('at the threshold: pauses free packages, then notifies staff and the teacher once', async () => {
    const f = fakes({
      cost: { costMicroUsd: COST_ALARM_THRESHOLD_MICRO_USD, unknown: 2, unpriced: 1 },
      paused: [FREE_1, FREE_2, FREE_3],
    });
    const out = await checkTeacherCost(T, f.ports);
    expect(out.outcome).toBe('threshold_reached');
    expect(out.paused).toEqual([FREE_1, FREE_2, FREE_3]);
    expect(f.pauses).toEqual([
      {
        scope: { teacherId: T },
        options: {
          monthStart: OCT,
          reason: 'cost alarm 2026-10: 50000000 micro-USD >= threshold 50000000 micro-USD',
        },
      },
    ]);
    expect(f.events).toEqual([
      {
        kind: 'threshold_reached',
        recipients: ['staff', 'teacher'],
        teacherId: T,
        monthStartIso: OCT,
        costMicroUsd: COST_ALARM_THRESHOLD_MICRO_USD,
        thresholdMicroUsd: COST_ALARM_THRESHOLD_MICRO_USD,
        unknownCalls: 2,
        unpricedCalls: 1,
        pausedSubscriptionIds: ['sub_1a', 'sub_2a', 'sub_3a'],
        pausedPackageIds: ['pkg_free', 'pkg_free_2'],
        pauseFailed: false,
      },
    ]);
  });

  it('a teacher with only paid students is still notified (nothing to pause)', async () => {
    const f = fakes({ cost: { costMicroUsd: 99_000_000 }, paused: [] });
    const out = await checkTeacherCost(T, f.ports);
    expect(out.outcome).toBe('threshold_reached');
    expect(f.pauses).toHaveLength(1);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      kind: 'threshold_reached',
      pausedSubscriptionIds: [],
      pausedPackageIds: [],
    });
  });

  it('a second run in the same month re-alerts but pauses nothing new (the repo skips them)', async () => {
    const f = fakes({
      cost: { costMicroUsd: 60_000_000 },
      paused: (call) => (call === 1 ? [FREE_1] : []),
    });
    await checkTeacherCost(T, f.ports);
    const second = await checkTeacherCost(T, f.ports);
    expect(second.paused).toEqual([]);
    expect(f.pauses.map((p) => p.options.monthStart)).toEqual([OCT, OCT]);
    expect(f.events.map((e) => e.pausedSubscriptionIds)).toEqual([['sub_1a'], []]);
  });

  it('below the threshold with unknown or unpriced calls: warns staff only, never pauses', async () => {
    for (const over of [{ unknown: 3 }, { unpriced: 1 }]) {
      const f = fakes({ cost: { costMicroUsd: 10, ...over } });
      const out = await checkTeacherCost(T, f.ports);
      expect(out.outcome).toBe('cost_incomplete');
      expect(f.pauses).toEqual([]);
      expect(f.events).toEqual([
        {
          kind: 'cost_incomplete',
          recipients: ['staff'],
          teacherId: T,
          monthStartIso: OCT,
          costMicroUsd: 10,
          thresholdMicroUsd: COST_ALARM_THRESHOLD_MICRO_USD,
          unknownCalls: over.unknown ?? 0,
          unpricedCalls: over.unpriced ?? 0,
          pausedSubscriptionIds: [],
          pausedPackageIds: [],
          pauseFailed: false,
        },
      ]);
    }
  });

  it('a configured threshold replaces the default', async () => {
    const f = fakes({ cost: { costMicroUsd: 5_000 }, threshold: 5_000, paused: [FREE_1] });
    expect((await checkTeacherCost(T, f.ports)).outcome).toBe('threshold_reached');
    expect(f.events[0]?.thresholdMicroUsd).toBe(5_000);
    const g = fakes({ cost: { costMicroUsd: 4_999 }, threshold: 5_000 });
    expect((await checkTeacherCost(T, g.ports)).outcome).toBe('below_threshold');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects threshold %s before reading anything',
    async (threshold) => {
      const f = fakes({ threshold });
      await expect(checkTeacherCost(T, f.ports)).rejects.toThrow(/threshold/);
      expect(f.sums).toEqual([]);
    },
  );

  it.each(['', "x' or 1=1", 'a'.repeat(129), undefined, 42])(
    'rejects teacher id %j before reading anything',
    async (bad) => {
      const f = fakes();
      await expect(checkTeacherCost(bad as never, f.ports)).rejects.toThrow(/teacher id/);
      expect(f.sums).toEqual([]);
    },
  );

  it('totals for a different teacher than asked are refused, never acted on', async () => {
    const f = fakes({ cost: () => totals({ teacherId: 'tch_b', costMicroUsd: 99_000_000 }) });
    await expect(checkTeacherCost(T, f.ports)).rejects.toThrow(/totals/);
    expect(f.pauses).toEqual([]);
    expect(f.events).toEqual([]);
  });

  it.each([
    ['a negative cost', { costMicroUsd: -1 }],
    ['a fractional unknown count', { unknown: 0.5 }],
    ['a NaN cost', { costMicroUsd: Number.NaN }],
  ])('totals with %s are refused', async (_l, over) => {
    const f = fakes({ cost: over });
    await expect(checkTeacherCost(T, f.ports)).rejects.toThrow(/totals/);
    expect(f.events).toEqual([]);
  });

  it('a failing read throws and does nothing else', async () => {
    const f = fakes({ sumError: new Error('db down') });
    await expect(checkTeacherCost(T, f.ports)).rejects.toThrow('db down');
    expect(f.pauses).toEqual([]);
    expect(f.events).toEqual([]);
  });

  it('a failing pause still alerts (pauseFailed), then throws so the job is retried', async () => {
    const f = fakes({ cost: { costMicroUsd: 70_000_000 }, pauseError: new Error('lock timeout') });
    await expect(checkTeacherCost(T, f.ports)).rejects.toThrow('lock timeout');
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      kind: 'threshold_reached',
      pauseFailed: true,
      pausedSubscriptionIds: [],
    });
  });

  it('a failing pause and a failing alert surface the pause error', async () => {
    const f = fakes({
      cost: { costMicroUsd: 70_000_000 },
      pauseError: new Error('lock timeout'),
      notifyError: new Error('sink down'),
    });
    await expect(checkTeacherCost(T, f.ports)).rejects.toThrow('lock timeout');
  });

  it('a failing alert after a pause throws (the pause stands; a retry re-alerts)', async () => {
    const f = fakes({
      cost: { costMicroUsd: 70_000_000 },
      paused: [FREE_1],
      notifyError: new Error('sink down'),
    });
    await expect(checkTeacherCost(T, f.ports)).rejects.toThrow('sink down');
    expect(f.pauses).toHaveLength(1);
  });

  it('the event carries no student ids and no free text', async () => {
    const f = fakes({ cost: { costMicroUsd: 70_000_000, unknown: 1 }, paused: [FREE_1, FREE_2] });
    await checkTeacherCost(T, f.ports);
    const e = f.events[0]!;
    expect(Object.keys(e).sort()).toEqual([
      'costMicroUsd',
      'kind',
      'monthStartIso',
      'pauseFailed',
      'pausedPackageIds',
      'pausedSubscriptionIds',
      'recipients',
      'teacherId',
      'thresholdMicroUsd',
      'unknownCalls',
      'unpricedCalls',
    ]);
    expect(JSON.stringify(e)).not.toMatch(/stu_/);
  });
});

describe('checkTeachersCost: many teachers, one failure does not stop the rest', () => {
  it('checks each teacher in order and reports failures by teacher', async () => {
    const f = fakes({
      cost: (id) => {
        if (id === 'tch_bad') throw new Error('boom');
        return totals({ teacherId: id, costMicroUsd: id === 'tch_hot' ? 80_000_000 : 1 });
      },
      paused: [FREE_1],
    });
    const out = await checkTeachersCost(['tch_cold', 'tch_bad', 'tch_hot'], f.ports);
    expect(out.results.map((r) => [r.teacherId, r.outcome])).toEqual([
      ['tch_cold', 'below_threshold'],
      ['tch_hot', 'threshold_reached'],
    ]);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]?.teacherId).toBe('tch_bad');
    expect(out.failures[0]?.error).toBeInstanceOf(Error);
    expect(f.events.map((e) => e.teacherId)).toEqual(['tch_hot']);
  });

  it('an empty list does nothing', async () => {
    const f = fakes();
    expect(await checkTeachersCost([], f.ports)).toEqual({ results: [], failures: [] });
    expect(f.sums).toEqual([]);
  });

  it('checks a teacher listed twice once', async () => {
    const f = fakes();
    await checkTeachersCost([T, T], f.ports);
    expect(f.sums).toHaveLength(1);
  });
});
