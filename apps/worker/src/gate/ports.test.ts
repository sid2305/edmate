import { describe, expect, it } from 'vitest';
import { gateCasePorts, gateSideEffects, gateUsageMeter, systemClock, systemIds } from './ports.js';

const msg = (id: string) => ({ id, role: 'student' as const, text: id, createdAt: new Date().toISOString() });

describe('gateCasePorts (in memory, nothing durable)', () => {
  it('transcripts keep per-session order and honour the limit', async () => {
    const p = gateCasePorts(gateSideEffects());
    await p.transcripts.append('s1', msg('a'));
    await p.transcripts.append('s1', msg('b'));
    await p.transcripts.append('s2', msg('c'));
    expect((await p.transcripts.history('s1', 1)).map((m) => m.id)).toEqual(['b']);
    expect((await p.transcripts.history('s1', 5)).map((m) => m.id)).toEqual(['a', 'b']);
    expect(await p.transcripts.history('s1', 0)).toEqual([]);
    expect(await p.transcripts.history('none', 5)).toEqual([]);
  });

  it('help state round-trips in memory, null when unset', async () => {
    const p = gateCasePorts(gateSideEffects());
    expect(p.helpState('s1')).toBeNull();
    await p.sessionState.saveHelpState('s1', { rung: 2 });
    expect(p.helpState('s1')).toEqual({ rung: 2 });
  });

  it('profiles are blank and evidence never moves mastery', async () => {
    const p = gateCasePorts(gateSideEffects());
    expect(await p.profiles.get('st', 'tch')).toMatchObject({ studentId: 'st', teacherId: 'tch', mastery: {} });
    const after = await p.profiles.applyEvidence([
      { studentId: 'st', teacherId: 'tch', topicId: 'top', correct: true, source: 'check', weight: 1, ts: new Date().toISOString() },
    ]);
    expect(after).toMatchObject({ studentId: 'st', mastery: {} });
    expect(await p.profiles.applyEvidence([])).toMatchObject({ studentId: '', mastery: {} });
  });

  it('every write port only counts', async () => {
    const effects = gateSideEffects();
    const p = gateCasePorts(effects);
    await p.traces.record({} as never);
    await p.alerts.raise({} as never);
    await p.safetyEvents.record({} as never);
    expect(await p.teacherQuestions.findSimilar('tch', 'x')).toEqual([]);
    const q = await p.teacherQuestions.open({ teacherId: 'tch', agentId: 'agt', studentId: 'st', text: 'q', similarIds: [] });
    expect(q).toMatchObject({ status: 'open', text: 'q' });
    expect(q.id).toMatch(/^gateq_/);
    p.log.backgroundFailure({} as never);
    expect(effects).toEqual({
      alerts: 1,
      safetyEvents: 1,
      teacherQuestions: 1,
      traces: 1,
      backgroundFailures: 1,
      lockedLeaks: 0,
    });
  });
});

describe('gateUsageMeter', () => {
  it('sums priced calls and counts unmetered ones apart', async () => {
    const m = gateUsageMeter();
    const u = { model: 'm', tier: 'main' as const, inputTokens: 1, outputTokens: 1, costMicroUsd: 5 };
    await m.record(u);
    await m.record({ ...u, costMicroUsd: 7 });
    await m.recordUnmetered({ reason: 'unpriced_model:x' } as never);
    await m.recordUnmetered({ reason: 'unpriced_model:x' } as never);
    expect(m.totals()).toEqual({ calls: 2, costMicroUsd: 12, unmetered: 2, unmeteredReasons: ['unpriced_model:x'] });
  });
});

describe('system clock and ids', () => {
  it('sleeps, and a cancel ends the sleep early', async () => {
    const clock = systemClock();
    expect(clock.now()).toBeGreaterThan(0);
    await clock.sleep(1);
    let cancel: (() => void) | undefined;
    const slept = clock.sleep(60_000, { onCancel: (fn: () => void) => { cancel = fn; } } as never);
    cancel?.();
    await slept;
  });

  it('ids are prefixed by kind and unique', () => {
    const ids = systemIds();
    const a = ids.next('turn' as never);
    expect(a).toMatch(/^turn_/);
    expect(ids.next('turn' as never)).not.toBe(a);
  });
});
