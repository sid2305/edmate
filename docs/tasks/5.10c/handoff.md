**Status:** DONE

## What changed

5.10b review's code-reviewer re-verify LOW: the `open()`-vs-`answer()` deadlock test replayed
`open()`'s `FOR KEY SHARE` lock statement on a raw connection instead of calling `open()`, so
removing `.orderBy(teacherQuestions.id)` from `open()`'s lock read would not fail it.

I tried driving the real `open()` into a forced two-connection interleaving first (holding a raw
`FOR UPDATE` on the group's `highId` row from a second connection, calling `open()` with
`similarIds: [lowId, highId]`, then having the second connection also claim `lowId`). It is not
deterministic: without `ORDER BY`, Postgres is free to choose any row order for a tiny `IN (...)`
list (the same reason the 5.10b author already gave for not forcing it through the live call, and
why that test instead replays the statement on a raw connection), so the interleaving can't be
pinned to a chosen lock order through `open()` itself without a production change.

Per the brief's fallback, I added a **query-shape test** instead (test-only, no production
change): `packages/db/test/teacher-question-answer.int.test.ts`, new test in the "5.10b review
follow-ups" describe block. It monkey-patches `pg.Client.prototype.query` for the duration of one
`open()` call with two `similarIds`, captures the exact SQL text the driver sends, finds the
statement with `for key share` + `teacher_questions` + an `IN (...)` list, and asserts it contains
`order by "teacher_questions"."id"` before `for key share`. The patch is restored in a `finally`
whether or not the call throws.

No production file was touched (the brief's preferred outcome); the lock statement's
`.orderBy(teacherQuestions.id)` in `packages/db/src/repositories/teacher-questions.ts` is unchanged.

## Evidence

**Failing-without-orderBy proof** (temporarily removed `.orderBy(teacherQuestions.id)` from
`open()`'s lock read at `packages/db/src/repositories/teacher-questions.ts:171`, ran the full
file, then restored it):

```
❯ test/teacher-question-answer.int.test.ts (18 tests | 1 failed) 3064ms
  ❯ 5.10b review follow-ups (4)
    × open()'s own callerSimilarIds lock statement (query shape): ...

AssertionError: expected 'select "id" from "teacher_questions" …' to match /order by\s+"teacher_questions"\."id"…/i

- Expected:
/order by\s+"teacher_questions"\."id"[\s\S]*for key share/i

+ Received:
"select \"id\" from \"teacher_questions\" where (\"teacher_questions\".\"teacher_id\" = $1 and \"teacher_questions\".\"id\" in ($2, $3)) for key share"

Test Files  1 failed (1)
     Tests  1 failed | 17 passed (18)
```

(The file's other 17 tests, including the two forced-interleaving deadlock tests from 5.10b, all
still passed — only the new query-shape test caught the regression.)

**Gate with the orderBy restored** (`corepack pnpm turbo run typecheck lint test
--filter=@edmate/db`): 8 tasks successful, 8 total (typecheck, lint, test each ran once, all
cached or fresh-green). `@edmate/db:test`: 74 test files run, 74 passed, 0 failed; 1446 tests
passed, 4 skipped (0 skipped for "no Postgres" — the dev Postgres at 127.0.0.1:55432 was used
throughout).

**Secret scan:** `python3 .githooks/secret-scan.py --all` — clean, no output.

## Decisions

### 22 Oct 2026 · open()'s multi-row lock order is pinned by a query-shape test, not a forced live interleaving · decided by builder · risk: low

- Decided: instead of forcing the real `open()` call into the deadlock interleaving (tried and
  found non-deterministic, matching the reasoning the 5.10b test's own comments already give for
  the raw-connection replay), 5.10c adds a test-only query-shape assertion on `open()`'s captured
  SQL text and leaves `packages/db/src/repositories/teacher-questions.ts` unchanged.
- Why: Postgres doesn't guarantee a row order for an unordered multi-row `IN (...)` lock, so no
  two-connection timing setup can reliably force `open()`'s statement to lock in a chosen order
  without the `ORDER BY` already in place to pin it — any such test would be flaky in both
  directions. Pinning the statement's own SQL text instead directly catches the exact change the
  accept line names (removing `.orderBy(teacherQuestions.id)`), with no production change and no
  flakiness.
- risk: low (test-only change, no files under `packages/db/src/repositories` were touched).

Tool calls used: 26
