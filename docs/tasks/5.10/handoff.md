# Task 5.10 handoff: Ask-the-teacher path

Status: PARTIAL (Phase A of A–D done)
Branch: `m5/5.10-ask-the-teacher` (built on local `work-5.10a`)
Worktree: `.claude/worktrees/agent-a2780f9d3b337cf96` (under the repo root)

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

## Left to do

- **Phase B** (db): migration `0018_ask_the_teacher.sql` (`teacher_eval_cases`, `notifications`, `group_id` backfill), schema enums and tables, `chunks.insertTeacherNote` / `chunks.addTeacherNote`, `correctionStoreFor` in `ports.ts`, `test/correction-store.int.test.ts`, CASES and schema/migrate tests, README § Ask the teacher.
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
