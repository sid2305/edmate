// `edmate chat`'s db-backed retrieval (task 3.9f, deferred from 3.9a): switches `deps.retrieval`
// from the in-memory lexical index (`retrieval.ts`, still the no-database fallback) to the
// production `RetrievalIndex` over a real Postgres database, when `env.DATABASE_URL` is set.
//
// `packages/db` needs no change: every piece this file uses is already public API --
// `openDatabase`/`retrievalIndexFor` from `@edmate/db`'s index, `parseMarkdown`/`chunkDocument`/
// `indexDocument` from `@edmate/ingest`'s index. No vector embedder is wired here, so
// `retrievalIndexFor(repos)` searches full text only (recall.int.test.ts's "full text only" case
// already shows that is enough for recall); embeddings for the CLI's db path are a follow-up.
import type { DemoTeacherContent } from '@edmate/content';
import type { RetrievalIndex } from '@edmate/contracts';
import { openDatabase, retrievalIndexFor, type Repositories } from '@edmate/db';
import { chunkDocument, indexDocument, parseMarkdown } from '@edmate/ingest';
import type { Env } from './gateway.js';

/** True iff `env.DATABASE_URL` names a database: the only signal `edmate chat` uses to switch to
 * the production retrieval index (acceptance wording: "when a database is configured", not a new
 * flag -- `DATABASE_URL` already travels through the existing `env: Env` field). */
export function dbConfigured(env: Env): boolean {
  return typeof env.DATABASE_URL === 'string' && env.DATABASE_URL !== '';
}

/**
 * Writes real `documents`/`chunks` rows for every module of the demo teacher's course, exactly
 * the pattern `packages/db/test/recall.int.test.ts`'s `beforeAll` loop uses, generalised to any
 * teacher id. Exported so `chatDbRetrieval.int.test.ts` can reuse it without duplicating the
 * chunk-writing logic (the plan's one place this logic lives in `apps/cli`).
 */
export async function seedChatChunks(
  repos: Repositories,
  content: DemoTeacherContent,
  teacherId: string,
): Promise<void> {
  const scope = { teacherId };
  for (const m of content.course.modules) {
    const text = content.notes.get(m.id);
    if (text === undefined) continue;
    const parsed = parseMarkdown(text, m.title);
    const id = `doc_${m.id}`;
    await repos.documents.create(scope, {
      id,
      moduleId: m.id,
      kind: 'material',
      sourceTitle: parsed.sourceTitle,
      rightsDeclared: true,
    });
    await indexDocument(
      { writer: repos.chunks },
      { scope, documentId: id, source: { kind: 'parsed', document: parsed, headings: true } },
    );
  }
}

/**
 * Opens a real database and builds the production `RetrievalIndex` over it (full text only, no
 * embedder). Auto-seeds the demo teacher's chunks once, the first time `edmate chat` runs against
 * a freshly migrated/seeded database: `db:migrate`/`db:seed` seed the teacher/agent/packages rows
 * but not chunks (`packages/db/src/seed.ts`'s `SEED_TABLES` has no `documents`/`chunks` entry), so
 * without this a human who only ran those two commands would see an agent with nothing to
 * retrieve. The check-then-seed is idempotent: `seedChatChunks` is called at all only when
 * `repos.documents.listForTeacher({ teacherId })` is still empty, so a second `edmate chat` run
 * against the same database never re-inserts (and never hits `documents.create`'s duplicate-id
 * error). This checks `documents`, not `retrieval.material` -- `packages/db`'s static access
 * audit (`access-audit.test.ts`) requires `.material(` be called only from `retrieval.ts`, since
 * it returns a teacher's full text (locked included) with no access filter.
 */
export async function buildDbRetrieval(
  env: Env,
  teacherId: string,
  content: DemoTeacherContent,
): Promise<{ index: RetrievalIndex; close: () => Promise<void> }> {
  const { repos, close } = openDatabase(env);
  const existing = await repos.documents.listForTeacher({ teacherId });
  if (existing.length === 0) await seedChatChunks(repos, content, teacherId);
  return { index: retrievalIndexFor(repos), close };
}
