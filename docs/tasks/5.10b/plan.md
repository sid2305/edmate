# Task 5.10b: teacher-questions locking and index follow-ups from the 5.10 review

Lead brief (delegated directly, no separate planner round): fix the four review follow-ups left
from 5.10 (`docs/tasks/5.10/review.md`), all in `packages/db`.

## Scope

`python3 .claude/skills/board/board.py show 5.10b`. Context: `docs/tasks/5.10/plan.md`,
`docs/tasks/5.10/review.md`, `docs/tasks/5.10/handoff.md`, `docs/lessons.md` ("Two writers that
lock the same rows in different orders deadlock"). Code: `packages/db/src/repositories/
teacher-questions.ts`, `question-similarity.ts`, `packages/db/src/schema/content.ts`,
`packages/db/migrations/`.

## Lead decisions

1. `teacherQuestions.answer` takes the agent lock first (same order as `open`), then locks the
   group's question rows in one statement ordered by id (`SELECT ... WHERE id = ANY(...) ORDER BY
   id FOR UPDATE`). Integration test: two concurrent answers in one group (`Promise.all`) finish
   without a 40P01 deadlock and leave a consistent state.
2. Store the trimmed answer in both the thread message and `teacher_questions.answer`.
3. Migration (additive only): a unique partial index on open sessions per `(teacher, student,
   agent)`, and a `(teacher_id, agent_id, status, created_at)` index for grouping. Before adding
   the unique index, check that no code path creates two open sessions for one `(teacher, student,
   agent)`; if one does, stop PARTIAL and say where.
4. `bestGroup` tokenises the incoming question once per call, not once per candidate. Keep
   behaviour identical (existing tests stay green).

## Rules

- Risky path: `packages/db/src/repositories/**`. `risk: high` naming database-reviewer and
  security-reviewer; a decision for the migration (additive only) naming database-reviewer.
- No `packages/contracts` change. No `apps/*` edits.
- Shared files (append-only; another builder is also in `packages/db`):
  `packages/db/src/repositories/index.ts`, `README.md`, the schema index, the migration journal,
  `packages/db/test/repositories.int.test.ts`. Don't touch `subscriptions.ts`. Don't reformat
  unrelated code.
- db integration tests run against a disposable Postgres container, never the running `edmate-*`
  containers.
- Test text is synthetic.

## Acceptance (board)

A concurrency test answers two members of one group at once with no deadlock; a question opened
during an answer doesn't stay open after its group is answered; the stored answer has no trailing
newline; the migration is additive; the db tests pass.
