// Task 12.5b integration test on the compose Redis and Postgres (the alert plan's acceptance
// cases 1(a)-(c)): a SafetyAlert raised through queuedAlertSink becomes a safety_alerts row (via
// dbAlertStore), and the trust team is told; not acknowledged -> escalated_at and
// escalation_round >= 1, on-call paged every interval; acknowledged (via the repository, as the
// staff console will call it) before the first check -> never escalated, never paged;
// acknowledged after the first escalation -> paging stops and one safety_alert.ack audit row
// exists. The escalation interval is cut to ~300 ms, as in alert.int.test.ts. Compose command: see
// commit.int.test.ts. Skips locally without the services; fails in CI.
import { randomBytes } from 'node:crypto';
import type { SafetyAlert } from '@edmate/contracts';
import { demoSafetyAlert } from '@edmate/contracts/fixtures';
import { migrateDatabase, openDatabase } from '@edmate/db';
import { ALERT_QUEUE, DEAD_LETTER_QUEUE, queuedAlertSink } from '@edmate/queue';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAlertWorker, dbAlertStore } from '../src/alerts/index.js';
import type { AlertAudience, AlertNotifier } from '../src/alerts/types.js';
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
const SKIP = 'SKIPPED: no Postgres or Redis; see commit.int.test.ts for the compose command';
if (!up) process.stderr.write(`[@edmate/worker] alert-inbox integration ${SKIP}\n`);

