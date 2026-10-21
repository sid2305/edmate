# Task 5.10: Ask-the-teacher path (open and group, teacher answer to thread and notification, CorrectionStore)

Board: milestone M5 · deps `5.3`, `5.4`, `M3` (all done) · branch `m5/5.10-ask-the-teacher` · **risky** (`packages/db/src/repositories/**`). Four phases on one branch with one PR. Each phase gets a fresh builder.

MVP first (human, 20 Oct 2026): CLI, harness and db only. There is no web UI: 8.9 owns the teacher inbox and 9.x owns the student thread and notification screens. **Do not touch `apps/web`** (another builder is working there). English-only pilot.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Ask-the-teacher path: open and group `TeacherQuestion`s; teacher answer → student thread + notification; `CorrectionStore` turns answers and corrections into teacher notes and eval cases"
Accept: "in an integration test, an uncovered question is answered by the teacher and the next similar question is answered from the new note, citing it."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| The acceptance, on Postgres | `packages/db/test/ask-teacher-loop.int.test.ts` (Phase D). The real harness steps run over the real db adapters (`retrievalIndexFor`, `teacherQuestionStoreFor`, `entitlementStoreFor`, `turnConfigStoreFor`) with the scripted gateway. (1) Student 1's uncovered question gives `ask_teacher` and a `teacher_question` event. (2) Student 2's similarly worded question opens a second question in the **same group**. (3) The teacher answers once through the CLI (`runTeacherQuestionsCli(['answer', …])`) with a module. (4) Both students get one `teacher` message in their open session and one notification. A `teacher_note` document and chunk exist in that module, plus one `teacher_eval_cases` row, and the material revision went up. (5) A third turn with a similar question is **not** `ask_teacher` and opens no new question. The note is retrieved first, and the `sources` event cites `{ kind: 'teacher_note', title: "Teacher's answer" }`. |
| The same loop with no Postgres | `packages/harness/src/pipeline/askTeacher.integration.test.ts` (Phase A) runs it on memory ports: `memoryTeacherQuestionStore`, `memoryCorrectionStore` writing into `memoryRetrieval`. |
| Grouping | `packages/db/test/question-similarity.test.ts` (pure, with pairs that should and should not group) and `teacher-question-store.int.test.ts`: similar open questions share `group_id`; different ones don't. Another teacher's or another agent's questions never group together. Two concurrent similar opens land in one group. `listGroupsForTeacher` never returns a student id. |
| CorrectionStore | `packages/db/test/correction-store.int.test.ts`: `correctionStoreFor(repos, scope).addTeacherNote` writes one `teacher_note` document and chunk in the teacher's module, one eval-case row and a revision bump, all in one transaction. Another teacher's module or a mismatched `teacherId` writes nothing (`not_found` / `scope`). Only scoped retrieval finds the note: a package without that module does not. |
| Isolation | Every new repository method has its case in `CASES` (`test/repositories.int.test.ts`) and is covered by `test/scope.test.ts`'s bad-scope sweep. `test/access-audit.test.ts` stays green (the chunks table is named only in `chunks.ts`). |
| No contracts change | `git diff origin/main -- packages/contracts docs/adr` is empty (see "Contracts" below). |
| No model calls | Scripted gateway and fake judge only. No embedder: notes are found by full text. |

## Spec it must honour

- Build plan § Ask the teacher 1–6, § Staying true to the teacher ("Corrections" bullet), § Turn pipeline step 11, § Access filter 2 and 4. PRD lines 98 and 179. The product decision `grounding` (tasks.yaml): "the question goes to the teacher, whose answer returns to the student and becomes a teacher note + eval case".
- Earlier decisions: 3.7 Q3 (the runner opens the question before `done`), 3.17 (the 0011 open-dedup index, insert-or-return-existing; `findSimilar` returns `[]`), 5.3 (a matching teacher note ranks first; every chunk or document write bumps the material revision), 5.4 (`access-audit` rules; the cache rule).
- `packages/db/src/repositories/README.md` rules 1–10: scope first and validated before SQL; ownership in the same statement; messages scoped through `sessions`; no existence oracle; no `sql.raw(`; no student id in any teacher-scoped read; errors scrubbed.
- Rule 3: the harness imports only contracts, zod, mathjs and its own modules.

## Contracts: no change, no ADR

