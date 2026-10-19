import { JOB } from '@edmate/queue';
import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import type { LogLine } from '../log.js';
import { deadLetterData, type FailedJob, isFinal, onJobFailed } from './deadLetter.js';

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
  data: { scope: { studentId: 'stu_1', teacherId: 'tch_a' }, message: { text: 'student text' } },
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

describe('deadLetterData', () => {
  it('drops the help state value (the answer key) and keeps everything else', () => {
    const data = { scope: { studentId: 's' }, sessionId: 'ses_1', helpState: { answerKey: [CANARY] } };
    const kept = deadLetterData(JOB.helpState, data);
    expect(JSON.stringify(kept)).not.toContain(CANARY);
    expect(kept).toEqual({ scope: { studentId: 's' }, sessionId: 'ses_1', helpStateDropped: true });
    expect(deadLetterData(JOB.message, data)).toBe(data);
    expect(deadLetterData(JOB.helpState, null)).toBeNull();
    expect(deadLetterData(JOB.helpState, 'x')).toBe('x');
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
          data: job().data,
        },
        opts: { jobId: 'edmate-turn-commit.msg_1.message', removeOnComplete: false, removeOnFail: false },
      },
    ]);
    expect(w.lines.map((l) => [l.level, l.event])).toEqual([['error', 'job.dead_lettered']]);
    expect(JSON.stringify(w.lines)).not.toContain('student text');
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