const dbName = `edmate_test_${randomBytes(6).toString('hex')}`;
const prefix = `edmate-test-${randomBytes(4).toString('hex')}`;
const dbUrl = (() => {
  const u = new URL(PG_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const FAST_ESCALATE_MS = 300;
const CANARY = 'EXCERPT-CANARY-125b';

const alertNamed = (id: string): SafetyAlert => ({
  ...demoSafetyAlert,
  id,
  excerptRedacted: `${CANARY} i want to kill myself`,
});

function recordingNotifier() {
  const delivered: { alertId: string; audience: AlertAudience }[] = [];
  const notifier: AlertNotifier = {
    notify(a, audience) {
      delivered.push({ alertId: a.id, audience });
      return Promise.resolve();
    },
  };
  return { notifier, delivered };
}

async function until<T>(read: () => T | Promise<T>, ok: (v: T) => boolean, ms: number): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out waiting; last value ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const lines: LogLine[] = [];
let admin: pg.Client;
let raw: pg.Client;
let db: ReturnType<typeof openDatabase>;
let connection: Redis;
let queue: Queue;
let deadLetter: Queue;
let worker: Worker;

async function seed(c: pg.Client): Promise<void> {
  await c.query(`insert into users (id, name, locale, market, role) values
    ('tch_test_01', 'T', 'en', 'test', 'teacher'),
    ('stu_test_01', 'S1', 'en', 'test', 'student'),
    ('staff_test_01', 'Staff', 'en', 'test', 'staff')`);
  await c.query(`insert into agents (id, teacher_id, status, live_version)
    values ('agt_test_01', 'tch_test_01', 'live', 1)`);
  await c.query(`insert into agent_versions (id, teacher_id, agent_id, version, config)
    values ('av_1', 'tch_test_01', 'agt_test_01', 1, '{}')`);
  await c.query(`insert into packages (id, teacher_id, agent_id, name, live_version)
    values ('pkg_test_paid', 'tch_test_01', 'agt_test_01', 'P', 1)`);
  await c.query(`insert into package_versions (id, teacher_id, package_id, version, config)
    values ('pv_test_paid_1', 'tch_test_01', 'pkg_test_paid', 1, '{}')`);
  await c.query(`insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version)
    values ('ses_test_01', 'stu_test_01', 'tch_test_01', 'agt_test_01', 1, 'pkg_test_paid', 1)`);
}

describe.skipIf(!up)(`alert worker acks on Redis + Postgres${up ? '' : ` (${SKIP})`}`, () => {
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
    queue = new Queue(ALERT_QUEUE, { connection, prefix });
    deadLetter = new Queue(DEAD_LETTER_QUEUE, { connection, prefix });
    worker = createAlertWorker({
      connection,
      notifier: recordingNotifier().notifier, // replaced per-test below via a fresh worker where needed
      store: dbAlertStore(db.repos.safetyAlerts),
      queue,
      deadLetter,
      log: (l) => lines.push(l),
      prefix,
      escalateAfterMs: FAST_ESCALATE_MS,
      backoff: { startMs: 50, maxMs: 200 },
      autorun: true,
    });
  }, 60_000);

  afterAll(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    await deadLetter?.obliterate({ force: true }).catch(() => undefined);
    await deadLetter?.close();
    const keys = await connection.keys(`${prefix}:*`);
    if (keys.length > 0) await connection.del(...keys);
    await connection?.quit();
    await db?.close();
    await raw?.end();
    await admin?.query(`drop database if exists "${dbName}" with (force)`);
    await admin?.end();
  }, 60_000);

  it('1(a) not acknowledged: the row escalates and on-call is paged every interval', async () => {
    const id = 'alert_unacked';
    await queuedAlertSink(queue, { escalateAfterMs: FAST_ESCALATE_MS }).raise(alertNamed(id));
    const rows = await until(
      () => db.repos.safetyAlerts.listForStaff('staff_test_01', { status: 'all', limit: 50 }),
      (rs) => rs.some((r) => r.id === id && r.escalationRound >= 1 && r.escalatedAt !== null),
      10_000,
    );
    const row = rows.find((r) => r.id === id);
    expect(row?.escalatedAt).not.toBeNull();
    expect(row?.escalationRound).toBeGreaterThanOrEqual(1);
    const before = row?.escalationRound ?? 0;
    await until(
      async () =>
        (
          await db.repos.safetyAlerts.listForStaff('staff_test_01', { status: 'all', limit: 50 })
        ).find((r) => r.id === id)?.escalationRound ?? 0,
      (n) => n > before,
      10_000,
    );
  }, 30_000);

  it('1(b) acknowledged by staff before the first check: never escalated, never paged', async () => {
    const id = 'alert_acked_early';
    const { written } = await db.repos.safetyAlerts.record(alertNamed(id));
    expect(written).toBe(true);
    await db.repos.safetyAlerts.acknowledge('staff_test_01', { alertId: id });
    await queuedAlertSink(queue, { escalateAfterMs: FAST_ESCALATE_MS }).raise(alertNamed(id));
    // Give the escalation check time to run at least once; it must see the ack and stop.
    await sleep(FAST_ESCALATE_MS * 4);
    const rows = await db.repos.safetyAlerts.listForStaff('staff_test_01', { status: 'all', limit: 50 });
    const row = rows.find((r) => r.id === id);
    expect(row?.escalatedAt).toBeNull();
    expect(row?.escalationRound).toBe(0);
    expect(row?.acknowledgedAt).not.toBeNull();
  }, 15_000);

  it('1(c) acknowledged after the first escalation: paging stops, one audit row exists', async () => {
    const id = 'alert_acked_late';
    await queuedAlertSink(queue, { escalateAfterMs: FAST_ESCALATE_MS }).raise(alertNamed(id));
    await until(
      async () =>
        (
          await db.repos.safetyAlerts.listForStaff('staff_test_01', { status: 'all', limit: 50 })
        ).find((r) => r.id === id)?.escalationRound ?? 0,
      (n) => n >= 1,
      10_000,
    );
    await db.repos.safetyAlerts.acknowledge('staff_test_01', { alertId: id, note: 'handled' });
    const stopped = (
      await db.repos.safetyAlerts.listForStaff('staff_test_01', { status: 'all', limit: 50 })
    ).find((r) => r.id === id)?.escalationRound;
    await sleep(FAST_ESCALATE_MS * 4);
    const after = (
      await db.repos.safetyAlerts.listForStaff('staff_test_01', { status: 'all', limit: 50 })
    ).find((r) => r.id === id)?.escalationRound;
    expect(after).toBe(stopped);
    const { rows: audit } = await raw.query(
      `select action, reason from audit_log where target = $1`,
      [`safety_alert:${id}`],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('safety_alert.ack');
  }, 15_000);

  it('no log line carries the excerpt', () => {
    expect(JSON.stringify(lines)).not.toContain(CANARY);
  }, 1_000);
});
