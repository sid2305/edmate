import { JOB } from '@edmate/queue';
import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import type { LogLine } from '../log.js';
import {
  deadLetterRefs,
  type FailedJob,
  isFinal,
  onJobFailed,
  PRUNE_BATCH,
  pruneDeadLetters,
} from './deadLetter.js';

const CANARY = 'CANARY-ANSWER-0b1d';
const NOW = new Date('2026-10-18T10:00:00.000Z');

function world(opts: { dlqFails?: boolean } = {}) {
  const lines: LogLine[] = [];
  const dead: { name: string; data: unknown; opts: unknown }[] = [];
  const handler = onJobFailed({
    log: (l) => lines.push(l),
    now: () => NOW,
    deadLetter: {
      add: (name, data, o) => {
        if (opts.dlqFails === true) return Promise.reject(new Error('redis down'));
        dead.push({ name, data, opts: o });
        return Promise.resolve();
      },
    },
  });
  return { lines, dead, handler };
}

const job = (o: Partial<FailedJob> = {}): FailedJob => ({
  id: 'msg_1.message',
  name: JOB.message,
  queueName: 'edmate-turn-commit',
  data: {
    scope: { studentId: 'stu_1', teacherId: 'tch_a' },
    sessionId: 'ses_1',
    message: {
      id: 'msg_1',
      role: 'student',
      text: 'student text',
      createdAt: '2026-10-18T10:00:00.000Z',
      sources: [{ title: 'student notes title', locator: 'p. 1', kind: 'material' }],
    },
  },
  attemptsMade: 5,
  opts: { attempts: 5 },
  ...o,
});

describe('isFinal', () => {
  it('is final on an UnrecoverableError or once the attempts are used up', () => {
    expect(isFinal(job({ attemptsMade: 1 }), new UnrecoverableError('x'))).toBe(true);
    expect(isFinal(job({ attemptsMade: 4 }), new Error('x'))).toBe(false);
    expect(isFinal(job({ attemptsMade: 5 }), new Error('x'))).toBe(true);
    expect(isFinal(job({ attemptsMade: 1, opts: {} }), new Error('x'))).toBe(true);
  });
});

describe('deadLetterRefs', () => {
  it('keeps the ids of every job kind and nothing else', () => {
    const scope = { studentId: 'stu_1', teacherId: 'tch_a' };
    expect(deadLetterRefs(job().data)).toEqual({
      studentId: 'stu_1',
      teacherId: 'tch_a',
      sessionId: 'ses_1',
      messageId: 'msg_1',
      role: 'student',
    });
    expect(
      deadLetterRefs({
        scope,
        packageId: 'pkg_a',
        turnId: 'turn_1',
        index: 2,
        source: 'subscription',
        usage: { model: 'm' },
      }),
    ).toEqual({ ...scope, packageId: 'pkg_a', turnId: 'turn_1', index: 2 });
    expect(
      deadLetterRefs({ scope, trace: { turnId: 'turn_1', sessionId: 'ses_1', guards: [] } }),
    ).toEqual({ ...scope, turnId: 'turn_1', sessionId: 'ses_1' });
    const help = deadLetterRefs({ scope, sessionId: 'ses_1', helpState: { answerKey: [CANARY] } });
    expect(help).toEqual({ ...scope, sessionId: 'ses_1' });
  });

  it('reads a malformed payload defensively', () => {
    expect(deadLetterRefs(null)).toEqual({});
    expect(deadLetterRefs('student text')).toEqual({});
    expect(
      deadLetterRefs({ scope: 'x', sessionId: 7, index: 1.5, turnId: 'x'.repeat(500) }),
    ).toEqual({ turnId: 'x'.repeat(128) });
  });
});

