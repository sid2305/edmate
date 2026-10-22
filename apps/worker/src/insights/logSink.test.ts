import { describe, expect, it } from 'vitest';
import type { LogLine } from '../log.js';
import { logWeeklyInsightsRun, logWeeklyInsightsTeacherFailed } from './logSink.js';

describe('logWeeklyInsightsTeacherFailed', () => {
  it('logs the teacher id, week and the error name/message only', () => {
    const lines: LogLine[] = [];
    logWeeklyInsightsTeacherFailed((l) => lines.push(l), {
      teacherId: 'tch_a',
      weekStart: '2026-10-12',
      error: new Error('insights.computeAndSaveWeek: failed'),
    });
    expect(lines).toEqual([
      {
        level: 'error',
        event: 'weekly_insights.teacher_failed',
        teacherId: 'tch_a',
        weekStart: '2026-10-12',
        error: { name: 'Error', message: 'insights.computeAndSaveWeek: failed' },
      },
    ]);
  });

  it('never includes any extra field a caller might have added to the error object', () => {
    const lines: LogLine[] = [];
    const error = Object.assign(new Error('failed'), { studentText: 'a real question', pii: 'x' });
    logWeeklyInsightsTeacherFailed((l) => lines.push(l), {
      teacherId: 'tch_a',
      weekStart: '2026-10-12',
      error,
    });
    const line = JSON.stringify(lines[0]);
    expect(line).not.toMatch(/studentText|real question|pii/);
  });
});

describe('logWeeklyInsightsRun', () => {
  it('logs warn when any teacher failed', () => {
    const lines: LogLine[] = [];
    logWeeklyInsightsRun((l) => lines.push(l), {
      weekStart: '2026-10-12',
      teachers: 3,
      saved: 2,
      failed: 1,
    });
    expect(lines).toEqual([
      {
        level: 'warn',
        event: 'weekly_insights.run',
        weekStart: '2026-10-12',
        teachers: 3,
        saved: 2,
        failed: 1,
      },
    ]);
  });

  it('logs info on a clean run', () => {
    const lines: LogLine[] = [];
    logWeeklyInsightsRun((l) => lines.push(l), {
      weekStart: '2026-10-12',
      teachers: 1,
      saved: 1,
      failed: 0,
    });
    expect(lines[0]?.level).toBe('info');
  });
});
