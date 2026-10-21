# Task 5.10 handoff: Ask-the-teacher path

Status: PARTIAL (Phases A and B of A–D done)
Branch: `m5/5.10-ask-the-teacher`
Worktree (Phase B): `.claude/worktrees/agent-a4e69cb301edd9e42` (under the repo root)

## Phase A

Harness side: the teacher-note format and the loop proven on memory ports. No contracts, ADR,
`apps/web`, guardrails, pedagogy or access change. The harness imports only contracts and its own
modules.

### Acceptance evidence

| Item | Evidence |
|---|---|
| The same loop with no Postgres | `packages/harness/src/pipeline/askTeacher.integration.test.ts`: real admit, entitle, buildContext, decide and generate over `memoryRetrieval(retrievalWorld())`, `memoryTeacherQuestionStore` and `memoryCorrectionStore`, scripted gateway. Turn 1 ("Why does the sky look blue at noon?") is `ask_teacher` with one `teacher_question` event. After `addTeacherNote` into `mod_test_02`, turn 2 ("Why does the sky look so blue?") is not `ask_teacher` or `locked`, opens no question, the note is the top search hit (score ≥ 0.5), and the `sources` event's first item is `{ title: "Teacher's answer", locator: '2026-10-21', kind: 'teacher_note' }`. The scripted reply cites `[1]`. |
| Note outside the package | Same file: a note filed in the teacher's locked module (`mod_test_04`) never teaches: the turn is `locked` and no event carries the note's title or text. |
| Another teacher's module | Same file and `memoryPorts.test.ts`: `not_found`, nothing written, the question still goes to the teacher. |
| Note text and citation | `teacherNote.test.ts`: exact `Question: <q>\nAnswer: <a>` text (trimmed), empty or over-cap parts rejected with fixed text, citation title fixed, date locator only, no student text. |
| Scoped retrieval of a note | `memoryRetrieval.test.ts` (`add`) and `memoryPorts.test.ts` (`memoryCorrectionStore`): found only under a scope allowing its teacher and module. |
| No model calls | Scripted gateway only. |

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...
  @edmate/contracts:test  Tests 348 passed (348)
  @edmate/config:test     Tests 42 passed (42)
  @edmate/harness:test    Test Files 111 passed (111)   Tests 5019 passed (5019)
  teacherNote.ts 100% statements / lines / functions
  Tasks: 10 successful, 10 total