`CorrectionStore.addTeacherNote`, `TeacherQuestionStore` and `TeacherQuestion` are used as they are. New shapes are local to db: `TeacherQuestionGroup`, `AnswerResult`, `NotificationRow`, `TeacherNoteInput`. `TeacherQuestion` has no `answer` field, so the student reads the answer through the db-local notification read (Q2). If a reviewer asks for `answer` on the contract, that is a later task with its own ADR.

## Design

1. **Teacher note text and source (harness, pure).** New `packages/harness/src/pipeline/teacherNote.ts`:
   - `teacherNoteText({ question, answer })` returns `Question: <q>\nAnswer: <a>`. The question is included so full text matches the next similar question (Q3).
   - `teacherNoteSource(origin, answeredOn)` returns `{ title: "Teacher's answer" | "Teacher's correction", locator: 'YYYY-MM-DD', kind: 'teacher_note' }`. No student text goes in a citation.
   - The db adapter and the memory double both use these, so they cannot drift.
2. **Grouping happens inside `teacherQuestions.open`, in db (Q1).**
   - New pure `packages/db/src/repositories/question-similarity.ts`. `questionSimilarity(a, b)` is the Jaccard index over `queryTerms` (reused from `retrieval.ts`: stop words, stemming). Two questions group when the Jaccard index is ≥ `QUESTION_GROUP_MIN` (0.5, provisional) **and** they share ≥ 2 terms. `bestGroup(text, candidates)` returns the highest match, with ties going to the oldest.
   - Inside `open`'s transaction:
     - The agent row lock goes from `key share` to `no key update`, so concurrent opens for one agent are serialised.
     - Read that teacher's and that agent's **open** questions (newest 200: id, text, group_id).
     - `group_id` becomes the best match's group, or the question's own id.
     - `similar_ids` becomes the caller's ids plus the other open members (at most 50).
   - The 0011 conflict path (returning the existing row) is unchanged.
   - `teacherQuestionStoreFor.findSimilar` keeps returning `[]`, so other students' questions never enter a student's turn. The returned question's `similarIds` carries the group as ids only.
   - The migration backfills `group_id = id` where it is null.
3. **The CorrectionStore write (db).** `chunks.ts` gains the transaction helper `insertTeacherNote(tx, teacherId, { moduleId, question, answer, origin, teacherQuestionId? })`. It lives in `chunks.ts` because `access-audit` rule 1 lets only `chunks.ts` and `retrieval.ts` name the chunks table. In one transaction the helper:
   - creates a `documents` row (`kind 'teacher_note'`, `status 'ready'`, `storage_key` null, source title from `teacherNoteSource`) with `INSERT … SELECT FROM modules WHERE id = $m AND teacher_id = $t`; 0 rows means `not_found`;
   - writes one chunk (`chunkId(doc, 0)`, text from `teacherNoteText`, locator from the date);
   - writes one `teacher_eval_cases` row;
   - bumps the material revision.

   It returns `{ chunkId, evalCaseId }`. The repository method `chunks.addTeacherNote(scope, input)` wraps the helper. `correctionStoreFor(repos, scope)` in `ports.ts` is the `CorrectionStore` adapter: a payload `teacherId` other than the bound one is `scope`. The answer is capped at `TEACHER_ANSWER_MAX_LENGTH` = `LIMITS.turnTextMaxLength` and the question at the same; both must be non-empty after trimming.
