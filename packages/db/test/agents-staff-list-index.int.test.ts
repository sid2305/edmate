// Task 12.4e: additive index backing regulated-subjects.ts's listForStaff sort, deferred from
// 12.4a's review (packages/db/src/repositories/regulated-subjects.ts listForStaff sorts by
// (created_at desc, id desc) with no backing index on agents).
// See test/pg.ts for how to start Postgres.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('agents staff-list index tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let raw: pg.Client;

describe.skipIf(!up)(
  `agents(created_at, id) index on Postgres${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();

      // 500 teachers, one agent each, spread across created_at so the sort has something to do.
      await raw.query(
        `insert into users (id, name, locale, market, role)
           select 'tch_idx_' || gs, 'Agent Teacher ' || gs, 'en-US', 'US', 'teacher'
           from generate_series(1, 500) gs`,
      );
      await raw.query(
        `insert into agents (id, teacher_id, status, created_at, updated_at)
           select 'agt_idx_' || gs,
                  'tch_idx_' || gs,
                  'draft',
                  timestamp '2026-01-01 00:00:00' + (gs || ' seconds')::interval,
                  timestamp '2026-01-01 00:00:00' + (gs || ' seconds')::interval
           from generate_series(1, 500) gs`,
      );
      await raw.query('analyze agents');
    });

    afterAll(async () => {
      await raw?.end();
      await dropDatabase(dbName);
      await handle?.close();
    });

    it('creates the agents(created_at, id) index', async () => {
      const { rows } = await raw.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes where tablename = 'agents'`,
      );
      const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      expect(defs.agents_created_at_id_idx).toMatch(/\(created_at, id\)/);
    });

    it('accesses agents through the new index for a query shaped like listForStaff', async () => {
      const { rows } = await raw.query<{ 'QUERY PLAN': string }>(
        `explain select id from agents order by created_at desc, id desc limit 200`,
      );
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toContain('agents_created_at_id_idx');
      expect(plan).toMatch(/Index( Only)? Scan Backward/);
      expect(plan).not.toContain('Sort');
    });
  },
);