python3 .githooks/secret-scan.py --all  → clean
```

### Changes

- New `packages/harness/src/pipeline/teacherNote.ts` (+ `teacherNote.test.ts`).
- New `packages/harness/src/pipeline/askTeacher.integration.test.ts`.
- `src/testing/memoryRetrieval.ts`: `add(chunk)` (validated with `ChunkSchema`, stored as a copy, duplicate id rejected). Search, probe and leakCheck scope checks unchanged.
- `src/testing/memoryPorts.ts`: `memoryCorrectionStore({ retrieval, clock?, moduleOwners?, fail? })` with `notes` and `cases`; type `MemoryEvalCase`.
- Exports: `src/pipeline/index.ts` (teacherNote), `src/testing/index.ts` (`memoryCorrectionStore`, `MemoryCorrectionStore`, `MemoryEvalCase`).

### API Phase B needs (from `@edmate/harness`)

- `teacherNoteText({ question, answer }): string` → `Question: <q>\nAnswer: <a>`, both trimmed. Throws a fixed-text `HarnessError` when either part is empty after trimming or over the cap. Use it for the chunk text.
- `teacherNoteParts({ question, answer }): { question, answer } | null` → the trimmed parts, or `null` when unusable. Use it for validation (`invalid`) and for the eval-case row's question and answer, before any SQL.
- `teacherNoteSource(origin, answeredOn: string | number)` → `{ title: "Teacher's answer" | "Teacher's correction", locator: 'YYYY-MM-DD' (UTC), kind: 'teacher_note' }`. `answeredOn` is an ISO date or timestamp string or epoch ms; anything else throws `HarnessError`.
- `TEACHER_NOTE_PART_MAX` (= `LIMITS.turnTextMaxLength`, counted with `countChars`). The plan's `TEACHER_ANSWER_MAX_LENGTH` can be this constant.
- `TEACHER_NOTE_TITLES`, types `TeacherNoteOrigin`, `TeacherNoteParts`.

### Deviations

- `memoryCorrectionStore` takes an optional `moduleOwners` map (module id → teacher id) so the memory double can refuse another teacher's module with `not_found`, like the db adapter. Without it, any module is accepted.
- Added `teacherNoteParts` and `TEACHER_NOTE_PART_MAX` to the plan's two functions, so the db adapter validates and caps from the same helper rather than its own copy.
- The loop test uses the test-double postGuard (as `turn.integration.test.ts` does), so grounding's judge is not exercised here; Phase D's Postgres run can add it.

## Phase B

db side: migration `0018_ask_the_teacher.sql`, the new schema, and a `CorrectionStore` db adapter
that writes a teacher note (document + chunk + eval case) and bumps the material revision, all in
one transaction, scrubbed the same way every other repository is. No contracts, ADR, harness or
`apps/web` change. `packages/db` still imports `@edmate/harness` only for the shared teacher-note
helpers (already a dependency, already used by `retrieval.ts`).

### Acceptance evidence

| Item | Evidence |
|---|---|
| Schema | `teacher_eval_cases` (teacher_id, module_id, origin, question, answer, chunk_id, teacher_question_id) and `notifications` (student_id, teacher_id, kind, teacher_question_id, read_at) tables; `note_origin` and `notification_kind` enums. `test/schema.test.ts` (teacher-owned-table index rule, create-only rule with `0018` listed in `REVIEWED_UPDATES`), `test/helpers.ts` (`DATA_MODEL_TABLES`). |
| Migration backfill | `test/ask-teacher-migration.int.test.ts` (folder-before-0018 pattern): a pre-existing `teacher_questions` row with `group_id = null` backfills to its own id; a later row's explicit `group_id` is untouched; the new tables exist after migrating to head. |
| CorrectionStore writes one note, in one transaction | `test/correction-store.int.test.ts`: `correctionStoreFor(repos, scope).addTeacherNote(...)` writes one `documents` + one `chunks` (`kind: 'teacher_note'`, exact `Question: ...\nAnswer: ...` text, `source_title: "Teacher's answer"`) + one `teacher_eval_cases` row, and bumps `teacher_material_revisions` by 1, all asserted by exact counts before/after. |
| Scope and validation, before any write | Same file: another teacher's module → `not_found`; a payload `teacherId` other than the bound scope → `scope`; empty (after trim) or over-`LIMITS.turnTextMaxLength` text → `invalid`; all three leave row counts and the revision unchanged. |
| The note is retrievable, and only under an allowed scope | Same file: `retrievalIndexFor(repos).search(...)` finds the note first by full text under a scope that allows its module, and not at all under a scope that doesn't. |
| Isolation | `test/repositories.int.test.ts` CASES gained `'chunks.addTeacherNote'` (own module → ok, another teacher's module → `not_found`). |
| No model calls | Pure SQL / Postgres via Testcontainers-style throwaway db; no gateway involved. |

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --force --concurrency=1
  @edmate/db:test   Test Files 47 passed (47)   Tests 799 passed | 4 skipped (803)
  Coverage: All files 99.88% stmts / 98.59% branch / 99.79% funcs / 99.93% lines
  Tasks: 26 successful, 26 total
python3 .githooks/secret-scan.py --all  → clean
```

### Changes

