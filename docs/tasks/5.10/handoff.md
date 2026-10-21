# Task 5.10 handoff: Ask-the-teacher path

Status: DONE (Phases A, B, C and D)
Branch: `m5/5.10-ask-the-teacher`
Worktree (Phase B): `.claude/worktrees/agent-a4e69cb301edd9e42` (under the repo root)
Worktree (Phase C): `.claude/worktrees/agent-acdc1d576e76ff106` (under the repo root)
Worktree (Phase D): `.claude/worktrees/agent-a2df51270fe6a409c` (under the repo root)

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

## Phase C

db side: lexical grouping of a teacher's open questions inside `teacherQuestions.open`'s own
transaction, `listGroupsForTeacher`, a transactional `teacherQuestions.answer`, and a new
`notifications` repository (`listForStudent`, `markRead`). No contracts, ADR, harness or `apps/web`
change; never a real embeddings search (`teacherQuestionStoreFor.findSimilar` still returns `[]`).

### Acceptance evidence

| Item | Evidence |
|---|---|
| Grouping is pure and lexical | `test/question-similarity.test.ts` (20 tests): `questionSimilarity` (Jaccard over shared terms), `bestGroup` (best score, ties to oldest then lowest id, `null` group handled) over ~12 synthetic should/should-not-group pairs. |
| New questions join only that teacher's and agent's own open questions | `test/teacher-question-answer.int.test.ts`: two similarly-worded questions from the same teacher+agent converge on one `group_id`; a differently-worded one doesn't join; another teacher, or another of this teacher's agents, never groups even with identical wording; two concurrent opens for one agent converge on one group (the agent lock is now `no key update`); a 0011 dedup replay still converges on the identical row. |
| `answer` answers the whole group, one note, in one transaction | Same file: answering one member answers every open member of its group; one teacher note (`insertTeacherNote`) is written; one message and one notification per distinct student (not per question); a replay of an already-answered question, another teacher's or a dismissed question, and another teacher's module are all `not_found` and write nothing (`teacher_eval_cases` count unchanged); returns counts only. |
| `listGroupsForTeacher` never selects `student_id`, biggest group first then oldest | Same file: ordering checked directly; `JSON.stringify(groups)` never matches `/stu_/`. |
| `notifications` is the student's own read | Same file: `markRead` across students is `not_found`, a missing id is `not_found`, a successful `markRead` removes the row from an unread-only list. |
| Isolation | `test/repositories.int.test.ts` CASES gained `teacherQuestions.listGroupsForTeacher`, `teacherQuestions.answer`, `notifications.listForStudent`, `notifications.markRead`, each with fixed, pre-made fixtures (created once in `beforeAll`, following the file's existing `delDoc`/`repDoc` convention) so a cross-scope `attempt`/`mismatches` closure only calls the method under test and writes nothing when it fails closed. |
| No model calls | Pure SQL / Postgres via a throwaway db; no gateway involved. |

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --concurrency=1
  @edmate/db:test   Test Files 49 passed (49)   Tests 838 passed | 4 skipped (842)
  Coverage: All files 99.89% stmts / 97.64% branch / 99.8% funcs / 99.93% lines
  Tasks: 26 successful, 26 total
python3 .githooks/secret-scan.py --all  → clean
```

### Changes

- New `src/repositories/question-similarity.ts` (`questionSimilarity`, `bestGroup`, `QUESTION_GROUP_MIN`) + `test/question-similarity.test.ts`.
- New `src/repositories/notifications.ts` (`notificationsRepo`: `listForStudent`, `markRead`) + exports (`NOTIFICATIONS_MAX_LIMIT`, `NotificationRow`) and wiring in `src/repositories/index.ts`.
- `src/repositories/teacher-questions.ts`: `open`'s agent lock is now `no key update` (was `key share`); it reads up to `GROUPING_CANDIDATE_MAX` of the teacher+agent's own newest open questions as grouping candidates, calls `bestGroup`, and writes `group_id` and the merged `similar_ids` (at most `SIMILAR_IDS_MAX`) in the same insert. New `listGroupsForTeacher(scope, { limit })` (in-memory grouping over at most `GROUPING_SCAN_MAX` open rows) and `answer(scope, { questionId, moduleId, answer, noteQuestion? })` (locks target then group members, calls `insertTeacherNote`, marks every member answered, writes one message — `order by created_at desc, id desc limit 1`, so a stray second open session never fails a message insert's primary key — and one notification per distinct student).
- `src/repositories/ports.ts`: doc comment on `findSimilar` notes Phase C's lexical grouping is a separate mechanism that never goes through this port.
- `src/repositories/README.md`: Phase C paragraphs under `## Ask the teacher (task 5.10)`.
- `src/repositories/index.ts`: exports `GROUPS_MAX_LIMIT`, `GROUP_QUESTIONS_MAX`, `AnswerResult`, `TeacherQuestionGroup`, `NOTIFICATIONS_MAX_LIMIT`, `NotificationRow`.
- New `test/teacher-question-answer.int.test.ts` (grouping, `answer`, `listGroupsForTeacher`, `notifications`).
- `test/repositories.int.test.ts`: 4 new CASES entries, fixed fixtures created in `beforeAll` (`answerTarget`/`answerEmpty`/`answerDismissed`/`answerWrongModule`/`answerReplay` per teacher, `notifTarget` per pair), and two pre-existing tests (`listForTeacher never returns studentId`, `round-trips optional fields: ...`) loosened from exact-count assertions to shape/membership assertions now that `answer` exists and other parts of the same suite legitimately answer questions.

### Deviations

See `## Decisions` below.

## Phase D

db side: a `db:questions` CLI over Phase C's `teacherQuestions.listGroupsForTeacher`/`answer`, and
the task's own Postgres acceptance test running the real harness steps (admit, entitle,
buildContext, decide, generate) over the real db ports with the scripted gateway. No contracts,
ADR, harness, pedagogy, access or `apps/web` change.

