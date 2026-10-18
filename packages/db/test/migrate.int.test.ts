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
import { DATA_MODEL_TABLES, latestSnapshot } from './helpers.js';
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
          embedding: [0.5, -1, 2],
        });
        const [chunk] = await db.select().from(s.chunks).where(eq(s.chunks.teacherId, teacher.id));
        expect(chunk?.embedding).toEqual([0.5, -1, 2]);
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
