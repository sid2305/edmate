// Task 3.16, migration 0009 on Postgres: sessions written before the package pin existed are
// backfilled from the student's live entitlement, or ended with that pair's last summary cleared;
// sessions that had already ended stay as they were. No row is deleted. See test/pg.ts.
//
// The database is migrated to 0008 from a copy of the migrations folder whose journal stops
// there, seeded with raw SQL in the pre-0009 shape, then migrated to the newest with the real
// folder (only 0009 runs) on a client whose NOTICE output is captured.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../src/migrate.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('session package migration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const PIN = '0009_session_package_pin';
/** Migrating twice and seeding against a slow CI Postgres. */
const SLOW_MS = 60_000;

let raw: pg.Client;
let tmp: string;
const notices: string[] = [];

async function migrateWith(folder: string): Promise<void> {
  const c = new pg.Client({ connectionString: TEST_URL });
  c.on('notice', (n) => notices.push(n.message ?? ''));
  await c.connect();
  try {
    await migrate(drizzle(c), { migrationsFolder: folder });
  } finally {
    await c.end();
  }
}

/** A copy of the migrations folder whose journal ends just before 0009. */
function foldersBefore0009(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edmate-mig-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const path = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((e) => e.tag === PIN);
  expect(at, '0009 is in the journal').toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, at);
  writeFileSync(path, JSON.stringify(journal));
  return dir;
}

/**
 * Teacher A with agents agt_a (packages pkg_a v1, v2) and agt_x (pkg_x v1). Students:
 * - stu_1: active on pkg_a v2.  ses_ok (agt_a, open) backfills; ses_other (agt_x, open) ends.
 * - stu_2: paused on pkg_a v1.  ses_paused (agt_a, open) backfills (entitle refuses paused later).
 * - stu_3: ended subscription.  ses_lapsed (agt_a, open) ends.
 * - stu_4: no subscription.     ses_none (agt_a, open) ends; it has no profile row.
 * - stu_5: active on pkg_a v1.  ses_old (agt_a, already ended) is left alone.
 * - tch_a previewing:           ses_preview (agt_a, open, no subscription) ends.
 */
async function seedPre0009(c: pg.Client): Promise<void> {
  const students = ['stu_1', 'stu_2', 'stu_3', 'stu_4', 'stu_5'];
  await c.query(
    `insert into users (id, name, locale, market, role) values
       ('tch_a', '[A] teacher', 'en', 'test', 'teacher'),
       ${students.map((s) => `('${s}', '[${s}]', 'en', 'test', 'student')`).join(', ')}`,
  );
  await c.query(
    `insert into agents (id, teacher_id, status, live_version) values
       ('agt_a', 'tch_a', 'live', 1), ('agt_x', 'tch_a', 'live', 1)`,
  );
  await c.query(
    `insert into packages (id, teacher_id, agent_id, name, live_version) values
       ('pkg_a', 'tch_a', 'agt_a', '[A] a', 2), ('pkg_x', 'tch_a', 'agt_x', '[A] x', 1)`,
  );
  await c.query(
    `insert into package_versions (id, teacher_id, package_id, version, config) values
       ('pv_a_1', 'tch_a', 'pkg_a', 1, '{}'), ('pv_a_2', 'tch_a', 'pkg_a', 2, '{}'),
       ('pv_x_1', 'tch_a', 'pkg_x', 1, '{}')`,
  );
  await c.query(
    `insert into subscriptions (id, student_id, teacher_id, package_version_id, status, period_end)
     values ('sub_1', 'stu_1', 'tch_a', 'pv_a_2', 'active', '2026-12-01'),
            ('sub_2', 'stu_2', 'tch_a', 'pv_a_1', 'paused', '2026-12-01'),
            ('sub_3', 'stu_3', 'tch_a', 'pv_a_2', 'ended', '2026-10-01'),
            ('sub_5', 'stu_5', 'tch_a', 'pv_a_1', 'active', '2026-12-01')`,
  );
  await c.query(
    `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, ended_at) values
       ('ses_ok', 'stu_1', 'tch_a', 'agt_a', 1, null),
       ('ses_other', 'stu_1', 'tch_a', 'agt_x', 1, null),
       ('ses_paused', 'stu_2', 'tch_a', 'agt_a', 1, null),
       ('ses_lapsed', 'stu_3', 'tch_a', 'agt_a', 1, null),
       ('ses_none', 'stu_4', 'tch_a', 'agt_a', 1, null),
       ('ses_old', 'stu_5', 'tch_a', 'agt_a', 1, '2026-10-01T00:00:00Z'),
       ('ses_preview', 'tch_a', 'tch_a', 'agt_a', 1, null)`,
  );
  await c.query(
    `insert into messages (id, session_id, role, text) values
       ('msg_ok', 'ses_ok', 'student', '[1] kept'), ('msg_lapsed', 'ses_lapsed', 'student', '[3] kept'),
       ('msg_old', 'ses_old', 'student', '[5] kept')`,
  );
  await c.query(
    `insert into learner_profiles (id, student_id, teacher_id, lang, last_summary) values
       ('lp_1', 'stu_1', 'tch_a', 'en', '[1] summary'), ('lp_2', 'stu_2', 'tch_a', 'en', '[2] summary'),
       ('lp_3', 'stu_3', 'tch_a', 'en', '[3] summary'), ('lp_5', 'stu_5', 'tch_a', 'en', '[5] summary')`,
  );
}

