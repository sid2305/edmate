# 11.3a handoff: weekly insights repository (11.3 Phase A)

Status: DONE
Branch: m11/11.3a-insights-repo (built on local `work-113a`)
Worktree: .claude/worktrees/agent-a64239553d86c5192

## Summary
New `insightsRepo(db)` in `@edmate/db`, wired as `repos.insights`:
- `weeklyTopQuestions(scope, since)`: question groups opened since `since` (any status).
- `openQuestionGroups(scope)`: question groups still open, any age.
- `stickingTopics(scope, since)`: topics students got wrong (`evidence_events.correct = false`, by `ts`).
- `unhelpfulAnswerCount(scope, since)`: turns with move `ask_teacher` or a failed `grounding` guard entry; `null` under the floor.
- `saveWeek(scope, weekStart, payload)`: upsert on `insights_teacher_id_week_key`. `getWeek(scope, weekStart)`: the stored row or `null`. A stored payload that doesn't parse throws `integrity`.

Privacy floor: every aggregate needs at least 5 **distinct students** (`INSIGHTS_MIN_STUDENTS`). The repository enforces it in SQL (`having count(distinct student_id) >= 5`), and each list is capped at the top 5 (`INSIGHTS_TOP_N`). `student_id` appears only inside `count(distinct …)`: no read selects or returns it. `saveWeek`'s strict zod schema (`WeeklyInsightsPayloadSchema`, local to @edmate/db) refuses a group, topic or count under the floor, any extra field, more than 5 entries, or a week that is not a Monday date.

Payload shape: `{ topQuestions: Group[], stickingTopics: Topic[], unhelpfulAnswers: number | null, openTeacherQuestions: Group[] }`. Group is `{ groupId, students, questions, oldestAt, sample }`, where `sample` is the group's oldest question text cut to 280 characters. Topic is `{ topicId, title, students, misses }`.

## Files
- `packages/db/src/repositories/insights.ts` (new)
- `packages/db/src/repositories/index.ts`: appended the `insights` repo and its barrel exports
- `packages/db/test/insights.int.test.ts` (new, 21 tests)
- `packages/db/test/repositories.int.test.ts`: 6 `CASES` entries, plus fixtures past the floor for teachers A (5 students) and B (6 students, more unhelpful turns so the two counts differ)

No migration, no schema edit, `teacher-questions.ts` untouched, no `packages/contracts` change.

## Tests
- `TEST_DATABASE_URL=… corepack pnpm vitest run test/insights.int.test.ts` → `Tests 21 passed (21)`. Covers 4 vs 5 distinct students for each of the four aggregates; many rows from fewer than 5 students dropped (questions, open questions, topics, unhelpful turns); window and status filters; top-5 ordering; cross-teacher isolation, including a fifth student who only asked teacher B, so A still has 4; no `stu_`/`studentId` in any payload or saved row; upsert replaces the same week; invalid payload, week and scope; `integrity` on a corrupt stored payload; `not_found` for an unknown teacher.
- `vitest run test/repositories.int.test.ts` → `Tests 133 passed (133)`; 108 methods, including `insights.*` at `cases=22 leaks=0` for each read.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` (own Postgres on port 55413) → `Tasks: 26 successful, 26 total`; db `Test Files 63 passed (63)`; `insights.ts | 100 | 100 | 100 | 100`.
- `python3 .githooks/secret-scan.py --all` → clean.

## Deviations
- The floor is enforced in SQL `HAVING count(distinct student_id)` for the two question groupings too, not with the plan's in-memory count filter. The lead's answer requires distinct students, and the brief says no read may select a student id; an in-memory count would have to select it.

## Decisions
### 22 Oct 2026 · 11.3a The insights privacy floor counts distinct students, in the repository's own SQL · decided by builder · risk: high
- Decided: every insights aggregate (question groups, open-question groups, sticking topics, the unhelpful-answer count) needs `count(distinct student_id) >= 5`, enforced with SQL `HAVING` inside `insightsRepo`. Below the floor, a group or topic is dropped and the count is `null`. No read selects or returns `student_id`. `saveWeek`'s schema also refuses anything under the floor. Risky path `packages/db/src/repositories/**`: reviewer security-reviewer.
- Why: the lead's answer (22 Oct 2026) says the floor counts students, never rows; acceptance says "no student identifiable". Doing it in SQL keeps student ids out of process memory and out of every caller.
- risk: high

### 22 Oct 2026 · 11.3a The insights payload stays a local zod schema in @edmate/db · decided by builder · risk: low
- Decided: `WeeklyInsightsPayloadSchema` lives in `insights.ts`, with no `packages/contracts` change and no ADR.
- Why: plan decision 1. No UI reads it yet; a later studio task decides whether to promote it.
- risk: low

### 22 Oct 2026 · 11.3a "Unhelpful answers" = ask_teacher move or failed grounding guard · decided by builder · risk: low
- Decided: count turns since `since` whose move is `ask_teacher`, or whose `guards` hold `{name: 'grounding', ok: false}`; teacher ownership comes through the session join.
- Why: plan decision 3. There is no rating feature yet.
- risk: low

### 22 Oct 2026 · 11.3a A question group carries one sample text, cut to 280 characters · decided by builder · risk: medium
- Decided: each group shows its oldest question's text (`left(…, 280)`) as `sample`, so the teacher knows what was asked. No student id or name is attached.
- Why: a top-questions list needs a question to show. The teacher already sees these texts in the 8.8 inbox (by design, lead answer), and the group passes the 5-student floor. A student could still type identifying words into a question; the security reviewer may prefer dropping `sample`.
- risk: medium

### 22 Oct 2026 · 11.3a Weeks are stored by their Monday date; openQuestionGroups has no time window · decided by builder · risk: low
- Decided: `saveWeek`/`getWeek` take the ISO week's Monday as `YYYY-MM-DD` and refuse any other day. `openQuestionGroups` counts open questions of any age.
- Why: the `insights.week` column comment says "Monday of the ISO week". "Currently open" means not yet answered, whatever its age.
- risk: low

## Left to do (Phase B, apps/worker)
- `weeklyInsights.ts`: compute `since = run time − 7 days` and `weekStart` (the Monday of the run's week in the US pack's timezone), call the four reads plus `saveWeek` on `repos.insights`, and use `WeeklyInsightsPayload`/`InsightQuestionGroup`/`StickingTopic` from `@edmate/db`.
- Scheduler, logSink and wiring as in the plan's Phase B. Every value the reads return already passes `saveWeek`'s schema, so the worker should save them as they are.

Tool calls used: 37
