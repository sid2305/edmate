// Task 5.3 Phase D: recall@5 on the demo Q&A set, the acceptance gate of the retrieval index.
// The demo course's notes are chunked by @edmate/ingest exactly as indexing does, stored through
// the repositories and searched through the production RetrievalIndex. Scope = every demo module
// (teacher preview), so this measures ranking, not access. Gold is heading-level (Q1): a hit is
// a top-5 chunk under one of the item's headings; module-level recall is reported too.
//
// Three runs: full text only (no query embedder), hybrid with the hashed test embedder (proves the
// plumbing, not semantic recall), and hybrid with the recorded vectors of the real model (Q2,
// skipped until test/fixtures/demo-embeddings.json is recorded). No model is ever called.
//
// The out-of-course items calibrate the coverage threshold: the best score of an in-course
// question should clear it, the best score of an out-of-course question should not.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RetrievalIndex } from '@edmate/contracts';
import { DEFAULT_COVERAGE_THRESHOLD } from '@edmate/harness';
import { indexDocument } from '@edmate/ingest';
import { hashedEmbedding } from '@edmate/ingest/testing';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import { createRepositories, type Repositories, retrievalIndexFor } from '../src/index.js';
import { PROBE_FLOOR } from '../src/repositories/retrieval.js';
import * as s from '../src/schema/index.js';
import { createDatabase, dropDatabase, postgresUp, SKIP_REASON, throwawayName, urlFor } from './pg.js';
import { demoCorpus, readRecordedEmbeddings } from './recall-corpus.js';

