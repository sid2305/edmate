// Task 8.7 Phase C integration test on Postgres and Redis: a run started with `publish.startRun`
// is enqueued with `enqueueGate`, the `edmate-gate` worker picks it up and runs a scripted gate (no
// model call), and on a pass the agent, its packages and the run are live/`passed` with every case
// result and the scorecard stored; on a fail nothing goes live and the failed case is stored.
// Compose command: see ../commit.int.test.ts. Skips locally without the services; fails in CI.
import { randomBytes } from 'node:crypto';
import { demoAgentConfig } from '@edmate/contracts/fixtures';
import { migrateDatabase, openDatabase, type Repositories } from '@edmate/db';
import {
  generatePerAgentSuite,
  groupVerdict,
  memoryRecorder,
  selectGateCases,
  type EvalCase,
  type GateInput,
  type GateResult,
} from '@edmate/evals';
import { createGateQueue, DEAD_LETTER_QUEUE, enqueueGate } from '@edmate/queue';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateWorker } from '../../src/gate/workers.js';
import type { LogLine } from '../../src/log.js';

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
const SKIP = 'SKIPPED: no Postgres or Redis; see commit.int.test.ts for the compose command';
if (!up) process.stderr.write(`[@edmate/worker] gate integration ${SKIP}\n`);

