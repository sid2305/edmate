// Task 13.4 (Phase B), on the compose Postgres (no Redis needed -- `retentionJob` is tested
// directly against `openDatabase().retention`, the way `createTurnWorkers`' int test proves the
// commit path against the same database, not through BullMQ). Proves the wiring end to end: a
// dry run (the job's default) reports counts and changes nothing; live mode purges only
// `turn_traces` past its own configured cutoff, leaving a recent one and an unrelated session
// alone.
//
// Locally: dev Postgres must already be running (`docker compose -f docker/compose.yaml up -d
// postgres`, or whatever the repo's dev stack already uses) -- this test never starts, stops or
// composes containers itself. CI provides it. Without it the suite skips locally and fails in CI.
import { randomBytes } from 'node:crypto';
import { migrateDatabase, openDatabase } from '@edmate/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { retentionJob } from '../src/retention/index.js';

const PG_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://edmate:edmate-dev@127.0.0.1:55432/edmate';

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const up = await reachable();
if (!up && process.env.CI === 'true') {
  throw new Error('CI=true but Postgres (TEST_DATABASE_URL) is unreachable');
}
const SKIP = 'SKIPPED: no Postgres; see the header for how to start it';
if (!up) process.stderr.write(`[@edmate/worker] retention integration ${SKIP}\n`);

const dbName = `edmate_test_${randomBytes(6).toString('hex')}`;
const dbUrl = (() => {
  const u = new URL(PG_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

const NOW = new Date('2026-10-25T04:00:00.000Z');
const OLD = new Date('2020-01-01T00:00:00Z'); // well past every table's placeholder cutoff
const RECENT = new Date('2026-10-20T00:00:00Z'); // within every table's placeholder cutoff

let admin: pg.Client;
let raw: pg.Client;
let db: ReturnType<typeof openDatabase>;
let n = 0;
const uid = (p: string) => `${p}_${(n += 1)}`;

/** A teacher, student, agent and one ended session, for `turn_traces`' required FK. */
async function seedSession(): Promise<string> {
  const tid = uid('tch');
  const stid = uid('stu');
  const agentId = uid('agt');
  const sessionId = uid('ses');
  await raw.query(
    `insert into users (id, name, locale, market, role) values ($1,'T','en','US','teacher')`,
    [tid],
  );
  await raw.query(
    `insert into users (id, name, locale, market, role) values ($1,'S','en','US','student')`,
    [stid],
  );
  await raw.query(`insert into agents (id, teacher_id) values ($1,$2)`, [agentId, tid]);
  await raw.query(
    `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, ended_at) values ($1,$2,$3,$4,1,now())`,
    [sessionId, stid, tid, agentId],
  );
  return sessionId;
}

async function seedTrace(at: Date): Promise<string> {
  const sessionId = await seedSession();
  const id = uid('tt');
  await raw.query(
    `insert into turn_traces (id, session_id, steps, model, input_tokens, output_tokens, cost_micro_usd, turn_id, agent_version, package_version, intent, move, guards, usage, created_at, updated_at)
     values ($1,$2,'[]','scripted',0,0,0,$3,1,1,'other','answer','{}','{}',$4,$4)`,
    [id, sessionId, uid('trn'), at],
  );
  return id;
}

describe.skipIf(!up)(`retention job on Postgres${up ? '' : ` (${SKIP})`}`, () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: PG_URL });
    await admin.connect();
    await admin.query(`create database "${dbName}"`);
    await migrateDatabase(dbUrl);
    raw = new pg.Client({ connectionString: dbUrl });
    await raw.connect();
    db = openDatabase({ DATABASE_URL: dbUrl });
  });

  afterAll(async () => {
    await db?.close();
    await raw?.end();
    await admin?.query(`drop database if exists "${dbName}" with (force)`);
    await admin?.end();
  });

  it('dry run (the job default) reports a count for an old trace and deletes nothing', async () => {
    const oldId = await seedTrace(OLD);
    const run = retentionJob({ retention: db.retention, now: () => NOW, log: () => undefined });
    const summary = await run();
    expect(summary.dryRun).toBe(true);
    expect(summary.turnTraces).toBeGreaterThanOrEqual(1);
    const { rows } = await raw.query('select 1 from turn_traces where id = $1', [oldId]);
    expect(rows).toHaveLength(1);
  });

  it('live mode purges only the past-cutoff turn_traces row, leaving a recent one in place', async () => {
    const oldId = await seedTrace(OLD);
    const recentId = await seedTrace(RECENT);
    const run = retentionJob({
      retention: db.retention,
      config: {
        days: { sessions: 100_000, turnTraces: 90, transcriptChunks: 100_000 },
        dryRun: false,
      },
      now: () => NOW,
      log: () => undefined,
    });
    const summary = await run();
    expect(summary.dryRun).toBe(false);
    expect(summary.turnTraces).toBeGreaterThanOrEqual(1);
    const { rows: oldRows } = await raw.query('select 1 from turn_traces where id = $1', [oldId]);
    expect(oldRows).toHaveLength(0);
    const { rows: recentRows } = await raw.query('select 1 from turn_traces where id = $1', [
      recentId,
    ]);
    expect(recentRows).toHaveLength(1);
  });
});
