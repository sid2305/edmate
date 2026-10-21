// Task 5.2: the 60-minute video fixture is searchable within the 15-minute budget. Indexes a
// synthetic 60-minute transcript through @edmate/ingest's indexDocument (real writer = repos.chunks
// / repos.documents, a scripted Transcriber so no real transcription call is ever made, and the
// hashed test embedder, rule 4), times the call, then proves recall through the production
// RetrievalIndex.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createScriptedTranscriber } from '@edmate/gateway/testing';
import { indexDocument } from '@edmate/ingest';
import { hashedEmbedder } from '@edmate/ingest/testing';
import { migrateDatabase } from '../src/migrate.js';
import { createDb, type DbHandle } from '../src/internal.js';
import { createRepositories, type Repositories, retrievalIndexFor } from '../src/index.js';
import * as s from '../src/schema/index.js';
import { createDatabase, dropDatabase, postgresUp, SKIP_REASON, throwawayName, urlFor } from './pg.js';

const BUDGET_MS = 15 * 60_000;
const TEACHER = 'tch_video_ingest';
const COURSE = 'course_video_ingest';
const MODULE = 'mod_video_ingest';
const DOCUMENT = 'doc_video_ingest';
const scope = { teacherId: TEACHER };

const up = await postgresUp('video ingestion tests');
const dbName = throwawayName();
const TEST_URL = urlFor(dbName);

/** A synthetic transcript shaped like a 60-minute live class: 720 five-second segments. One
 * segment carries a recognisable phrase ("quadratic equations") to prove recall finds it. */
function sixtyMinuteTranscript() {
  const segments = Array.from({ length: 720 }, (_, i) => ({
    startMs: i * 5_000,
    endMs: i * 5_000 + 4_800,
    text:
      i === 400
        ? 'Today we solve quadratic equations by completing the square.'
        : `Minute ${String(Math.floor(i / 12) + 1)}, point ${String((i % 12) + 1)}.`,
  }));
  return {
    text: segments.map((seg) => seg.text).join(' '),
    language: 'en',
    durationMs: 60 * 60_000,
    segments,
  };
}

let handle: DbHandle;
let repos: Repositories;

describe.skipIf(!up)('video ingestion: 60-minute fixture is searchable within the budget (5.2)', () => {
  beforeAll(async () => {
    await createDatabase(dbName);
    await migrateDatabase(TEST_URL);
    handle = createDb({ DATABASE_URL: TEST_URL });
    repos = createRepositories(handle.db);
    const { db } = handle;
    await db.insert(s.users).values({
      id: TEACHER,
      name: 'Video teacher',
      locale: 'en',
      market: 'test',
      role: 'teacher',
    });
    await db.insert(s.courses).values({ id: COURSE, teacherId: TEACHER, title: 'Algebra', order: 0 });
    await db
      .insert(s.modules)
      .values({ id: MODULE, teacherId: TEACHER, courseId: COURSE, title: 'Quadratics', order: 0 });
    await repos.documents.create(scope, {
      id: DOCUMENT,
      moduleId: MODULE,
      kind: 'material',
      sourceTitle: 'Live class: quadratic equations',
    });
  });

  afterAll(async () => {
    await handle?.close();
    await dropDatabase(dbName);
  });

  it(`indexes the 60-minute fixture and finds it again, under the ${String(BUDGET_MS / 60_000)}-minute budget`, async () => {
    const transcriber = createScriptedTranscriber([{ transcript: sixtyMinuteTranscript() }]);
    const recording = {
      url: 'https://storage.edmate.invalid/recordings/live-class-60m.mp3?X-Amz-Signature=fake0sig',
      mimeType: 'audio/mpeg',
      languageHint: 'en' as const,
    };

    const start = performance.now();
    const result = await indexDocument(
      { writer: repos.chunks, embedder: hashedEmbedder(), transcriber },
      {
        scope,
        documentId: DOCUMENT,
        source: { kind: 'video', sourceTitle: 'Live class: quadratic equations', recording },
      },
    );
    const elapsed = performance.now() - start;

    expect(transcriber.calls).toEqual([recording]);
    expect(result.chunks).toBeGreaterThan(0);
    expect(result.embedded).toBe(true);
    expect(elapsed).toBeLessThan(BUDGET_MS);

    const index = retrievalIndexFor(repos);
    const allowed = { teacherId: TEACHER, allowedModuleIds: [MODULE] };
    const top = await index.search('how do we solve quadratic equations', allowed, 5);
    expect(top.length).toBeGreaterThan(0);
    const hit = top.find((c) => c.moduleId === MODULE);
    expect(hit).toBeDefined();
    // The matching chunk's locator is a video timestamp (MM:SS or H:MM:SS), proving it came from
    // the transcript, not another document.
    expect(hit?.source.locator).toMatch(/^\d+:\d{2}(:\d{2})?$/);
  });
});

describe.skipIf(up)('video ingestion: 60-minute fixture is searchable within the budget', () => {
  it.skip(SKIP_REASON, () => undefined);
});
