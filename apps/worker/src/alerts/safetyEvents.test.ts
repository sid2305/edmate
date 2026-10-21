// The safety-event processor and worker (task 4.4, ADR-0006): each job becomes one safety_events
// row through the repository, scoped to the job's student x teacher; a replay writes nothing new;
// a malformed payload or a permanent repository error is not retried; logs carry ids and the code.
import { EventEmitter } from 'node:events';
import { RepositoryError } from '@edmate/db';
import { JOB, RETRY, SAFETY_EVENT_QUEUE } from '@edmate/queue';
import { describe, expect, it, vi } from 'vitest';
import { PermanentJobError } from '../commit/processors.js';
import type { LogLine } from '../log.js';
import {
  createSafetyEventWorker,
  type SafetyEventRepo,
  safetyEventProcessor,
} from './safetyEvents.js';

const T = 5_000;
const scope = { studentId: 'stu_test_01', teacherId: 'tch_test_01' };
const data = {
  scope,
  sessionId: 'ses_test_01',
  turnId: 'trn_test_01',
  guard: 'jailbreak',
  code: 'jailbreak_override',
  source: 'rule',
};
const job = (d: unknown = data, name: string = JOB.safetyEventRecord) => ({
  id: 'j1',
  name,
  data: d,
});

function repo(results: ({ id: string; written: boolean } | Error)[] = []) {
  const calls: unknown[][] = [];
  const r: SafetyEventRepo = {
    record(...args) {
      calls.push(args);
      const next = results.shift() ?? { id: 'se_1', written: true };
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
  return { r, calls };
}

describe('safetyEventProcessor', () => {
  it(
    'writes the event under the job scope; logs ids and the code, never more',
    async () => {
      const { r, calls } = repo();
      const lines: LogLine[] = [];
      const out = await safetyEventProcessor(r, (l) => lines.push(l))(job());
      expect(out).toBe('written');
      expect(calls).toEqual([
        [
          scope,
          {
            sessionId: 'ses_test_01',
            turnId: 'trn_test_01',
            guard: 'jailbreak',
            code: 'jailbreak_override',
            source: 'rule',
          },
        ],
      ]);
      expect(lines).toEqual([
        {
          level: 'info',
          event: 'safety_event.recorded',
          jobId: 'j1',
          sessionId: 'ses_test_01',
          turnId: 'trn_test_01',
          guard: 'jailbreak',
          code: 'jailbreak_override',
          source: 'rule',
          outcome: 'written',
        },
      ]);
    },
    T,
  );

  it(
    'a replay is already_written',
    async () => {
      const { r } = repo([{ id: 'se_1', written: false }]);
      expect(await safetyEventProcessor(r, () => undefined)(job())).toBe('already_written');
    },
    T,
  );

  it(
    'an unknown job name or a malformed payload is permanent, without quoting the payload',
    async () => {
      const { r, calls } = repo();
      const p = safetyEventProcessor(r, () => undefined);
      await expect(p(job(data, 'something.else'))).rejects.toBeInstanceOf(PermanentJobError);
      const err = await p(job({ ...data, code: 'canary free text' })).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err).toBeInstanceOf(PermanentJobError);
      expect(err?.message).not.toContain('canary');
      await expect(p(job({ ...data, excerpt: 'x' }))).rejects.toBeInstanceOf(PermanentJobError);
      expect(calls).toEqual([]);
    },
    T,
  );

  it(
    'not_found, scope or invalid from the repository is permanent; a database outage is retried',
    async () => {
      for (const kind of ['not_found', 'scope', 'invalid', 'integrity'] as const) {
        const { r } = repo([new RepositoryError(kind, 'safetyEvents.record')]);
        await expect(safetyEventProcessor(r, () => undefined)(job())).rejects.toBeInstanceOf(
          PermanentJobError,
        );
      }
      const down = new RepositoryError('failed', 'safetyEvents.record');
      const { r } = repo([down]);
      await expect(safetyEventProcessor(r, () => undefined)(job())).rejects.toBe(down);
    },
    T,
  );
});

/** A Redis stand-in that never opens a socket (rule 4). */
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

describe('createSafetyEventWorker', () => {
  it(
    'builds the worker on the safety-event queue without connecting; failures dead-letter',
    async () => {
      const redis = new FakeRedis();
      const dead: unknown[] = [];
      const lines: LogLine[] = [];
      const w = createSafetyEventWorker({
        connection: redis as never,
        repos: { safetyEvents: repo().r },
        deadLetter: { add: (_n: string, d: unknown) => Promise.resolve(dead.push(d)) },
        log: (l) => lines.push(l),
        now: () => new Date('2026-10-19T10:00:00.000Z'),
        prefix: 'edmate-test',
      });
      try {
        expect(w.name).toBe(SAFETY_EVENT_QUEUE);
        expect(w.isRunning()).toBe(false);
        expect(redis.connect).not.toHaveBeenCalled();
        // A final failure (attempts used up) is dead-lettered with ids only.
        w.emit(
          'failed',
          {
            id: 'j1',
            name: JOB.safetyEventRecord,
            queueName: SAFETY_EVENT_QUEUE,
            data,
            attemptsMade: RETRY.attempts,
            opts: { attempts: RETRY.attempts },
          } as never,
          new Error('db down'),
          'active',
        );
        w.emit('error', new Error('redis blip'));
        await vi.waitFor(() => expect(dead).toHaveLength(1));
        expect(dead[0]).toMatchObject({
          queue: SAFETY_EVENT_QUEUE,
          refs: { studentId: 'stu_test_01', sessionId: 'ses_test_01', turnId: 'trn_test_01' },
        });
        expect(JSON.stringify(dead[0])).not.toContain('jailbreak_override');
        expect(lines.some((l) => l.event === 'worker.error')).toBe(true);
      } finally {
        await w.close();
      }
    },
    T,
  );
});
