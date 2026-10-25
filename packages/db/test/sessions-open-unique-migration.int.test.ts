// Task 5.10d, migration 0028 on Postgres: sessions.create had no prior lookup, so two open
// sessions for one (teacher_id, student_id, agent_id) triple could already exist. Before the
// migration adds the unique partial index, it must close any existing duplicates on that key
// (else the CREATE UNIQUE INDEX CONCURRENTLY post-migrate step itself would fail). Duplicates are
// never deleted; the migration keeps the newest open session (most likely to hold live
// `help_state`) and ends the rest, the opposite of 0011's "oldest wins" (teacher_questions has no
// analogous in-progress state to prefer). See test/pg.ts for how to start Postgres and
// teacher-question-dedup-migration.int.test.ts for the folder-before-N pattern this follows, plus
// migrate.int.test.ts's `sessions_open_teacher_id_student_id_idx` coverage for the
// CONCURRENTLY-index assertions.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrateDatabase } from '../src/migrate.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('sessions open-unique migration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const PIN = '0028_sessions_open_unique';
/** Migrating twice and seeding against a slow CI Postgres. */
const SLOW_MS = 60_000;

let raw: pg.Client;
let tmp: string;

async function migrateWith(folder: string): Promise<void> {
  const c = new pg.Client({ connectionString: TEST_URL });
  await c.connect();
  try {
    await migrate(drizzle(c), { migrationsFolder: folder });
  } finally {
    await c.end();
  }
}

/** A copy of the migrations folder whose journal ends just before 0028. */
function foldersBefore0028(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edmate-mig-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const path = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((e) => e.tag === PIN);
  expect(at, '0028 is in the journal').toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, at);
  writeFileSync(path, JSON.stringify(journal));
  return dir;
}

/**
 * Teacher A, student 1, agent agt_a (package pkg_a v1): two open sessions sharing (teacher_id,
 * student_id, agent_id) — a stale tab a refresh never closed, and the newer one the student is
 * actually mid-conversation in — plus one already-ended session on that same triple (left alone:
 * the index only covers `ended_at is null`) and one open session on a different agent (no
 * duplicate, untouched).
 */
async function seedPre0028(c: pg.Client): Promise<void> {
  await c.query(
    `insert into users (id, name, locale, market, role) values
       ('tch_a', '[A] teacher', 'en', 'test', 'teacher'),
       ('stu_1', '[1] student', 'en', 'test', 'student')`,
  );
  await c.query(
    `insert into agents (id, teacher_id, status, live_version) values
       ('agt_a', 'tch_a', 'live', 1), ('agt_b', 'tch_a', 'live', 1)`,
  );
  await c.query(
    `insert into packages (id, teacher_id, agent_id, name, live_version) values
       ('pkg_a', 'tch_a', 'agt_a', '[A] a', 1), ('pkg_b', 'tch_a', 'agt_b', '[A] b', 1)`,
  );
  await c.query(
    `insert into package_versions (id, teacher_id, package_id, version, config) values
       ('pv_a_1', 'tch_a', 'pkg_a', 1, '{}'), ('pv_b_1', 'tch_a', 'pkg_b', 1, '{}')`,
  );
  await c.query(
    `insert into sessions
       (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version, ended_at, created_at) values
       ('ses_older', 'stu_1', 'tch_a', 'agt_a', 1, 'pkg_a', 1, null, '2026-10-01T00:00:00Z'),
       ('ses_newer', 'stu_1', 'tch_a', 'agt_a', 1, 'pkg_a', 1, null, '2026-10-02T00:00:00Z'),
       ('ses_ended_dup', 'stu_1', 'tch_a', 'agt_a', 1, 'pkg_a', 1, '2026-09-30T00:00:00Z', '2026-09-29T00:00:00Z'),
       ('ses_other_agent', 'stu_1', 'tch_a', 'agt_b', 1, 'pkg_b', 1, null, '2026-10-01T00:00:00Z')`,
  );
}

interface Row {
  id: string;
  ended_at: Date | null;
}

describe.skipIf(!up)(`migration 0028 on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    tmp = foldersBefore0028();
    await migrateWith(tmp);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    const idx = await raw.query(
      `select 1 from pg_indexes where indexname = 'sessions_open_teacher_student_agent_key'`,
    );
    expect(idx.rowCount, 'migrated before 0028 only').toBe(0);
    await seedPre0028(raw);
    // The unique index is a post-migrate step (CREATE UNIQUE INDEX CONCURRENTLY), not SQL in the
    // migration file, so the final migration must run through migrateDatabase() (which runs
    // runPostMigrateSteps after the file migration), not the raw drizzle migrate() used above for
    // the pre-0028 folder.
    await migrateDatabase(TEST_URL);
  }, SLOW_MS);

  afterAll(async () => {
    await raw?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropDatabase(dbName);
  }, SLOW_MS);

  async function rows(): Promise<Map<string, Row>> {
    const r = await raw.query<Row>('select id, ended_at from sessions');
    return new Map(r.rows.map((x) => [x.id, x]));
  }

  it('creates the unique open-session index, valid and ready', async () => {
    const idx = await raw.query<{ indisvalid: boolean; indisready: boolean }>(
      `select indisvalid, indisready from pg_index
         where indexrelid = 'sessions_open_teacher_student_agent_key'::regclass`,
    );
    expect(idx.rows).toHaveLength(1);
    expect(idx.rows[0]).toMatchObject({ indisvalid: true, indisready: true });
  });

  it('keeps exactly one open session among the duplicates, the newest', async () => {
    const r = await rows();
    expect(r.get('ses_newer')?.ended_at).toBeNull();
    expect(r.get('ses_older')?.ended_at).not.toBeNull();
  });

  it('leaves an already-ended duplicate and a non-duplicate open session alone', async () => {
    const r = await rows();
    expect(r.get('ses_ended_dup')?.ended_at?.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(r.get('ses_other_agent')?.ended_at).toBeNull();
  });

  it('loses no row: every seeded id is still there', async () => {
    const r = await rows();
    expect([...r.keys()].sort()).toEqual(
      ['ses_ended_dup', 'ses_newer', 'ses_older', 'ses_other_agent'].sort(),
    );
  });

  it('from now on a second open session on the same triple is rejected by the unique index', async () => {
    await expect(
      raw.query(
        `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version, ended_at)
         values ('ses_new_dup', 'stu_1', 'tch_a', 'agt_a', 1, 'pkg_a', 1, null)`,
      ),
    ).rejects.toThrow(/sessions_open_teacher_student_agent_key/);
  });
});