### Acceptance evidence

| Item | Evidence |
|---|---|
| CLI: list / answer, usage, redaction | `test/teacher-questions-cli.test.ts` (15 tests): list formats each group and its questions, or a plain "no open questions"; answer reads the answer file and prints counts only (never a student id), passes `--note-question` through; an unreadable `--answer-file` is a fixed message and never opens the db; `RepositoryError('not_found')` is "not found or already answered"; every bad usage (no args, unknown subcommand, missing flags, unknown flag, a stray positional) prints `usage: ` and exits 1 without opening the db; a missing `DATABASE_URL` is a fixed message; a generic failure is `redact()`ed (no connection password in the output) and still closes the handle; a failing `close()` is ignored. |
| The acceptance, on Postgres | `test/ask-teacher-loop.int.test.ts`: student 1's uncovered question gives `ask_teacher` and one `teacher_question` event; student 2's similarly worded question opens a second question in the **same group**; the teacher answers both at once through `runTeacherQuestionsCli(['answer', …])` with a module; both students get one `teacher` message in their own open session and one notification; a `teacher_note` document and chunk exist in that module, one `teacher_eval_cases` row exists, and the material revision went up; a third, similarly worded turn from student 1 is not `ask_teacher`, opens no new question, and the `sources` event cites the note (`{ title: "Teacher's answer", kind: 'teacher_note' }`, equal to `teacherNoteSource('teacher_answer', ...)`). |
| No model calls | Scripted gateway only (a fixed reply stream per turn); no real model or payment call anywhere in Phase D. |

```
corepack pnpm --filter @edmate/db exec vitest run
  Test Files 51 passed (51)   Tests 854 passed | 4 skipped (858)
corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
  Tasks: 26 successful, 26 total
  Coverage: All files 99.89% stmts / 97.62% branch / 99.8% funcs / 99.94% lines
python3 .githooks/secret-scan.py --all  → clean
```

### Changes

