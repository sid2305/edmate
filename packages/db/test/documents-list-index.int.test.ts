// Task 8.2r (8.2a review deferral): additive full (non-partial) index backing
// chunks.ts's documents.listForTeacher's `WHERE teacher_id = $1 ORDER BY created_at DESC, id
// DESC LIMIT 500`. See test/pg.ts for how to start Postgres.
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

const up = await postgresUp('documents list index tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
// Enough rows, spread across distinct created_at values, that the planner has a real sort to
// avoid; a second, unrelated teacher's documents so a plan that ignored teacher_id would be
// visibly wrong.
const DOC_COUNT = 400;
const OTHER_DOC_COUNT = 50;
let handle: DbHandle;
let raw: pg.Client;

describe.skipIf(!up)(
  `documents(teacher_id, created_at desc, id desc) index on Postgres${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();

      await raw.query(
        `insert into users (id, name, locale, market, role) values ('tch_dlidx', 'Doc List Teacher', 'en-US', 'US', 'teacher')`,
      );
      await raw.query(
        `insert into courses (id, teacher_id, title, "order") values ('crs_dlidx', 'tch_dlidx', 'c', 0)`,
      );
      await raw.query(
        `insert into modules (id, teacher_id, course_id, title, "order")
           values ('mod_dlidx', 'tch_dlidx', 'crs_dlidx', 'm', 0)`,
      );
      await raw.query(
        `insert into documents (id, teacher_id, module_id, kind, source_title, created_at)
           select 'doc_dlidx_' || gs, 'tch_dlidx', 'mod_dlidx', 'material', 'doc ' || gs,
                  timestamp '2026-01-01 00:00:00' + (gs || ' seconds')::interval
           from generate_series(1, ${DOC_COUNT}) gs`,
      );

      // A second, unrelated teacher with its own documents.
      await raw.query(
        `insert into users (id, name, locale, market, role) values ('tch_dlidx_other', 'Other Teacher', 'en-US', 'US', 'teacher')`,
      );
      await raw.query(
        `insert into courses (id, teacher_id, title, "order") values ('crs_dlidx_other', 'tch_dlidx_other', 'c', 0)`,
      );
      await raw.query(
        `insert into modules (id, teacher_id, course_id, title, "order")
           values ('mod_dlidx_other', 'tch_dlidx_other', 'crs_dlidx_other', 'm', 0)`,
      );
      await raw.query(
        `insert into documents (id, teacher_id, module_id, kind, source_title, created_at)
           select 'doc_dlidx_other_' || gs, 'tch_dlidx_other', 'mod_dlidx_other', 'material', 'other doc ' || gs,
                  timestamp '2026-02-01 00:00:00' + (gs || ' seconds')::interval
           from generate_series(1, ${OTHER_DOC_COUNT}) gs`,
      );
      await raw.query('analyze documents');
    });

    afterAll(async () => {
      await raw?.end();
      await dropDatabase(dbName);
      await handle?.close();
    });

    it('creates the documents_teacher_id_created_at_id_idx index', async () => {
      const { rows } = await raw.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes where tablename = 'documents'`,
      );
      const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      const def = defs.documents_teacher_id_created_at_id_idx;
      expect(def).toBeDefined();
      // Postgres omits "NULLS LAST" from indexdef when it's DESC's default order -- but
      // teacher_id/created_at/id are all NOT NULL here, so there's no ambiguity either way.
      expect(def).toMatch(/\(teacher_id, created_at DESC, id DESC\)/);
    });

    it('accesses documents through the new index for a query shaped like listForTeacher', async () => {
      await raw.query('begin');
      // A small work_mem and a lower random_page_cost (SSD-like, the production host's actual
      // storage) make the planner's cost model match a table far bigger than this fixture: an
      // on-disk sort of a sort-based plan's rows costs enough, and random index page reads cost
      // little enough, that scanning the new index in its native order (no separate Sort node)
      // wins over a sequential/bitmap scan plus explicit sort, without needing a
      // production-sized synthetic fixture.
      await raw.query("set local work_mem = '64kB'");
      await raw.query('set local random_page_cost = 1.1');
      const { rows } = await raw.query<{ 'QUERY PLAN': string }>(
        `explain select id, teacher_id, module_id, kind, source_title, storage_key,
                rights_declared_at, status, failure_reason, live_class_id, created_at, updated_at
         from documents
         where teacher_id = 'tch_dlidx'
         order by created_at desc, id desc
         limit 500`,
      );
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      await raw.query('rollback');
      expect(plan).toContain('documents_teacher_id_created_at_id_idx');
      expect(plan).toMatch(/Index( Only)? Scan/);
      expect(plan).not.toContain('Sort');
    });
  },
);