- `src/schema/_shared.ts`: `noteOrigin` and `notificationKind` enums.
- `src/schema/content.ts`: `teacherEvalCases` table.
- `src/schema/learning.ts`: `notifications` table.
- `migrations/0018_ask_the_teacher.sql` (+ updated `meta/_journal.json`, generated `meta/0018_snapshot.json`): the two enums, two tables, and a hand-added `UPDATE teacher_questions SET group_id = id WHERE group_id IS NULL` backfill (Phase C's grouping needs every row to already have a `group_id`).
- `src/repositories/chunks.ts`: `TeacherNoteInputSchema` / `TeacherNoteWriteInput`, `insertTeacherNote(tx, teacherId, input, method)` (document + chunk + eval-case row + revision bump, one transaction, using the existing `insertSelect` ownership pattern and the existing `insertChunkRows` helper), and `chunksRepo().addTeacherNote`.
- `src/repositories/ports.ts`: `correctionStoreFor(repos, scope)`.
- `src/repositories/index.ts`: exports `correctionStoreFor`, `insertTeacherNote`, `TeacherNoteWriteInput`.
- `src/repositories/README.md`: new `## Ask the teacher (task 5.10)` section.
- `test/helpers.ts`, `test/schema.test.ts`: new tables registered; `0018` added to `REVIEWED_UPDATES`.
- `test/repositories.int.test.ts`: `'chunks.addTeacherNote'` isolation case.
- New `test/ask-teacher-migration.int.test.ts`, `test/correction-store.int.test.ts`.

### Deviations

- Added an index on `notifications.teacher_id` alone, beyond the plan's `(student_id, teacher_id, created_at)` composite index, so the table satisfies the existing repo-wide invariant that every teacher-owned table has an index led by `teacher_id` (`test/schema.test.ts`).
- Tested the `group_id` backfill in its own file (`ask-teacher-migration.int.test.ts`), following the same "folder-before-N" convention `document-status-migration.int.test.ts` and `age-consent-migration.int.test.ts` already use, rather than extending the large shared `test/migrate.int.test.ts`.

## Left to do

- **Phase C** (db): `question-similarity.ts` (+ pure test), grouping inside `teacherQuestions.open`, `listGroupsForTeacher`, `answer` (one transaction), `notifications.ts` (`listForStudent`, `markRead`), `teacher-question-answer.int.test.ts`, CASES.
- **Phase D** (db): `runTeacherQuestionsCli` + `src/bin/teacher-questions.ts` + `db:questions`, CLI unit test, `test/ask-teacher-loop.int.test.ts` (the Postgres acceptance), merge gate, `review.md` (code-reviewer, security-reviewer), and the planned `risk: high` decision.

## Decisions

### 21 Oct 2026 · Teacher-note validation lives in the shared harness helper · decided by tdd-guide
Decided: `teacherNote.ts` also exports `teacherNoteParts` and `TEACHER_NOTE_PART_MAX` (the turn text limit, counted in characters), and `teacherNoteText` / `teacherNoteSource` throw a fixed-text `HarnessError` on bad input. The db adapter and the memory double validate through it.
Why: one place decides what a usable note is, as well as its text and citation, so the two stores cannot drift (lead answer Q3), and no error carries the teacher's or student's words.
risk: low

### 21 Oct 2026 · The note's date locator is the UTC day · decided by tdd-guide
Decided: `teacherNoteSource` takes an ISO string or epoch ms and uses the UTC calendar day (`YYYY-MM-DD`) as the locator; rolled-over or malformed dates are rejected.
Why: a deterministic, locale-free date; no market's time zone is assumed in the harness.
risk: low

### 21 Oct 2026 · The memory CorrectionStore can check module ownership · decided by tdd-guide
Decided: `memoryCorrectionStore` takes an optional `moduleOwners` map and rejects an unknown or another teacher's module with `not_found`, writing nothing.
Why: lets the memory loop show the same refusal the db adapter gives, without the double needing a module store.
risk: low

### 21 Oct 2026 · `group_id` backfills to each row's own id, before Phase C groups anything · decided by tdd-guide
Decided: migration `0018` backfills every pre-existing `teacher_questions.group_id` (nullable since 0001, never set) to its own `id`, so a question is always its own group's oldest member until a later, similar question joins it in Phase C.
Why: Phase C's grouping logic can assume `group_id` is never null without a special case for old rows.
risk: low

### 21 Oct 2026 · `notifications` also gets a lone `teacher_id` index · decided by tdd-guide
Decided: added `notifications_teacher_id_idx` beyond the plan's named composite index.
Why: the repo-wide invariant that every teacher-owned table has an index led by `teacher_id` (enforced by `test/schema.test.ts`) applies here too.
risk: low
