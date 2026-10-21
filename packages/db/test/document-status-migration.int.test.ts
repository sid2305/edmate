// Task 8.2, migration 0017 on Postgres: documents gain `status` and `failure_reason`. A document
// written before the migration was already ingested, so it becomes `ready`, not `uploading`; only
// rows written afterwards start `uploading`. Folder-before-N pattern of age-consent-migration.
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

const up = await postgresUp('document status migration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const PIN = '0017_document_status';
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

describe.skipIf(!up)(`migration 0017 on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
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
      `insert into documents (id, teacher_id, module_id, kind, source_title) values
         ('doc_pre', 'tch_pre', 'mod_pre', 'material', 'pre')`,
    );
    await migrateWith(MIGRATIONS_DIR);
  }, SLOW_MS);

  afterAll(async () => {
    await raw?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropDatabase(dbName);
  }, SLOW_MS);

  it('marks a document ingested before the migration ready, with no failure reason', async () => {
    const { rows } = await raw.query(
      `select status, failure_reason from documents where id = 'doc_pre'`,
    );
    expect(rows).toEqual([{ status: 'ready', failure_reason: null }]);
  });

  it('starts a document written afterwards as uploading', async () => {
    await raw.query(
      `insert into documents (id, teacher_id, module_id, kind, source_title) values
         ('doc_post', 'tch_pre', 'mod_pre', 'material', 'post')`,
    );
    const { rows } = await raw.query(`select status from documents where id = 'doc_post'`);
    expect(rows).toEqual([{ status: 'uploading' }]);
  });
});
