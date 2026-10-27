// Task 8.2i (Phase B), on a real Postgres 16 (see test/pg.ts; skipped locally without one, fails
// in CI). `staleProcessing` is a cross-teacher read (a scheduled job, not a signed-in teacher's
// own request): it returns only `processing` documents whose `updated_at` is older than cutoff,
// across every teacher, oldest first, capped at `limit`, and never a null-storage-key row.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import { ingestSweepRepo, type IngestSweepRepo } from '../src/index.js';
import { documents } from '../src/schema/content.js';
import { MOD, RA, RB, seedRetrievalWorld } from './retrieval-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('ingest sweep integration tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);

const OLD = new Date('2026-01-01T00:00:00Z');
const RECENT = new Date('2026-10-27T09:45:00Z');
const CUTOFF = new Date('2026-10-27T09:15:00Z');

let n = 0;
const uid = (p: string) => `${p}_${(n += 1)}`;

describe.skipIf(!up)(`ingest sweep on Postgres 16${up ? '' : ` (${SKIP_REASON})`}`, () => {
  let handle: DbHandle;
  let sweep: IngestSweepRepo;
  let raw: pg.Client;

  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    sweep = ingestSweepRepo(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
    await seedRetrievalWorld(handle.db);
  });

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  /** A document for `teacherId`/`moduleId` with `status`, `storageKey` and a backdated `updatedAt`. */
  async function seedDoc(
    teacherId: string,
    moduleId: string,
    status: 'uploading' | 'processing' | 'ready' | 'failed',
    storageKey: string | null,
    updatedAt: Date,
  ): Promise<string> {
    const id = uid('doc_sweep');
    await raw.query(
      `insert into documents (id, teacher_id, module_id, kind, source_title, storage_key, status, updated_at)
       values ($1,$2,$3,'material',$4,$5,$6,$7)`,
      [id, teacherId, moduleId, `${id} title`, storageKey, status, updatedAt],
    );
    return id;
  }

  describe('staleProcessing', () => {
    it('returns only past-cutoff processing rows with a storage key, across teachers', async () => {
      const staleA = await seedDoc(RA, MOD.allowed, 'processing', 'uploads/a/1.pdf', OLD);
      const staleB = await seedDoc(RB, MOD.other, 'processing', 'uploads/b/1.pdf', OLD);
      const recent = await seedDoc(RA, MOD.allowed, 'processing', 'uploads/a/2.pdf', RECENT);
      const ready = await seedDoc(RA, MOD.allowed, 'ready', 'uploads/a/3.pdf', OLD);
      const failed = await seedDoc(RA, MOD.allowed, 'failed', 'uploads/a/4.pdf', OLD);
      const uploading = await seedDoc(RA, MOD.allowed, 'uploading', 'uploads/a/5.pdf', OLD);
      const note = await seedDoc(RA, MOD.allowed, 'processing', null, OLD);

      const rows = await sweep.staleProcessing(CUTOFF);
      const ids = rows.map((r) => r.id);

      expect(ids).toEqual(expect.arrayContaining([staleA, staleB]));
      expect(ids).not.toContain(recent);
      expect(ids).not.toContain(ready);
      expect(ids).not.toContain(failed);
      expect(ids).not.toContain(uploading);
      expect(ids).not.toContain(note);

      const staleARow = rows.find((r) => r.id === staleA);
      expect(staleARow).toEqual({ id: staleA, teacherId: RA, storageKey: 'uploads/a/1.pdf' });
    });

    it('is oldest-first and respects `limit`', async () => {
      // Older than every other row this file seeds, so it is unambiguously first regardless of
      // what other tests in this describe block have already inserted.
      const FAR_OLDER = new Date('2025-06-01T00:00:00Z');
      const older = await seedDoc(RA, MOD.allowed, 'processing', 'uploads/a/older.pdf', FAR_OLDER);
      const newer = await seedDoc(
        RA,
        MOD.allowed,
        'processing',
        'uploads/a/newer.pdf',
        new Date(FAR_OLDER.getTime() + 60_000),
      );

      const rows = await sweep.staleProcessing(CUTOFF, 1);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(older);

      const all = await sweep.staleProcessing(CUTOFF, 100);
      const orderedIds = all.map((r) => r.id);
      expect(orderedIds.indexOf(older)).toBeLessThan(orderedIds.indexOf(newer));
    });

    it('a cutoff in the past returns nothing', async () => {
      await seedDoc(RA, MOD.allowed, 'processing', 'uploads/a/far.pdf', OLD);
      const rows = await sweep.staleProcessing(new Date('2020-01-01T00:00:00Z'));
      expect(rows).toEqual([]);
    });

    // Task 8.2p, index widened by task 8.2r at the 8.2q review's request:
    // documents_sweep_updated_at_id_idx (replacing documents_processing_updated_at_id_idx) backs
    // this query's `status = 'processing'` range plus its `ORDER BY updated_at, id` keyset --
    // the new index's wider `status IN ('processing', 'uploading')` predicate still covers this
    // query's narrower filter. `enable_seqscan = off` (the table is tiny, so without it the
    // planner picks a seq scan unforced) inside a rolled-back transaction, same helper shape as
    // discovery.int.test.ts's explainSeqscanOff.
    it('the sweep query uses documents_sweep_updated_at_id_idx', async () => {
      const query = handle.db
        .select({
          id: documents.id,
          teacherId: documents.teacherId,
          storageKey: documents.storageKey,
        })
        .from(documents)
        .where(
          and(
            eq(documents.status, 'processing'),
            lt(documents.updatedAt, CUTOFF),
            isNotNull(documents.storageKey),
          ),
        )
        .orderBy(asc(documents.updatedAt), asc(documents.id))
        .limit(1000);
      const { sql: text, params } = query.toSQL();
      await raw.query('BEGIN');
      let plan: string;
      try {
        await raw.query('SET LOCAL enable_seqscan = off');
        const { rows } = await raw.query(`EXPLAIN (FORMAT JSON) ${text}`, params);
        plan = JSON.stringify(rows[0]['QUERY PLAN']);
      } finally {
        await raw.query('ROLLBACK');
      }
      expect(plan).toContain('documents_sweep_updated_at_id_idx');
    });
  });
});
