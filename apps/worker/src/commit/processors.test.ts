import type { Message, TurnTrace } from '@edmate/contracts';
import { type Repositories, RepositoryError } from '@edmate/db';
import { JOB, usageRowId } from '@edmate/queue';
import { describe, expect, it } from 'vitest';
import type { LogLine } from '../log.js';
import { commitProcessor, meterProcessor, PermanentJobError } from './processors.js';

const scope = { studentId: 'stu_1', teacherId: 'tch_a' };
const noLog = () => undefined;
const usage = {
  model: 'm',
  tier: 'main',
  inputTokens: 1,
  outputTokens: 2,
  costMicroUsd: 3,
} as const;
const message: Message = {
  id: 'msg_1',
  role: 'agent',
  text: 'What do you notice?',
  createdAt: '2026-10-18T10:00:00.000Z',
};
const trace: TurnTrace = {
  turnId: 'turn_1',
  sessionId: 'ses_1',
  agentVersion: 1,
  packageVersion: 1,
  steps: [],
  intent: 'on_task',
  move: 'hint',
  guards: [],
  usage: [],
};

/**
 * In-memory repositories with the db's own duplicate rules: a duplicate usage id is `invalid`, a
 * duplicate message id is `not_found`, a second trace for a turn is `invalid`. `fail` makes the
 * named write throw that error instead.
 */
function memoryRepos(fail: Partial<Record<string, unknown>> = {}) {
  const ledger: { id: string; turnId: string }[] = [];
  const messages: { sessionId: string; m: Message }[] = [];
  const traces: TurnTrace[] = [];
  const help: { sessionId: string; value: unknown }[] = [];
  const calls: string[] = [];
  const check = (name: string) => {
    calls.push(name);
    if (fail[name] !== undefined) throw fail[name];
  };
  const repos = {
    usageLedger: {
      listForTurn: (_s: unknown, turnId: string) => {
        check('listForTurn');
        return Promise.resolve(ledger.filter((r) => r.turnId === turnId));
      },
      record: (_s: unknown, _p: string, e: { id: string; turnId: string }) => {
        check('record');
        if (ledger.some((r) => r.id === e.id))
          throw new RepositoryError('invalid', 'usageLedger.record');
        ledger.push({ id: e.id, turnId: e.turnId });
        return Promise.resolve();
      },
      recordUnmetered: (_s: unknown, _p: string, e: { id: string; turnId: string }) => {
        check('recordUnmetered');
        ledger.push({ id: e.id, turnId: e.turnId });
        return Promise.resolve();
      },
    },
    messages: {
      history: (_s: unknown, sessionId: string) => {
        check('history');
        return Promise.resolve(messages.filter((x) => x.sessionId === sessionId).map((x) => x.m));
      },
      append: (_s: unknown, sessionId: string, m: Message) => {
        check('append');
        if (messages.some((x) => x.m.id === m.id)) {
          throw new RepositoryError('not_found', 'messages.append');
        }
        messages.push({ sessionId, m });
        return Promise.resolve();
      },
    },
    sessions: {
      saveHelpState: (_s: unknown, sessionId: string, value: unknown) => {
        check('saveHelpState');
        help.push({ sessionId, value });
        return Promise.resolve();
      },
    },
    turnTraces: {
      findForTurn: (_s: unknown, ref: { sessionId: string; turnId: string }) => {
        check('findForTurn');
        return Promise.resolve(
          traces.find((t) => t.sessionId === ref.sessionId && t.turnId === ref.turnId) ?? null,
        );
      },
      insert: (_s: unknown, t: TurnTrace) => {
        check('insert');
        if (traces.some((x) => x.turnId === t.turnId)) {
          throw new RepositoryError('invalid', 'turnTraces.insert');
        }
        traces.push(t);
        return Promise.resolve();
      },
    },
  };
  return { repos: repos as unknown as Repositories, ledger, messages, traces, help, calls };
}

const usageJob = (index = 0) => ({
  name: JOB.usage,
  data: { scope, packageId: 'pkg_a', turnId: 'turn_1', source: 'subscription', index, usage },
});