describe('onJobFailed', () => {
  it('a retryable failure is logged as a warning and not dead-lettered', async () => {
    const w = world();
    await w.handler(job({ attemptsMade: 2 }), new Error('db down'));
    expect(w.dead).toEqual([]);
    expect(w.lines).toEqual([
      {
        level: 'warn',
        event: 'job.failed_will_retry',
        queue: 'edmate-turn-commit',
        name: 'message.append',
        jobId: 'msg_1.message',
        attemptsMade: 2,
        error: { name: 'Error', message: 'db down' },
      },
    ]);
  });

  it('a final failure is dead-lettered and logged loudly; no payload text in the log', async () => {
    const w = world();
    await w.handler(job(), new Error('db down'));
    expect(w.dead).toEqual([
      {
        name: 'dead',
        data: {
          queue: 'edmate-turn-commit',
          name: 'message.append',
          jobId: 'msg_1.message',
          attemptsMade: 5,
          error: { name: 'Error', message: 'db down' },
          failedAt: NOW.toISOString(),
          refs: {
            studentId: 'stu_1',
            teacherId: 'tch_a',
            sessionId: 'ses_1',
            messageId: 'msg_1',
            role: 'student',
          },
        },
        opts: {
          jobId: 'edmate-turn-commit.msg_1.message',
          removeOnComplete: { age: 604_800 },
          removeOnFail: { age: 604_800 },
        },
      },
    ]);
    // No student free text in the dead-letter entry or the log.
    for (const text of ['student text', 'student notes title']) {
      expect(JSON.stringify(w.dead)).not.toContain(text);
      expect(JSON.stringify(w.lines)).not.toContain(text);
    }
    expect(w.lines.map((l) => [l.level, l.event])).toEqual([['error', 'job.dead_lettered']]);
  });

  it('a help-state job is dead-lettered without its value', async () => {
    const w = world();
    await w.handler(
      job({
        id: 'ses_1.help.w1',
        name: JOB.helpState,
        data: { sessionId: 'ses_1', helpState: { answerKey: [CANARY] } },
      }),
      new UnrecoverableError('session.help_state: sessions.saveHelpState: not_found'),
    );
    expect(JSON.stringify(w.dead)).not.toContain(CANARY);
    expect(JSON.stringify(w.lines)).not.toContain(CANARY);
  });

  it('a failing dead-letter write is logged (dead_letter.failed), never thrown', async () => {
    const w = world({ dlqFails: true });
    await expect(w.handler(job(), new Error('db down'))).resolves.toBeUndefined();
    expect(w.lines).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'dead_letter.failed',
        jobId: 'msg_1.message',
        deadLetterError: { name: 'Error', message: 'redis down' },
      }),
    ]);
  });

  it('a failure with no job (BullMQ passes undefined) is still logged; an id-less job too', async () => {
    const w = world();
    await w.handler(undefined, new Error('lock lost'));
    await w.handler(job({ id: undefined, attemptsMade: 1 }), new Error('x'));
    expect(w.lines.map((l) => [l.event, l.jobId])).toEqual([
      ['job.failed', null],
      ['job.failed_will_retry', ''],
    ]);
  });
});

describe('pruneDeadLetters', () => {
  it('removes waiting entries older than 7 days and logs how many', async () => {
    const lines: LogLine[] = [];
    const calls: unknown[][] = [];
    const queue = {
      clean: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(['a', 'b']);
      },
    };
    expect(await pruneDeadLetters(queue, (l) => lines.push(l))).toBe(2);
    expect(calls).toEqual([[604_800_000, PRUNE_BATCH, 'wait']]);
    expect(lines).toEqual([{ level: 'info', event: 'dead_letter.pruned', removed: 2 }]);
  });

  it('logs nothing when nothing expired; a failure is logged, never thrown', async () => {
    const lines: LogLine[] = [];
    expect(await pruneDeadLetters({ clean: () => Promise.resolve([]) }, (l) => lines.push(l))).toBe(
      0,
    );
    expect(lines).toEqual([]);
    expect(
      await pruneDeadLetters({ clean: () => Promise.reject(new Error('redis down')) }, (l) =>
        lines.push(l),
      ),
    ).toBe(0);
    expect(lines).toEqual([
      {
        level: 'error',
        event: 'dead_letter.prune_failed',
        error: { name: 'Error', message: 'redis down' },
      },
    ]);
  });
});