const dbName = `edmate_test_${randomBytes(6).toString('hex')}`;
const prefix = `edmate-test-${randomBytes(4).toString('hex')}`;
const dbUrl = (() => {
  const u = new URL(PG_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const lines: LogLine[] = [];
let admin: pg.Client;
let raw: pg.Client;
let db: ReturnType<typeof openDatabase>;
let repos: Repositories;
let connection: Redis;
let gateQueue: ReturnType<typeof createGateQueue>;
let deadLetter: Queue;
let worker: Worker;
/** Case ids the scripted gate fails for each run id. */
const failFor = new Map<string, readonly string[]>();

/** A verified teacher with a draft agent (v1), one module, a style card and two packages (v1). */
async function seedTeacher(k: string) {
  const t = {
    teacherId: `tch_gate_${k}`,
    agentId: `agt_gate_${k}`,
    courseId: `crs_gate_${k}`,
    styleCardId: `sty_gate_${k}`,
    packages: [`pkg_gate_${k}_free`, `pkg_gate_${k}_paid`],
  };
  await raw.query(
    `insert into users (id, name, locale, market, role) values ($1, 'Gate Teacher', 'en', 'test', 'teacher')`,
    [t.teacherId],
  );
  await raw.query(
    `insert into teacher_profiles (id, user_id, slug, subject, verification_status)
     values ($1, $2, $3, 'maths', 'verified')`,
    [`tp_gate_${k}`, t.teacherId, `gate-teacher-${k}`],
  );
  await raw.query(
    `insert into courses (id, teacher_id, title, "order") values ($1, $2, 'Course', 0)`,
    [t.courseId, t.teacherId],
  );
  await raw.query(
    `insert into modules (id, teacher_id, course_id, title, "order") values ($1, $2, $3, 'M', 0)`,
    [`mod_gate_${k}`, t.teacherId, t.courseId],
  );
  await raw.query(
    `insert into style_cards (id, teacher_id, version, text) values ($1, $2, 1, 'card')`,
    [t.styleCardId, t.teacherId],
  );
  await raw.query(`insert into agents (id, teacher_id, status) values ($1, $2, 'draft')`, [
    t.agentId,
    t.teacherId,
  ]);
  await raw.query(
    `insert into agent_versions (id, teacher_id, agent_id, version, config) values ($1, $2, $3, 1, $4)`,
    [
      `av_gate_${k}`,
      t.teacherId,
      t.agentId,
      JSON.stringify({
        ...demoAgentConfig,
        id: t.agentId,
        version: 1,
        teacherId: t.teacherId,
        courseId: t.courseId,
        styleCardId: t.styleCardId,
      }),
    ],
  );
  for (const pkgId of t.packages) {
    await raw.query(
      `insert into packages (id, teacher_id, agent_id, name) values ($1, $2, $3, 'P')`,
      [pkgId, t.teacherId, t.agentId],
    );
    await raw.query(
      `insert into package_versions (id, teacher_id, package_id, version, config)
       values ($1, $2, $3, 1, '{}'::jsonb)`,
      [`pv_${pkgId}_1`, t.teacherId, pkgId],
    );
  }
  return t;
}

function platformCase(id: string, suite: string): EvalCase {
  return {
    id,
    suite,
    package: 'free',
    reviewed_by: 'lead',
    source: 'fixture',
    turns: [{ student: 'A platform question', expect: { judge: ['The reply is kind.'] } }],
  } as EvalCase;
}

/** The gate input for a run (scripted: the agent and judge are never asked). */
function inputFor(teacherId: string, agentId: string): GateInput {
  return {
    changes: ['first_publish'],
    platformCases: [platformCase('plat-acc-1', 'accuracy'), platformCase('plat-safety-1', 'safety')],
    perAgent: {
      teacherId,
      agentId,
      packages: [
        { id: 'pkg_free', name: 'Free', moduleIds: ['mod_a'], lockedReply: 'generic', sourceLabel: 'pv#free' },
      ],
      answerable: [
        {
          id: 'tec_1',
          moduleId: 'mod_a',
          question: 'What does a for loop do?',
          answer: 'It repeats a block.',
          provenance: 'teacher-answer',
          sourceLabel: 'teacher_eval_cases#tec_1',
        },
      ],
      outOfCourse: [],
    },
    agentFor: () => ({ reply: () => Promise.reject(new Error('the scripted gate never asks')) }),
    judgeGateway: { generateText: () => Promise.reject(new Error('never asked')) } as never,
    recorder: memoryRecorder('record'),
  };
}

/** A scripted gate over the real case scope: every case passes unless listed. */
function scriptedGate(input: GateInput, fail: readonly string[]): GateResult {
  const scope = selectGateCases({
    changes: input.changes,
    platformCases: input.platformCases,
    perAgentCases: generatePerAgentSuite(input.perAgent),
    requireAgentLocked: false,
  });
  const results = scope.cases.map(({ evalCase }) => {
    const pass = !fail.includes(evalCase.id);
    const checks = [{ name: 'judge', pass }];
    return {
      id: evalCase.id,
      suite: evalCase.suite,
      pass,
      turns: [{ turnIndex: 0, student: '', reply: 'never stored', checks, pass }],
    };
  });
  const tally = new Map<string, { origin: 'platform' | 'agent'; group: string; total: number; passed: number }>();
  scope.cases.forEach((c, i) => {
    const key = `${c.origin}:${c.group}`;
    const t = tally.get(key) ?? { origin: c.origin, group: c.group, total: 0, passed: 0 };
    t.total += 1;
    if (results[i]?.pass) t.passed += 1;
    tally.set(key, t);
  });
  const groups = [...tally.values()].map((t) =>
    groupVerdict(t.origin, t.group as never, t.total, t.passed),
  );
  return {
    pass: groups.every((g) => g.pass),
    changes: [...input.changes],
    groups,
    failedCaseIds: results.filter((r) => !r.pass).map((r) => r.id),
    results,
    stats: {
      cases: results.length,
      notRun: 0,
      deadlinePassed: false,
      deadlineMs: 1,
      agentCalls: 0,
      judgeCalls: 0,
      totalCalls: 0,
      maxCallsPerCase: 2,
      concurrency: 1,
      criticalPathCalls: 0,
      estimatedSeconds: 0,
    },
  };
}

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out waiting; last value ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function startAndEnqueue(t: Awaited<ReturnType<typeof seedTeacher>>) {
  const run = await repos.publish.startRun(
    { teacherId: t.teacherId },
    {
      agentId: t.agentId,
      courseId: t.courseId,
      styleCardId: t.styleCardId,
      promptPackVersion: '1.0.0',
      modelPolicy: demoAgentConfig.modelPolicy,
      judgeModel: 'judge-test',
    },
  );
  return run;
}

const terminal = (s: string) => s === 'passed' || s === 'failed' || s === 'error';

describe.skipIf(!up)('gate worker on Postgres and Redis', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: PG_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await migrateDatabase(dbUrl);
    raw = new pg.Client({ connectionString: dbUrl });
    await raw.connect();
    db = openDatabase({ DATABASE_URL: dbUrl });
    repos = db.repos;
    connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    gateQueue = createGateQueue(connection, { prefix });
    deadLetter = new Queue(DEAD_LETTER_QUEUE, { connection, prefix });
    worker = createGateWorker({
      connection,
      prefix,
      deadLetter,
      log: (l) => lines.push(l),
      autorun: true,
      deps: {
        repos,
        log: (l) => lines.push(l),
        prepare: (_run, basis) =>
          Promise.resolve({
            input: inputFor(basis.teacherId, basis.agentId),
            usage: () => ({ calls: 0, costMicroUsd: 0, unmetered: 0, unmeteredReasons: [] }),
          }),
        runGate: (input) =>
          Promise.resolve(scriptedGate(input, failFor.get(input.perAgent.agentId) ?? [])),
      },
    });
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    await worker?.close();
    await gateQueue?.close();
    await deadLetter?.close();
    await connection?.quit();
    await db?.close();
    await raw?.end();
    await admin?.query(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
  });

  it('a passing gate publishes the agent and its packages, with results and scorecard stored', async () => {
    const t = await seedTeacher('pass');
    const run = await startAndEnqueue(t);
    expect(run.status).toBe('queued');
    await enqueueGate(gateQueue, { runId: run.id, teacherId: t.teacherId });

    const done = await until(
      () => repos.publish.getRun({ teacherId: t.teacherId }, run.id),
      (r) => r !== null && terminal(r.status),
    );
    expect(done?.status).toBe('passed');
    expect(done?.passRate).toBe(1);
    expect(done?.scorecard?.pass).toBe(true);
    expect(done?.finishedAt).not.toBeNull();
    expect(done?.publishedAt).not.toBeNull();

    const agent = await raw.query<{ status: string; live_version: number }>(
      'select status, live_version from agents where id = $1',
      [t.agentId],
    );
    expect(agent.rows[0]).toEqual({ status: 'live', live_version: run.agentVersion });
    const pkgs = await raw.query<{ id: string; live_version: number }>(
      'select id, live_version from packages where agent_id = $1 order by id',
      [t.agentId],
    );
    expect(pkgs.rows).toEqual(t.packages.map((id) => ({ id, live_version: 1 })));

    const results = await raw.query<{ case_id: string; passed: boolean; details: unknown }>(
      'select case_id, passed, details from eval_results where eval_run_id = $1',
      [run.id],
    );
    const expected = scriptedGate(inputFor(t.teacherId, t.agentId), []).results.length;
    expect(results.rows).toHaveLength(expected);
    expect(results.rows.every((r) => r.passed)).toBe(true);
    expect(JSON.stringify(results.rows)).not.toContain('never stored');

    const card = await repos.publish.publicScorecard({ agentId: t.agentId });
    expect(card?.categories.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.event === 'gate.published' && l.runId === run.id)).toBe(true);
  });

  it('a failing gate stores the failed case and nothing goes live; a redelivered job is a no-op', async () => {
    const t = await seedTeacher('fail');
    const run = await startAndEnqueue(t);
    const failing = scriptedGate(inputFor(t.teacherId, t.agentId), []).results.find(
      (r) => !r.id.startsWith('plat-') && r.suite === 'accuracy',
    );
    expect(failing).toBeDefined();
    failFor.set(t.agentId, [failing!.id]);
    await enqueueGate(gateQueue, { runId: run.id, teacherId: t.teacherId });

    const done = await until(
      () => repos.publish.getRun({ teacherId: t.teacherId }, run.id),
      (r) => r !== null && terminal(r.status),
    );
    expect(done?.status).toBe('failed');
    expect(done?.publishedAt).toBeNull();
    const failed = await repos.publish.failedCases({ teacherId: t.teacherId }, run.id);
    expect(failed.map((f) => f.caseId)).toEqual([failing!.id]);
    expect(failed[0]?.details).toMatchObject({ origin: 'agent', group: 'accuracy', failedChecks: ['judge'] });
    const agent = await raw.query<{ status: string; live_version: number | null }>(
      'select status, live_version from agents where id = $1',
      [t.agentId],
    );
    expect(agent.rows[0]).toEqual({ status: 'draft', live_version: null });
    const pkgs = await raw.query<{ live_version: number | null }>(
      'select live_version from packages where agent_id = $1',
      [t.agentId],
    );
    expect(pkgs.rows.every((p) => p.live_version === null)).toBe(true);

    // The completed job was removed, so the same id can be added again: the run is no longer
    // queued, and the processor logs a skip without touching it.
    await enqueueGate(gateQueue, { runId: run.id, teacherId: t.teacherId });
    await until(
      () => Promise.resolve(lines.filter((l) => l.event === 'gate.skipped' && l.runId === run.id)),
      (s) => s.length === 1,
    );
    expect((await repos.publish.getRun({ teacherId: t.teacherId }, run.id))?.status).toBe('failed');
  });

  it('a malformed job is never retried: it is dead-lettered', async () => {
    const before = await deadLetter.count();
    await gateQueue.add('gate.run', { runId: 'x' }, { attempts: 1 });
    await until(
      () => deadLetter.count(),
      (n) => n === before + 1,
    );
    expect(lines.some((l) => l.event === 'gate.invalid_job')).toBe(true);
  });
});
