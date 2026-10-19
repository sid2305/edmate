// Task 3.8 integration test on the compose Redis and Postgres: a real harness turn's meter and
// commit writes go through @edmate/queue into BullMQ, the workers write them to Postgres, a job
// processed twice writes once, and failing jobs are retried, then dead-lettered.
//
// Locally:
//   docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml \
//     -f apps/worker/test/compose.port.yaml up -d postgres redis
// CI provides both services. Without them the suite skips locally and fails in CI.
import { randomBytes } from 'node:crypto';
import type { TurnEvent } from '@edmate/contracts';
import { demoTurnInput } from '@edmate/contracts/fixtures';
import { migrateDatabase, openDatabase, type Repositories, RepositoryError } from '@edmate/db';
import { defaultSteps, runTurn } from '@edmate/harness';
import { testDeps, testSteps } from '@edmate/harness/testing';
import {
  COMMIT_QUEUE,
  createTurnQueues,
  DEAD_LETTER_QUEUE,
  FAILED_JOB_TTL_SECONDS,
  JOB,
  jobOptions,
  queuedTurnPorts,
  type TurnQueues,
  usageRowId,
} from '@edmate/queue';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commitProcessor, createTurnWorkers, meterProcessor } from '../src/commit/index.js';
import type { LogLine } from '../src/log.js';

const PG_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://edmate:edmate-dev@127.0.0.1:55432/edmate';
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379';

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 2_000 });
  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await client.connect();
    await redis.connect();
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
    redis.disconnect();
  }
}

const up = await reachable();
if (!up && process.env.CI === 'true') {
  throw new Error(
    'CI=true but Postgres (TEST_DATABASE_URL) or Redis (TEST_REDIS_URL) is unreachable',
  );
}
const SKIP = 'SKIPPED: no Postgres or Redis; see the header for the compose command';
if (!up) process.stderr.write(`[@edmate/worker] commit integration ${SKIP}\n`);

