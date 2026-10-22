Status: DONE
Tool calls used: 19

## What changed
Added `apps/web/src/studio/insights.ts` (Phase A of 8.8's plan): a pure aggregation module with
no React, no db, no model calls.

- `loadInsights(backend: InsightsBackend, scope: TeacherScope, now: Date = new Date()):
  Promise<Insights>` — computes `since = now - INSIGHTS_WINDOW_DAYS` (7 days), calls
  `backend.turnTraces.listForTeacherSince(scope, since)` and
  `backend.teacherQuestions.listGroupsForTeacher(scope, { limit: INSIGHTS_TOP_GROUPS })` (5
  groups) in parallel, and returns:
  `{ windowDays, health: HealthMetrics, capped: boolean, topQuestionGroups: InsightsQuestionGroup[] }`.
- `capped = traces.length === TEACHER_TRACES_MAX_LIMIT` (200).
- `InsightsQuestionGroup = { groupId, count, oldestAt, sample }`, `sample` = the group's oldest
  question's text, `''` if the group is empty.
- `InsightsBackend` is the narrow repo-pick interface (`turnTraces.listForTeacherSince`,
  `teacherQuestions.listGroupsForTeacher`), same convention as `OutlineBackend`/`ProfileBackend` —
  no real db needed in tests.
- Exports: `INSIGHTS_WINDOW_DAYS = 7`, `INSIGHTS_TOP_GROUPS = 5`, `InsightsBackend`, `Insights`,
  `InsightsQuestionGroup`, `loadInsights`.

For Phase B: the page should call `loadInsights(serverDatabase().repos, { teacherId:
principal.userId })` directly (no `now` override in production; `serverDatabase().repos` already
satisfies `InsightsBackend` structurally). Reuse this file's `traceRow`/`group` fixture helpers
in `page.test.tsx` if a trace/group fixture is needed there too — they mirror
`packages/harness/src/metrics/health.test.ts`'s own `trace` fixture shape plus the
`TurnTraceRow`/`TeacherQuestionGroup` row columns.

## Evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → 34/34 tasks successful,
  61 test files passed (1 pre-existing skip), 940 tests passed; `src/studio/insights.ts` at
  100/100/100/100 coverage (stmts/branch/funcs/lines).
- `python3 .githooks/secret-scan.py --all` → no output (clean).

## Decisions

### 22 Oct 2026 · 8.8a sample text is the group's oldest question, not newest or first-inserted · decided by builder · risk: low
- Decided: `InsightsQuestionGroup.sample` is `group.questions[0]?.text ?? ''`, and
  `listGroupsForTeacher` already returns each group's `questions` oldest-first (its own repo
  comment and sort). So "sample" here means the oldest open question in the group.
- Why: the plan says "sample = the group's first question's text" without saying which ordering
  counts as "first"; the repo's own output is already ordered oldest-first, so taking index 0
  needed no extra sort and matches "oldest-first" being the one order 5.10's own docs commit to.
- risk: low — a one-line follow-up to switch to newest-first if a reviewer disagrees.

### 22 Oct 2026 · 8.8a The teacher trace listing returns the newest traces when capped · decided by builder · risk: medium
- Decided: `turnTraces.listForTeacherSince` (packages/db) now orders by `createdAt desc, id desc`,
  takes `limit`, then reverses the page in memory before returning it, so callers still see
  oldest-first output but the page is the *newest* `limit` rows, not the oldest. JSDoc updated to
  say "the newest `limit` traces ... returned oldest first". `apps/web/src/studio/insights.ts`'s
  `capped` now reads `traces.length >= TEACHER_TRACES_MAX_LIMIT` (was `===`, a defensive `>=`
  since the cap is enforced by the repo's own `Limit` schema, not by this call site).
- Why: typescript-reviewer (HIGH) found the previous ascending-order-then-limit read returned the
  *oldest* 200 traces once a teacher passed 200 turns in the 7-day window, while
  `insights.ts`'s comment and the studio UI both say "most recent" — a pilot teacher would see
  stale health. Only one real implementation of this repo method exists (Postgres); there is no
  in-memory/fixture copy to also fix.
- risk: medium — this is the first edit to `packages/db` inside task 8.8 (otherwise an
  `apps/web`-only task); it changes a public repo method's query shape and page composition, so a
  reviewer should re-check the isolation/ordering tests in
  `packages/db/test/trace-sink.int.test.ts` and `repositories.int.test.ts`.

## Fix round 1
Fixed the HIGH above (`listForTeacherSince` returning the oldest 200 traces instead of the newest
when capped) and the LOW (`capped` using `===` instead of `>=`).

- `packages/db/src/repositories/turn-traces.ts`: `listForTeacherSince` now orders
  `desc(turnTraces.createdAt), desc(turnTraces.id)`, limits, maps rows, then `.reverse()`s the
  array so the return is still oldest-first. Updated the method's JSDoc.
- `packages/db/test/trace-sink.int.test.ts`:
  - Updated the existing "bounds by time, caps rows..." test: capping to 1 now asserts the kept
    row is `trn_window_new` (the newer of the two seeded traces), not just `toHaveLength(1)`.
  - Added a new test, "listForTeacherSince returns the newest `limit` traces, oldest first, when
    capped": seeds 4 traces with explicit, far-future `created_at` timestamps (`2030-01-0{1..4}`,
    so the assertion is deterministic regardless of other tests' leftover rows or the real
    clock), caps at `limit = 2`, and asserts the result is `['trn_cap_3', 'trn_cap_4']` — the
    newest two, oldest first.
  - Both tests originally used near-present dates (2020/2024/2026-06-01); switched to
    2030-dated rows after a first local run showed other tests' un-cleaned-up seed rows (e.g.
    `trn_find`, `trn_once`, inserted at the real "now") sorting as newer under the new
    `desc`-ordered query, breaking the fixed ordering the tests expect.
- `apps/web/src/studio/insights.ts`: `capped: traces.length >= TEACHER_TRACES_MAX_LIMIT` (was
  `===`); the "most recent" comment needed no change since it's now true.

Tests: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --filter=@edmate/web...
--force` → 34/34 tasks successful; `packages/db`'s integration suite (including
`trace-sink.int.test.ts`) ran against a local Postgres (`docker compose -f docker/compose.yaml -f
packages/db/test/compose.port.yaml up -d postgres`), 992 passed / 4 skipped (pre-existing,
unrelated); `turn-traces.ts` at 100/100/100/100 coverage. `python3 .githooks/secret-scan.py --all`
→ clean.

Tool calls used: 29
