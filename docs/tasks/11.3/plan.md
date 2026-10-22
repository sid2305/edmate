# 11.3 — Weekly insights worker

## Acceptance (verbatim)
"generated Monday 07:00 in the locale pack's timezone; no student identifiable."
Title: "Weekly insights worker: top questions, sticking topics, unhelpful answers, open teacher
questions; aggregated with a minimum group size of 5."
Shown as: a row in the existing `insights` table (`teacher_id, week, payload jsonb`, migration
0001 — already created, unused until now) per teacher per ISO week. No UI in this task; a passing
`insights.int.test.ts` plus the worker's own run-summary log line are the evidence.

## MVP scope (US-first, English-only)
One BullMQ scheduler, one cron (Monday 07:00 in the US pack's `timezone`, `America/New_York` —
India is parked per the 21 Oct standing rule, so one schedule is enough). Each run: for every
teacher with usage in the past 7 days (`usageLedger.teacherIdsWithUsageSince`, already built for
the cost alarm — reused as-is, no new "list teachers" method), compute and upsert one `insights`
row with `payload`:
- `topQuestions`: `teacherQuestions` opened in the last 7 days (any status), grouped by the
  existing `groupId`/own-id grouping teacher-questions.ts already writes at `open()` time; groups
  with fewer than 5 questions are dropped; top 5 by count.
- `stickingTopics`: topics where `evidenceEvents.correct = false` in the last 7 days, grouped by
  `topicId`, kept only when `count(distinct student_id) >= 5`; top 5 by struggling-student count.
- `unhelpfulAnswers`: a single teacher-wide count of turns in the last 7 days whose `turnTraces.move
  = 'ask_teacher'` or whose `guards` array holds a `grounding` entry with `ok: false` (the best
  existing signal — there is no thumbs-down/rating feature yet); `null` when the count is below 5,
  never a smaller real number.
- `openTeacherQuestions`: currently-open question groups (teacher hasn't answered), same grouping,
  same >= 5 floor, top 5.
None of the four reads ever selects a student id (same discipline as `teacherQuestions.listForTeacher`
and `turnTraces.listForTeacherSince`); the floor is enforced in the repository's own queries (SQL
`HAVING count(distinct student_id) >= 5` for sticking topics; an in-memory count filter for the two
question groupings, the same place `teacherQuestions.listGroupsForTeacher` already does its own
grouping — not in any caller), and every floor has its own test (4 vs. 5 students/questions).

## Phase A — packages/db: the `insights` repository (risky path)
Files:
- `packages/db/src/repositories/insights.ts` (new) — `insightsRepo(db)`: `weeklyTopQuestions`,
  `openQuestionGroups`, `stickingTopics`, `unhelpfulAnswerCount` (all `TeacherScope`, `since`-scoped
  reads) and `saveWeek(scope, weekStart, payload)` (upsert on the existing
  `insights_teacher_id_week_key` unique index) plus `getWeek`. Payload is validated with a local
  zod schema in this file only — **no `packages/contracts` change** (no UI consumes it yet, so no
  ADR; if a later task adds a studio page for it, that task decides whether to promote the shape).
- `packages/db/src/repositories/index.ts` — append `insights: guardAll('insights', insightsRepo(db))`
  and its barrel type exports (same append-only pattern every repo task uses).
- `packages/db/test/insights.int.test.ts` (new) — floor tests (4 vs 5), upsert-replaces-same-week,
  cross-teacher isolation, no student id in any payload field.
