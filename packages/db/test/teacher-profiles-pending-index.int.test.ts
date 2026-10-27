// Task 12.1c (12.1a review follow-up): additive partial index backing
// teacher-profiles.ts's listPendingForStaff sort (verification_status = 'pending', ordered by
// (created_at, id)), deferred from 12.1a's review.
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

const up = await postgresUp('teacher_profiles pending index tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let raw: pg.Client;

describe.skipIf(!up)(
  `teacher_profiles(created_at, id) where pending index on Postgres${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();

      // 500 teachers, one profile each, split pending/verified and spread across created_at so
      // the partial index has both a filter and a sort to do.
      await raw.query(
        `insert into users (id, name, locale, market, role)
           select 'tch_pidx_' || gs, 'Pending Teacher ' || gs, 'en-US', 'US', 'teacher'
           from generate_series(1, 500) gs`,
      );
      await raw.query(
        `insert into teacher_profiles (id, user_id, slug, subject, verification_status, created_at, updated_at)
           select 'tp_pidx_' || gs,
                  'tch_pidx_' || gs,
                  'pending-teacher-' || gs,
                  'math',
                  (case when gs % 2 = 0 then 'pending' else 'verified' end)::teacher_verification_status,
                  timestamp '2026-01-01 00:00:00' + (gs || ' seconds')::interval,
                  timestamp '2026-01-01 00:00:00' + (gs || ' seconds')::interval
           from generate_series(1, 500) gs`,
      );
      await raw.query('analyze teacher_profiles');
    });

    afterAll(async () => {
      await raw?.end();
      await dropDatabase(dbName);
      await handle?.close();
    });

    it('creates the teacher_profiles_pending_created_at_id_idx index', async () => {
      const { rows } = await raw.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes where tablename = 'teacher_profiles'`,
      );
      const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      expect(defs.teacher_profiles_pending_created_at_id_idx).toMatch(/\(created_at, id\)/);
      expect(defs.teacher_profiles_pending_created_at_id_idx).toMatch(
        /WHERE \(verification_status = 'pending'/,
      );
    });

    it('accesses teacher_profiles through the new index for a query shaped like listPendingForStaff', async () => {
      const { rows } = await raw.query<{ 'QUERY PLAN': string }>(
        `explain select id from teacher_profiles where verification_status = 'pending' order by created_at, id limit 50`,
      );
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toContain('teacher_profiles_pending_created_at_id_idx');
      expect(plan).toMatch(/Index( Only)? Scan/);
      expect(plan).not.toContain('Sort');
    });
  },
);