describe('meterProcessor', () => {
  it('writes a usage row once under its derived id; a second run is already_written', async () => {
    const w = memoryRepos();
    const run = meterProcessor(w.repos, noLog);
    expect(await run(usageJob(0))).toBe('written');
    expect(await run(usageJob(0))).toBe('already_written');
    expect(await run(usageJob(1))).toBe('written');
    expect(w.ledger.map((r) => r.id)).toEqual([usageRowId('turn_1', 0), usageRowId('turn_1', 1)]);
  });

  it('an unmetered job writes once, with or without model and tokens', async () => {
    const w = memoryRepos();
    const run = meterProcessor(w.repos, noLog);
    const base = { scope, packageId: 'pkg_a', turnId: 'turn_2', source: 'eval', tier: 'small' };
    const unknown = {
      name: JOB.unmetered,
      data: { ...base, index: 0, reason: 'no_usage_reported' },
    };
    const unpriced = {
      name: JOB.unmetered,
      data: {
        ...base,
        index: 1,
        reason: 'unpriced_model:x',
        model: 'x',
        tokens: { inputTokens: 1, outputTokens: 1 },
      },
    };
    expect(await run(unknown)).toBe('written');
    expect(await run(unpriced)).toBe('written');
    expect(await run(unknown)).toBe('already_written');
    expect(w.ledger).toHaveLength(2);
  });

  it('a lost race (the insert fails but the row is there) is already_written', async () => {
    const w = memoryRepos();
    let listed = 0;
    const repos = {
      ...w.repos,
      usageLedger: {
        ...w.repos.usageLedger,
        // First check: not there yet; after the failed insert: there.
        listForTurn: () =>
          Promise.resolve(
            listed++ === 0 ? [] : [{ id: usageRowId('turn_1', 0), turnId: 'turn_1' }],
          ),
        record: () => Promise.reject(new RepositoryError('invalid', 'usageLedger.record')),
      },
    } as unknown as Repositories;
    expect(await meterProcessor(repos, noLog)(usageJob(0))).toBe('already_written');
  });

  it('a db outage is retryable; scope, not_found, invalid and integrity are permanent', async () => {
    const down = new RepositoryError('failed', 'usageLedger.record');
    await expect(
      meterProcessor(memoryRepos({ record: down }).repos, noLog)(usageJob()),
    ).rejects.toBe(down);
    for (const kind of ['scope', 'not_found', 'invalid', 'integrity'] as const) {
      const w = memoryRepos({ record: new RepositoryError(kind, 'usageLedger.record') });
      await expect(meterProcessor(w.repos, noLog)(usageJob())).rejects.toBeInstanceOf(
        PermanentJobError,
      );
    }
    // The existence check failing is classified the same way.
    const listDown = new RepositoryError('failed', 'usageLedger.listForTurn');
    await expect(
      meterProcessor(memoryRepos({ listForTurn: listDown }).repos, noLog)(usageJob()),
    ).rejects.toBe(listDown);
  });

  it('a failing re-check after a failed write keeps the write’s error and logs the re-check', async () => {
    let n = 0;
    const w = memoryRepos();
    const repos = {
      ...w.repos,
      usageLedger: {
        ...w.repos.usageLedger,
        listForTurn: () =>
          n++ === 0 ? Promise.resolve([]) : Promise.reject(new Error('still down')),
        record: () => Promise.reject(new RepositoryError('failed', 'usageLedger.record')),
      },
    } as unknown as Repositories;
    const lines: LogLine[] = [];
    await expect(
      meterProcessor(repos, (l) => lines.push(l))({ ...usageJob(), id: 'turn_1.usage.0' }),
    ).rejects.toMatchObject({ kind: 'failed' });
    expect(lines).toEqual([
      {
        level: 'warn',
        event: 'job.recheck_failed',
        name: 'usage.record',
        jobId: 'turn_1.usage.0',
        error: { name: 'Error', message: 'still down' },
      },
    ]);
    // Without a BullMQ id the line still names the job.
    n = 0;
    await expect(meterProcessor(repos, (l) => lines.push(l))(usageJob())).rejects.toMatchObject({
      kind: 'failed',
    });
    expect(lines[1]).toMatchObject({ event: 'job.recheck_failed', jobId: null });
  });

  it('a malformed payload or an unknown job name is permanent and names no payload text', async () => {
    const run = meterProcessor(memoryRepos().repos, noLog);
    const bad = {
      name: JOB.usage,
      data: { ...usageJob().data, index: -1, secret: 'student text' },
    };
    const e = await run(bad).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PermanentJobError);
    expect((e as Error).message).toBe('usage.record: invalid job payload');
    await expect(run({ name: 'other', data: {} })).rejects.toThrow(/unknown meter job "other"/);
  });
});

describe('commitProcessor', () => {
  const messageJob = { name: JOB.message, data: { scope, sessionId: 'ses_1', message } };
  const helpJob = { name: JOB.helpState, data: { scope, sessionId: 'ses_1', helpState: { v: 1 } } };
  const traceJob = { name: JOB.trace, data: { scope, trace } };

  it('appends a message once: a duplicate id found in the history is already_written', async () => {
    const w = memoryRepos();
    const run = commitProcessor(w.repos, noLog);
    expect(await run(messageJob)).toBe('written');
    expect(await run(messageJob)).toBe('already_written');
    expect(w.messages).toHaveLength(1);
  });

  it('not_found with the id absent (another student’s session) is permanent', async () => {
    const w = memoryRepos({ append: new RepositoryError('not_found', 'messages.append') });
    await expect(commitProcessor(w.repos, noLog)(messageJob)).rejects.toBeInstanceOf(
      PermanentJobError,
    );
    const down = new RepositoryError('failed', 'messages.append');
    await expect(
      commitProcessor(memoryRepos({ append: down }).repos, noLog)(messageJob),
    ).rejects.toBe(down);
  });

  it('saves the help state (last write wins: running it twice is harmless)', async () => {
    const w = memoryRepos();
    const run = commitProcessor(w.repos, noLog);
    expect(await run(helpJob)).toBe('written');
    expect(await run(helpJob)).toBe('written');
    expect(w.help).toEqual([
      { sessionId: 'ses_1', value: { v: 1 } },
      { sessionId: 'ses_1', value: { v: 1 } },
    ]);
    const ended = memoryRepos({ saveHelpState: new RepositoryError('not_found', 's') });
    await expect(commitProcessor(ended.repos, noLog)(helpJob)).rejects.toBeInstanceOf(
      PermanentJobError,
    );
  });

  it('records a trace once per turn', async () => {
    const w = memoryRepos();
    const run = commitProcessor(w.repos, noLog);
    expect(await run(traceJob)).toBe('written');
    expect(await run(traceJob)).toBe('already_written');
    expect(w.traces).toHaveLength(1);
  });

  it('a malformed payload or an unknown job name is permanent', async () => {
    const run = commitProcessor(memoryRepos().repos, noLog);
    for (const name of [JOB.message, JOB.helpState, JOB.trace]) {
      await expect(run({ name, data: { scope } })).rejects.toThrow(`${name}: invalid job payload`);
    }
    await expect(run({ name: 'other', data: {} })).rejects.toThrow(/unknown commit job/);
  });
});
