Status: DONE
Tool calls used: 53 (harness count)

## Summary
Task 8.8 Phase B: the `/teacher/insights` page and its nav link. A server component only (no
client JS, no fetch) that calls `loadInsights` (Phase A, `apps/web/src/studio/insights.ts`)
directly from the session's own teacher scope, then renders two read-only, student-blind
sections:

- **Turn health** (last 7 days): turn count, error rate %, guard-trip rate %, reply latency
  (`health.stepLatencyMs.generate`, p50/p95) and first-token latency
  (`health.stepLatencyMs.firstToken`, p50/p95) — the "overall p50/p95 latency only" lead answer
  (Q4), not a per-step breakdown of all 11 pipeline steps. A capped-window notice
  (`role="status"`) renders when `insights.capped` is true; an empty state renders when
  `health.turns === 0`.
- **What students are stuck on**: up to 5 open question groups, each as "`{count}` asked
  near-identically since `{date}`" (date = `oldestAt.slice(0, 10)`, no locale lookup) plus the
  group's sample text; an empty state when there are no groups.

No per-student row anywhere: the page only ever touches `InsightsQuestionGroup`'s
`{groupId, count, oldestAt, sample}` shape from Phase A, which carries no student id by
construction.

`docs/lessons.md`'s "a studio page that trusts a 200 response gets stuck" doesn't apply here:
there is no client fetch on this page at all — `loadInsights` runs server-side inside the RSC,
so there's no JSON-body/busy-flag risk to guard against.

## Files
- `apps/web/app/teacher/insights/page.tsx` (new) — `requireRole(['teacher'])` then
  `loadInsights(serverDatabase().repos, { teacherId: principal.userId })`; own `AppShell` nav
  (dashboard, uploads, insights), matching `uploads/page.tsx`'s nav shape plus the new link.
- `apps/web/app/teacher/insights/page.test.tsx` (new) — mocks `requireRole`/`serverDatabase`/
  `loadInsights`; asserts the guard runs first (`loadInsights` never called when `requireRole`
  rejects), the scope is `{ teacherId: <principal> }` only, both empty states, the capped notice,
  and the question-group rendering with no student id in any mock result.
- `apps/web/app/teacher/view.tsx` — one new nav entry, `{ href: '/teacher/insights', label:
  t('insightsLink') }`, appended after the existing entries (8.3c's outline and 8.4b's style-card
  links were already merged into this file on `origin/main` before this build started, so there
  was no textual conflict to resolve — just appended at the end, no reordering).
- `apps/web/app/teacher/view.test.tsx` — one new test, "links to the insights page from the main
  nav", added without touching the existing cases.
- `apps/web/messages/en.json` — added `"insightsLink": "Insights"` to the existing `teacher`
  object (one new line) and a new top-level `"insights"` object (title, health-block labels,
  questions-block labels, the capped notice, both empty-state strings). Pure additions; nothing
  existing reworded or reordered.

## Tests
- `page.test.tsx`: 5 cases (teacher-scoped read + nav link; guard-first; both empty states;
  capped notice + all health numbers; up to-5 question groups with no student id).
- `view.test.tsx`: 7 cases total (6 existing + 1 new insights-link case), all green.
- `src/studio/insights.ts`/`.test.ts` (Phase A, unchanged in this phase): still 100/100/100/100.

Evidence:
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → 34/34 tasks successful
  (cached + fresh), all test files green including `app/teacher/insights/page.test.tsx` (5
  tests), `app/teacher/view.test.tsx` (7 tests), `src/studio/insights.test.ts` (7 tests).
- `python3 .githooks/secret-scan.py --all` → no output (clean).

## Decisions

### 22 Oct 2026 · 8.8b "Overall p50/p95 latency" means the generate and firstToken steps, not a step breakdown · decided by builder · risk: low
- Decided: the health block shows `health.stepLatencyMs.generate` (full reply latency) and
  `health.stepLatencyMs.firstToken` as "Reply latency" and "First token", and nothing else from
  `stepLatencyMs` (the other 9 pipeline steps are not shown).
- Why: `HealthMetrics` has no single "overall turn" step — `stepLatencyMs` is keyed per
  `trace.steps[].name` (admit, entitle, preGuard, route, escalate, buildContext, decide, generate,
  postGuard, meter, commit) plus the derived `firstToken` entry; `generate` is the step that
  produces the student-visible reply, so it is the one that matches "reply latency" in 8.8's
  accept-shaping text, and the plan's own Q4 recommendation says to keep this first page short
  rather than breaking down every pipeline step.
- risk: low — a one-line follow-up to add more steps to the page if a reviewer wants the full
  breakdown; `HealthMetrics.stepLatencyMs` already has the data.

### 22 Oct 2026 · 8.8b Group dates are shown as a plain ISO date slice, no locale formatting · decided by builder · risk: low
- Decided: `oldestAt` (an ISO timestamp) is rendered as `oldestAt.slice(0, 10)` (`YYYY-MM-DD`),
  not `toLocaleDateString()`.
- Why: English-only pilot, no locale-pack timezone lookup on this page (that's 11.3's own
  "Monday 07:00 in the locale pack's timezone" requirement, not this read-only page); a plain ISO
  slice is deterministic in tests and avoids a server/client locale mismatch since this is a pure
  server component with no hydration.

## Left to do
None for this phase.
