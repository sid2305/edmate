// Task 8.2r (8.2a review deferral): migration 0017 added
// documents_failure_reason_only_when_failed as a plain, immediately-validated `ADD CONSTRAINT
// ... CHECK`, unlike every later CHECK/FK in this repo's POST_MIGRATE_STEPS (migrate.ts). 0017
// already shipped, so migration 0041 instead drops and re-adds the exact same CHECK as NOT
// VALID, validated by a new post-migrate step. Folder-before-N pattern of
// document-status-migration.int.test.ts.
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

const up = await postgresUp('documents failure_reason validate migration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
// folderBefore slices the journal up to (excluding) this tag, so this migrates up through 0040
// only -- the state right before this task's migration lands.
const PIN = '0041_documents_list_index_failure_reason_validate';
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

describe.skipIf(!up)(
  `migration 0041's documents_failure_reason_only_when_failed drop/reinstate on Postgres${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      tmp = folderBefore(PIN);
      await migrateWith(tmp);
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();
      await raw.query(
        `insert into users (id, name, locale, market, role) values ('tch_frv', 'FRV', 'en', 'test', 'teacher')`,
      );
      await raw.query(
        `insert into courses (id, teacher_id, title, "order") values ('crs_frv', 'tch_frv', 'c', 0)`,
      );
      await raw.query(
        `insert into modules (id, teacher_id, course_id, title, "order")
           values ('mod_frv', 'tch_frv', 'crs_frv', 'm', 0)`,
      );
      // One row on each side of the constraint, surviving before and after the DROP/ADD pair.
      await raw.query(
        `insert into documents (id, teacher_id, module_id, kind, source_title, status, failure_reason)
           values ('doc_frv_ready', 'tch_frv', 'mod_frv', 'material', 'ready doc', 'ready', null)`,
      );
      await raw.query(
        `insert into documents (id, teacher_id, module_id, kind, source_title, status, failure_reason)
           values ('doc_frv_failed', 'tch_frv', 'mod_frv', 'material', 'failed doc', 'failed', 'bad_file')`,
      );
      // Finish the migration run via migrateDatabase (not a bare migrate()) so this task's
      // post-migrate VALIDATE CONSTRAINT step also runs.
      await migrateDatabase(TEST_URL);
    }, SLOW_MS);

    afterAll(async () => {
      await raw?.end();
      if (tmp) rmSync(tmp, { recursive: true, force: true });
      await dropDatabase(dbName);
    }, SLOW_MS);

    it('keeps existing rows valid across the drop-and-reinstate', async () => {
      const { rows } = await raw.query<{
        id: string;
        status: string;
        failure_reason: string | null;
      }>(
        `select id, status, failure_reason from documents where id in ('doc_frv_ready', 'doc_frv_failed') order by id`,
      );
      expect(rows).toEqual([
        { id: 'doc_frv_failed', status: 'failed', failure_reason: 'bad_file' },
        { id: 'doc_frv_ready', status: 'ready', failure_reason: null },
      ]);
    });

    it('the constraint is validated (not just present) after migrateDatabase', async () => {
      const { rows } = await raw.query<{ convalidated: boolean }>(
        `select convalidated from pg_constraint
           where conname = 'documents_failure_reason_only_when_failed' and conrelid = 'documents'::regclass`,
      );
      expect(rows).toEqual([{ convalidated: true }]);
    });

    it('still rejects a failure_reason on a non-failed row after the migration', async () => {
      await expect(
        raw.query(
          `insert into documents (id, teacher_id, module_id, kind, source_title, status, failure_reason)
             values ('doc_frv_bad', 'tch_frv', 'mod_frv', 'material', 'bad doc', 'ready', 'x')`,
        ),
      ).rejects.toThrow();
    });
  },
);
