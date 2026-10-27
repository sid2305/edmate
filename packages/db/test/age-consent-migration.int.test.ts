// Task 1.7, migration 0014 on Postgres: additive only. It adds users.birth_year (nullable,
// 1900-2100), consents.granted_by (self | parent, default self) and consents.withdrawn_at, and
// keeps every existing user and consent row as it was. Follows the folder-before-N pattern of
// teacher-question-dedup-migration.int.test.ts; see test/pg.ts to start a Postgres.
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

const up = await postgresUp('age and consent migration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const PIN = '0014_age_consent';
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

describe.skipIf(!up)(`migration 0014 on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    tmp = folderBefore(PIN);
    await migrateWith(tmp);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await raw.query(
      `insert into users (id, name, locale, market, role, age_confirmed_at) values
         ('usr_pre', 'Pre', 'en', 'global', 'student', '2026-10-01T00:00:00Z')`,
    );
    await raw.query(
      `insert into consents (id, user_id, kind, version, ts) values
         ('cns_pre', 'usr_pre', 'privacy_notice', 'v0', '2026-10-01T00:00:00Z')`,
    );
    // migrateDatabase() (not migrate()): it also runs the post-migrate step that validates the
    // 0014 NOT VALID CHECK constraints (document-live-class-migration.int.test.ts made the same
    // swap for its own NOT VALID constraint).
    await migrateDatabase(TEST_URL);
  }, SLOW_MS);

  afterAll(async () => {
    await raw?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropDatabase(dbName);
  }, SLOW_MS);

  it('keeps the existing user, with no birth year', async () => {
    const { rows } = await raw.query(
      `select id, market, age_confirmed_at, birth_year from users where id = 'usr_pre'`,
    );
    expect(rows).toEqual([
      {
        id: 'usr_pre',
        market: 'global',
        age_confirmed_at: new Date('2026-10-01T00:00:00Z'),
        birth_year: null,
      },
    ]);
  });

  it('keeps the existing consent as granted by self and not withdrawn', async () => {
    const { rows } = await raw.query(
      `select id, kind, version, granted_by, withdrawn_at from consents where id = 'cns_pre'`,
    );
    expect(rows).toEqual([
      {
        id: 'cns_pre',
        kind: 'privacy_notice',
        version: 'v0',
        granted_by: 'self',
        withdrawn_at: null,
      },
    ]);
  });

  it('accepts a birth year in 1900-2100 and rejects one outside it', async () => {
    await raw.query(`update users set birth_year = 1900 where id = 'usr_pre'`);
    await raw.query(`update users set birth_year = 2100 where id = 'usr_pre'`);
    await expect(
      raw.query(`update users set birth_year = 1899 where id = 'usr_pre'`),
    ).rejects.toThrow(/users_birth_year_check/);
    await expect(
      raw.query(`update users set birth_year = 2101 where id = 'usr_pre'`),
    ).rejects.toThrow(/users_birth_year_check/);
  });

  it('accepts granted_by self or parent, and nothing else', async () => {
    await raw.query(
      `insert into consents (id, user_id, kind, version, granted_by) values
         ('cns_parent', 'usr_pre', 'parental', 'v0', 'parent')`,
    );
    await expect(
      raw.query(
        `insert into consents (id, user_id, kind, version, granted_by) values
           ('cns_bad', 'usr_pre', 'parental', 'v1', 'school')`,
      ),
    ).rejects.toThrow(/consents_granted_by_check/);
  });

  it('validates both NOT VALID CHECK constraints outside the migration transaction', async () => {
    const { rows } = await raw.query<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint
        where conname in ('consents_granted_by_check', 'users_birth_year_check')
        order by conname`,
    );
    expect(rows).toEqual([
      { conname: 'consents_granted_by_check', convalidated: true },
      { conname: 'users_birth_year_check', convalidated: true },
    ]);
  });
});
