// Task 8.7 Phase C: the publish-gate queue (no real Redis: a fake connection and a fake queue).
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  createGateQueue,
  enqueueGate,
  FAILED_JOB_TTL_SECONDS,
  GATE_JOB,
  GATE_QUEUE,
  GateJobSchema,
  gateJobId,
  gateJobOptions,
} from '../src/index.js';
import { fakeQueue } from './fakeQueue.js';

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

const RUN = '11111111-2222-4333-8444-555555555555';
const TEACHER = 'teacher_gate_1';

describe('GateJobSchema', () => {
  it('accepts exactly {runId, teacherId}', () => {
    expect(GateJobSchema.parse({ runId: RUN, teacherId: TEACHER })).toEqual({
      runId: RUN,
      teacherId: TEACHER,
    });
  });

  it('rejects extra keys, missing keys and bad ids', () => {
    expect(GateJobSchema.safeParse({ runId: RUN, teacherId: TEACHER, agentId: 'a' }).success).toBe(
      false,
    );
    expect(GateJobSchema.safeParse({ runId: RUN }).success).toBe(false);
    expect(GateJobSchema.safeParse({ runId: '', teacherId: TEACHER }).success).toBe(false);
    expect(GateJobSchema.safeParse({ runId: RUN, teacherId: 'has space' }).success).toBe(false);
    expect(GateJobSchema.safeParse(null).success).toBe(false);
  });
});

describe('gate job options', () => {
  it('has a stable job id per run, with no colon', () => {
    expect(gateJobId(RUN)).toBe(`${RUN}.gate`);
    expect(gateJobId(RUN)).toBe(gateJobId(RUN));
    expect(gateJobId(RUN)).not.toContain(':');
  });

  it('runs once (a 2 h gate is never auto-retried) and keeps failures 7 days', () => {
    expect(gateJobOptions(RUN)).toEqual({
      jobId: `${RUN}.gate`,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { age: FAILED_JOB_TTL_SECONDS, count: 1_000 },
    });
  });
});

describe('enqueueGate', () => {
  it('adds one gate job with its options', async () => {
    const q = fakeQueue();
    await enqueueGate(q, { runId: RUN, teacherId: TEACHER });
    expect(q.added).toEqual([
      { name: GATE_JOB, data: { runId: RUN, teacherId: TEACHER }, opts: gateJobOptions(RUN) },
    ]);
  });

  it('refuses a malformed job before touching the queue', async () => {
    const q = fakeQueue();
    await expect(
      enqueueGate(q, { runId: RUN, teacherId: TEACHER, extra: 1 } as never),
    ).rejects.toThrow();
    expect(q.added).toEqual([]);
  });

  it('passes a queue failure to the caller', async () => {
    await expect(enqueueGate(fakeQueue({ fail: true }), { runId: RUN, teacherId: TEACHER })).rejects.toThrow(
      'redis down',
    );
  });
});

describe('createGateQueue', () => {
  it('builds the gate queue on the caller’s connection without connecting', async () => {
    const redis = new FakeRedis();
    const q = createGateQueue(redis as never);
    expect((q as unknown as { name: string }).name).toBe(GATE_QUEUE);
    await q.close();
    expect(redis.connect).not.toHaveBeenCalled();
  });

  it('takes a key prefix', async () => {
    const redis = new FakeRedis();
    const q = createGateQueue(redis as never, { prefix: 'gate-test' });
    expect((q as unknown as { opts: { prefix: string } }).opts.prefix).toBe('gate-test');
    await q.close();
  });
});
