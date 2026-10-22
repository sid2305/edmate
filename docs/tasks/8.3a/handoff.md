# 8.3a handoff: outline db (Phase A of 8.3)

- **Status:** DONE
- **Branch:** `m8/8.3a-outline-db` (local `work-83a`)
- **Worktree:** `.claude/worktrees/agent-a88e019b17bb568a3`
- **Tool calls used:** 66 (budget 150)
- **Scope:** `packages/db` only. Nothing in `packages/contracts`, `.claude/`, `.github/` or `apps/` changed.
- **Risky path:** `packages/db/src/repositories/**`. Security-reviewer is required; database-reviewer is recommended (new table, two cascading FKs, a third named delete exception).

## What changed

- `src/schema/content.ts` and `schema/index.ts` add a new `topic_chunks` table: `id`, `teacher_id` (FK to users), `topic_id` (FK to topics, ON DELETE CASCADE), `chunk_id` (FK to chunks, ON DELETE CASCADE), `order` and timestamps. It has indexes on `(teacher_id, topic_id)` and `(chunk_id)`, plus a unique index on `(topic_id, chunk_id)`.
- `migrations/0019_outline_topic_chunks.sql` (+ snapshot, journal) came from `db:generate`. It is additive only: CREATE TABLE, 3 ADD CONSTRAINT FK and 3 CREATE INDEX. I reviewed it by hand.
- New `src/repositories/outline.ts` holds two repositories:
  - `coursesRepo`:
    - `get(scope)` returns the teacher's first course, or null.
    - `ensureDefault(scope)` creates "My course", plus "Module 1" when the teacher has no modules. It is idempotent: it runs under a per-teacher `pg_advisory_xact_lock`, and a ghost scope gives `not_found`.
  - `outlineRepo`:
    - `getOutline(scope)` returns `{ courseId, outlineVersion, modules[{ id, title, order, topics[{ id, title, order, chunkIds[{ chunkId, sourceTitle, locator }] }] }] }`. It never returns chunk text, and gives null when the teacher has no course.
    - `replaceOutline(scope, { modules })` does the whole edit in one transaction (see Decisions for how it works). It returns `{ courseId, outlineVersion }`.
- `src/repositories/chunks.ts`:
  - `chunksRepo.listForModule(scope, moduleId)` returns `[{ id, text, locator, sourceTitle }]`, from `ready` documents only, ordered by document then chunk. It gives `[]` for another teacher's or a missing module, and `invalid` above `MODULE_CHUNKS_MAX` (2000).
  - Two new exported helpers, `insertTopicLinks` and `topicSources`, both teacher-checked on both the chunk and the topic.
- `src/repositories/map.ts` adds local zod row shapes and mappers: `CourseRow`, `Outline`, `OutlineModuleRow`, `OutlineTopicRow`, `OutlineSource`, `toCourseRow`, `toOutline`.
- `src/repositories/index.ts` wires `courses` and `outline` through `guardAll`. It exports the new types, the caps (`OUTLINE_*`, `TOPIC_CHUNKS_MAX`, `MODULE_CHUNKS_MAX`), `ModuleChunk` and the default titles.
- `src/repositories/README.md`:
  - Rule 7 and rule 8 now name `outline.ts`'s scoped deletes of `topics` and `topic_chunks`, and the two cascading FKs.
  - New "Outline (task 8.3)" section.