const up = await postgresUp('recall tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);
const TEACHER = 'tch_demo_recall';
const scope = { teacherId: TEACHER };
const K = 5;
const RECALL_FLOOR = 0.8;

const corpus = demoCorpus();
const moduleIds = corpus.modules.map((m) => m.moduleId);
const inCourse = corpus.items.filter((i) => 'expectedModuleId' in i);
const outOfCourse = corpus.items.filter((i) => 'outOfCourse' in i);
const recorded = readRecordedEmbeddings();

let handle: DbHandle;
let repos: Repositories;
/** Chunk id → text, to embed the stored chunks for the hybrid runs. */
const chunkText = new Map<string, string>();

interface Measured {
  /** Heading-level hits / in-course items. */
  recall: number;
  /** Module-level hits / in-course items. */
  moduleRecall: number;
  /** Best score per in-course and out-of-course item. */
  inScores: number[];
  outScores: number[];
  misses: string[];
}

const lastHeading = (locator: string) => locator.slice(locator.lastIndexOf(' > ') + 3).trim();

async function measure(label: string, index: RetrievalIndex): Promise<Measured> {
  const allowed = { teacherId: TEACHER, allowedModuleIds: moduleIds };
  const rows: string[] = [];
  let hits = 0;
  let moduleHits = 0;
  const inScores: number[] = [];
  const misses: string[] = [];
  for (const item of inCourse) {
    const top = await index.search(item.question, allowed, K);
    const hit = top.some(
      (c) =>
        c.moduleId === item.expectedModuleId &&
        item.expectedHeadings.includes(lastHeading(c.source.locator)),
    );
    const moduleHit = top.some((c) => c.moduleId === item.expectedModuleId);
    hits += Number(hit);
    moduleHits += Number(moduleHit);
    if (!hit) misses.push(item.id);
    const best = Math.max(0, ...top.map((c) => c.score ?? 0));
    inScores.push(best);
    rows.push(
      `${item.id.padEnd(9)} ${hit ? 'hit ' : 'MISS'} module=${moduleHit ? 'hit ' : 'MISS'} best=${best.toFixed(3)}`,
    );
  }
  const outScores: number[] = [];
  for (const item of outOfCourse) {
    const top = await index.search(item.question, allowed, K);
    const best = Math.max(0, ...top.map((c) => c.score ?? 0));
    outScores.push(best);
    rows.push(`${item.id.padEnd(9)} out-of-course best=${best.toFixed(3)}`);
  }
  const recall = hits / inCourse.length;
  const moduleRecall = moduleHits / inCourse.length;
  process.stdout.write(
    `\n[recall@${K} ${label}] heading ${hits}/${inCourse.length} = ${recall.toFixed(3)}, ` +
      `module ${moduleHits}/${inCourse.length} = ${moduleRecall.toFixed(3)}\n` +
      `${rows.join('\n')}\n`,
  );
  return { recall, moduleRecall, inScores, outScores, misses };
}

/** Share of `scores` at or above `threshold`. */
const covered = (scores: number[], threshold: number) =>
  scores.filter((x) => x >= threshold).length / scores.length;

describe.skipIf(!up)('recall@5 on the demo Q&A set (5.3 Phase D)', () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    repos = createRepositories(handle.db);
    const { db } = handle;
    await db.insert(s.users).values({
      id: TEACHER,
      name: 'Demo teacher',
      locale: 'en',
      market: 'test',
      role: 'teacher',
    });
    const course = corpus.content.course;
    await db
      .insert(s.courses)
      .values({ id: course.id, teacherId: TEACHER, title: course.title, order: 0 });
    await db.insert(s.modules).values(
      corpus.modules.map((m, order) => ({
        id: m.moduleId,
        teacherId: TEACHER,
        courseId: course.id,
        title: m.title,
        order,
      })),
    );
    for (const m of corpus.modules) {
      const documentId = `doc_${m.moduleId}`;
      await repos.documents.create(scope, {
        id: documentId,
        moduleId: m.moduleId,
        kind: 'material',
        sourceTitle: m.parsed.sourceTitle,
      });
      // No embedder: full text only, every embedding NULL until a hybrid run sets them.
      const res = await indexDocument(
        { writer: repos.chunks },
        { scope, documentId, source: { kind: 'parsed', document: m.parsed, headings: true } },
      );
      expect(res).toMatchObject({ chunks: m.drafts.length, embedded: false });
      m.drafts.forEach((d) => {
        chunkText.set(`${documentId}-c${String(d.ord).padStart(4, '0')}`, d.text);
      });
    }
  });

  afterAll(async () => {
    await handle?.close();
    await dropDatabase(dbName);
  });

  async function embedChunks(vectorOf: (text: string) => number[]): Promise<void> {
    const items = [...chunkText].map(([id, text]) => ({ id, embedding: vectorOf(text) }));
    const { updated } = await repos.chunks.setEmbeddings(scope, items);
    expect(updated).toBe(items.length);
  }

  it('the recall set is the size Q1 asked for: about 30 in-course and 8 out-of-course items', () => {
    expect(inCourse.length).toBeGreaterThanOrEqual(30);
    expect(outOfCourse.length).toBeGreaterThanOrEqual(8);
  });

  it(`full text only: recall@${K} >= ${RECALL_FLOOR}, and the coverage threshold separates in-course from out-of-course`, async () => {
    const m = await measure('full text', retrievalIndexFor(repos));
    expect(m.recall).toBeGreaterThanOrEqual(RECALL_FLOOR);
    // Calibration (see retrieval.ts): most in-course questions clear the coverage threshold and
    // the probe floor; most out-of-course questions do not.
    expect(covered(m.inScores, DEFAULT_COVERAGE_THRESHOLD)).toBeGreaterThanOrEqual(RECALL_FLOOR);
    expect(covered(m.outScores, DEFAULT_COVERAGE_THRESHOLD)).toBeLessThanOrEqual(0.25);
    expect(PROBE_FLOOR).toBe(DEFAULT_COVERAGE_THRESHOLD);
  });

  it(`hybrid with the hashed test embedder: recall@${K} >= ${RECALL_FLOOR} (plumbing, not semantics)`, async () => {
    await embedChunks(hashedEmbedding);
    const index = retrievalIndexFor(repos, {
      embedder: { embed: (texts) => Promise.resolve(texts.map(hashedEmbedding)) },
    });
    const m = await measure('hybrid, hashed embedder', index);
    expect(m.recall).toBeGreaterThanOrEqual(RECALL_FLOOR);
  });

  it.skipIf(recorded === undefined)(
    `hybrid with the recorded model vectors: recall@${K} >= ${RECALL_FLOOR} ` +
      '(SKIPPED until test/fixtures/demo-embeddings.json is recorded: B-24, Q2)',
    async () => {
      const vectors = recorded as Map<string, number[]>;
      const vectorOf = (text: string): number[] => {
        const v = vectors.get(text);
        if (v === undefined) throw new Error('demo-embeddings.json is stale: re-record it');
        return v;
      };
      await embedChunks(vectorOf);
      const index = retrievalIndexFor(repos, {
        embedder: { embed: (texts) => Promise.resolve(texts.map(vectorOf)) },
      });
      const m = await measure('hybrid, recorded vectors', index);
      expect(m.recall).toBeGreaterThanOrEqual(RECALL_FLOOR);
      // The vector calibration (VECTOR_ZERO) is provisional until this run: it must keep the
      // same separation as full text.
      expect(covered(m.inScores, DEFAULT_COVERAGE_THRESHOLD)).toBeGreaterThanOrEqual(RECALL_FLOOR);
      expect(covered(m.outScores, DEFAULT_COVERAGE_THRESHOLD)).toBeLessThanOrEqual(0.25);
    },
  );
});

describe.skipIf(up)('recall@5 on the demo Q&A set', () => {
  it.skip(SKIP_REASON, () => undefined);
});
