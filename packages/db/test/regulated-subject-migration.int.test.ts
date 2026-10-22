// Task 12.4a, migration 0023 on Postgres: agents gain the staff regulated-subject flag and
// approval columns, and each agent's subject is backfilled from its newest version's config
// (backfilled agents start unapproved). Folder-before-N pattern of document-status-migration.
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

const up = await postgresUp('regulated subject migration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const PIN = '0023_agents_regulated_subject';
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

describe.skipIf(!up)(`migration 0023 on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
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
      `insert into agents (id, teacher_id) values
         ('agt_newest_set', 'tch_pre'), ('agt_newest_unset', 'tch_pre'),
         ('agt_never', 'tch_pre'), ('agt_none', 'tch_pre'), ('agt_bad', 'tch_pre')`,
    );
    const versions: [string, number, Record<string, unknown>][] = [
      // Newest version sets a subject: it wins over an older, different one.
      ['agt_newest_set', 1, { regulatedSubject: 'law' }],
      ['agt_newest_set', 2, { regulatedSubject: 'health' }],
      // Newest version dropped the subject: the agent stays unflagged.
      ['agt_newest_unset', 1, { regulatedSubject: 'investing' }],
      ['agt_newest_unset', 2, {}],
      ['agt_never', 1, {}],
      // A value outside the set is never copied (the check constraint would refuse it).
      ['agt_bad', 1, { regulatedSubject: 'medicine' }],
    ];
    for (const [agent, version, config] of versions) {
      await raw.query(
        `insert into agent_versions (id, teacher_id, agent_id, version, config)
           values ($1, 'tch_pre', $2, $3, $4)`,
        [`agv_${agent}_${version}`, agent, version, JSON.stringify(config)],
      );
    }
    // migrateDatabase() (not migrateWith/migrate()): this is what also runs the post-migrate
    // step that validates the 0023 NOT VALID constraints (packages/db/src/migrate.ts
    // POST_MIGRATE_STEPS), same pattern as 0009 (task 3.16b).
    await migrateDatabase(TEST_URL);
  }, SLOW_MS);

  afterAll(async () => {
    await raw?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropDatabase(dbName);
  }, SLOW_MS);

  it("backfills each agent's subject from its newest version only, unapproved", async () => {
    const { rows } = await raw.query(
      `select id, regulated_subject, regulated_approved_at, regulated_approved_by
         from agents order by id`,
    );
    expect(rows).toEqual([
      { id: 'agt_bad', regulated_subject: null, regulated_approved_at: null, regulated_approved_by: null },
      { id: 'agt_never', regulated_subject: null, regulated_approved_at: null, regulated_approved_by: null },
      { id: 'agt_newest_set', regulated_subject: 'health', regulated_approved_at: null, regulated_approved_by: null },
      { id: 'agt_newest_unset', regulated_subject: null, regulated_approved_at: null, regulated_approved_by: null },
      { id: 'agt_none', regulated_subject: null, regulated_approved_at: null, regulated_approved_by: null },
    ]);
  });

  it('validates the three NOT VALID 0023 constraints outside the migration transaction', async () => {
    const { rows } = await raw.query<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint where conrelid = 'agents'::regclass
         and conname in (
           'agents_regulated_approved_by_users_id_fk',
           'agents_regulated_subject_check',
           'agents_regulated_approval_check'
         )`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.convalidated, row.conname).toBe(true);
    }
  });

  it('keeps every agent and version (nothing dropped or deleted)', async () => {
    const { rows } = await raw.query(
      `select (select count(*)::int from agents) as agents, (select count(*)::int from agent_versions) as versions`,
    );
    expect(rows).toEqual([{ agents: 5, versions: 6 }]);
  });
});
