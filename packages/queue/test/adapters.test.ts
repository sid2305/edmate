import { LIMITS, type Message } from '@edmate/contracts';
import { demoSafetyAlert, demoTurnTrace, usageMain, usageSmall } from '@edmate/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  COMMIT_QUEUE,
  DEAD_LETTER_QUEUE,
  FAILED_JOB_TTL_SECONDS,
  HelpStateJobSchema,
  JOB,
  jobId,
  jobOptions,
  MAX_TRACKED_TURNS,
  METER_QUEUE,
  MessageJobSchema,
  queuedSessionStateStore,
  queuedTraceSink,
  queuedTranscriptStore,
  queuedTurnPorts,
  queuedUsageMeter,
  RETRY,
  TraceJobSchema,
  UnmeteredJobSchema,
  UsageJobSchema,
  usageRowId,
} from '../src/index.js';
import { fakeQueue } from './fakeQueue.js';

const scope = { studentId: 'stu_test_01', teacherId: 'tch_test_01' };
const ctx = {
  teacherId: 'tch_test_01',
  packageId: 'pkg_test_paid',
  studentId: 'stu_test_01',
  turnId: 'turn_1',
  source: 'subscription',
} as const;
const message: Message = {
  id: 'msg_1',
  role: 'agent',
  text: 'What do you notice?',
  createdAt: '2026-10-18T10:00:00.000Z',
};

describe('queue names, job ids and options', () => {
  it('names the three queues; BullMQ-safe job ids (no colon)', () => {
    expect([METER_QUEUE, COMMIT_QUEUE, DEAD_LETTER_QUEUE]).toEqual([
      'edmate-turn-meter',
      'edmate-turn-commit',
      'edmate-dead-letter',
    ]);
    const all = [
      jobId.usage('turn_1', 0),
      jobId.message('msg_1'),
      jobId.helpState('ses_1', 'w1'),
      jobId.trace('turn_1'),
    ];
    expect(all).toEqual(['turn_1.usage.0', 'msg_1.message', 'ses_1.help.w1', 'turn_1.trace']);
    for (const id of all) expect(id).not.toContain(':');
  });

  it('retries with exponential backoff; the help-state job is never kept after it fails', () => {
    expect(RETRY).toEqual({ attempts: 5, backoff: { type: 'exponential', delay: 1_000 } });
    expect(jobOptions('x', JOB.trace)).toEqual({
      ...RETRY,
      jobId: 'x',
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
    });
    expect(jobOptions('x', JOB.helpState).removeOnFail).toBe(true);
    expect(FAILED_JOB_TTL_SECONDS).toBe(604_800);
  });

  it('usageRowId is stable per (turn, index), distinct across them, and a contracts id', () => {
    const a = usageRowId('turn_1', 0);
    expect(usageRowId('turn_1', 0)).toBe(a);
    expect(usageRowId('turn_1', 1)).not.toBe(a);
    expect(usageRowId('turn_10', 0)).not.toBe(usageRowId('turn_1', 0));
    expect(usageRowId('x'.repeat(128), 99)).toMatch(/^ul_[0-9a-f]{40}$/);
  });
});

