// Task 11.4a, migration 0024 on Postgres: documents gain a nullable `live_class_id` (FK to
// live_classes, ON DELETE SET NULL, partial index). Additive only: a document written before the
// migration keeps every value and gets null; deleting a class unlinks its recordings instead of
// blocking the delete or removing them. Folder-before-N pattern of document-status-migration.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase, MIGRATIONS_DIR } from '../src/migrate.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('document live-class migration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const PIN = '0024_document_live_class';
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

describe.skipIf(!up)(`migration 0024 on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    tmp = folderBefore(PIN);
    await migrateWith(tmp);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await raw.query(
      `insert into users (id, name, locale, market, role) values ('tch_pre', 'Pre', 'en', 'test', 'teacher')`,
    );
    await raw.query(
      `insert into courses (id, teacher_id, title, "order") values ('crs_pre', 'tch_pre', 'c', 0)`,
    );
    await raw.query(
      `insert into modules (id, teacher_id, course_id, title, "order")
         values ('mod_pre', 'tch_pre', 'crs_pre', 'm', 0)`,
    );
    await raw.query(
      `insert into documents (id, teacher_id, module_id, kind, source_title, status) values
         ('doc_pre', 'tch_pre', 'mod_pre', 'material', 'pre', 'ready')`,
    );
    // migrateDatabase() (not migrate()): it also runs the post-migrate step that validates the
    // 0024 NOT VALID foreign key (src/migrate.ts POST_MIGRATE_STEPS).
    await migrateDatabase(TEST_URL);
  }, SLOW_MS);

  afterAll(async () => {
    await raw?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropDatabase(dbName);
  }, SLOW_MS);

  it('keeps a document written before the migration, with a null live_class_id', async () => {
    const { rows } = await raw.query(
      `select source_title, status, live_class_id from documents where id = 'doc_pre'`,
    );
    expect(rows).toEqual([{ source_title: 'pre', status: 'ready', live_class_id: null }]);
  });

  it('adds the partial index on live_class_id', async () => {
    const { rows } = await raw.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'documents_live_class_id_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/\(live_class_id\) WHERE \(live_class_id IS NOT NULL\)/);
  });

  it('refuses a link to a missing class, and unlinks (keeps) recordings when a class is deleted', async () => {
    await expect(
      raw.query(`update documents set live_class_id = 'lc_missing' where id = 'doc_pre'`),
    ).rejects.toThrow(/foreign key/);
    await raw.query(
      `insert into live_classes (id, teacher_id, title, starts_at)
         values ('lc_pre', 'tch_pre', 'c', now() - interval '1 hour')`,
    );
    await raw.query(
      `insert into documents (id, teacher_id, module_id, kind, source_title, live_class_id) values
         ('doc_rec', 'tch_pre', 'mod_pre', 'transcript', 'rec', 'lc_pre')`,
    );
    await raw.query(`delete from live_classes where id = 'lc_pre'`);
    const { rows } = await raw.query(
      `select id, live_class_id from documents where id = 'doc_rec'`,
    );
    expect(rows).toEqual([{ id: 'doc_rec', live_class_id: null }]);
  });

  it('validates the NOT VALID foreign key outside the migration transaction, ON DELETE SET NULL', async () => {
    const { rows } = await raw.query<{ convalidated: boolean; confdeltype: string }>(
      `select convalidated, confdeltype from pg_constraint
        where conrelid = 'documents'::regclass and contype = 'f'
          and pg_get_constraintdef(oid) like '%live_classes%'`,
    );
    expect(rows).toEqual([{ convalidated: true, confdeltype: 'n' }]);
  });
});
