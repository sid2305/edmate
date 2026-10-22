# Task 8.8 — Insights view (earnings view moves to 10.7)

## Acceptance (verbatim, board `show 8.8`)
- Title: "Insights view (earnings view moves to 10.7)"
- Accept: "insights show no individual student."
- Deps: 1.3, 5.1, 5.2, 8.1 — all done.

How it will be shown: a new `/teacher/insights` page in the teacher studio, linked from the
studio's main nav as "Insights". It renders two read-only, teacher-wide sections over data that
already exists today, with no per-student row anywhere:

1. **Turn health** (last 7 days): turn count, error rate, guard-trip rate, and reply latency
   (p50/p95, incl. first token) — `turnTraces.listForTeacherSince` (7.7) fed straight into
   `computeHealthMetrics` (`packages/harness`), exactly as 7.7 built it. Neither reads nor selects
   a student id.
2. **What students are stuck on**: the top 5 open question groups — `teacherQuestions
   .listGroupsForTeacher` (5.10), the same grouping 8.9's inbox will use. The repo's `SELECT`
   never includes `student_id` (see its own comment), so a group's sample question text carries no
   asker identity by construction, and the text is the same post-scrub text 8.9's inbox already
   shows a teacher (confirmed via `commit.test.ts`'s scrubbed-number case).

## Scope cut (MVP first, human: a testable product fast)
8.8 is **not** 11.3 (the weekly insights worker). It ships none of: a Monday 07:00 cron, email
delivery, "unhelpful answers" (no feedback-signal source exists yet), "sticking topics" (no
per-topic guard/help rollup exists yet), or the `teacher-chat-visibility` decision 11.3 is blocked
on. It's a live, on-demand page over two read paths that are already built and already aggregate
correctly — the smallest slice that clears 8.8's own accept line. 11.3 stays the task that adds
the rest.

## Why there is no db phase
`turnTracesRepo.listForTeacherSince` (7.7) and `teacherQuestionsRepo.listGroupsForTeacher` (5.10)
already exist, are already exported from `@edmate/db` (`Repositories['turnTraces']`,
`Repositories['teacherQuestions']`, plus `TEACHER_TRACES_MAX_LIMIT`, `TeacherQuestionGroup`,
`GROUPS_MAX_LIMIT`), and `computeHealthMetrics` is already exported from `@edmate/harness`'s root
index, which `apps/web` already depends on. 8.8 adds **zero** lines to `packages/db` or
`packages/harness`. This also keeps 8.8 off `packages/db/src/repositories/**` entirely, so it
can't collide with 8.6b's in-flight edits there.

`/api/studio/**` is already `access: ['teacher']` in `apps/web/src/auth/policy.ts` (GET included),
so no API-route layer or policy change is needed either; the page reads its own data straight from
`serverDatabase().repos` server-side, the same pattern `apps/web/app/teacher/uploads/page.tsx`
already uses for `modules.ids`.

## Phase A — insights aggregation module (apps/web, pure, no React)
Budget: ~110 tool calls.

Files to create:
- `apps/web/src/studio/insights.ts` — `loadInsights(backend, scope, now?)`:
  - computes `since = now - 7 days` (export `INSIGHTS_WINDOW_DAYS = 7`), calls
    `backend.turnTraces.listForTeacherSince(scope, since)` and
    `backend.teacherQuestions.listGroupsForTeacher(scope, { limit: INSIGHTS_TOP_GROUPS })`
    (export `INSIGHTS_TOP_GROUPS = 5`);
  - returns `{ windowDays, health: computeHealthMetrics(traces), capped, topQuestionGroups }`;
  - `capped = traces.length === TEACHER_TRACES_MAX_LIMIT` — when the 7-day window has 200+ turns
    the health numbers are the most recent 200, not the full week; the page must say so (see the
    lesson below), never present a capped read as the whole window;
  - `topQuestionGroups` maps each `TeacherQuestionGroup` to `{ groupId, count, oldestAt, sample }`
    (`sample` = the group's first question's text, `''` when the group is somehow empty);
  - `InsightsBackend` interface: `Pick<Repositories['turnTraces'], 'listForTeacherSince'>` +
    `Pick<Repositories['teacherQuestions'], 'listGroupsForTeacher'>` — same narrow-interface
    convention as `OutlineBackend`/`ProfileBackend`, so the test needs no real db (rule 4).
- `apps/web/src/studio/insights.test.ts` — fakes for both repo methods; cases:
  - the 7-day `since` passed to `listForTeacherSince` is computed from the injected `now`, not
    `Date.now()` (deterministic test);
  - `health` is exactly `computeHealthMetrics(traces)`'s output for a small fixed trace list
    (reuse a fixture shape from `packages/harness/src/metrics/health.test.ts` rather than
    reinventing one);
  - `capped` is `true` only when `listForTeacherSince` returns exactly
    `TEACHER_TRACES_MAX_LIMIT` rows, `false` for fewer;
  - zero traces -> `health.turns === 0`, no throw (matches `computeHealthMetrics`'s own empty-input
    behaviour);
  - zero question groups -> `topQuestionGroups === []`;
  - the returned type has no `studentId`/`student_id` field anywhere (a compile-time check: assign
    the result to a type missing that key, or an explicit `expect(Object.keys(...)).not.toContain`
    sweep over every nested object) — this is the test that actually backs the accept line.

No edits to `apps/web/src/studio/index.ts`/`routes.ts`/`runtime.ts` in this phase: `insights.ts`
is self-contained and Phase B imports it directly, like `outline.ts` is imported directly rather
than routed through a shared runtime object (the backend here is just the two repo picks, built
inline from `serverDatabase().repos` in the page, not a new runtime singleton).

## Phase B — the `/teacher/insights` page and nav link
Budget: ~110 tool calls.

Files to create:
- `apps/web/app/teacher/insights/page.tsx` — server component, `export const dynamic =
  'force-dynamic'`; `requireRole(['teacher'])`, then `loadInsights(serverDatabase().repos,
  { teacherId: principal.userId })`; renders inside `AppShell` (same nav array shape as
  `uploads/page.tsx`, with an added Insights link — see the shared-file note below):
  - a health block: turn count, error rate and guard rate as percentages, p50/p95 latency; a
    capped-window notice when `capped` is true; an empty state when `health.turns === 0`;
  - a questions block: up to 5 groups, each as "count asked near-identically since `oldestAt`" +
    the sample text; an empty state when there are no open question groups.
  - every string from a new `insights` namespace in `apps/web/messages/en.json`.
- `apps/web/app/teacher/insights/page.test.tsx` — same shape as `uploads/page.test.tsx`: mock
  `requireRole`/`serverDatabase`, mock `./insights`'s `loadInsights`-like entry point; assert the
  scope passed is `{ teacherId: <principal> }` only; assert the heading and both empty states
  render when the fakes return zero data; assert the capped notice renders when `capped: true`;
  assert the guard runs before any repo read (`requireRole` rejects -> `loadInsights` never
  called), mirroring the uploads page's own "reads nothing when the guard refuses" case.

Files to modify (**shared with 8.3c and 8.4b — see below**):
- `apps/web/app/teacher/view.tsx` — add one nav entry, `{ href: '/teacher/insights', label:
  t('insightsLink') }`, appended after the existing two; no reordering of the existing array.
- `apps/web/app/teacher/view.test.tsx` — add one test mirroring the existing two link tests
  ("links to the uploads centre" / "links to the onboarding form"), asserting the new Insights
  link; no edits to the existing tests.
- `apps/web/messages/en.json` — add `"insightsLink": "Insights"` to the existing `teacher` object
  (one new line, not touching `title`/`placeholder`/`nav`/the other two links), and a new
  top-level `"insights": { ... }` object (title, the health-block labels, the questions-block
  labels, the capped notice, both empty states). Both are pure additions; nothing existing is
  reworded or reordered.

## Shared files with other in-flight tasks
- `apps/web/messages/en.json` and `apps/web/app/teacher/view.tsx` are also being edited by 8.4b
  (style-card studio page, review) and 8.3c (outline-editor follow-ups, review). Both are ahead of
  8.8 in the queue. Before Phase B starts editing either file, the builder pulls `main` and checks
  both files' current state first — the lead merges 8.4b/8.3c before 8.8's Phase B build starts
  wherever practical; if either lands mid-build, the builder re-pulls and re-applies its own small
  addition (one nav entry, one `insightsLink` line, one `insights` block) rather than resolving a
  textual conflict by hand across unrelated hunks. Phase A (apps/web/src/studio/insights.ts +
  test) touches neither file and is unaffected by their landing order.
- `packages/db/src/repositories/{index.ts,README.md,map.ts}` and
  `packages/db/test/repositories.int.test.ts` (8.6b, running) are not touched by this plan at all
  (see "Why there is no db phase" above) — no collision.

## Risky paths touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`). Every file in both phases is
under `apps/web/app/teacher/**`, `apps/web/src/studio/**` or `apps/web/messages/en.json`; none of
those match a risk-paths glob (`apps/web/src/auth/**`, `apps/web/app/api/webhooks/**`,
`apps/web/app/api/auth/**`, `packages/db/src/repositories/**`, `packages/contracts/**`,
`packages/harness/src/{guardrails,access,pedagogy}/**`, `content/**`, `.claude/**`, `.github/**`,
`.githooks/**` are the nearby ones, and this plan is outside all of them). Not a contracts change,
so no ADR. The handoff logs a normal (not `risk: high`) decision; no extra reviewers beyond the
usual code-reviewer/typescript-reviewer pass.

## Lead answers (22 Oct 2026)
- Q1: accepted. The window is the last 7 days.
- Q2: accepted. Show the top 5 open-question groups by count.
- Q3: accepted. No minimum-group-size filter in 8.8; that policy belongs to 11.3.
- Q4: accepted. Overall p50/p95 latency only.
- Shared files: Phase B starts after 8.4b and 8.3c merge; its builder merges origin/main before the final push.

## Open questions (with recommendation)
1. **Window length.** Recommend 7 days (`INSIGHTS_WINDOW_DAYS = 7`), matching the weekly cadence
   11.3 will later formalise, and simple to explain on the page ("last 7 days"). No config knob in
   this MVP slice.
2. **How many question groups to show.** Recommend top 5 by count (`INSIGHTS_TOP_GROUPS = 5`) —
   enough to be useful, short enough to read at a glance; 8.9's own inbox is the place to see every
   group.
3. **A minimum group size before a question group is shown (11.3's board text names "minimum
   group size of 5").** Recommend **not** adding that filter in 8.8: the repo already excludes
   `student_id` from every row it selects, so a group of 1 still names no student; the "minimum
   group size" language belongs to 11.3's own aggregation policy (and its open
   `teacher-chat-visibility` decision), not to this read-only reuse of 5.10's existing, already
   student-blind grouping. If the human disagrees once this ships, tightening to a floor of 5 is a
   one-line follow-up task, not a blocker now.
4. **Latency detail shown.** Recommend only the overall p50/p95 (not every pipeline step) on this
   first page, to keep the UI short; `HealthMetrics.stepLatencyMs` has the rest if a later task
   wants a breakdown (e.g. 7.7a's own "health report surface" follow-up, still `todo`).

## Risks and lessons applied
- *A check that silently skips looks like a pass* (`docs/lessons.md`): the `capped` flag exists
  specifically so a 200-turn cap is never shown to a teacher as "your whole week" — Phase A's
  tests assert `capped` flips at exactly `TEACHER_TRACES_MAX_LIMIT`, and Phase B's page test
  asserts the notice actually renders when it's true.
- *Red CI from changes that passed locally* (`docs/lessons.md`): both phases run
  `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` (and `--filter=@edmate/db
  --filter=@edmate/harness` for Phase A's imports) before handoff; no snapshot files are touched.
- English only, US first (standing rules): every new string is English, no locale branching; the
  7-day window and timestamps use the server's own clock, no locale-pack timezone lookup (that
  belongs to 11.3's "Monday 07:00 in the locale pack's timezone" requirement, not this page).

## Tests first
- Phase A: `insights.test.ts` written and red before `insights.ts` exists (fakes only, no db).
- Phase B: `page.test.tsx` written and red before `page.tsx` exists; `view.test.tsx`'s new case
  written and red before `view.tsx`'s nav entry is added.

## Budget
Budget: 220 tool calls (2 phases, apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for apps/web and, for Phase A's
imports, @edmate/db and @edmate/harness; secret scan only — no migrations, no new db/model/payment
calls).

## Exit conditions
- Phase A: `Status: DONE` once `insights.ts` + `insights.test.ts` are green under
  `--filter=@edmate/web` and the "no studentId anywhere in the result" test passes; state-after
  note says which fixture shape Phase B's page test should reuse. `Status: PARTIAL` past ~110 tool
  calls, or if `computeHealthMetrics`'s exported shape has changed since this plan was written.
- Phase B: `Status: DONE` once the page renders both sections and both empty states, the nav link
  and its test are in, and `apps/web`'s typecheck/lint/test are green including
  `route-coverage.test.ts` (unaffected, since no new `app/api/**` route is added) and
  `view.test.tsx`. `Status: PARTIAL` past ~110 tool calls, or if 8.3c/8.4b have not yet landed and
  a real (not mechanical) conflict appears in `view.tsx` or `en.json` — hand back rather than
  resolving someone else's in-flight hunk by hand.