- `packages/db/test/repositories.int.test.ts` — add the new methods' cases to the `CASES` grid
  (required: `tsc` fails without one per the file's own comment).

No migration, no `schema/**` edit: `insights` (and `liveClasses`/`classQuestions` for 11.1/11.2)
were already created in migration 0001 and are unused until this task.

**Risky path:** `packages/db/src/repositories/**` → reviewers: security-reviewer (per
`risk-paths.txt`'s access/isolation group). Handoff logs `risk: high`.

**Shared files, other builders active now:** `packages/db/src/repositories/index.ts` and
`packages/db/test/repositories.int.test.ts` are append-only per method and touched by nearly every
db task — 9.6c and 11.1a are both in `packages/db` right now and may also append to these two
files; expect a textual (not logical) merge conflict at merge time, not a design conflict. No
`packages/db/src/schema/**` or `packages/db/migrations/**` file is touched, so there is no overlap
with any schema/migration-number work 9.6c or 11.1a might be doing.

Budget: 70 tool calls (Phase A, packages/db)
Allowed tools: Read, Grep, Glob, Edit, Write, Bash (migrate/test/typecheck/lint only)
Exit conditions: DONE when `insights.int.test.ts` and the updated isolation grid are green and
`turbo run typecheck lint test --filter=@edmate/db` is green; PARTIAL past ~70 calls or if a floor
can't be expressed as a query-level filter without touching `teacher-questions.ts`'s exported
grouping helper (ask the lead rather than editing that file).

## Phase B — apps/worker: the weekly job
Files:
- `apps/worker/src/insights/weeklyInsights.ts` (new) — pure: one teacher's week, calling the four
  `insightsRepo` reads and `saveWeek`; narrow `InsightsBackend` interface (ports), same shape as
  `apps/web/src/studio/insights.ts`'s `InsightsBackend`.
- `apps/worker/src/insights/schedule.ts` (new) — mirrors `apps/worker/src/alarms/schedule.ts`:
  `scheduleWeeklyInsights` (one `upsertJobScheduler`, cron `0 7 * * 1`, `tz` read from the US locale
  pack via `@edmate/content`'s `loadLocalePacks()`, not hardcoded), `weeklyInsightsJob` (loops
  `usageLedger.teacherIdsWithUsageSince`, per-teacher try/catch logging like `costAlarmJob`),
  `createWeeklyInsightsWorker`.
- `apps/worker/src/insights/logSink.ts`, `index.ts` (barrel) — same shape as `alarms/logSink.ts`
  and `alarms/index.ts`.
- `apps/worker/src/index.ts` — wire the new scheduler/worker alongside the cost alarm's.
- Tests: `weeklyInsights.test.ts`, `schedule.test.ts`, `logSink.test.ts` (unit, fakes only — no
  real db, no real model/payment calls, per rule 4).

**Risky path:** none (`apps/worker/src/insights/**` is not in `risk-paths.txt`; only
`apps/worker/src/alerts/**` is listed). Standard reviewers: code-reviewer, typescript-reviewer.

**Shared files:** `apps/worker/src/index.ts` (small additive wiring edit — check whether another
running builder touched it since Phase A started before editing). No `apps/web/messages/en.json`
touch (no UI).

Budget: 55 tool calls (Phase B, apps/worker)
Allowed tools: Read, Grep, Glob, Edit, Write, Bash (test/typecheck/lint only)
Exit conditions: DONE when the three new test files and
`turbo run typecheck lint test --filter=@edmate/worker` are green and the scheduler is wired in
`index.ts`; PARTIAL past ~55 calls.

## Budget
Budget: 125 tool calls (2 phases: Phase A packages/db, Phase B apps/worker)

## Decisions (to log at merge, not blockers)
- Payload stays a local zod shape in `@edmate/db`; no `packages/contracts`/ADR change this task.
- Min-group-size (5) is enforced inside the repository's own read methods (SQL `HAVING` for topics,
  an in-memory count filter for question grouping, matching `listGroupsForTeacher`'s existing
  precedent), not in a caller.
- "Unhelpful answers" = `move = 'ask_teacher'` or a failed `grounding` guard entry on the trace;
  there is no rating/thumbs-down feature yet, so this is the best existing signal, noted for a
  future task if a real rating lands.
- One schedule, US pack timezone only (US-first standing rule); multi-market scheduling is deferred
  until an India pack reactivates.
- `apps/web/src/studio/insights.ts` (8.8, done) is untouched; its own comment already defers the
  min-group-size floor to 11.3, but only for this new weekly-worker path, not retrofitted onto the
  live studio page — a tiny separate follow-up if wanted later.

## Open questions
None blocking.

## Status: READY

## Lead answers (22 Oct 2026)
- The minimum group size counts **distinct students**, never rows. A question group, an open-question group, a sticking topic and the unhelpful-answer count each need `count(distinct student_id) >= 5` (a group of 5 questions from 2 students is dropped). Tests cover 4 vs 5 distinct students, and many rows from fewer than 5 students.
- The 8.8 studio page stays as it is in this task (teachers see their own questions by design); not a follow-up for now.
