// The safety-event producer (task 4.4, ADR-0006): SafetyEventSink on its own queue. The event is
// validated (strict, codes only, no text) before it is enqueued; the job id is the dedupe key
// `${turnId}:${guard}` (with `.`), so a retried guard run enqueues nothing new.
import { describe, expect, it } from 'vitest';
import {
  FAILED_JOB_TTL_SECONDS,
  JOB,
  jobId,
  queuedSafetyEventSink,
  RETRY,
  SAFETY_EVENT_QUEUE,
  SafetyEventJobSchema,
  SafetyEventSchema,
} from '../src/index.js';
import { fakeQueue } from './fakeQueue.js';

const T = 1_000;
const scope = { studentId: 'stu_test_01', teacherId: 'tch_test_01' };
const event = {
  ...scope,
  sessionId: 'ses_test_01',
  turnId: 'trn_test_01',
  guard: 'jailbreak',
  code: 'jailbreak_override',
  source: 'rule',
} as const;

describe('safety-event queue names, ids and schemas', () => {
  it(
    'names the queue and job; the id is the turn and guard, BullMQ-safe',
    () => {
      expect(SAFETY_EVENT_QUEUE).toBe('edmate-safety-event');
      expect(JOB.safetyEventRecord).toBe('safety_event.record');
      expect(jobId.safetyEvent('trn_1', 'jailbreak')).toBe('trn_1.jailbreak.safety');
      expect(jobId.safetyEvent('trn_1', 'moderationIn')).toBe('trn_1.moderationIn.safety');
      expect(jobId.safetyEvent('trn_1', 'jailbreak')).not.toContain(':');
    },
    T,
  );

  it(
    'the event schema is strict: no extra field, no free-text code',
    () => {
      expect(SafetyEventSchema.safeParse(event).success).toBe(true);
      expect(SafetyEventSchema.safeParse({ ...event, excerpt: 'x' }).success).toBe(false);
      expect(SafetyEventSchema.safeParse({ ...event, code: 'he asked for slurs' }).success).toBe(
        false,
      );
      expect(SafetyEventSchema.safeParse({ ...event, guard: 'answerLeak' }).success).toBe(false);
      expect(SafetyEventSchema.safeParse({ ...event, source: 'human' }).success).toBe(false);
      expect(SafetyEventSchema.safeParse({ ...event, turnId: 'bad id!' }).success).toBe(false);
    },
    T,
  );

  it(
    'the job schema is strict too',
    () => {
      const job = {
        scope,
        sessionId: 'ses_test_01',
        turnId: 'trn_test_01',
        guard: 'jailbreak',
        code: 'jailbreak_other',
        source: 'classifier',
      };
      expect(SafetyEventJobSchema.safeParse(job).success).toBe(true);
      expect(SafetyEventJobSchema.safeParse({ ...job, reason: 'x' }).success).toBe(false);
      expect(SafetyEventJobSchema.safeParse({ ...job, scope: { studentId: 'x' } }).success).toBe(
        false,
      );
    },
    T,
  );
});

describe('queuedSafetyEventSink', () => {
  it(
    'enqueues one job with the dedupe id and the turn-queue retries; resolves once queued',
    async () => {
      const q = fakeQueue();
      await queuedSafetyEventSink(q, scope).record(event);
      expect(q.added).toEqual([
        {
          name: 'safety_event.record',
          data: {
            scope,
            sessionId: 'ses_test_01',
            turnId: 'trn_test_01',
            guard: 'jailbreak',
            code: 'jailbreak_override',
            source: 'rule',
          },
          opts: {
            ...RETRY,
            jobId: 'trn_test_01.jailbreak.safety',
            removeOnComplete: true,
            removeOnFail: { age: FAILED_JOB_TTL_SECONDS, count: 1_000 },
          },
        },
      ]);
    },
    T,
  );

  it(
    'refuses an event for another student or teacher than the bound scope',
    async () => {
      const q = fakeQueue();
      const sink = queuedSafetyEventSink(q, scope);
      await expect(sink.record({ ...event, studentId: 'stu_other' })).rejects.toThrow(
        'queuedSafetyEventSink: event outside the bound scope',
      );
      await expect(sink.record({ ...event, teacherId: 'tch_other' })).rejects.toThrow(
        /bound scope/,
      );
      expect(q.added).toEqual([]);
    },
    T,
  );

  it(
    'refuses a malformed event without quoting it',
    async () => {
      const q = fakeQueue();
      const sink = queuedSafetyEventSink(q, scope);
      const bad = { ...event, code: 'canary_text_9' } as unknown as typeof event;
      const err = await sink.record(bad).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err?.message).toBe('queuedSafetyEventSink: invalid safety event');
      expect(err?.message).not.toContain('canary');
      expect(q.added).toEqual([]);
    },
    T,
  );

  it(
    'a queue failure rejects (the guard then fails the chain closed)',
    async () => {
      await expect(
        queuedSafetyEventSink(fakeQueue({ fail: true }), scope).record(event),
      ).rejects.toThrow('redis down');
    },
    T,
  );

  it(
    'an invalid bound scope is refused when the sink is built',
    () => {
      expect(() =>
        queuedSafetyEventSink(fakeQueue(), { studentId: '', teacherId: 'tch_1' }),
      ).toThrow(/invalid scope/);
    },
    T,
  );
});
