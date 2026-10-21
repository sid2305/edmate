// Task 5.10, migration 0018 on Postgres: `teacher_questions.group_id` has existed, unset, since
// 0001 (grouping starts in Phase C); a row written before this migration backfills `group_id =
// id`, so it is its own group until a later similar question joins it. Folder-before-N pattern of
// document-status-migration.int.test.ts / age-consent-migration.int.test.ts.
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

const up = await postgresUp('ask-the-teacher migration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const PIN = '0018_ask_the_teacher';
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

function folderBefore(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'edmate-mig-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const path = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((e) => e.tag === tag);
  expect(at, `${tag} is in the journal`).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, at);
  writeFileSync(path, JSON.stringify(journal));
  return dir;
}

describe.skipIf(!up)(`migration 0018 on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    tmp = folderBefore(PIN);
    await migrateWith(tmp);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await raw.query(
      `insert into users (id, name, locale, market, role) values ('tch_askpre', 'Pre', 'en', 'test', 'teacher')`,
    );
    await raw.query(
      `insert into users (id, name, locale, market, role) values ('stu_askpre', 'Stu', 'en', 'test', 'student')`,
    );
    await raw.query(`insert into agents (id, teacher_id) values ('agt_askpre', 'tch_askpre')`);
    // A pre-existing open question (as if migrated from before 0018): group_id is null, as every
    // row's was until this migration.
    await raw.query(
      `insert into teacher_questions (id, teacher_id, agent_id, student_id, text, status)
         values ('tq_askpre', 'tch_askpre', 'agt_askpre', 'stu_askpre', 'Why?', 'open')`,
    );
    const before = await raw.query(`select group_id from teacher_questions where id = 'tq_askpre'`);
    expect(before.rows).toEqual([{ group_id: null }]);
    await migrateWith(MIGRATIONS_DIR);
  }, SLOW_MS);

  afterAll(async () => {
    await raw?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropDatabase(dbName);
  }, SLOW_MS);

  it('backfills a pre-existing question’s group_id to its own id', async () => {
    const { rows } = await raw.query(`select group_id from teacher_questions where id = 'tq_askpre'`);
    expect(rows).toEqual([{ group_id: 'tq_askpre' }]);
  });

  it('leaves a question’s own group_id set by a later write untouched (the migration runs once)', async () => {
    await raw.query(
      `insert into teacher_questions (id, teacher_id, agent_id, student_id, text, status, group_id)
         values ('tq_askpost', 'tch_askpre', 'agt_askpre', 'stu_askpre', 'Why not?', 'open', 'tq_askpre')`,
    );
    const { rows } = await raw.query(`select group_id from teacher_questions where id = 'tq_askpost'`);
    expect(rows).toEqual([{ group_id: 'tq_askpre' }]);
  });

  it('creates the new tables', async () => {
    const { rows } = await raw.query<{ table_name: string }>(
      `select table_name from information_schema.tables
         where table_schema = 'public' and table_name in ('teacher_eval_cases', 'notifications')
         order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(['notifications', 'teacher_eval_cases']);
  });
});
