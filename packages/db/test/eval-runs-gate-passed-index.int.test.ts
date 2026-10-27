// Task 13.regatea (13.regate review deferral): additive partial index backing
// publish.ts's regateRepo(db).liveAgentsWithMaterialChange's `last` CTE scan (newest
// passed/published gate run per agent_id).
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

const up = await postgresUp('eval_runs gate passed index tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const AGENT_COUNT = 400;
// Multiple historical gate runs per agent (not just one), so the "last" CTE's DISTINCT ON is a
// real pick-the-newest-per-agent problem over enough total rows that a sort of them is expensive
// relative to scanning the new index in its native order.
const RUNS_PER_AGENT = 10;
// Non-gate, non-passed rows for the same agents, so the table's existing unfiltered
// `eval_runs_agent_id_created_at_idx` has far more rows to filter through per agent than the new
// partial index, which holds only the gate/passed/published rows -- matching production, where
// most eval_runs rows are not publish-gate runs.
const OTHER_RUNS_PER_AGENT = 20;
let handle: DbHandle;
let raw: pg.Client;

describe.skipIf(!up)(
  `eval_runs(agent_id, published_at desc, id desc) where gate passed index on Postgres${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
      await migrateDatabase(TEST_URL);
      handle = createDb({ DATABASE_URL: TEST_URL });
      raw = new pg.Client({ connectionString: TEST_URL });
      await raw.connect();

      await raw.query(
        `insert into users (id, name, locale, market, role) values ('tch_ridx', 'Regate Teacher', 'en-US', 'US', 'teacher')`,
      );
      await raw.query(
        `insert into teacher_profiles (id, user_id, slug, subject, verification_status)
           values ('tp_ridx', 'tch_ridx', 'regate-teacher', 'math', 'verified')`,
      );
      // One anchor agent + agent_version to satisfy eval_runs.agent_version_id's NOT NULL FK; its
      // value isn't semantically tied to this test, so every synthetic eval_runs row reuses it
      // (lead answer Q2).
      await raw.query(
        `insert into agents (id, teacher_id, status) values ('agt_ridx_anchor', 'tch_ridx', 'draft')`,
      );
      await raw.query(
        `insert into agent_versions (id, teacher_id, agent_id, version, config)
           values ('av_ridx_anchor', 'tch_ridx', 'agt_ridx_anchor', 1, '{}'::jsonb)`,
      );

      // AGENT_COUNT distinct live agents, RUNS_PER_AGENT passed/published gate eval_runs rows
      // each, spread across distinct published_at timestamps so there's a real sort to avoid.
      await raw.query(
        `insert into agents (id, teacher_id, status)
           select 'agt_ridx_' || gs, 'tch_ridx', 'live'
           from generate_series(1, ${AGENT_COUNT}) gs`,
      );
      await raw.query(
        `insert into eval_runs (id, teacher_id, agent_version_id, agent_id, suite, model, status, basis, published_at)
           select 'er_ridx_' || a || '_' || r, 'tch_ridx', 'av_ridx_anchor', 'agt_ridx_' || a,
                  'gate', 'm', 'passed', '{}'::jsonb,
                  timestamp '2026-01-01 00:00:00' + ((a * ${RUNS_PER_AGENT} + r) || ' seconds')::interval
           from generate_series(1, ${AGENT_COUNT}) a, generate_series(1, ${RUNS_PER_AGENT}) r`,
      );
      await raw.query(
        `insert into eval_runs (id, teacher_id, agent_version_id, agent_id, suite, model)
           select 'er_ridx_other_' || a || '_' || r, 'tch_ridx', 'av_ridx_anchor', 'agt_ridx_' || a,
                  'accuracy', 'm'
           from generate_series(1, ${AGENT_COUNT}) a, generate_series(1, ${OTHER_RUNS_PER_AGENT}) r`,
      );
      await raw.query('analyze eval_runs');
    });

    afterAll(async () => {
      await raw?.end();
      await dropDatabase(dbName);
      await handle?.close();
    });

    it('creates the eval_runs_gate_passed_agent_id_published_at_id_idx index', async () => {
      const { rows } = await raw.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes where tablename = 'eval_runs'`,
      );
      const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      const def = defs.eval_runs_gate_passed_agent_id_published_at_id_idx;
      expect(def).toBeDefined();
      // Postgres omits "NULLS FIRST" from indexdef here since it's DESC's default order.
      expect(def).toMatch(/\(agent_id, published_at DESC, id DESC\)/);
      expect(def).toContain("suite = 'gate'");
      expect(def).toContain("status = 'passed'");
    });

    it('accesses eval_runs through the new index for a query shaped like the last CTE', async () => {
      await raw.query('begin');
      // A small work_mem and a lower random_page_cost (SSD-like, the production host's actual
      // storage) make the planner's cost model match a table far bigger than this fixture: an
      // on-disk sort of a sort-based plan's rows costs enough, and random index page reads cost
      // little enough, that scanning the new index in its native order (no separate Sort node)
      // wins over a sequential/bitmap scan plus explicit sort, without needing a
      // production-sized synthetic fixture.
      await raw.query("set local work_mem = '64kB'");
      await raw.query('set local random_page_cost = 1.1');
      // Same where/order by/distinct on as publish.ts's `last` CTE, unannotated: Postgres
      // defaults an un-annotated `desc` to `nulls first`, which is why the index's columns are
      // declared `.desc().nullsFirst()` in operations.ts -- so this exact, unmodified query shape
      // matches the index's native order with no Sort needed.
      const { rows } = await raw.query<{ 'QUERY PLAN': string }>(
        `explain select distinct on (agent_id)
           agent_id, teacher_id, (basis->>'materialRevision')::bigint as published_revision
         from eval_runs
         where suite = 'gate' and status = 'passed' and published_at is not null
         order by agent_id, published_at desc, id desc`,
      );
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      await raw.query('rollback');
      expect(plan).toContain('eval_runs_gate_passed_agent_id_published_at_id_idx');
      expect(plan).toMatch(/Index( Only)? Scan/);
      expect(plan).not.toContain('Sort');
    });
  },
);
