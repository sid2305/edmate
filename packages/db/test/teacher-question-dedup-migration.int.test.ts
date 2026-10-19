// Review fix round (3.17), migration 0011 on Postgres: before the migration adds the open-dedup
// unique index, it must close any existing duplicate open rows on that key (else the index build
// itself fails). Duplicates are never deleted; the migration keeps the oldest open row and marks
// the rest `dismissed`. See test/pg.ts for how to start a Postgres and
// session-package-migration.int.test.ts for the folder-before-N pattern this follows.
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

const up = await postgresUp('teacher question dedup migration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const PIN = '0011_teacher_question_open_dedup';
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

/** A copy of the migrations folder whose journal ends just before 0011. */
function foldersBefore0011(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edmate-mig-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const path = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((e) => e.tag === PIN);
  expect(at, '0011 is in the journal').toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, at);
  writeFileSync(path, JSON.stringify(journal));
  return dir;
}

/**
 * Teacher A, student 1, agent agt_a: three open rows sharing (teacher_id, student_id, agent_id,
 * md5(text)) — the same question text, asked three times before the dedup existed — plus one
 * already-answered row on that same key (left alone: the index only covers `status = 'open'`) and
 * one open row with different text (no duplicate, untouched).
 */
async function seedPre0011(c: pg.Client): Promise<void> {
  await c.query(
    `insert into users (id, name, locale, market, role) values
       ('tch_a', '[A] teacher', 'en', 'test', 'teacher'),
       ('stu_1', '[1] student', 'en', 'test', 'student')`,
  );
  await c.query(
    `insert into agents (id, teacher_id, status, live_version) values ('agt_a', 'tch_a', 'live', 1)`,
  );
  await c.query(
    `insert into teacher_questions (id, teacher_id, agent_id, student_id, text, status, created_at) values
       ('tq_oldest', 'tch_a', 'agt_a', 'stu_1', 'what is a derivative', 'open', '2026-10-01T00:00:00Z'),
       ('tq_middle', 'tch_a', 'agt_a', 'stu_1', 'what is a derivative', 'open', '2026-10-02T00:00:00Z'),
       ('tq_newest', 'tch_a', 'agt_a', 'stu_1', 'what is a derivative', 'open', '2026-10-03T00:00:00Z'),
       ('tq_answered_dup', 'tch_a', 'agt_a', 'stu_1', 'what is a derivative', 'answered', '2026-09-30T00:00:00Z'),
       ('tq_other_text', 'tch_a', 'agt_a', 'stu_1', 'what is an integral', 'open', '2026-10-01T00:00:00Z')`,
  );
}

interface Row {
  id: string;
  status: string;
}

describe.skipIf(!up)(`migration 0011 on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    tmp = foldersBefore0011();
    await migrateWith(tmp);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    const idx = await raw.query(
      `select 1 from pg_indexes where indexname = 'teacher_questions_open_dedup_key'`,
    );
    expect(idx.rowCount, 'migrated before 0011 only').toBe(0);
    await seedPre0011(raw);
    await migrateWith(MIGRATIONS_DIR);
  }, SLOW_MS);

  afterAll(async () => {
    await raw?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropDatabase(dbName);
  }, SLOW_MS);

  async function rows(): Promise<Map<string, Row>> {
    const r = await raw.query<Row>('select id, status from teacher_questions');
    return new Map(r.rows.map((x) => [x.id, x]));
  }

  it('creates the unique open-dedup index', async () => {
    const idx = await raw.query(
      `select 1 from pg_indexes where indexname = 'teacher_questions_open_dedup_key'`,
    );
    expect(idx.rowCount).toBe(1);
  });

  it('keeps exactly one open row among the duplicates, the oldest', async () => {
    const r = await rows();
    expect(r.get('tq_oldest')?.status).toBe('open');
    expect(r.get('tq_middle')?.status).toBe('dismissed');
    expect(r.get('tq_newest')?.status).toBe('dismissed');
  });

  it('leaves a non-open duplicate and a non-duplicate open row alone', async () => {
    const r = await rows();
    expect(r.get('tq_answered_dup')?.status).toBe('answered');
    expect(r.get('tq_other_text')?.status).toBe('open');
  });

  it('loses no row: every seeded id is still there', async () => {
    const r = await rows();
    expect([...r.keys()].sort()).toEqual(
      ['tq_answered_dup', 'tq_middle', 'tq_newest', 'tq_oldest', 'tq_other_text'].sort(),
    );
  });

  it('from now on a second open row on the same key is rejected by the unique index', async () => {
    await expect(
      raw.query(
        `insert into teacher_questions (id, teacher_id, agent_id, student_id, text, status)
         values ('tq_new_dup', 'tch_a', 'agt_a', 'stu_1', 'what is a derivative', 'open')`,
      ),
    ).rejects.toThrow(/teacher_questions_open_dedup_key/);
  });
});