4. **Answering is one transaction (db).** `teacherQuestions.answer(teacherScope, { questionId, moduleId, answer, noteQuestion? })`:
   1. Lock the target `FOR UPDATE` (`teacher_id` = scope and `status = 'open'`, else `not_found`), then lock every open member of its `group_id`.
   2. Call `insertTeacherNote` with `question = noteQuestion ?? target.text` and `origin 'teacher_answer'`.
   3. Set the members to `status 'answered'`, with `answer` and `answered_at`.
   4. For each **distinct student** among the members, write one `teacher` message (text = the answer) into that student's open session with this teacher and agent. Use `INSERT … SELECT FROM sessions WHERE teacher_id = $t AND student_id = <locked row's> AND agent_id = … AND ended_at IS NULL`, which writes 0 or 1 row.
   5. Write one `notifications` row per distinct student (unique on student and question).

   It returns counts only: `{ answered, students, threadMessages, noteChunkId, evalCaseId }`. No student id leaves. A question that is already answered or dismissed is `not_found`.

   The answer path calls the same helper as the `CorrectionStore` adapter rather than the port itself, so the note, the status and the delivery commit together (decision 2).
5. **Reads.**
   - `teacherQuestions.listGroupsForTeacher(teacherScope, { limit ≤ 100 })` returns `TeacherQuestionGroup[]`: `{ groupId, count, oldestAt, questions: { id, text, createdAt }[] (≤ 20) }`. Biggest group first, then oldest. It never selects `student_id`.
   - `notifications.listForStudent(studentScope, { unreadOnly, limit ≤ 200 })` returns `{ id, kind, questionId, questionText, answer, createdAt, readAt }`, joined to the scope's own questions.
   - `notifications.markRead(studentScope, id)` marks one notification read. Another student's notification is `not_found`.
6. **Teacher CLI (Q5).** `runTeacherQuestionsCli(argv, env, log, open?)` goes in `packages/db/src/cli.ts`, with the entry `src/bin/teacher-questions.ts` and the script `db:questions`. This follows the `verify-teacher` pattern, including an injectable opener for unit tests.
   - `list --teacher <id>` prints each group's id, count, question ids and texts.
   - `answer --teacher <id> --question <id> --module <id> --answer-file <path> [--note-question <text>]` prints the counts.
   - Errors are fixed messages (`not found or already answered`) and never driver text. `DATABASE_URL` is required.

## Phase A: harness (`packages/harness`), about 6 files, about 50 tool calls

- **Create:** `src/pipeline/teacherNote.ts` and `teacherNote.test.ts`; `src/pipeline/askTeacher.integration.test.ts`.
- **Modify:**
  - `src/testing/memoryRetrieval.ts`: add `add(chunk)` and keep the scope checks.
  - `src/testing/memoryPorts.ts`: add `memoryCorrectionStore({ retrieval, clock? })`. Its `addTeacherNote` pushes a `teacher_note` chunk built with `teacherNote.ts` and records each case in `notes` and `cases`.
  - `src/testing/index.ts`, `src/pipeline/index.ts` (exports).
- **Tests first:**
  - teacherNote: exact text and source; no student text in `source`.
  - memoryCorrectionStore: the note is searchable only under its module's allowed scope.
  - Loop: turn 1 (uncovered) gives `ask_teacher` and a `teacher_question` event. After `addTeacherNote`, turn 2 (similar wording) is covered, opens no question and its `sources` event has `kind: 'teacher_note'`. The scripted reply cites `[1]`.
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...`
- **State after:** the note format exists and the loop is proven in memory. Green commit.

## Phase B: schema, migration, CorrectionStore adapter (`packages/db`), about 8 files, about 90 tool calls

- **Create:**
  - `migrations/0018_ask_the_teacher.sql` via `db:generate`, with drizzle meta. It is additive:
    - table `teacher_eval_cases` (`id`, `teacher_id`, `module_id` FK modules, `origin`, `question`, `answer`, `chunk_id` text with **no FK**, because cases are permanent and notes can be deleted, `teacher_question_id` text, timestamps; index on `teacher_id`);
    - table `notifications` (`id`, `student_id`, `teacher_id`, `kind` (`teacher_answer`), `teacher_question_id` FK, `read_at`, timestamps; unique (`student_id`, `teacher_question_id`); index on (`student_id`, `teacher_id`, `created_at`));
    - backfill `UPDATE teacher_questions SET group_id = id WHERE group_id IS NULL`.
  - `test/correction-store.int.test.ts`.
- **Modify:**
  - `src/schema/_shared.ts` (enums `note_origin`, `notification_kind`), `src/schema/content.ts` (`teacherEvalCases`), `src/schema/learning.ts` (`notifications`).
  - `src/repositories/chunks.ts` (`insertTeacherNote` and `chunks.addTeacherNote`), `src/repositories/ports.ts` (`correctionStoreFor`), `src/repositories/index.ts` (exports), `src/repositories/README.md` (§ Ask the teacher).
  - Tests: `test/repositories.int.test.ts` (CASES), `test/schema.test.ts` and `test/migrate.int.test.ts` as their conventions need.
