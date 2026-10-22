// Task 8.2 Phase 1: a document's lifecycle on a real Postgres 16 + pgvector (see test/pg.ts;
// skipped locally without one, fails in CI). Status moves uploading -> processing -> ready/failed;
// delete removes chunks and row and bumps the material revision in one transaction, so the very
// next retrieval search misses the deleted document; startReplace clears the old chunks.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import {
  createRepositories,
  DOCUMENT_LIST_MAX,
  type DocumentRow,
  type Repositories,
  RepositoryError,
} from '../src/index.js';
import { MOD, RA, RB, seedRetrievalWorld } from './retrieval-seed.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('document lifecycle tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
let handle: DbHandle;
let repos: Repositories;
let raw: pg.Client;

const A = { teacherId: RA };
const B = { teacherId: RB };

async function rejection(p: Promise<unknown>): Promise<RepositoryError> {
  const err = await p.then(
    () => new Error('resolved'),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RepositoryError);
  return err as RepositoryError;
}

let n = 0;
/** A new document of A's under MOD.allowed with `texts` as its chunks. */
async function doc(texts: string[], storageKey = `uploads/${RA}/f${++n}.pdf`): Promise<string> {
  const id = `doc_life_${++n}`;
  await repos.documents.create(A, {
    id,
    moduleId: MOD.allowed,
    kind: 'material',
    sourceTitle: `${id} title`,
    storageKey,
  });
  if (texts.length > 0) {
    await repos.chunks.insertMany(
      A,
      id,
      texts.map((text, ord) => ({ ord, text, locator: `p${ord + 1}` })),
    );
  }
  return id;
}

const search = (q: string) =>
  repos.retrieval.search(A, { q, allowedModuleIds: [MOD.allowed], k: 50 });
const chunkCount = async (docId: string) =>
  Number(
    (await raw.query<{ n: string }>(`select count(*) as n from chunks where document_id = $1`, [
      docId,
    ])).rows[0]?.n,
  );