interface Row {
  id: string;
  package_id: string | null;
  package_version: number | null;
  ended_at: Date | null;
}

describe.skipIf(!up)(`migration 0009 on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  const before = new Map<string, Row>();
  let summariesBefore: Record<string, string | null> = {};

  beforeAll(async () => {
    await createDatabase(dbName);
    tmp = foldersBefore0009();
    await migrateWith(tmp);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    const cols = await raw.query(
      `select 1 from information_schema.columns where table_name = 'sessions' and column_name = 'package_id'`,
    );
    expect(cols.rowCount, 'migrated to 0008 only').toBe(0);
    await seedPre0009(raw);
    const ended = await raw.query<{ id: string; ended_at: Date | null }>(
      'select id, ended_at from sessions',
    );
    for (const r of ended.rows) before.set(r.id, { ...r, package_id: null, package_version: null });
    summariesBefore = await summaries();
    notices.length = 0;
    await migrateWith(MIGRATIONS_DIR);
  }, SLOW_MS);

  afterAll(async () => {
    await raw?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropDatabase(dbName);
  }, SLOW_MS);

  async function sessionsNow(): Promise<Map<string, Row>> {
    const r = await raw.query<Row>(
      'select id, package_id, package_version, ended_at from sessions',
    );
    return new Map(r.rows.map((x) => [x.id, x]));
  }
  async function summaries(): Promise<Record<string, string | null>> {
    const r = await raw.query<{ student_id: string; last_summary: string | null }>(
      'select student_id, last_summary from learner_profiles',
    );
    return Object.fromEntries(r.rows.map((x) => [x.student_id, x.last_summary]));
  }

  it('reports the count for each path', () => {
    expect(notices).toContain(
      'sessions package pin (3.16): 2 backfilled, 4 ended, 1 already ended',
    );
  });

  it('backfills an open session from the live entitlement for its agent (paused included)', async () => {
    const rows = await sessionsNow();
    expect(rows.get('ses_ok')).toMatchObject({
      package_id: 'pkg_a',
      package_version: 2,
      ended_at: null,
    });
    expect(rows.get('ses_paused')).toMatchObject({
      package_id: 'pkg_a',
      package_version: 1,
      ended_at: null,
    });
    // A backfilled pair whose sessions all matched keeps its summary.
    expect((await summaries()).stu_2).toBe('[2] summary');
  });

  it('ends an open session with no matching entitlement and clears that pair’s summary', async () => {
    const rows = await sessionsNow();
    for (const id of ['ses_other', 'ses_lapsed', 'ses_none', 'ses_preview']) {
      expect(rows.get(id)?.ended_at, id).toBeInstanceOf(Date);
      expect(rows.get(id)?.package_id, id).toBeNull();
    }
    const now = await summaries();
    // stu_1's agt_x session ended, so the pair's summary (which may cover it) is cleared too.
    expect(now.stu_1).toBeNull();
    expect(now.stu_3).toBeNull();
  });

  it('leaves an already-ended session and its pair alone', async () => {
    const old = (await sessionsNow()).get('ses_old');
    expect(old?.ended_at?.toISOString()).toBe(before.get('ses_old')?.ended_at?.toISOString());
    expect(old?.package_id).toBeNull();
    expect((await summaries()).stu_5).toBe(summariesBefore.stu_5);
  });

  it('loses no row: every session, message and profile is still there', async () => {
    expect([...(await sessionsNow()).keys()].sort()).toEqual([...before.keys()].sort());
    const msgs = await raw.query<{ id: string }>('select id from messages order by id');
    expect(msgs.rows.map((r) => r.id)).toEqual(['msg_lapsed', 'msg_ok', 'msg_old']);
    expect(Object.keys(await summaries()).sort()).toEqual(Object.keys(summariesBefore).sort());
  });

  it('from now on an open session must carry a complete pin to a real package version', async () => {
    let newSessionCount = 0;
    const insert = (pkg: string | null, version: number | null, endedAt: string | null) =>
      raw.query(
        `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version, ended_at)
         values ($4, 'stu_1', 'tch_a', 'agt_a', 1, $1, $2, $3)`,
        [pkg, version, endedAt, `ses_new_${++newSessionCount}`],
      );
    await expect(insert(null, null, null)).rejects.toThrow(/sessions_open_has_package/);
    await expect(insert('pkg_a', null, null)).rejects.toThrow(/sessions_package_pin_complete/);
    await expect(insert('pkg_a', 9, null)).rejects.toThrow(/sessions_package_version_fk/);
    await expect(insert('pkg_a', 2, null)).resolves.toMatchObject({ rowCount: 1 });
    await expect(insert(null, null, '2026-10-18T00:00:00Z')).resolves.toMatchObject({
      rowCount: 1,
    });
  });
});
