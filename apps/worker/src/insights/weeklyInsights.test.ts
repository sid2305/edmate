import { describe, expect, it } from 'vitest';
import { finishedWeekStart, weeklyInsightsForTeacher } from './weeklyInsights.js';

describe('finishedWeekStart', () => {
  it('a Monday 07:00 run reports the week that ended at that Monday 00:00 UTC', () => {
    expect(finishedWeekStart(new Date('2026-10-19T07:00:00.000Z'))).toBe('2026-10-12');
  });

  it('a run just after midnight UTC on a Monday still reports the prior week', () => {
    expect(finishedWeekStart(new Date('2026-10-19T00:00:00.001Z'))).toBe('2026-10-12');
  });

  it('a run exactly at Monday 00:00:00.000 UTC reports the prior week', () => {
    expect(finishedWeekStart(new Date('2026-10-19T00:00:00.000Z'))).toBe('2026-10-12');
  });

  it('a mid-week hand re-run reports the same, already-finished, previous week', () => {
    expect(finishedWeekStart(new Date('2026-10-21T15:30:00.000Z'))).toBe('2026-10-12');
    // Never the current (in-progress) week, and never a future week.
    expect(finishedWeekStart(new Date('2026-10-21T15:30:00.000Z'))).not.toBe('2026-10-19');
  });

  it('a Sunday run (end of the in-progress week) still reports the prior finished week', () => {
    expect(finishedWeekStart(new Date('2026-10-25T23:59:59.999Z'))).toBe('2026-10-12');
  });

  it('throws on an invalid date', () => {
    expect(() => finishedWeekStart(new Date('not-a-date'))).toThrow(/invalid date/);
  });
});

describe('weeklyInsightsForTeacher', () => {
  it('calls only computeAndSaveWeek, with a teacher scope and the given week', async () => {
    const calls: unknown[] = [];
    const backend = {
      computeAndSaveWeek: (scope: unknown, weekStart: unknown) => {
        calls.push([scope, weekStart]);
        return Promise.resolve({ week: weekStart, payload: {}, updatedAt: 'x' });
      },
    };
    await weeklyInsightsForTeacher(backend, 'tch_a', '2026-10-12');
    expect(calls).toEqual([[{ teacherId: 'tch_a' }, '2026-10-12']]);
  });

  it('propagates a failed computeAndSaveWeek', async () => {
    const backend = {
      computeAndSaveWeek: () => Promise.reject(new Error('insights.computeAndSaveWeek: failed')),
    };
    await expect(weeklyInsightsForTeacher(backend, 'tch_a', '2026-10-12')).rejects.toThrow(
      /failed/,
    );
  });
});
