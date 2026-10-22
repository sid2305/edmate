# Task 8.9a handoff: db, `teacherQuestions.dismiss` (8.9 Phase A)

Status: DONE
Tool calls used: 54

- Branch: `m8/8.9a-dismiss-question` (built on local branch `work-89a`)
- Worktree: `.claude/worktrees/agent-a3185a9e9b0ccc808`
- Plan: `docs/tasks/8.9/plan.md`, Phase A. Only `packages/db` changed; no migration, contracts,
  harness or apps change. Lead answer Q1 followed: dismiss closes one question only, never the
  group.

## What changed (signature for Phase B)

```ts
repos.teacherQuestions.dismiss(scope: TeacherScope, questionId: string): Promise<void>
```

Closes the scope's own open question alone: one scoped UPDATE (`status 'open' -> 'dismissed'`),
leaving `answer`/`answered_at` null and never touching the group id or sibling rows. Another
teacher's, a missing, or an already-answered/dismissed question throws `RepositoryError('not_found')`
and writes nothing. Once dismissed the row already drops out of `listForTeacher`'s and
`listGroupsForTeacher`'s `status = 'open'` queries, so no other file changed.

Files touched:
- `packages/db/src/repositories/teacher-questions.ts` — added `dismiss`.
- `packages/db/src/repositories/README.md` — one new paragraph under "Ask the teacher".
- `packages/db/test/teacher-question-answer.int.test.ts` — two new `describe('dismiss', …)` cases:
  closes the named row only (sibling group member stays open and is still answerable); another
  teacher's / missing / already-answered / already-dismissed question is `not_found`, nothing
  written.
- `packages/db/test/repositories.int.test.ts` — added `teacherQuestions.dismiss` to the exhaustive
  `CASES` table (new `dismissTarget` / `dismissReplay` fixtures in `beforeAll`, following the
  file's `answerTarget`-style convention); the method also appears in the "has a case for exactly
  the methods" runtime check.

## Evidence

Own compose project `edmate89a` (`docker compose -p edmate89a -f docker/compose.yaml -f
packages/db/test/compose.port.yaml up -d postgres`, `EDMATE_PG_TEST_PORT=55489`):

```
✓ test/teacher-question-answer.int.test.ts (13 tests)
✓ test/repositories.int.test.ts (105 tests)
  teacherQuestions.dismiss           teacher write cases=10 leaks=0
```

`corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`:

```
Test Files  58 passed (58)
     Tests  997 passed | 4 skipped (1001)
 teacher-questions.ts | 100 | 78.12 | 100 | 100 | 296,399-401  (uncovered lines pre-date this change)
Tasks:    26 successful, 26 total
```

`python3 .githooks/secret-scan.py --all`: clean.

`docker compose -p edmate89a -f docker/compose.yaml -f packages/db/test/compose.port.yaml down -v`
run at the end.

## Deviations

None from the plan.

## Decisions
### 22 Oct 2026 · 8.9a Lead accepts the dismiss repository method · decided by lead · risk: high
- Decided: `teacherQuestions.dismiss` merges as one scoped UPDATE with no transaction, closing a single question and leaving its group open. It touches packages/db/src/repositories/teacher-questions.ts, a risky path for keeping each teacher's data apart.
- Why: the security, database and TypeScript reviewers all approved it. Ownership is enforced in the SQL WHERE, so a guessed question id can't reach another teacher's row, and every refusal writes nothing. The one LOW, a concurrency test, joins the repository follow-ups in 8.6f.
- risk: high


### 22 Oct 2026 · 8.9a dismiss is a single scoped UPDATE, no transaction · decided by builder · risk: high
- Decided: `dismiss` is one `UPDATE … WHERE id = $id AND teacher_id = $t AND status = 'open'
  RETURNING id`, not a transaction — same shape as `notifications.markRead`, since there is only
  one row to touch and nothing else to write (no note, no group-wide effect, no second statement
  whose failure needs to roll back the first).
- Why: this is a risky path (`packages/db/src/repositories/teacher-questions.ts`, the "access
  filter / money / isolation" group in risk-paths.txt) and the plan's own open question 1 flagged
  dismiss's scoping (single-row vs. group-wide) as needing a recorded decision. The lead's answer
  (Q1: dismiss closes one question only) is followed exactly: the WHERE clause scopes by
  `teacher_id` (never another teacher's row) and by `status = 'open'` (an already-closed row is
  `not_found`, so a replayed dismiss or a race with `answer` can't silently succeed twice), and no
  other table or column is touched.
- risk: high