const dbName = `edmate_test_${randomBytes(6).toString('hex')}`;
const prefix = `edmate-test-${randomBytes(4).toString('hex')}`;
const dbUrl = (() => {
  const u = new URL(PG_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

const scope = { studentId: 'stu_test_01', teacherId: 'tch_test_01' };
const lines: LogLine[] = [];
let admin: pg.Client;
let raw: pg.Client;
let db: ReturnType<typeof openDatabase>;
let connection: Redis;
let queues: TurnQueues;
let deadLetter: Queue;
let workers: Worker[] = [];

async function seed(c: pg.Client): Promise<void> {
  await c.query(`insert into users (id, name, locale, market, role) values
    ('tch_test_01', 'T', 'en', 'test', 'teacher'),
    ('stu_test_01', 'S1', 'en', 'test', 'student'),
    ('stu_test_02', 'S2', 'en', 'test', 'student')`);
  await c.query(`insert into agents (id, teacher_id, status, live_version)
    values ('agt_test_01', 'tch_test_01', 'live', 1)`);
  await c.query(`insert into agent_versions (id, teacher_id, agent_id, version, config)
    values ('av_1', 'tch_test_01', 'agt_test_01', 1, '{}')`);
  await c.query(`insert into packages (id, teacher_id, agent_id, name, live_version)
    values ('pkg_test_paid', 'tch_test_01', 'agt_test_01', 'P', 1)`);
  await c.query(`insert into sessions (id, student_id, teacher_id, agent_id, agent_version) values
    ('ses_test_01', 'stu_test_01', 'tch_test_01', 'agt_test_01', 1),
    ('ses_test_02', 'stu_test_02', 'tch_test_01', 'agt_test_01', 1)`);
}

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out waiting; last value ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const count = async (sql: string, args: unknown[] = []) =>
  Number((await raw.query<{ n: string }>(sql, args)).rows[0]?.n);

async function deadLetters(): Promise<
  { name: string; jobId: string; attemptsMade: number; data: unknown }[]
> {
  const jobs = await deadLetter.getJobs(['waiting']);
  return jobs.map((j) => j.data as never);
}

describe.skipIf(!up)(`turn queues on Redis + Postgres${up ? '' : ` (${SKIP})`}`, () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: PG_URL });
    await admin.connect();
    await admin.query(`create database "${dbName}"`);
    await migrateDatabase(dbUrl);
    raw = new pg.Client({ connectionString: dbUrl });
    await raw.connect();
    await seed(raw);
    db = openDatabase({ DATABASE_URL: dbUrl });
    connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    queues = createTurnQueues(connection, { prefix });
    deadLetter = new Queue(DEAD_LETTER_QUEUE, { connection, prefix });
    const turn = createTurnWorkers({
      connection,
      repos: db.repos,
      deadLetter,
      log: (l) => lines.push(l),
      prefix,
      autorun: true,
    });
    workers = [turn.meter, turn.commit];
  });

  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close()));
    await queues?.close();
    await deadLetter?.obliterate({ force: true }).catch(() => undefined);
    await deadLetter?.close();
    const keys = await connection.keys(`${prefix}:*`);
    if (keys.length > 0) await connection.del(...keys);
    await connection?.quit();
    await db?.close();
    await raw?.end();
    await admin?.query(`drop database if exists "${dbName}" with (force)`);
    await admin?.end();
  });

  it('a harness turn on the queue-backed ports lands in Postgres via the workers', async () => {
    const ports = queuedTurnPorts(queues, scope, {
      history: (s, n) => db.repos.messages.history(scope, s, n),
    });
    // A real clock: the enqueue is real I/O, which a virtual clock would read as a deadlock.
    const clock = {
      now: () => Date.now(),
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    };
    const t = testDeps({ overrides: { ...ports, clock } });
    const steps = { ...testSteps(), meter: defaultSteps.meter, commit: defaultSteps.commit };
    const run = runTurn(demoTurnInput, { deps: t.deps, steps });
    const events: TurnEvent[] = [];
    const [, result] = await Promise.all([
      (async () => {
        for await (const e of run.events) events.push(e);
      })(),
      run.finished,
    ]);
    expect(events.at(-1)?.type).toBe('done');
    expect(result.background).toEqual([]);

    const history = await until(
      () => db.repos.messages.history(scope, 'ses_test_01', 200),
      (h) => h.length === 2,
    );
    expect(history.map((m) => m.role)).toEqual(['student', 'agent']);
    const usage = await until(
      () => db.repos.usageLedger.listForTurn(scope, 'turn_1'),
      (u) => u.length === 1,
    );
    expect(usage[0]?.id).toBe(usageRowId('turn_1', 0));
    const traces = await until(
      () => db.repos.turnTraces.listForSession(scope, 'ses_test_01'),
      (x) => x.length === 1,
    );
    expect(traces[0]?.turnId).toBe('turn_1');
    const help = await until(
      () => db.repos.sessions.get(scope, 'ses_test_01'),
      (s) => JSON.stringify(s?.helpState) !== '{}',
    );
    expect(help?.helpState).toMatchObject({ v: 1 });
  });

  it('the same job processed twice writes the message, usage row and trace once each', async () => {
    const message = {
      id: 'msg_twice',
      role: 'agent',
      text: 'twice',
      createdAt: '2026-10-18T11:00:00.000Z',
    } as const;
    const jobs = {
      usage: {
        name: JOB.usage,
        data: {
          scope,
          packageId: 'pkg_test_paid',
          turnId: 'turn_twice',
          source: 'subscription',
          index: 0,
          usage: { model: 'm', tier: 'main', inputTokens: 1, outputTokens: 1, costMicroUsd: 1 },
        },
      },
      message: { name: JOB.message, data: { scope, sessionId: 'ses_test_01', message } },
      help: {
        name: JOB.helpState,
        data: { scope, sessionId: 'ses_test_01', helpState: { v: 1, rung: 3 } },
      },
      trace: {
        name: JOB.trace,
        data: {
          scope,
          trace: {
            turnId: 'turn_twice',
            sessionId: 'ses_test_01',
            agentVersion: 1,
            packageVersion: 1,
            steps: [],
            intent: 'on_task',
            move: 'hint',
            guards: [],
            usage: [],
          },
        },
      },
    };
    const meter = meterProcessor(db.repos, (l) => lines.push(l));
    const commit = commitProcessor(db.repos, (l) => lines.push(l));
    for (let i = 0; i < 2; i += 1) {
      const expected = i === 0 ? 'written' : 'already_written';
      expect(await meter(jobs.usage)).toBe(expected);
      expect(await commit(jobs.message)).toBe(expected);
      expect(await commit(jobs.help)).toBe('written');
      expect(await commit(jobs.trace)).toBe(expected);
    }
    expect(
      await count(`select count(*)::text as n from usage_ledger where turn_id = 'turn_twice'`),
    ).toBe(1);
    expect(await count(`select count(*)::text as n from messages where id = 'msg_twice'`)).toBe(1);
    expect(
      await count(`select count(*)::text as n from turn_traces where turn_id = 'turn_twice'`),
    ).toBe(1);
    expect((await db.repos.sessions.get(scope, 'ses_test_01'))?.helpState).toEqual({
      v: 1,
      rung: 3,
    });
  });

  it('a permanent failure (another student’s session) is dead-lettered after one attempt', async () => {
    const message = {
      id: 'msg_wrong',
      role: 'student',
      text: 'STUDENT-TEXT-CANARY-4e1',
      createdAt: '2026-10-18T11:00:00.000Z',
    };
    await queues.commit.add(
      JOB.message,
      { scope, sessionId: 'ses_test_02', message },
      jobOptions('msg_wrong.message', JOB.message),
    );
    const dead = await until(deadLetters, (d) => d.some((x) => x.jobId === 'msg_wrong.message'));
    expect(dead.find((x) => x.jobId === 'msg_wrong.message')).toMatchObject({
      name: JOB.message,
      attemptsMade: 1,
      refs: { sessionId: 'ses_test_02', messageId: 'msg_wrong', role: 'student' },
    });
    // The entry keeps ids only, and expires after 7 days.
    expect(JSON.stringify(dead)).not.toContain('STUDENT-TEXT-CANARY');
    const [stored] = (await deadLetter.getJobs(['waiting'])).filter(
      (j) => j.id === `${COMMIT_QUEUE}.msg_wrong.message`,
    );
    expect(stored?.opts.removeOnFail).toEqual({ age: FAILED_JOB_TTL_SECONDS });
    expect(await count(`select count(*)::text as n from messages where id = 'msg_wrong'`)).toBe(0);
    expect(
      lines.some((l) => l.event === 'job.dead_lettered' && l.jobId === 'msg_wrong.message'),
    ).toBe(true);
  });

  it('a failing write is retried, then dead-lettered; every failure is logged', async () => {
    const failPrefix = `${prefix}-fail`;
    const failing: Repositories = {
      ...db.repos,
      messages: {
        ...db.repos.messages,
        append: () => Promise.reject(new RepositoryError('failed', 'messages.append')),
      },
    };
    const failLines: LogLine[] = [];
    const q = createTurnQueues(connection, { prefix: failPrefix });
    const w = createTurnWorkers({
      connection,
      repos: failing,
      deadLetter,
      log: (l) => failLines.push(l),
      prefix: failPrefix,
      autorun: true,
    });
    try {
      const message = {
        id: 'msg_retry',
        role: 'agent',
        text: 'x',
        createdAt: '2026-10-18T11:00:00.000Z',
      };
      await q.commit.add(
        JOB.message,
        { scope, sessionId: 'ses_test_01', message },
        {
          ...jobOptions('msg_retry.message', JOB.message),
          attempts: 3,
          backoff: { type: 'fixed', delay: 20 },
        },
      );
      const dead = await until(deadLetters, (d) => d.some((x) => x.jobId === 'msg_retry.message'));
      expect(dead.find((x) => x.jobId === 'msg_retry.message')).toMatchObject({ attemptsMade: 3 });
      await until(
        () => Promise.resolve(failLines.map((l) => l.event)),
        (e) => e.includes('job.dead_lettered'),
      );
      expect(failLines.map((l) => l.event)).toEqual([
        'job.failed_will_retry',
        'job.failed_will_retry',
        'job.dead_lettered',
      ]);
      expect(failLines.every((l) => l.queue === COMMIT_QUEUE)).toBe(true);
      expect(JSON.stringify(failLines)).not.toContain('"text"');
    } finally {
      await Promise.all([w.meter.close(), w.commit.close()]);
      await q.close();
      const keys = await connection.keys(`${failPrefix}:*`);
      if (keys.length > 0) await connection.del(...keys);
    }
  });
});