- Tests:
  - `test/helpers.ts` adds `topic_chunks` to `DATA_MODEL_TABLES`.
  - `test/schema.test.ts` adds a test for the table, its FKs and their cascade, its indexes and the 0019 migration.
  - `test/scope.test.ts` allows `outline.ts`'s deletes and pins them to `topics`/`topicChunks` with `teacherId` in the same statement.
  - `test/repositories.int.test.ts` adds isolation `CASES` for `courses.get`, `courses.ensureDefault`, `outline.getOutline`, `outline.replaceOutline` (teacher A writing to B's modules gives `not_found`, with nothing written; B's chunk id gives `invalid`; B's topic id gives `not_found`; a stray `teacherId` key gives `invalid`) and `chunks.listForModule`.
  - New `test/outline.int.test.ts` has 21 tests.

## Evidence

| Item | Evidence |
|---|---|
| Source links persist | `outline.int.test.ts` "reorders and renames…": `getOutline` returns `{ chunkId, sourceTitle: 'doc_o1.pdf', locator: 'p2' }`, and the JSON contains no chunk text |
| Reorder, rename | same test: modules come back as `[M2 'Geometry' 0, M1 'Algebra' 1]` and topics as `['Ratios', 'Fractions']` |
| Merge | "merges…": the kept topic has `[c1, c2, c3]`; the absorbed topic's `topics` and `topic_chunks` rows are 0 |
| Split | "splits…": the two topics' links are `[c1, c3]` and `[c2, c4]`, which partition the original `[c1..c4]` |
| Edits versioned | "bumps outline_version by exactly 1…": versions `v0+1`, `v0+2`, with 2 `outline.edit` audit rows holding before/after `{ outlineVersion, moduleCount, topicCount }` |
| Rejected edit writes nothing | "a rejected edit writes nothing…" covers 14 cases (unknown, foreign or duplicate chunk id; foreign or missing module; foreign topic; topic of an unnamed module; topic with student evidence; empty, duplicate or blank input; unknown key). After each one, a state snapshot of courses, modules, topics, topic_chunks and the audit count is unchanged |
| Document delete cascade | "a document delete drops its chunks' links without bumping the version" |
| ensureDefault idempotent | two concurrent calls plus a third give 1 course and 1 module |
| Teacher scoping | the isolation grid covers every new method; "leaves another teacher's outline untouched" |
| No contracts change | `git diff origin/main -- packages/contracts` is empty |

Commands (a throwaway `pgvector/pgvector:0.8.1-pg16` container on 127.0.0.1:55483, removed afterwards):

```
TEST_DATABASE_URL=… corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
  → Tasks: 26 successful, 26 total
  → @edmate/db: Test Files 55 passed (55); outline.ts 100 % stmts / 94.44 % branches / 100 % funcs / 100 % lines;
    chunks.ts 100 / 100 / 100 / 100; map.ts 100 / 100 / 100 / 100
corepack pnpm --filter @edmate/db db:generate   → "No schema changes, nothing to migrate"
python3 .githooks/secret-scan.py --all          → clean (no findings)
```

## Deviations from the plan

1. **Topics are updated in place, not deleted and re-inserted.** `evidence_events.topic_id` is a FK to `topics` (no cascade), so the plan's "delete every topic of the module and insert fresh rows" would fail, or would have to delete student data, on every edit once students have studied a topic. Now a listed topic id keeps its row. On a merge, the surviving topic keeps its id and only the absorbed topic's id disappears (the plan said "a fresh row").
2. **The chunk-table SQL lives in `chunks.ts`** (`insertTopicLinks`, `topicSources`), not in `outline.ts`. `test/access-audit.test.ts` rule 1 allows only `chunks.ts` and `retrieval.ts` to name the `chunks` table.
3. **`listForModule` also returns chunk `text`.** `@edmate/ingest`'s `draftOutline` takes `{ id, locator, text }` per chunk, so Phase B needs it. The text is the teacher's own material, read server-side only.
4. **Both `topics` and `topic_chunks` deletes are in `outline.ts`.** The second one clears kept topics' links before they are rewritten. Both are scoped and pinned by `scope.test.ts`.

## Notes for Phase B (8.3b)

- `replaceOutline` input is `{ modules: [{ id, title, order, topics: [{ id?, title, order, chunkIds: string[] }] }] }`:
  - 1..100 modules, at most 200 topics per module, at most 500 links per topic.
  - Titles are trimmed, 1..200 characters. Order is an integer 0..10000.
  - The schema is strict, so unknown keys are `invalid`.
- Map `invalid` to 400 and `not_found` to 404.
- The generate path may send topics without `id`. If it omits the existing topics of a named module, they are deleted, unless a topic has student evidence: then the whole edit is `invalid`. Generate should either keep the existing topic ids it can, or surface that error to the teacher.
- `listForModule` returns `[]` for an empty module, so skip it before calling `draftOutline`.

## Decisions

### 22 Oct 2026 · 8.3a Outline edits keep topic ids and never delete topics with student evidence · decided by builder · risk: high
- Decided: `replaceOutline` updates a listed topic in place: title, order, module and its links. It inserts topics that have no id. It deletes the unlisted topics of the named modules, but if any of them has `evidence_events`, the whole edit is `invalid` and nothing is written.
- Why: `evidence_events.topic_id` references `topics` with no cascade. Deleting and re-inserting would break every edit after students have studied, or would delete student data. Keeping ids also keeps students' mastery keys valid. A lead question remains: should merging a studied topic be allowed by re-pointing evidence to the surviving topic? That is a follow-up if teachers need it.
- risk: high

### 22 Oct 2026 · 8.3a Outline repository and topic_chunks table on the teacher-scoped repositories path · decided by builder · risk: high
- Decided: add the new `topic_chunks` table (teacher-scoped, cascading FKs to `topics` and `chunks`) and the `courses`/`outline` repositories on the risky path. Every statement carries `teacher_id`. Locks are taken in a fixed order: courses, then modules, then topics, each by id. Chunk ids are ownership-checked inside the same `INSERT … SELECT`. `outline.ts` has two new named deletes (`topics`, `topic_chunks`).
- Why: plan 8.3 Phase A, scope decisions 1 and 2. The repositories path is a risky-path group (CLAUDE.md rule 6), so security-reviewer is required.
- risk: high

### 22 Oct 2026 · 8.3a Topic-level merge and split only; modules rename and reorder · decided by builder · risk: low
- Decided: carrying out plan scope decision 1 and lead answer Q2. `replaceOutline` changes a module's title and order only. Topics can be merged, split, moved between named modules, renamed and reordered.
- Why: documents and chunks reference `module_id` as NOT NULL; merging modules would mean reassigning them.
- risk: low

### 22 Oct 2026 · 8.3a Versioning is the outline_version counter plus one audit row · decided by builder · risk: low
- Decided: carrying out scope decision 3. Each successful edit sets `outline_version` to the locked value + 1 and writes one `outline.edit` audit row with counts only. A failed edit writes nothing.
- Why: the column already exists, and the accept line names no history or undo.
- risk: low

### 22 Oct 2026 · 8.3a ensureDefault bootstraps a course and first module · decided by builder · risk: medium
- Decided: carrying out scope decision 5 and lead answer Q1. `courses.ensureDefault` creates "My course" and, when the teacher has zero modules, "Module 1", under a per-teacher transaction advisory lock so that it is idempotent.
- Why: nothing else creates a teacher's first course or module, and both the outline editor and the 8.2 upload centre need one.
- risk: medium

### 22 Oct 2026 · 8.3a A document delete silently shrinks topic links · decided by builder · risk: low
- Decided: carrying out scope decision 2 and lead answer Q3. The `chunk_id` FK cascades, so 8.2's `documents.delete` drops links with no version bump and no code change in the delete path.
- Why: the lead accepted this for the MVP.
- risk: low

### 22 Oct 2026 · 8.3a Chunk-table SQL for the outline lives in chunks.ts · decided by builder · risk: low
- Decided: `insertTopicLinks` and `topicSources` are exported from `chunks.ts`, and `outline.ts` calls them.
- Why: the access audit allows only `chunks.ts` and `retrieval.ts` to name the `chunks` table, and widening that allowlist would weaken the 5.4 guard.
- risk: low

### 22 Oct 2026 · 8.3a listForModule returns text and refuses more than 2000 chunks · decided by builder · risk: low
- Decided: `chunks.listForModule` returns `id`, `text`, `locator` and `sourceTitle` for `ready` documents only. Above `MODULE_CHUNKS_MAX` (2000) it is `invalid`, never a cut list.
- Why: the drafter needs the text. A silently truncated module would give it partial material, which is the same reasoning as the `TEACHER_EVAL_CASES_MAX` precedent.
- risk: low

### 22 Oct 2026 · 8.3a One outline edit names modules of one course only · decided by builder · risk: low
- Decided: `replaceOutline` is `invalid` when the named modules span two courses, and `not_found` when a module sits under a course that is not the teacher's. `getOutline` reads the teacher's first course (by order). A chunk may back topics in any of the teacher's own modules.
- Why: the MVP has one course per teacher; the version bump and audit row need a single course.
- risk: low