- New `src/bin/teacher-questions.ts`: entry point for `db:questions` (built by `tsc`, run as `node dist/bin/teacher-questions.js`).
- `src/cli.ts`: `runTeacherQuestionsCli(argv, env, log, open?)` (+ `OpenTeacherQuestions` type, `parseTqArgs`, fixed usage text) — list and answer subcommands over `createRepositories(db).teacherQuestions`; a `RepositoryError('not_found')` is a fixed message, anything else is `redact()`ed; the db handle always closes.
- `package.json`: `"db:questions": "node dist/bin/teacher-questions.js"`.
- `src/repositories/README.md`: a `db:questions` paragraph under `## Ask the teacher (task 5.10)`.
- New `test/teacher-questions-cli.test.ts` (the CLI, with a fake repository — never opens a real db) and `test/ask-teacher-loop.int.test.ts` (the Postgres acceptance, seeded with `isolation-seed.ts`'s `seed()`).

### Deviations

- Used `isolation-seed.ts`'s plain `seed()` for the acceptance test rather than `access-seed.ts`/`retrieval-seed.ts`: it already seeds one subscribed student x teacher pair per teacher (with an open session, a live agent, and a package version with one in-package module), which is everything the five-step acceptance needs; the extra fixtures `access-seed.ts` adds (a second agent/package version, draft/suspended agents, an eval student) are not exercised by this test.
- The acceptance test drives `runTurn` with a small hand-written real clock (`realClock()`, implementing the testing package's `VirtualClock` shape with real `setTimeout`/`Date.now`, `advance()` a no-op and `drive()` just awaiting the promise) instead of `virtualClock()` + `driveTurn()`. The steps under test make real Postgres round trips, which only ever settle through the event loop's real I/O phase; `virtualClock()`'s `drive()` fires a step's timeout as soon as its own microtask queue goes quiet, which always happens before a real query can return, so every real-db step timed out at once under the virtual clock regardless of actual elapsed time. A real clock's `sleep` races real elapsed time instead, the same as production. This stayed within full-runner wiring (not a manual `defaultSteps` chain), so the plan's ~30-tool-call fallback note does not apply.
- The acceptance test also overrides `deps.promptPacks` with a small library built from the testing package's fixture pack text re-pinned to version `'1.0.0'` (`createPromptPackLibrary([parsePromptPackSet({ ...fixturePromptPackRaw, version: '1.0.0' })])`), instead of the default `fixturePromptPackLibrary` (pinned to `'0.1.0-fixture'`): the seeded agent's `promptPackVersion` comes from `@edmate/contracts/fixtures`' `demoAgentConfig` (`'1.0.0'`), which the default testing library doesn't have.
- The third turn's scripted reply includes an explicit `[1]` citation marker (`generate`'s real citation extraction only emits a `sources` event when the model's own text contains a bracket citation that resolves to a provided source), matching the acceptance's own requirement that the `sources` event cite the note.
- The note's retrieval score was not independently checked against `DEFAULT_COVERAGE_THRESHOLD`: the acceptance only asserts it is the top hit and is cited, which it is; no change was needed to any ranking constant.

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

### 21 Oct 2026 · One member per distinct student stands for the group, earliest first · decided by tdd-guide
Decided: when `answer` delivers a message and a notification, it picks one member per distinct student among the group being answered — the earliest (then lowest id) of that student's own member rows — rather than every member.
Why: the plan calls for "one message, one notification per distinct student", not per question; a student who asked two near-duplicate questions in the same group should get one reply, not two.
risk: low

### 21 Oct 2026 · The group's message insert picks the newest open session, not "the" one · decided by tdd-guide
Decided: `answer`'s message insert adds `order by created_at desc, id desc limit 1` to the open-session lookup (`teacher_id`/`student_id`/`agent_id` match, `ended_at is null`), instead of assuming at most one row matches.
Why: nothing in the schema stops two sessions for the same triple being open at once (found by the isolation suite's own fixtures); without the cap, the insert-select would try to write one generated message id twice and fail the primary key. Picking the newest is a deterministic, harmless choice among an already-unexpected state, not a new invariant.
risk: low

### 21 Oct 2026 · Isolation fixtures for `answer` and `notifications` are pre-made, not inline · decided by tdd-guide
Decided: `teacherQuestions.answer`'s and `notifications.markRead`'s cross-scope CASES entries use fixed questions/notifications created once in `beforeAll`, instead of opening a question (or inserting a notification) inside the `attempt`/`mismatches` closure itself.
Why: `expectFailsClosed`'s whole-database snapshot check covers the entire closure passed to it, including any setup inside it; a closure that both arranges state and performs the (correctly failing) call under test would otherwise be flagged as "writing something" even though the operation under test wrote nothing. This matches the file's existing `delDoc`/`repDoc`/`isoDoc` convention for other write cases.
risk: low

### 21 Oct 2026 · Two pre-existing exact-count assertions loosened to shape/membership · decided by tdd-guide
Decided: `listForTeacher never returns studentId` and `round-trips optional fields: ...` no longer assert an empty or single-element `answered` list for a teacher; they assert the known row is present (or absent) and that no row leaks `studentId`.
Why: before Phase C, `answer` didn't exist, so no `teacher_questions` row was ever `answered` and the exact-count assertions were trivially true; once `answer` is real, other parts of the same shared isolation suite legitimately answer questions for the same teachers, so an exact count is no longer a meaningful invariant — whether the leak and filter rules hold is.
risk: low

### 21 Oct 2026 · Postgres-backed acceptance tests need a real clock, not `virtualClock()` · decided by tdd-guide
Decided: `test/ask-teacher-loop.int.test.ts` drives `runTurn` with a small real clock (real `setTimeout`/`Date.now`) implementing the testing package's `VirtualClock` shape, instead of `virtualClock()` + `driveTurn()`.
Why: `virtualClock()`'s `drive()` fires a step's timeout as soon as its own microtask queue goes quiet; a step making a real Postgres round trip never settles within that quiet window (real I/O only resolves through the event loop's poll phase, which pure microtask flushing never reaches), so every real-db step timed out at once regardless of actual elapsed time. A real clock's `sleep` races real elapsed time, as production does; `virtualClock()` stays correct and necessary for the harness's own in-memory-port tests, which this decision does not change.
risk: low

### 21 Oct 2026 · 5.10 as a whole: a planned `risk: high` decision now that all four phases are done · decided by tdd-guide
Decided (plan's own wording, logged now that the grouping and the answer transaction it describes are both built and tested): "5.10 Ask the teacher: questions grouped inside `open` (lexical, same teacher and agent, `findSimilar` stays `[]`); the teacher's answer writes the note, eval case, status, thread messages and notifications in one teacher-scoped transaction that writes into the asking students' open sessions; new tables `teacher_eval_cases` and `notifications`."
Why: `packages/db/src/repositories/**` is a risk-paths group ("access filter / money / isolation") that needs the security-reviewer's sign-off at merge, per the plan's own Phase A/B/C "Risky paths touched" and "Decisions (draft)" sections; Phase D adds no new risky-path file, so this closes out the one whole-task decision the plan asked the lead to log at merge.
risk: high

## Fix round 1

Test-only changes in `packages/db/test/ask-teacher-loop.int.test.ts`; production code and budgets unchanged.

- **[HIGH] real-clock CI flake (3.9b/3.9d class):** `realClock()` is now `slackClock(10)`, copied from `apps/worker/test/clock.ts` (3.9d) and fitted to `VirtualClock`: `sleep(ms)` waits `ms * 10` real ms and `now()` advances at 1/10 speed, so the 50/50/300/500 ms budgets get headroom over real Postgres while a real hang still times out. `runFor` now returns a `why` (error events + trace step outcomes) that every turn assertion prints on failure.
- **[MEDIUM] "next similar question" not really tested:** the shared `ASKTEACH-LOOP` prefix is gone (the database is a throwaway per run, so no marker is needed). Q2 is `What makes the sky blue on a clear day around noon?` (Jaccard 5/8 with Q1, 5 shared terms) and turn 3 is `Why is a clear sky blue at noon?`, both with term sets different from Q1's; the test asserts that up front through `queryTerms`/`questionSimilarity`/`bestGroup`. Turn 3 is still asserted to end `done`, not `ask_teacher`, open no question, and cite the teacher's note first.

Evidence:
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` (twice, second with `--force`) → `Tasks: 26 successful, 26 total`; `@edmate/db:test: Tests 854 passed | 4 skipped (858)`.
- `corepack pnpm vitest run test/ask-teacher-loop.int.test.ts` ×3 → `Tests 1 passed (1)` each time.
- `python3 .githooks/secret-scan.py --all` → exit 0.

Decisions: None (the slack clock follows 3.9d's merged pattern).