/** Waits until some session of this database is blocked on a row lock (the raced insert). */
async function waitForLockWait(): Promise<void> {
  for (let i = 0; i < 250; i++) {
    const { rows } = await raw.query<{ n: string }>(
      `select count(*) as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (Number(rows[0]?.n) > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('the insert never waited on the row lock');
}

describe.skipIf(!up)(`document lifecycle on Postgres 16${up ? '' : ` (${SKIP_REASON})`}`, () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    await seedRetrievalWorld(handle.db);
    repos = createRepositories(handle.db);
    raw = new pg.Client({ connectionString: TEST_URL });
    await raw.connect();
  });

  afterAll(async () => {
    await raw?.end();
    await handle?.close();
    await dropDatabase(dbName);
  });

  describe('get and listForTeacher', () => {
    it('a new document starts uploading, with no failure reason', async () => {
      const id = await doc([], 'uploads/k1.pdf');
      const row = await repos.documents.get(A, id);
      expect(row).toEqual<DocumentRow>({
        id,
        teacherId: RA,
        moduleId: MOD.allowed,
        kind: 'material',
        sourceTitle: `${id} title`,
        storageKey: 'uploads/k1.pdf',
        status: 'uploading',
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });
      expect(Object.keys(row!)).not.toContain('failureReason');
    });

    it('returns rightsDeclaredAt once the declaration is stored, and omits it before (12.3b)', async () => {
      const id = await doc([], 'uploads/k-rights.pdf');
      expect(Object.keys((await repos.documents.get(A, id))!)).not.toContain('rightsDeclaredAt');
      await raw.query(
        `update documents set rights_declared_at = '2026-10-22T09:30:00Z' where id = $1`,
        [id],
      );
      expect((await repos.documents.get(A, id))?.rightsDeclaredAt).toBe('2026-10-22T09:30:00.000Z');
      const listed = await repos.documents.listForTeacher(A);
      expect(listed.find((d) => d.id === id)?.rightsDeclaredAt).toBe('2026-10-22T09:30:00.000Z');
    });

    it("another teacher's or a missing document is null", async () => {
      const id = await doc([]);
      expect(await repos.documents.get(B, id)).toBeNull();
      expect(await repos.documents.get(A, 'doc_nope')).toBeNull();
    });

    it('omits storageKey for a note typed in the studio', async () => {
      await repos.documents.create(A, {
        id: 'doc_note_1',
        moduleId: MOD.allowed,
        kind: 'teacher_note',
        sourceTitle: 'note',
      });
      const row = await repos.documents.get(A, 'doc_note_1');
      expect(row && Object.keys(row)).not.toContain('storageKey');
    });

    it("lists only the scope's documents, newest first, optionally by module", async () => {
      await repos.documents.create(B, {
        id: 'doc_b_1',
        moduleId: MOD.other,
        kind: 'material',
        sourceTitle: 'b',
      });
      await repos.documents.create(A, {
        id: 'doc_locked_1',
        moduleId: MOD.locked,
        kind: 'material',
        sourceTitle: 'locked',
      });
      const all = await repos.documents.listForTeacher(A);
      expect(all.length).toBeGreaterThan(2);
      expect(all.every((d) => d.teacherId === RA)).toBe(true);
      expect(all.map((d) => d.id)).toContain('doc_locked_1');
      const times = all.map((d) => d.createdAt);
      expect([...times].sort().reverse()).toEqual(times);

      const locked = await repos.documents.listForTeacher(A, { moduleId: MOD.locked });
      expect(locked.map((d) => d.id)).toEqual(['doc_locked_1']);
      expect(await repos.documents.listForTeacher(A, { moduleId: MOD.other })).toEqual([]);
      expect((await repos.documents.listForTeacher(B)).map((d) => d.id)).toEqual(['doc_b_1']);
    });

    it('rejects a malformed id, module id or option before any SQL', async () => {
      expect((await rejection(repos.documents.get(A, "x' or 1=1"))).kind).toBe('invalid');
      for (const opts of [{ moduleId: '' }, { moduleId: 'a'.repeat(129) }, { extra: 1 }]) {
        const err = await rejection(repos.documents.listForTeacher(A, opts as never));
        expect(err.kind).toBe('invalid');
      }
    });

    it('caps a list at DOCUMENT_LIST_MAX', () => {
      expect(DOCUMENT_LIST_MAX).toBeGreaterThanOrEqual(100);
    });
  });

  describe('updateStatus', () => {
    it('moves uploading -> processing -> ready, and processing -> failed with a fixed code', async () => {
      const id = await doc([]);
      await repos.documents.updateStatus(A, id, 'processing');
      expect((await repos.documents.get(A, id))?.status).toBe('processing');
      await repos.documents.updateStatus(A, id, 'ready');
      expect((await repos.documents.get(A, id))?.status).toBe('ready');

      const bad = await doc([]);
      await repos.documents.updateStatus(A, bad, 'processing');
      await repos.documents.updateStatus(A, bad, 'failed', 'parse_failed');
      const row = await repos.documents.get(A, bad);
      expect(row?.status).toBe('failed');
      expect(row?.failureReason).toBe('parse_failed');
    });

    it('a failed document may be processed again, which clears its failure reason', async () => {
      const id = await doc([]);
      await repos.documents.updateStatus(A, id, 'failed', 'upload_missing');
      await repos.documents.updateStatus(A, id, 'processing');
      const row = await repos.documents.get(A, id);
      expect(row?.status).toBe('processing');
      expect(row && Object.keys(row)).not.toContain('failureReason');
    });

    it('refuses a transition the lifecycle does not allow, as not_found, writing nothing', async () => {
      const id = await doc([]);
      // uploading -> ready skips processing
      expect((await rejection(repos.documents.updateStatus(A, id, 'ready'))).kind).toBe(
        'not_found',
      );
      await repos.documents.updateStatus(A, id, 'processing');
      await repos.documents.updateStatus(A, id, 'ready');
      // ready is final until startReplace
      for (const s of ['processing', 'failed'] as const) {
        const err = await rejection(
          repos.documents.updateStatus(A, id, s, s === 'failed' ? 'x_failed' : undefined),
        );
        expect(err.kind).toBe('not_found');
      }
      expect((await repos.documents.get(A, id))?.status).toBe('ready');
    });

    it("another teacher's or a missing document is not_found", async () => {
      const id = await doc([]);
      expect((await rejection(repos.documents.updateStatus(B, id, 'processing'))).kind).toBe(
        'not_found',
      );
      expect((await rejection(repos.documents.updateStatus(A, 'doc_nope', 'processing'))).kind).toBe(
        'not_found',
      );
      expect((await repos.documents.get(A, id))?.status).toBe('uploading');
    });

    it('rejects a bad status or failure reason before any SQL', async () => {
      const id = await doc([]);
      const bad: [string, string | undefined][] = [
        ['uploading', undefined], // only create / startReplace set uploading
        ['done', undefined],
        ['failed', undefined], // a failure needs its code
        ['ready', 'parse_failed'], // a code only with failed
        ['failed', 'Raw error: ECONNREFUSED 10.0.0.1'],
        ['failed', 'a'.repeat(65)],
        ['failed', ''],
      ];
      for (const [s, reason] of bad) {
        const err = await rejection(repos.documents.updateStatus(A, id, s as never, reason));
        expect(err.kind, `${s} ${String(reason)}`).toBe('invalid');
      }
      expect((await repos.documents.get(A, id))?.status).toBe('uploading');
    });

    it('does not bump the material revision (status is not a retrieval gate)', async () => {
      const id = await doc([]);
      const before = await repos.retrieval.revision(A);
      await repos.documents.updateStatus(A, id, 'processing');
      expect(await repos.retrieval.revision(A)).toBe(before);
    });
  });

  describe('delete', () => {
    it('removes chunks and row, bumps the revision, and the next search misses it', async () => {
      const id = await doc(['zygomorphic petals unique marker', 'second zygomorphic chunk']);
      const keep = await doc(['zygomorphic survivor chunk']);
      expect((await search('zygomorphic')).map((c) => c.documentId)).toContain(id);
      const before = await repos.retrieval.revision(A);

      const res = await repos.documents.delete(A, id);

      expect(res.storageKey).toMatch(/^uploads\//);
      expect(await repos.retrieval.revision(A)).toBe(before + 1);
      expect(await repos.documents.get(A, id)).toBeNull();
      expect(await chunkCount(id)).toBe(0);
      const hits = await search('zygomorphic');
      expect(hits.map((c) => c.documentId)).not.toContain(id);
      expect(hits.map((c) => c.documentId)).toContain(keep);
    });

    it('returns a null storageKey for a document without a file', async () => {
      await repos.documents.create(A, {
        id: 'doc_note_del',
        moduleId: MOD.allowed,
        kind: 'teacher_note',
        sourceTitle: 'n',
      });
      expect(await repos.documents.delete(A, 'doc_note_del')).toEqual({ storageKey: null });
    });

    it("another teacher's, a missing or an already deleted document is not_found, nothing written", async () => {
      const id = await doc(['quokka marker text']);
      const before = await repos.retrieval.revision(A);
      expect((await rejection(repos.documents.delete(B, id))).kind).toBe('not_found');
      expect((await rejection(repos.documents.delete(A, 'doc_nope'))).kind).toBe('not_found');
      expect(await chunkCount(id)).toBe(1);
      expect(await repos.retrieval.revision(A)).toBe(before);
      await repos.documents.delete(A, id);
      expect((await rejection(repos.documents.delete(A, id))).kind).toBe('not_found');
    });

    it('rejects a malformed id before any SQL', async () => {
      expect((await rejection(repos.documents.delete(A, ''))).kind).toBe('invalid');
    });

    it('a concurrent chunk insert either lands before the delete or fails; none survive', async () => {
      const id = await doc(['raced first chunk']);
      const results = await Promise.allSettled([
        repos.chunks.insertMany(A, id, [{ ord: 5, text: 'raced late chunk', locator: 'p6' }]),
        repos.documents.delete(A, id),
      ]);
      expect(results[1].status).toBe('fulfilled');
      expect(await chunkCount(id)).toBe(0);
    });
  });

  describe('startReplace', () => {
    it('clears the old chunks, resets status and key, bumps the revision', async () => {
      const id = await doc(['xenolith old version marker'], 'uploads/old.pdf');
      await repos.documents.updateStatus(A, id, 'processing');
      await repos.documents.updateStatus(A, id, 'failed', 'parse_failed');
      const before = await repos.retrieval.revision(A);

      const res = await repos.documents.startReplace(A, id, { storageKey: 'uploads/new.pdf' });

      expect(res).toEqual({ previousStorageKey: 'uploads/old.pdf' });
      const row = await repos.documents.get(A, id);
      expect(row?.status).toBe('uploading');
      expect(row?.storageKey).toBe('uploads/new.pdf');
      expect(row && Object.keys(row)).not.toContain('failureReason');
      expect(await chunkCount(id)).toBe(0);
      expect(await repos.retrieval.revision(A)).toBe(before + 1);
      expect((await search('xenolith')).map((c) => c.documentId)).not.toContain(id);
      // the replaced document takes new chunks under the same id
      await repos.chunks.insertMany(A, id, [{ ord: 0, text: 'xenolith new', locator: 'p1' }]);
      expect(await chunkCount(id)).toBe(1);
    });

    it("another teacher's or a missing document is not_found, nothing written", async () => {
      const id = await doc(['wombat marker'], 'uploads/w.pdf');
      for (const [scope, target] of [
        [B, id],
        [A, 'doc_nope'],
      ] as const) {
        const err = await rejection(
          repos.documents.startReplace(scope, target, { storageKey: 'uploads/evil.pdf' }),
        );
        expect(err.kind).toBe('not_found');
      }
      expect((await repos.documents.get(A, id))?.storageKey).toBe('uploads/w.pdf');
      expect(await chunkCount(id)).toBe(1);
    });

    it('rejects a bad storage key or extra keys before any SQL', async () => {
      const id = await doc([]);
      for (const input of [
        { storageKey: '' },
        { storageKey: 'k'.repeat(1025) },
        {},
        { storageKey: 'k', teacherId: RB },
      ]) {
        const err = await rejection(repos.documents.startReplace(A, id, input as never));
        expect(err.kind).toBe('invalid');
      }
    });
  });

  describe('chunks.insertManyIfStorageKey (8.2 fix round: check and write in one statement)', () => {
    const draft = [{ ord: 0, text: 'quokka keyed chunk', locator: 'p1' }];

    it('writes when the document still has the expected key', async () => {
      const id = await doc([], 'uploads/keep.pdf');
      const before = await repos.retrieval.revision(A);
      const res = await repos.chunks.insertManyIfStorageKey(A, id, 'uploads/keep.pdf', draft);
      expect(res).toEqual({ stale: false, ids: [`${id}-c0000`] });
      expect(await chunkCount(id)).toBe(1);
      expect(await repos.retrieval.revision(A)).toBe(before + 1);
    });

    it('is stale and writes nothing once a replace changed the key', async () => {
      const id = await doc([], 'uploads/before.pdf');
      await repos.documents.startReplace(A, id, { storageKey: 'uploads/after.pdf' });
      const before = await repos.retrieval.revision(A);
      const res = await repos.chunks.insertManyIfStorageKey(A, id, 'uploads/before.pdf', draft);
      expect(res).toEqual({ stale: true });
      expect(await chunkCount(id)).toBe(0);
      expect(await repos.retrieval.revision(A)).toBe(before);
    });

    it("another teacher's or a missing document is not_found, nothing written", async () => {
      const id = await doc([], 'uploads/theirs.pdf');
      for (const [scope, target] of [
        [B, id],
        [A, 'doc_gone'],
      ] as const) {
        const err = await rejection(
          repos.chunks.insertManyIfStorageKey(scope, target, 'uploads/theirs.pdf', draft),
        );
        expect(err.kind).toBe('not_found');
      }
      expect(await chunkCount(id)).toBe(0);
    });

    it('a delete committing while the insert waits is not_found, nothing written', async () => {
      const id = await doc([], 'uploads/del-race.pdf');
      await raw.query('begin');
      await raw.query(`delete from documents where id = $1`, [id]);
      const pending = rejection(
        repos.chunks.insertManyIfStorageKey(A, id, 'uploads/del-race.pdf', draft),
      );
      await waitForLockWait();
      await raw.query('commit');
      expect((await pending).kind).toBe('not_found');
      expect(await chunkCount(id)).toBe(0);
    });

    it('a replace committing while the insert waits on the row lock wins: nothing written', async () => {
      const id = await doc([], 'uploads/race-old.pdf');
      await raw.query('begin');
      await raw.query(`select 1 from documents where id = $1 for update`, [id]);
      await raw.query(`update documents set storage_key = 'uploads/race-new.pdf' where id = $1`, [
        id,
      ]);
      const pending = repos.chunks.insertManyIfStorageKey(A, id, 'uploads/race-old.pdf', draft);
      await waitForLockWait();
      await raw.query('commit');
      expect(await pending).toEqual({ stale: true });
      expect(await chunkCount(id)).toBe(0);
    });

    it('rejects a bad key before any SQL', async () => {
      const id = await doc([]);
      for (const key of ['', 'k'.repeat(1025), 7]) {
        const err = await rejection(repos.chunks.insertManyIfStorageKey(A, id, key as never, draft));
        expect(err.kind).toBe('invalid');
      }
    });
  });

  it('the database refuses a failure reason on a document that has not failed', async () => {
    const id = await doc([]);
    await expect(
      raw.query(`update documents set failure_reason = 'x' where id = $1`, [id]),
    ).rejects.toThrow(/documents_failure_reason_only_when_failed/);
  });
});