- **Tests first:**
  - correction-store: happy path; another teacher's module → `not_found` with nothing written (no document, chunk, case or revision bump); mismatched `teacherId` → `scope`; empty or too-long text → `invalid`.
  - `retrievalIndexFor.search` finds the note first for a matching query under an allowed scope, and not when the module is outside the allowed scope.
  - `access-audit` still passes.
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --force --concurrency=1` with Postgres up, and `python3 .githooks/secret-scan.py --all`.
- **State after:** `CorrectionStore` has a production adapter. Questions are not grouped yet. Green commit.

## Phase C: grouping, answer, notifications (`packages/db`), about 7 files, about 100 tool calls

- **Create:** `src/repositories/question-similarity.ts` and `test/question-similarity.test.ts`; `src/repositories/notifications.ts`; `test/teacher-question-answer.int.test.ts`.
- **Modify:**
  - `src/repositories/teacher-questions.ts` (grouping in `open`, `listGroupsForTeacher`, `answer`), `src/repositories/map.ts` (row types), `src/repositories/index.ts` (the `notifications` repo, exports), `src/repositories/ports.ts` (doc comment on `findSimilar`), `README.md`.
  - Tests: `test/teacher-question-store.int.test.ts` (grouping), `test/repositories.int.test.ts` (CASES for `listGroupsForTeacher`, `answer`, `notifications.listForStudent`, `notifications.markRead`).
- **Tests first:**
  - similarity pairs: about 12 synthetic pairs, with no real student text.
  - Grouping isolation: across teachers and across agents.
  - Concurrency: two similar opens via `Promise.all` give one group.
  - 0011 dedup still converges.
  - Answer:
    - Every member is answered.
    - One message and one notification per distinct student.
    - No message when the student has no open session, but the notification is still written.
    - A replay is `not_found` and writes nothing.
    - Another teacher's question or module is `not_found`.
    - A dismissed question is `not_found`.
    - The result has no student id: assert the keys.
  - `listGroupsForTeacher` keys never include `studentId`.
  - Notifications: scoped to their own student; `markRead` on another student's notification is `not_found`.
- **Gate:** as in Phase B.
- **State after:** the whole server path works. There is no CLI yet. Green commit.

## Phase D: teacher CLI and acceptance (`packages/db`), about 5 files, about 70 tool calls

- **Create:** `src/bin/teacher-questions.ts`, `test/teacher-questions-cli.test.ts` (injected opener: usage, missing flags, unreadable answer file, `not_found` message, output has counts only), `test/ask-teacher-loop.int.test.ts` (the acceptance; see the table).
- **Modify:** `src/cli.ts` (`runTeacherQuestionsCli`), `package.json` (script `db:questions`), `README.md` (CLI usage).
- **Acceptance test notes:**
  - Seed with `access-seed.ts` and `retrieval-seed.ts`. Write the answer file into a temporary directory.
  - Prefer `runTurn` with `testDeps` overrides. If wiring the full runner over Postgres goes past about 30 tool calls, chain `defaultSteps` (entitle → buildContext → decide → generate) as the other db int tests do, and say so in the handoff.
  - If the note scores under `DEFAULT_COVERAGE_THRESHOLD` for honestly similar wording, **stop and report**. Do not change the threshold or the ranking constants.
- **Gate:** as in Phase B, plus `python3 .claude/skills/merge-gate/merge_gate.py 5.10` before handoff.
- **State after:** acceptance met.

## Files out of bounds

- `apps/web/**` (another builder, and 8.9 / 9.x own the screens), `apps/worker/**`, `apps/cli/**`.
- `packages/contracts/**`, `docs/adr/**`.
- `packages/harness/src/{guardrails,pedagogy,access}/**`. That includes `DEFAULT_COVERAGE_THRESHOLD` and the history rendering of teacher messages, both used as they are.
- `packages/db/src/repositories/retrieval.ts` ranking constants and `leakCache.ts`. Migration 0011's index.
- `content/**`, `evals/**`, `packages/evals/**` (7.3 turns `teacher_eval_cases` rows into suite cases).
- Dismissing a question (8.9), embedding notes (follow-up), email or push notifications, retention of the new tables (13.4).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/**`: `chunks.ts`, `teacher-questions.ts`, `notifications.ts`, `question-similarity.ts`, `ports.ts`, `map.ts`, `index.ts`, `README.md`. Group "access filter / money / isolation", which requires **security-reviewer**. code-reviewer runs on every PR.
- Checked and not risky: `packages/harness/src/{pipeline,testing}/**`, `packages/db/src/{schema,bin}/**`, `packages/db/src/cli.ts`, `packages/db/package.json`, `packages/db/test/**`, `packages/db/migrations/0018_*.sql` (additive; it drops and deletes nothing, so database-reviewer is not required; the `group_id` backfill is an UPDATE), `docs/tasks/5.10/**`. No contracts, ADR, guardrails, pedagogy, access, content, evals-suite, `.claude`, `.github` or `.githooks` path is touched.
- `review.md` names: `Reviewers: code-reviewer, security-reviewer`.
- Planned handoff decision (`risk: high`): "5.10 Ask the teacher: questions grouped inside `open` (lexical, same teacher and agent, `findSimilar` stays `[]`); the teacher's answer writes the note, eval case, status, thread messages and notifications in one teacher-scoped transaction that writes into the asking students' open sessions; new tables `teacher_eval_cases` and `notifications`."

## Risks

- **A teacher-scoped write into students' sessions.** Student ids come only from the locked question rows of this teacher and group, never from the caller. Sessions are matched on teacher, student and agent and must be open. The result is counts only. Tests cover cross-teacher refusal.
- **Prompt injection through a note.** The student's question becomes retrieved material for other students once answered. Mitigations:
  - preGuard's jailbreak check already blocked hostile turns before `ask_teacher`;
  - the stored text is the scrubbed text;
  - the teacher sees it in `list` and can rephrase it with `--note-question`;
  - retrieved material is delimited data in the prompt.
- **Coverage.** A note may score under 0.5 for a loosely similar question, which then opens a new group. That is acceptable (the teacher sees it again). The test uses honestly similar wording.
- **Locked-leak interplay.** A note filed in a module outside an asker's package is material outside that student's allowed set, so the lockedLeak check may hold a reply that quotes it. This fails safe (Q6).
- **`no key update` on `agents`.** It serialises opens per agent. Questions are rare, so the extra contention is negligible.

## Decisions (draft, for the handoff)

1. Grouping happens inside `open`. It is lexical (Jaccard ≥ 0.5 and ≥ 2 shared terms over `queryTerms`), within the same teacher and agent, over open questions only. `findSimilar` stays `[]`. Planner, risk: high (Q1).
2. The answer is one transaction that reuses the CorrectionStore helper rather than calling the port. Planner, risk: high.
3. Eval cases are db rows (`teacher_eval_cases`), not YAML: teacher content never enters the public repo. 7.3 converts them. Planner, medium (Q4).
4. Notifications are in-app rows only. Planner, low (Q2).
5. The teacher CLI is a db operator bin (`db:questions`). Planner, medium (Q5).
6. The note citation is "Teacher's answer" or "Teacher's correction" with the date as locator. Planner, low (Q3).
7. Notes are found by full text only until a follow-up embeds them. Planner, medium (Q7).

Follow-ups for the board: embed teacher notes; 13.4 retention covers `notifications` and `teacher_eval_cases` (they hold scrubbed student question text); 8.9 builds on `listGroupsForTeacher` and `answer` and adds dismiss.

## Open questions (each with a recommendation)

- **Q1. How are questions grouped, and where?** *Recommend:* lexically, inside `teacherQuestions.open`'s transaction (same teacher and agent, open questions only), with `findSimilar` kept at `[]`. The alternative, a real `findSimilar`, would hand other students' question text and ids to a student's turn process. Embeddings-based grouping can come later without a port change.
- **Q2. Where does the answer go when the student has no open session?** *Recommend:* always write a notification. The student's notification read carries the question and the answer. Write a `teacher` message only into an open session; never create or reopen one. Notifications are in-app rows; email and push wait (production SMTP is still B-25).
- **Q3 (privacy; human, if the lead prefers).** The note chunk stores `Question: … Answer: …`, so a student's scrubbed question can reach other students' model context once answered. *Recommend:* yes, because the question is needed for the next similar question to match. The teacher reviews it and can rephrase with `--note-question`. Citations show only "Teacher's answer" and a date. The alternative, storing the answer only, makes the acceptance unreliable.
- **Q4. Do per-agent eval cases from teacher answers need sign-off?** *Recommend:* no. The teacher wrote the expected answer, and these are per-agent accuracy rows, not platform suites (the lead's sign-off rule covers `evals/suites/**`).
- **Q5. Where does the teacher CLI live?** *Recommend:* `packages/db` `db:questions` (operator tool, like `db:verify-teacher`; the teacher id is a flag) until 8.9's authenticated inbox. The alternative is `apps/cli`, which would add pg to the student-facing CLI.
- **Q6. What if the chosen module is outside a grouped student's package?** *Recommend:* deliver the answer to every asker anyway. It is the teacher's direct reply. The note itself follows the module's packages. 8.9 can warn in the UI.
- **Q7. Should notes be embedded?** *Recommend:* not in 5.10. Full text finds a matching note and ranks it first (5.3). Add a board task to embed notes through the ingest worker.
