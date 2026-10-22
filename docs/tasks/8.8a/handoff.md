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
