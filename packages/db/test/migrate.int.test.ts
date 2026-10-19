// Integration: applies the migrations to a real Postgres 16 + pgvector (the pinned image), tears
// the result down and applies them again ("migrate up/down clean", task 1.1).
//
// Locally: docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres
// (the override publishes the compose Postgres on 127.0.0.1:55432 only). CI sets TEST_DATABASE_URL to
// the job's Postgres service. With no database reachable the suite is skipped locally and fails in CI.
//
// Each run creates its own throwaway database and drops it afterwards; it never touches the
// database named in the URL beyond CREATE/DROP DATABASE.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { demoPackageFree } from '@edmate/contracts/fixtures';
import { createDb } from '../src/client.js';
import { runMigrateCli } from '../src/cli.js';
import { migrateDatabase } from '../src/migrate.js';
import * as s from '../src/schema/index.js';
import { DATA_MODEL_TABLES, latestSnapshot, migrationSql } from './helpers.js';
import {
  admin,
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('migration integration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);

/** A text-embedding-3-small shaped vector (task 2.7): 1536 small, distinct values. */
const embedding1536 = Array.from({ length: 1536 }, (_, i) => ((i % 7) - 3) / 4);

/** Tables, columns, indexes and extensions as Postgres reports them. */
async function inspect() {
  return admin(async (c) => {
    const tables = await c.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const columns = await c.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    );
    const indexes = await c.query<{ tablename: string; indexname: string }>(
      `select tablename, indexname from pg_indexes where schemaname = 'public'`,
    );
    const ext = await c.query<{ extname: string }>(
      `select extname from pg_extension where extname = 'vector'`,
    );
    const applied = await c.query<{ n: string }>(
      `select count(*)::text as n from drizzle.__drizzle_migrations`,
    );
    return {
      tables: tables.rows.map((r) => r.table_name).sort(),
      columns: new Set(columns.rows.map((r) => `${r.table_name}.${r.column_name}`)),
      indexes: new Set(indexes.rows.map((r) => `${r.tablename}.${r.indexname}`)),
      vector: ext.rowCount === 1,
      applied: Number(applied.rows[0]?.n ?? 0),
    };
  }, TEST_URL);
}

/** Asserts the database holds exactly what the newest migration snapshot describes. */
async function expectFullSchema() {
  const got = await inspect();
  const snap = latestSnapshot();
  expect(got.vector, 'pgvector extension').toBe(true);
  expect(got.tables).toEqual([...DATA_MODEL_TABLES].sort());
  for (const t of Object.values(snap.tables)) {
    for (const col of Object.keys(t.columns)) {
      expect(got.columns.has(`${t.name}.${col}`), `${t.name}.${col}`).toBe(true);
    }
    for (const idx of Object.keys(t.indexes)) {
      expect(got.indexes.has(`${t.name}.${idx}`), `${t.name}.${idx}`).toBe(true);
    }
  }
  return got;
}

describe.skipIf(!up)(
  `migrations against Postgres 16 + pgvector${up ? '' : ` (${SKIP_REASON})`}`,
  () => {
    beforeAll(async () => {
      await createDatabase(dbName);
    });

    afterAll(async () => {
      await dropDatabase(dbName);
    });

    // Task 3.16c: migrateDatabase() takes a session-level advisory lock around drizzle's migrate()
    // and the post-migrate steps, so two overlapping runs (two app instances starting at once)
    // serialize instead of racing drizzle's migrations-table insert or the post-migrate index
    // build/drop.
    it('two concurrent migrateDatabase() calls against a fresh database both resolve, and the second finds the index valid and skips the drop', async () => {
      const concurrentDbName = throwawayName();
      const concurrentUrl = urlFor(concurrentDbName);
      await createDatabase(concurrentDbName);
      try {
        await Promise.all([migrateDatabase(concurrentUrl), migrateDatabase(concurrentUrl)]);
        await admin(async (c) => {
          const idx = await c.query<{ indisvalid: boolean; indisready: boolean }>(
            `select indisvalid, indisready from pg_index
               where indexrelid = 'sessions_package_id_package_version_idx'::regclass`,
          );
          expect(idx.rows).toHaveLength(1);
          expect(idx.rows[0]).toMatchObject({ indisvalid: true, indisready: true });

          const cons = await c.query<{ conname: string; convalidated: boolean }>(
            `select conname, convalidated from pg_constraint where conrelid = 'sessions'::regclass
               and conname in ('sessions_package_version_fk', 'sessions_package_pin_complete', 'sessions_open_has_package')`,
          );
          expect(cons.rows).toHaveLength(3);
          for (const row of cons.rows) {
            expect(row.convalidated, row.conname).toBe(true);
          }
        }, concurrentUrl);
      } finally {
        await dropDatabase(concurrentDbName);
      }
    });

    it('apply cleanly to an empty database', async () => {
      await migrateDatabase(TEST_URL);
      const got = await expectFullSchema();
      expect(got.applied).toBeGreaterThan(0);
      console.log(
        `[migrate up] ${got.tables.length} tables, ${got.columns.size} columns, ` +
          `${got.indexes.size} indexes, pgvector=${got.vector}, migrations applied=${got.applied}`,
      );
    });

    it('re-running is a no-op', async () => {
      const before = (await inspect()).applied;
      await migrateDatabase(TEST_URL);
      expect((await inspect()).applied).toBe(before);
    });

    // Task 3.16b: 0009's FK and both CHECKs are added NOT VALID, then validated by
    // runPostMigrateSteps outside drizzle's migration transaction; the index is built the same
    // way with CREATE INDEX CONCURRENTLY. migrateDatabase() above already ran this twice
    // ('apply cleanly' then 're-running is a no-op'), so both assertions also cover "runs twice,
    // still correct" for the post-migrate step itself.
    it('validates the three 0009 constraints and builds the package-pin and open-session indexes outside the migration transaction', async () => {
      await admin(async (c) => {
        const cons = await c.query<{ conname: string; convalidated: boolean }>(
          `select conname, convalidated from pg_constraint where conrelid = 'sessions'::regclass
             and conname in ('sessions_package_version_fk', 'sessions_package_pin_complete', 'sessions_open_has_package')`,
        );
        expect(cons.rows).toHaveLength(3);
        for (const row of cons.rows) {
          expect(row.convalidated, row.conname).toBe(true);
        }

        for (const indexName of [
          'sessions_package_id_package_version_idx',
          'sessions_open_teacher_id_student_id_idx',
        ]) {
          const idx = await c.query<{ indisvalid: boolean; indisready: boolean }>(
            `select indisvalid, indisready from pg_index where indexrelid = $1::regclass`,
            [indexName],
          );
          expect(idx.rows, indexName).toHaveLength(1);
          expect(idx.rows[0], indexName).toMatchObject({ indisvalid: true, indisready: true });
        }

        // Partial: only rows for an open session (ended_at is null) land in the index predicate.
        const pred = await c.query<{ indpred: string }>(
          `select pg_get_expr(indpred, indrelid) as indpred from pg_index
             where indexrelid = 'sessions_open_teacher_id_student_id_idx'::regclass`,
        );
        expect(pred.rows[0]?.indpred).toMatch(/ended_at.*IS NULL/i);
      }, TEST_URL);
    });

    it('rebuilds an index left INVALID by a failed or killed earlier CREATE INDEX CONCURRENTLY', async () => {
      // Simulates what a killed concurrent build leaves behind: the index exists, but
      // indisvalid = false. A later IF NOT EXISTS alone would keep it broken forever.
      await admin(
        (c) =>
          c.query(
            `update pg_index set indisvalid = false
               where indexrelid = 'sessions_package_id_package_version_idx'::regclass`,
          ),
        TEST_URL,
      );
      await admin(async (c) => {
        const before = await c.query<{ indisvalid: boolean }>(
          `select indisvalid from pg_index
             where indexrelid = 'sessions_package_id_package_version_idx'::regclass`,
        );
        expect(before.rows[0]?.indisvalid, 'forced INVALID').toBe(false);
      }, TEST_URL);

      await migrateDatabase(TEST_URL);

      await admin(async (c) => {
        const after = await c.query<{ indisvalid: boolean; indisready: boolean }>(
          `select indisvalid, indisready from pg_index
             where indexrelid = 'sessions_package_id_package_version_idx'::regclass`,
        );
        expect(after.rows).toHaveLength(1);
        expect(after.rows[0]).toMatchObject({ indisvalid: true, indisready: true });
      }, TEST_URL);
    });

    it('rejects a session that violates the 0009 package-pin constraints', async () => {
      await admin(async (c) => {
        // Self-contained fixture: a teacher, acting as its own student, and that teacher's agent.
        await c.query(
          `insert into users (id, name, locale, market, role)
             values ('usr_3_16b_fixture', 'T', 'en', 'test', 'teacher')`,
        );
        await c.query(
          `insert into agents (id, teacher_id) values ('agt_3_16b_fixture', 'usr_3_16b_fixture')`,
        );
        const teacherId = 'usr_3_16b_fixture';
        const agentId = 'agt_3_16b_fixture';
        // sessions_open_has_package: an open session (ended_at null) needs a pin.
        await expect(
          c.query(
            `insert into sessions (id, student_id, teacher_id, agent_id, agent_version)
             values ('ses_violates_open_has_package', $1, $1, $2, 1)`,
            [teacherId, agentId],
          ),
        ).rejects.toThrow(/sessions_open_has_package/);
        // sessions_package_pin_complete: both-or-neither.
        await expect(
          c.query(
            `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, ended_at)
             values ('ses_violates_pin_complete', $1, $1, $2, 1, 'pkg_missing', now())`,
            [teacherId, agentId],
          ),
        ).rejects.toThrow(/sessions_package_pin_complete/);
        // sessions_package_version_fk: the pin must name a real package version.
        await expect(
          c.query(
            `insert into sessions (id, student_id, teacher_id, agent_id, agent_version, package_id, package_version)
             values ('ses_violates_fk', $1, $1, $2, 1, 'pkg_missing', 1)`,
            [teacherId, agentId],
          ),
        ).rejects.toThrow(/sessions_package_version_fk/);
      }, TEST_URL);
    });

    it('store and read rows: vector embedding, generated tsvector, scoped keys', async () => {
      const { db, close } = createDb({ DATABASE_URL: TEST_URL });
      try {
        const [teacher] = await db
          .insert(s.users)
          .values({ name: 'T', locale: 'en', market: 'test', role: 'teacher' })
          .returning();
        const [student] = await db
          .insert(s.users)
          .values({ id: 'stu_test_01', name: 'S', locale: 'en', market: 'test', role: 'student' })
          .returning();
        if (!teacher || !student) throw new Error('insert returned nothing');
        expect(teacher.id).toMatch(/^[0-9a-f-]{36}$/);

        const [course] = await db
          .insert(s.courses)
          .values({ teacherId: teacher.id, title: 'C', order: 0 })
          .returning();
        const [mod] = await db
          .insert(s.modules)
          .values({ teacherId: teacher.id, courseId: course!.id, title: 'M', order: 0 })
          .returning();
        const [doc] = await db
          .insert(s.documents)
          .values({
            teacherId: teacher.id,
            moduleId: mod!.id,
            kind: 'material',
            sourceTitle: 'Notes',
          })
          .returning();
        await db.insert(s.chunks).values({
          teacherId: teacher.id,
          documentId: doc!.id,
          moduleId: mod!.id,
          kind: 'material',
          text: 'Compound interest grows exponentially',
          sourceTitle: 'Notes',
          locator: 'p. 1',
          embedding: embedding1536,
        });
        const [chunk] = await db.select().from(s.chunks).where(eq(s.chunks.teacherId, teacher.id));
        expect(chunk?.embedding).toEqual(embedding1536);
        // vector(1536): Postgres refuses any other length (task 2.7).
        await expect(
          db.insert(s.chunks).values({
            teacherId: teacher.id,
            documentId: doc!.id,
            moduleId: mod!.id,
            kind: 'material',
            text: 'wrong size',
            sourceTitle: 'Notes',
            locator: 'p. 2',
            embedding: [0.5, -1, 2],
          }),
        ).rejects.toThrow();
        expect(chunk?.search).toContain('compound');

        const noEmbedding = await db
          .insert(s.chunks)
          .values({
            teacherId: teacher.id,
            documentId: doc!.id,
            moduleId: mod!.id,
            kind: 'teacher_note',
            text: 'x',
            sourceTitle: 'Correction',
            locator: '',
          })
          .returning();
        expect(noEmbedding[0]?.embedding).toBeNull();

        const [agent] = await db.insert(s.agents).values({ teacherId: teacher.id }).returning();
        expect(agent?.status).toBe('draft');
        const [published] = await db
          .update(s.agents)
          .set({ status: 'live', liveVersion: 1 })
          .where(eq(s.agents.id, agent!.id))
          .returning();
        expect(published?.updatedAt.getTime()).toBeGreaterThanOrEqual(agent!.updatedAt.getTime());
        expect(published?.status).toBe('live');
        const [pkg] = await db
          .insert(s.packages)
          .values({ teacherId: teacher.id, agentId: agent!.id, name: 'Basic' })
          .returning();
        const [pv] = await db
          .insert(s.packageVersions)
          .values({
            teacherId: teacher.id,
            packageId: pkg!.id,
            version: 1,
            config: { ...demoPackageFree, teacherId: teacher.id, id: pkg!.id },
          })
          .returning();
        await expect(
          db.insert(s.packageVersions).values({
            teacherId: teacher.id,
            packageId: pkg!.id,
            version: 1,
            config: { ...demoPackageFree, teacherId: teacher.id, id: pkg!.id },
          }),
        ).rejects.toThrow();

        // One live subscription per student x teacher; ended ones don't count.
        const sub = {
          studentId: student.id,
          teacherId: teacher.id,
          packageVersionId: pv!.id,
          periodEnd: new Date('2026-12-01T00:00:00Z'),
        };
        await db.insert(s.subscriptions).values({ ...sub, status: 'ended' });
        await db.insert(s.subscriptions).values({ ...sub, status: 'active' });
        await expect(
          db.insert(s.subscriptions).values({ ...sub, status: 'trial' }),
        ).rejects.toThrow();

        // A teacher_id that isn't a user is rejected (foreign key).
        await expect(
          db.insert(s.courses).values({ teacherId: 'nobody', title: 'x', order: 0 }),
        ).rejects.toThrow();

        // An id the app considers valid but isn't a UUID is accepted (text ids).
        const rows = await db
          .select()
          .from(s.users)
          .where(and(eq(s.users.id, 'stu_test_01'), eq(s.users.role, 'student')));
        expect(rows).toHaveLength(1);

        await db.insert(s.webhookEvents).values({
          provider: 'test',
          providerEventId: 'evt_1',
          payloadHash: 'h',
        });
        await expect(
          db
            .insert(s.webhookEvents)
            .values({ provider: 'test', providerEventId: 'evt_1', payloadHash: 'h' }),
        ).rejects.toThrow();
      } finally {
        await close();
      }
    });

    it('0006 stops, and keeps the data, when an embedding has another dimension (task 2.7)', async () => {
      const sql = migrationSql().find((f) => f.file === '0006_chunk_embedding_dimension.sql')!.sql;
      const [guard] = sql.split('--> statement-breakpoint');
      await admin(async (c) => {
        await c.query('BEGIN');
        try {
          // Back to the pre-0006 column, holding one 3-dimensional vector.
          await c.query('DROP INDEX "chunks_embedding_hnsw_idx"');
          await c.query('ALTER TABLE "chunks" ALTER COLUMN "embedding" TYPE vector');
          const doc = await c.query<{ id: string; teacher_id: string; module_id: string }>(
            'select id, teacher_id, module_id from documents limit 1',
          );
          const d = doc.rows[0]!;
          await c.query(
            `insert into chunks (id, teacher_id, document_id, module_id, kind, text, source_title, locator, embedding)
             values ('chk_guard', $1, $2, $3, 'material', 'x', 'Notes', 'p. 9', '[1,2,3]')`,
            [d.teacher_id, d.id, d.module_id],
          );
          await expect(c.query(guard!)).rejects.toThrow(/not 1536-dimensional/);
        } finally {
          await c.query('ROLLBACK');
        }
        // The guard passes on the migrated database (every stored vector is 1536-dimensional).
        await c.query(guard!);
        const kept = await c.query<{ n: string }>(
          'select count(*)::text as n from chunks where embedding is not null',
        );
        expect(kept.rows[0]?.n).toBe('1');
      }, TEST_URL);
    });

    it('0007 stops when turn_traces already has rows (task 3.8)', async () => {
      const sql = migrationSql().find((f) => f.file === '0007_turn_trace_fields.sql')!.sql;
      const [guard] = sql.split('--> statement-breakpoint');
      await admin(async (c) => {
        // The guard passes on the migrated database (no traces stored yet).
        expect(
          (await c.query<{ n: string }>('select count(*)::text as n from turn_traces')).rows[0]?.n,
        ).toBe('0');
        await c.query(guard!);
        await c.query('BEGIN');
        try {
          // No session exists here; skip the foreign key for this rolled-back row only.
          await c.query('SET LOCAL session_replication_role = replica');
          await c.query(
            `insert into turn_traces (id, session_id, steps, model, input_tokens, output_tokens,
               cost_micro_usd, turn_id, agent_version, package_version, intent, move, guards, usage)
             values ('tt_guard', 'ses_guard', '[]', '', 0, 0, 0, 'trn_guard', 0, 0, 'on_task',
               'hint', '[]', '[]')`,
          );
          await expect(c.query(guard!)).rejects.toThrow(/turn_traces has rows/);
        } finally {
          await c.query('ROLLBACK');
        }
      }, TEST_URL);
    });

    it('tear down (drop the test schemas) and apply again from scratch', async () => {
      await admin(
        (c) =>
          c.query('DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public;'),
        TEST_URL,
      );
      const empty = await admin(
        (c) =>
          c.query<{ n: string }>(
            `select count(*)::text as n from information_schema.tables where table_schema = 'public'`,
          ),
        TEST_URL,
      );
      expect(empty.rows[0]?.n).toBe('0');
      console.log('[migrate down] dropped schemas public and drizzle; 0 tables left');

      const lines: string[] = [];
      expect(await runMigrateCli({ DATABASE_URL: TEST_URL }, (l) => lines.push(l))).toBe(0);
      expect(lines.join('\n')).toMatch(/migrations applied/);
      const got = await expectFullSchema();
      console.log(`[migrate re-apply] ${got.tables.length} tables, ${got.indexes.size} indexes`);
    });
  },
);
