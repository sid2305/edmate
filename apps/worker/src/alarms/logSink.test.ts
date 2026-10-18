import { describe, expect, it, vi } from 'vitest';
import { logCostAlarmSink } from './logSink.js';
import type { CostAlarmEvent } from './types.js';

const EVENT: CostAlarmEvent = {
  kind: 'threshold_reached',
  recipients: ['staff', 'teacher'],
  teacherId: 'tch_a',
  monthStartIso: '2026-10-01T00:00:00.000Z',
  costMicroUsd: 50_000_000,
  thresholdMicroUsd: 50_000_000,
  unknownCalls: 2,
  unpricedCalls: 0,
  pausedSubscriptionIds: ['sub_1a'],
  pausedPackageIds: ['pkg_free'],
  pauseFailed: false,
};

describe('logCostAlarmSink (the stub until a delivery vendor is chosen)', () => {
  it('writes one structured JSON line per event', async () => {
    const lines: string[] = [];
    await logCostAlarmSink((l) => lines.push(l)).notify(EVENT);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ level: 'warn', event: 'cost_alarm', ...EVENT });
  });

  it('only the event fields reach the line, even if a caller adds more', async () => {
    const lines: string[] = [];
    const extra = { ...EVENT, studentName: 'Ada', note: 'free text' } as CostAlarmEvent;
    await logCostAlarmSink((l) => lines.push(l)).notify(extra);
    expect(lines[0]).not.toMatch(/Ada|free text|studentName|note/);
    expect(lines[0]).not.toMatch(/stu_/);
  });

  it('defaults to console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await logCostAlarmSink().notify(EVENT);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ event: 'cost_alarm' });
    } finally {
      warn.mockRestore();
    }
  });
});
