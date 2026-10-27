// Task 8.2r (8.2q review request): documents_sweep_updated_at_id_idx replaces migration 0040's
// documents_processing_updated_at_id_idx with a wider predicate, `status IN ('processing',
// 'uploading')`, so it still backs ingestSweep.staleProcessing's `ORDER BY updated_at, id`
// keyset once task 8.2q widens that query's filter from `status = 'processing'` alone. This test
// EXPLAINs both the original and the widened query shape against the new index. See test/pg.ts
// for how to start Postgres.
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

const up = await postgresUp('documents sweep index tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const PROCESSING_COUNT = 300;
const UPLOADING_COUNT = 150;
// Non-matching rows (ready/failed), so the table's existing unfiltered indexes have far more
// rows to filter through per status than the new partial index.
const OTHER_COUNT = 400;
let handle: DbHandle;
let raw: pg.Client;

describe.skipIf(!up)(
  `documents(updated_at, id) where status in (processing, uploading) index on Postgres${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();

      await raw.query(
        `insert into users (id, name, locale, market, role) values ('tch_sweep', 'Sweep Teacher', 'en-US', 'US', 'teacher')`,
      );
      await raw.query(
        `insert into courses (id, teacher_id, title, "order") values ('crs_sweep', 'tch_sweep', 'c', 0)`,
      );
      await raw.query(
        `insert into modules (id, teacher_id, course_id, title, "order")
           values ('mod_sweep', 'tch_sweep', 'crs_sweep', 'm', 0)`,
      );
      await raw.query(
        `insert into documents (id, teacher_id, module_id, kind, source_title, status, storage_key, updated_at)
           select 'doc_sweep_proc_' || gs, 'tch_sweep', 'mod_sweep', 'material', 'proc ' || gs,
                  'processing', 'key-' || gs,
                  timestamp '2026-01-01 00:00:00' + (gs || ' seconds')::interval
           from generate_series(1, ${PROCESSING_COUNT}) gs`,
      );
      await raw.query(
        `insert into documents (id, teacher_id, module_id, kind, source_title, status, storage_key, updated_at)
           select 'doc_sweep_upl_' || gs, 'tch_sweep', 'mod_sweep', 'material', 'upl ' || gs,
                  'uploading', 'key-upl-' || gs,
                  timestamp '2026-02-01 00:00:00' + (gs || ' seconds')::interval
           from generate_series(1, ${UPLOADING_COUNT}) gs`,
      );
      await raw.query(
        `insert into documents (id, teacher_id, module_id, kind, source_title, status, storage_key, updated_at)
           select 'doc_sweep_other_' || gs, 'tch_sweep', 'mod_sweep', 'material', 'other ' || gs,
                  (array['ready', 'failed']::document_status[])[1 + gs % 2], 'key-other-' || gs,
                  timestamp '2026-03-01 00:00:00' + (gs || ' seconds')::interval
           from generate_series(1, ${OTHER_COUNT}) gs`,
      );
      await raw.query('analyze documents');
    });

    afterAll(async () => {
      await raw?.end();
      await dropDatabase(dbName);
      await handle?.close();
    });

    it('creates the documents_sweep_updated_at_id_idx index and drops the old one', async () => {
      const { rows } = await raw.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes where tablename = 'documents'`,
      );
      const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      expect(defs.documents_processing_updated_at_id_idx).toBeUndefined();
      const def = defs.documents_sweep_updated_at_id_idx;
      expect(def).toBeDefined();
      expect(def).toMatch(/\(updated_at, id\)/);
      expect(def).toContain(
        "status = ANY (ARRAY['processing'::document_status, 'uploading'::document_status])",
      );
    });

    it("accesses documents through the new index for 8.2a's original status = 'processing' shape", async () => {
      await raw.query('begin');
      await raw.query("set local work_mem = '64kB'");
      await raw.query('set local random_page_cost = 1.1');
      const { rows } = await raw.query<{ 'QUERY PLAN': string }>(
        `explain select id, teacher_id, storage_key
         from documents
         where status = 'processing' and updated_at < now() and storage_key is not null
         order by updated_at asc, id asc
         limit 1000`,
      );
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      await raw.query('rollback');
      expect(plan).toContain('documents_sweep_updated_at_id_idx');
      expect(plan).toMatch(/Index( Only)? Scan/);
      expect(plan).not.toContain('Sort');
    });

    it("accesses documents through the new index for 8.2q's widened status in (processing, uploading) shape", async () => {
      await raw.query('begin');
      await raw.query("set local work_mem = '64kB'");
      await raw.query('set local random_page_cost = 1.1');
      const { rows } = await raw.query<{ 'QUERY PLAN': string }>(
        `explain select id, teacher_id, storage_key
         from documents
         where status in ('processing', 'uploading') and updated_at < now() and storage_key is not null
         order by updated_at asc, id asc
         limit 1000`,
      );
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      await raw.query('rollback');
      expect(plan).toContain('documents_sweep_updated_at_id_idx');
      expect(plan).toMatch(/Index( Only)? Scan/);
      expect(plan).not.toContain('Sort');
    });
  },
);
