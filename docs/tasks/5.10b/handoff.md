# Task 5.10b handoff: teacher-questions locking and index follow-ups

## Summary

Fixed all four review follow-ups from `docs/tasks/5.10/review.md`, entirely in `packages/db`:

1. `teacherQuestions.answer` now takes the agent lock (`for('no key update')`, the same order
   `open` uses) before locking the group's open member rows, and locks that whole group in one
   statement, ordered ascending by id (`WHERE id = ANY(memberIds) ORDER BY id FOR UPDATE`), instead
   of the old single-row-then-unordered-group lock that could deadlock two concurrent `answer()`
   calls on different members of one group (40P01).
2. The stored answer is now the exact same trimmed string (`i.answer.trim()`) in both
   `teacher_questions.answer` and the thread message's `messages.text` — previously the thread
   message kept the raw, untrimmed `i.answer`.
3. Migration `0025_teacher_questions_grouping_index.sql` (additive, `CREATE INDEX`, no
   `CONCURRENTLY` — matches this package's other migrations) adds
   `teacher_questions_teacher_id_agent_id_status_created_at_idx` on
   `(teacher_id, agent_id, status, created_at)`, which both `open`'s grouping read and
   `listGroupsForTeacher` filter and sort by. The other half of this item — a unique partial index
   on open sessions per `(teacher, student, agent)` — was **not added**: see Decisions below.
4. `bestGroup` (`question-similarity.ts`) now tokenises the incoming question once per call
   (`queryTerms(text)` into a `Set`) instead of once per candidate inside the old
   `questionSimilarity`/`sharedTermCount` pair; behaviour (score, tie-breaks, `MIN_SHARED_TERMS`,
   `QUESTION_GROUP_MIN`) is unchanged and the existing `question-similarity.test.ts` suite stays
   green.

## Files

- `packages/db/src/repositories/teacher-questions.ts` — `answer()` rewritten (lock order, trimmed
  answer, two new defensive `not_found` guards with `/* v8 ignore next */` justifications for
  races too narrow to force deterministically in a test).
- `packages/db/src/repositories/question-similarity.ts` — `bestGroup` tokenises once.
- `packages/db/src/schema/learning.ts` — new grouping index on `teacherQuestions`.
- `packages/db/migrations/0025_teacher_questions_grouping_index.sql`,
  `packages/db/migrations/meta/_journal.json`, `packages/db/migrations/meta/0025_snapshot.json` —
  the additive migration.
- `packages/db/src/repositories/README.md` — documents the new lock order, the new index, and why
  the unique session index was not added (append-only edit inside the existing § Ask the teacher
  section, shared file).
- `packages/db/test/teacher-question-answer.int.test.ts` — three new tests (deadlock, race,
  trim/no-newline) plus one covering two of one student's own questions in a group, appended to
  the existing `describe('answer')` block (shared file, append-only).

## Tests

- Item 1 (deadlock): `"two concurrent answers to different members of one group finish without a
  40P01 deadlock, and both groups end up fully answered"` — opens two similar questions for
  different students (one group), runs `Promise.allSettled` on both `answer()` calls, asserts no
  rejection's message or `.cause` matches `/40P01|deadlock/i`, any rejection is `RepositoryError`
  kind `not_found`, and both questions end up `answered`. I could not make this fail reliably
  against the pre-fix code either (deadlocks are timing-dependent on this machine's scheduler) — I
  verified the fix by code reading (agent lock fully serializes concurrent `answer()`s for one
  agent, and the ordered group lock is defence in depth beyond that) rather than a repeatable
  red-before-fix run.
- Also for item 1 (the race the lead's decision calls out specifically): `"a question opened
  during an answer doesn't stay open after its group is answered"` — runs `answer()` on one member
  concurrently with `open()` of a new similar question from a second student; asserts the first
  question is `answered` and the newly opened one is either `answered` (if it landed in the same
  group before the lock) or `open` (if it formed/joined after) — never left open while its group
  is fully answered.
- Item 2 (trim): `"the stored answer is the same trimmed text in the thread message and
  teacher_questions.answer, with no trailing newline"` — answers with a trailing-newline string,
  checks both the `teacher_questions.answer` column and the latest `messages.text` row equal the
  trimmed text and neither ends in `\n`.
- Item 3 (migration, additive): `python3 .claude/skills/board/board.py` acceptance is covered by
  running the full db integration suite (including `migrate.int.test.ts`) against a fresh database
  — the new migration applies cleanly from scratch and on an existing database.
- Item 4 (`bestGroup`): existing `test/question-similarity.test.ts` (44 tests) stays green
  unchanged.
- New: `"two of the same student's own questions in one group count as one student, one message,
  one notification"` — closes a pre-existing branch-coverage gap in the (unchanged) `byStudent`
  dedup loop that no prior test exercised.
- Full package gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` — green.
  `corepack pnpm run test` (db package, full coverage) — 74 test files passed, 1443 passed / 4
  skipped, `src/repositories/**` aggregate: 100% statements/functions/lines, 98.24% branches
  (threshold 90%). `python3 .githooks/secret-scan.py --all` — clean.

## Left to do

- The unique partial index on open sessions per `(teacher, student, agent)` (item 3, second half)
  is not added — see Decisions. A follow-up task in `apps/web` (making `startSession` reuse or
  close an existing open session before opening a new one) would need to land first.
- Two `/* v8 ignore next */` guards in `teacherQuestions.answer` (the `owner` not-found check and
  the final `members.some` not-found check) defend against races that are real but too narrow
  (sub-millisecond, cross-transaction) to force deterministically in this test suite; a future
  task with manual two-connection lock-stepping could replace them with real tests if that's ever
  worth the cost.

Status: DONE

Tool calls used: ~55 (this continuation) + prior session (see earlier handoff notes); counted from
this agent's own log, approximate given the conversation was resumed from a summary.

## Decisions

### 22 Oct 2026 · 5.10b teacherQuestions.answer lock order and trimmed answer · decided by builder · risk: high
- Decided: `answer()` takes the agent lock (`for('no key update')`, same order as `open`) before
  locking the group's open members in one statement ordered ascending by id
  (`WHERE id = ANY(memberIds) ORDER BY id FOR UPDATE`); both the thread message and
  `teacher_questions.answer` store the same trimmed text.
- Why: two concurrent `answer()` calls on different members of one group could deadlock (40P01)
  under the old single-row-then-unordered-group lock; a consistent lock order removes the AB-BA
  cycle, and the agent lock closes the narrower "opened mid-answer" race the 5.10 review flagged.
  Storing the trimmed text in both places keeps the thread message and the answer record
  byte-identical.
- risk: high (touches `packages/db/src/repositories/**`). Needs `database-reviewer` and
  `security-reviewer`.

### 22 Oct 2026 · 5.10b additive migration for teacher-questions grouping index · decided by builder · risk: low
- Decided: migration `0025_teacher_questions_grouping_index.sql` adds
  `teacher_questions_teacher_id_agent_id_status_created_at_idx` on
  `(teacher_id, agent_id, status, created_at)`, additive only (`CREATE INDEX`).
- Why: `open`'s grouping read and `listGroupsForTeacher` both filter on exactly this
  `(teacher, agent, open)` triple and sort by recency; this index covers both instead of falling
  back to the existing `(teacher_id, status)` index plus a filter on `agent_id`.
- risk: low (additive index, no behaviour change). Needs `database-reviewer`.

### 22 Oct 2026 · 5.10b unique partial session index not added · decided by builder · risk: medium
- Decided: did not add the unique partial index on open sessions per `(teacher, student, agent)`
  that the plan's item 3 asked for.
- Why: `sessions.create` (`packages/db/src/repositories/sessions.ts`) has no check for an existing
  open session before inserting, and its only caller, `apps/web/src/turn/routes.ts`'s
  `startSession` handler, calls it unconditionally on every request with no prior lookup. Two open
  sessions for one `(teacher, student, agent)` triple can exist today, so a unique index on that
  triple would make some existing, currently-successful `startSession` calls fail with a
  constraint violation. The lead's own instruction for this item was to stop and say exactly where
  rather than add the index; fixing `apps/web`'s session-opening logic first is out of this task's
  bounds (no `apps/*` edits).
- risk: medium (a deferred safety net, not a behaviour change — but it means two open sessions for
  one triple remain possible until a follow-up task closes `startSession`'s gap). Needs
  `database-reviewer` to confirm before any follow-up task adds the index.