describe('queuedUsageMeter', () => {
  it('enqueues one job per usage with the turn index; resolves on the add', async () => {
    const q = fakeQueue();
    const m = queuedUsageMeter(q, scope);
    await m.record(usageSmall, ctx);
    await m.record(usageMain, ctx);
    await m.record(usageMain, { ...ctx, turnId: 'turn_2' });
    expect(q.added.map((j) => [j.name, j.opts.jobId])).toEqual([
      ['usage.record', 'turn_1.usage.0'],
      ['usage.record', 'turn_1.usage.1'],
      ['usage.record', 'turn_2.usage.0'],
    ]);
    expect(q.added[1]?.data).toEqual({
      scope,
      packageId: 'pkg_test_paid',
      turnId: 'turn_1',
      source: 'subscription',
      index: 1,
      usage: usageMain,
    });
    for (const j of q.added) expect(UsageJobSchema.parse(j.data)).toEqual(j.data);
    expect(q.added[0]?.opts).toMatchObject({ attempts: 5, removeOnComplete: true });
  });

  it('recordUnmetered shares the turn index (the gateway MeterSink, 2.4)', async () => {
    const q = fakeQueue();
    const m = queuedUsageMeter(q, scope);
    await m.record(usageMain, ctx);
    await m.recordUnmetered({ ...ctx, tier: 'small', reason: 'no_usage_reported', model: 'm' });
    await m.recordUnmetered({
      ...ctx,
      tier: 'main',
      reason: 'unpriced_model:x',
      model: 'x',
      tokens: { inputTokens: 1, outputTokens: 2 },
    });
    await m.recordUnmetered({ ...ctx, tier: 'small', reason: 'no_usage_reported' });
    expect(q.added.map((j) => [j.name, j.opts.jobId])).toEqual([
      ['usage.record', 'turn_1.usage.0'],
      ['usage.unmetered', 'turn_1.usage.1'],
      ['usage.unmetered', 'turn_1.usage.2'],
      ['usage.unmetered', 'turn_1.usage.3'],
    ]);
    expect(q.added[2]?.data).toMatchObject({ tokens: { inputTokens: 1, outputTokens: 2 } });
    expect(q.added[3]?.data).not.toHaveProperty('model');
    for (const j of q.added.slice(1)) expect(UnmeteredJobSchema.parse(j.data)).toEqual(j.data);
  });

  it('refuses another pair’s context and a bad scope; nothing is enqueued', async () => {
    const q = fakeQueue();
    const m = queuedUsageMeter(q, scope);
    await expect(m.record(usageMain, { ...ctx, studentId: 'stu_other' })).rejects.toThrow(
      /not this meter/,
    );
    await expect(
      m.recordUnmetered({
        ...ctx,
        teacherId: 'tch_other',
        tier: 'main',
        reason: 'no_usage_reported',
      }),
    ).rejects.toThrow(/not this meter/);
    expect(q.added).toEqual([]);
    expect(() => queuedUsageMeter(q, { studentId: '', teacherId: 'tch' })).toThrow(/invalid scope/);
  });

  it('a malformed usage or a failed add rejects (the meter step is then `failed`)', async () => {
    await expect(
      queuedUsageMeter(fakeQueue(), scope).record({ ...usageMain, inputTokens: -1 }, ctx),
    ).rejects.toThrow();
    await expect(
      queuedUsageMeter(fakeQueue({ fail: true }), scope).record(usageMain, ctx),
    ).rejects.toThrow('redis down');
  });

  it('keeps counters for at most MAX_TRACKED_TURNS turns (oldest dropped)', async () => {
    const q = fakeQueue();
    const m = queuedUsageMeter(q, scope);
    await m.record(usageMain, { ...ctx, turnId: 'turn_old' });
    for (let i = 0; i < MAX_TRACKED_TURNS; i += 1) {
      await m.record(usageMain, { ...ctx, turnId: `turn_n${i}` });
    }
    // The newest turn keeps counting; the oldest starts again from 0.
    await m.record(usageMain, { ...ctx, turnId: `turn_n${MAX_TRACKED_TURNS - 1}` });
    await m.record(usageMain, { ...ctx, turnId: 'turn_old' });
    expect(q.added.at(-2)?.opts.jobId).toBe(`turn_n${MAX_TRACKED_TURNS - 1}.usage.1`);
    expect(q.added.at(-1)?.opts.jobId).toBe('turn_old.usage.0');
  });
});

describe('queuedTranscriptStore', () => {
  it('append enqueues the message with its id as the job id; history goes to the reader', async () => {
    const q = fakeQueue();
    const reads: [string, number][] = [];
    const store = queuedTranscriptStore(q, scope, {
      history: (s, n) => {
        reads.push([s, n]);
        return Promise.resolve([message]);
      },
    });
    await store.append('ses_1', message);
    expect(q.added).toEqual([
      {
        name: 'message.append',
        data: { scope, sessionId: 'ses_1', message },
        opts: jobOptions('msg_1.message', JOB.message),
      },
    ]);
    expect(MessageJobSchema.parse(q.added[0]?.data)).toEqual(q.added[0]?.data);
    expect(await store.history('ses_1', 20)).toEqual([message]);
    expect(reads).toEqual([['ses_1', 20]]);
  });

  it('a malformed message or session id, or a failed add, rejects', async () => {
    const reader = { history: () => Promise.resolve([]) };
    const store = queuedTranscriptStore(fakeQueue(), scope, reader);
    await expect(store.append('ses_1', { ...message, id: 'bad id!' })).rejects.toThrow();
    await expect(store.append('bad id!', message)).rejects.toThrow();
    await expect(
      queuedTranscriptStore(fakeQueue({ fail: true }), scope, reader).append('ses_1', message),
    ).rejects.toThrow('redis down');
  });
});

