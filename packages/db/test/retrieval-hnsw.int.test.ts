// Task 5.3 Phase D (Phase A review MEDIUM): HNSW with a WHERE filter filters after the index scan
// (ef_search 40), so a teacher with many locked chunks near the query and a small allowed set
// could get fewer than 20 vector candidates. The vector query sets
// `hnsw.iterative_scan = strict_order` (pgvector 0.8) so the scan keeps going until the filter is
// satisfied. The pool here turns off sequential scans, bitmap scans and sorts to push the planner
// toward the HNSW index. Task 5.3a: the repository's inner query now orders by distance alone
// (the id tie-break is applied only outside, over the already-limited rows), so the planner can
// take the HNSW order for that inner scan; this is now a real guard that the iterative scan keeps
// 20 allowed candidates even when the 1,000 nearest chunks are locked, not a guard that could not
// be made red.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import { createRepositories, type Repositories } from '../src/index.js';
import * as s from '../src/schema/index.js';
import { EMBEDDING_DIMENSIONS } from '../src/schema/index.js';
import {
  createDatabase,
  dropDatabase,
  postgresUp,
  SKIP_REASON,
  throwawayName,
  urlFor,
} from './pg.js';

const up = await postgresUp('hnsw filtered-scan tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const T = 'tch_hnsw';
const scope = { teacherId: T };
const LOCKED = 'mod_hnsw_locked';
const ALLOWED = 'mod_hnsw_allowed';
const LOCKED_CHUNKS = 1_000;
const ALLOWED_CHUNKS = 30;

let handle: DbHandle;
let repos: Repositories;

/** A unit vector mostly on `axis`, with a small deterministic tilt so no two are equal. */
function near(axis: number, i: number): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[axis] = 1;
  v[10 + (i % 1_000)] = 0.05 + (i % 7) * 0.01;
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

async function fill(moduleId: string, axis: number, count: number): Promise<void> {
  const docId = `doc_${moduleId}`;
  await repos.documents.create(scope, {
    id: docId,
    moduleId,
    kind: 'material',
    sourceTitle: docId,
    rightsDeclared: true,
  });
  for (let start = 0; start < count; start += 500) {
    const n = Math.min(500, count - start);
    const drafts = Array.from({ length: n }, (_, j) => ({
      ord: start + j,
      text: `chunk ${moduleId} ${start + j}`,
      locator: `p${start + j}`,
    }));
    const { ids } = await repos.chunks.insertMany(scope, docId, drafts);
    await repos.chunks.setEmbeddings(
      scope,
      ids.map((id, j) => ({ id, embedding: near(axis, start + j) })),
    );
  }
}

describe.skipIf(!up)('vector search with a small allowed set (HNSW iterative scan)', () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb(
      { DATABASE_URL: TEST_URL },
      { options: '-c enable_seqscan=off -c enable_sort=off -c enable_bitmapscan=off' },
    );
    repos = createRepositories(handle.db);
    await handle.db
      .insert(s.users)
      .values({ id: T, name: 'H teacher', locale: 'en', market: 'test', role: 'teacher' });
    await handle.db
      .insert(s.courses)
      .values({ id: 'crs_hnsw', teacherId: T, title: 'H', order: 0 });
    await handle.db.insert(s.modules).values([
      { id: LOCKED, teacherId: T, courseId: 'crs_hnsw', title: 'Locked', order: 1 },
      { id: ALLOWED, teacherId: T, courseId: 'crs_hnsw', title: 'Allowed', order: 2 },
    ]);
    await fill(LOCKED, 0, LOCKED_CHUNKS);
    await fill(ALLOWED, 1, ALLOWED_CHUNKS);
  });

  afterAll(async () => {
    await handle?.close();
    await dropDatabase(dbName);
  });

  it('still returns 20 allowed vector candidates when the 1,000 nearest chunks are locked', async () => {
    const got = await repos.retrieval.search(scope, {
      q: 'zzzz',
      allowedModuleIds: [ALLOWED],
      k: 20,
      embedding: near(0, 0),
    });
    expect(got).toHaveLength(20);
    expect(got.every((c) => c.moduleId === ALLOWED)).toBe(true);
  });
});

describe.skipIf(up)('vector search with a small allowed set', () => {
  it.skip(SKIP_REASON, () => undefined);
});
