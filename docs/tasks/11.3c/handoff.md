# 11.3c handoff: insights refuse a week that has not ended

**Status:** DONE

Branch: m13/11.3c-insights-closed-weeks
Worktree: .claude/worktrees/agent-a92937f0d20642f5b

A first builder (Opus 5.5) started this task and stopped at the usage limit after 13 tool
calls, having already written the fix and the tests (committed as "11.3c: builder WIP (stopped
at the usage limit; not gated)"). This session read that WIP, verified it against the brief,
confirmed the callers check, and ran the gate.

## What changed

`packages/db/src/repositories/insights.ts`: `weekWindow` (used by every read and by
`computeAndSaveWeek`) now throws `RepositoryError('invalid', method)` when the window's end
(`weekStart` + 7 days) is after `Date.now()`. The module has no injected clock, so this follows
how it already gets "now" elsewhere (no new dependency). A comment above the function and a
block comment near the top of the file explain why (11.3a security review: differencing out one
student by reading the current week before and after their activity).

`packages/db/test/insights.int.test.ts`: the `WEEK`/`NEXT_WEEK` fixtures (and the handful of
dates that referenced them, e.g. the `getWeek(A, '2026-10-05')` null check and the "refuses a
week that is not a Monday date" literals) were moved from 2026-10-12/10-19 into the past
(2026-10-05/10-12), since the repository now refuses the current week outright. A new `describe`
block adds: (1) one test asserting `invalid` for the current week, next week and a week a year
out, across all four reads and `computeAndSaveWeek`, with no row ever written to `insights`; (2)
one test asserting that closed weeks (last week and both fixture weeks) still work normally.

No change to `packages/db/src/repositories/README.md`: it does not mention insights.

## Callers check (brief requirement)

Grepped `apps/web`, `apps/worker`, `apps/cli` for `weeklyTopQuestions`, `stickingTopics`,
`unhelpfulAnswerCount`, `computeAndSaveWeek`, `insights.getWeek`. Only caller is
`apps/worker/src/insights/weeklyInsights.ts`, which calls `computeAndSaveWeek` with a
`weekStart` it is given by `schedule.ts`/the worker's cron, always the last finished week (the
worker never asks for "this week"). No caller reads or computes the current week on purpose, so
no BLOCKED and no caller changes were needed.

## Evidence

`corepack pnpm turbo run typecheck lint test --filter=@edmate/db` → exit 0, 8/8 tasks successful.
`test/insights.int.test.ts (28 tests)` all passed, 0 skipped. Across the whole package: 74 test
files passed (74), 1449 tests passed, 4 skipped (unrelated: `recall.int.test.ts` 2 skipped,
`video-ingest.int.test.ts` 1 skipped, `retrieval-hnsw.int.test.ts` 1 skipped — none for lack of
Postgres; Postgres and Redis were up throughout). Coverage: `insights.ts` 100% stmts/branch/funcs/lines.

`python3 .githooks/secret-scan.py --all` → clean, no output.

## Decisions

### 22 Oct 2026 · 11.3c: insights refuse a week that has not ended in packages/db/src/repositories/insights.ts · decided by builder · risk: high
- Decided: `weekWindow` (shared by every insights read and by `computeAndSaveWeek`) throws
  `RepositoryError('invalid', method)` when the window's end (`weekStart` + 7 days) is after
  `Date.now()`. No injected clock exists on this repository, so this follows the module's
  existing way of getting "now" rather than adding one. Fixtures that previously used the
  then-current week were moved into the past instead of pinning a test clock.
- Why: 11.3a's security review found that a teacher could call a read for the current week
  twice, once before and once after a single student's activity, and difference the two results
  to identify that student even though the small-group floor (`INSIGHTS_MIN_STUDENTS`) is meant
  to prevent singling anyone out. Refusing any week that has not fully closed removes the
  attack: every payload the repository ever returns is for a week whose contents cannot change
  again.
- risk: high (`packages/db/src/repositories/**` is a risk path). Required reviewers:
  database-reviewer, security-reviewer.

## Note on 11.3a's handoff

11.3a's handoff states 27 tests; the int test file actually ran 26 tests at that point (now 28,
after this task's two additions). Noting it here per the brief rather than editing the 11.3a
handoff.

## Left to do

None. The gate is green and the fix matches the brief in full.

Tool calls used: 13 (first builder) + 22 (this session) = 35.