describe('queuedSessionStateStore', () => {
  it('enqueues the help state with a fresh write id per save', async () => {
    const q = fakeQueue();
    let n = 0;
    const store = queuedSessionStateStore(q, scope, { writeId: () => `w${++n}` });
    await store.saveHelpState('ses_1', { v: 1, rung: 1 });
    await store.saveHelpState('ses_1', { v: 1, rung: 2 });
    expect(q.added.map((j) => [j.name, j.opts.jobId, j.opts.removeOnFail])).toEqual([
      ['session.help_state', 'ses_1.help.w1', true],
      ['session.help_state', 'ses_1.help.w2', true],
    ]);
    expect(HelpStateJobSchema.parse(q.added[1]?.data)).toEqual({
      scope,
      sessionId: 'ses_1',
      helpState: { v: 1, rung: 2 },
    });
  });

  it('default write ids are unique', async () => {
    const q = fakeQueue();
    const store = queuedSessionStateStore(q, scope);
    await store.saveHelpState('ses_1', {});
    await store.saveHelpState('ses_1', {});
    expect(new Set(q.added.map((j) => j.opts.jobId)).size).toBe(2);
  });

  it('refuses an oversized or unserialisable value before Redis sees it', async () => {
    const q = fakeQueue();
    const store = queuedSessionStateStore(q, scope);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const at = { a: 'x'.repeat(LIMITS.helpStateMaxJsonLength - 8) };
    await store.saveHelpState('ses_1', at);
    for (const bad of [{ a: `${at.a}x` }, circular, undefined, { n: BigInt(1) }]) {
      await expect(store.saveHelpState('ses_1', bad)).rejects.toThrow(RangeError);
    }
    expect(q.added).toHaveLength(1);
  });

  it('a bad session id or a failed add rejects', async () => {
    await expect(
      queuedSessionStateStore(fakeQueue(), scope).saveHelpState('bad id!', {}),
    ).rejects.toThrow();
    await expect(
      queuedSessionStateStore(fakeQueue({ fail: true }), scope).saveHelpState('ses_1', {}),
    ).rejects.toThrow('redis down');
  });
});

describe('queuedTraceSink', () => {
  it('enqueues the trace as `<turnId>.trace`', async () => {
    const q = fakeQueue();
    await queuedTraceSink(q, scope).record(demoTurnTrace);
    expect(q.added).toEqual([
      {
        name: 'trace.record',
        data: { scope, trace: demoTurnTrace },
        opts: jobOptions(`${demoTurnTrace.turnId}.trace`, JOB.trace),
      },
    ]);
    expect(TraceJobSchema.parse(q.added[0]?.data)).toEqual(q.added[0]?.data);
  });

  it('a malformed trace or a failed add rejects', async () => {
    await expect(
      queuedTraceSink(fakeQueue(), scope).record({ ...demoTurnTrace, turnId: 'bad id!' }),
    ).rejects.toThrow();
    await expect(
      queuedTraceSink(fakeQueue({ fail: true }), scope).record(demoTurnTrace),
    ).rejects.toThrow('redis down');
  });
});

describe('queuedTurnPorts', () => {
  it('meter jobs go to the meter queue, alerts and safety events to their own, the rest to commit', async () => {
    const meter = fakeQueue();
    const commit = fakeQueue();
    const alert = fakeQueue();
    const safetyEvent = fakeQueue();
    const ports = queuedTurnPorts({ meter, commit, alert, safetyEvent }, scope, {
      history: () => Promise.resolve([]),
    });
    await ports.alerts.raise(demoSafetyAlert);
    await ports.safetyEvents.record({
      ...scope,
      sessionId: 'ses_1',
      turnId: 'trn_1',
      guard: 'moderationIn',
      code: 'hate',
      source: 'rule',
    });
    expect(safetyEvent.added.map((j) => j.name)).toEqual(['safety_event.record']);
    await ports.usage.record(usageMain, ctx);
    await ports.transcripts.append('ses_1', message);
    await ports.sessionState.saveHelpState('ses_1', {});
    await ports.traces.record(demoTurnTrace);
    expect(meter.added.map((j) => j.name)).toEqual(['usage.record']);
    expect(commit.added.map((j) => j.name)).toEqual([
      'message.append',
      'session.help_state',
      'trace.record',
    ]);
    expect(alert.added.map((j) => j.name)).toEqual(['alert.escalate_check', 'alert.raise']);
  });

  it('passes the alert options through (a shorter escalation delay)', async () => {
    const alert = fakeQueue();
    const ports = queuedTurnPorts(
      { meter: fakeQueue(), commit: fakeQueue(), alert, safetyEvent: fakeQueue() },
      scope,
      { history: () => Promise.resolve([]) },
      { escalateAfterMs: 25 },
    );
    await ports.alerts.raise(demoSafetyAlert);
    expect(alert.added[0]?.opts.delay).toBe(25);
  });
});
