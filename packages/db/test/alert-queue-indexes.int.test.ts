// Task 12.5d on Postgres: three index changes folded from 12.5a's deferred findings and 11.2c.
// 1. safety_alerts_open_created_at_created_id_idx matches listForStaff's open-list ORDER BY
//    (acknowledged_at is not null, escalated_at is null, created_at, id) WHERE acknowledged_at is
//    null exactly, so the open-list scan needs no Sort node.
// 2. safety_alerts_acknowledged_by_idx covers the acknowledged_by FK for staff lookups.
// 3. class_questions_live_class_id_created_at_id_idx matches the teacher queue scan's ORDER BY
//    (live_class_id, created_at, id), replacing the old live_class_id-only index.
// See test/pg.ts for how to start Postgres.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import { createRepositories, type Repositories } from '../src/index.js';
import { ids, seed, studentId, teacherId } from './isolation-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('alert/queue index tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const tA = teacherId('A');

describe.skipIf(!up)(`alert and queue indexes on Postgres${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seed(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();

    // A handful of open safety alerts, varied escalation state, for the EXPLAIN test.
    for (let i = 0; i < 6; i += 1) {
      await raw.query(
        `insert into safety_alerts
           (id, level, kind, student_id, teacher_id, session_id, excerpt_redacted, created_at, escalated_at)
         values ($1, 'alert', 'distress', $2, $3, $4, 'synthetic excerpt', $5, $6)`,
        [
          `alr_q_${i}`,
          studentId('1'),
          tA,
          ids.session('1A'),
          new Date(Date.UTC(2026, 9, 20, 0, i)),
          i % 2 === 0 ? null : new Date(Date.UTC(2026, 9, 20, 0, i)),
        ],
      );
    }

    // A live class with a few questions, for the EXPLAIN-free pg_indexes check.
    const { id: liveClassId } = await repos.liveClasses.create(
      { teacherId: tA },
      {
        title: 'Index test class',
        link: 'https://meet.example.com/idx',
        startsAt: '2030-01-01T00:00:00Z',
        packageIds: [ids.pkg('A')],
      },
    );
    for (let i = 0; i < 3; i += 1) {
      await raw.query(
        `insert into class_questions (id, live_class_id, text, created_at) values ($1, $2, $3, $4)`,
        [`cq_idx_${i}`, liveClassId, `question ${i}`, new Date(Date.UTC(2026, 9, 20, 0, i))],
      );
    }
  });

  afterAll(async () => {
    await raw?.end();
    await dropDatabase(dbName);
  });

  async function indexDefs(table: string): Promise<Record<string, string>> {
    const { rows } = await raw.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where tablename = $1`,
      [table],
    );
    return Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
  }

  it('creates the safety_alerts open-list index with the expected key and partial predicate', async () => {
    const defs = await indexDefs('safety_alerts');
    expect(defs.safety_alerts_open_created_at_created_id_idx).toMatch(
      /\(\(\(acknowledged_at IS NOT NULL\)\), \(\(escalated_at IS NULL\)\), created_at, id\)/,
    );
    expect(defs.safety_alerts_open_created_at_created_id_idx).toMatch(
      /WHERE \(acknowledged_at IS NULL\)/,
    );
    // The old created_at/id-only partial index is gone (nothing else uses it).
    expect(defs.safety_alerts_open_created_at_id_idx).toBeUndefined();
  });

  it('creates the safety_alerts acknowledged_by index, partial on not-null', async () => {
    const defs = await indexDefs('safety_alerts');
    expect(defs.safety_alerts_acknowledged_by_idx).toMatch(/\(acknowledged_by\)/);
    expect(defs.safety_alerts_acknowledged_by_idx).toMatch(/WHERE \(acknowledged_by IS NOT NULL\)/);
  });

  it('replaces the class_questions index with (live_class_id, created_at, id)', async () => {
    const defs = await indexDefs('class_questions');
    expect(defs.class_questions_live_class_id_created_at_id_idx).toMatch(
      /\(live_class_id, created_at, id\)/,
    );
    expect(defs.class_questions_live_class_id_idx).toBeUndefined();
  });

  it('scans the open safety-alert list in index order with no Sort node', async () => {
    await raw.query('begin');
    try {
      await raw.query('set local enable_seqscan = off');
      const { rows } = await raw.query<{ 'QUERY PLAN': string }>(
        `explain select id from safety_alerts
           where acknowledged_at is null
           order by (acknowledged_at is not null), (escalated_at is null), created_at, id`,
      );
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toContain('safety_alerts_open_created_at_created_id_idx');
      expect(plan).not.toContain('Sort');
    } finally {
      await raw.query('rollback');
    }
  });
});
