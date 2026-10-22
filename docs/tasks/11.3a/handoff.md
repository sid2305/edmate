# 11.3a handoff: weekly insights repository (11.3 Phase A)

Status: DONE
Branch: m11/11.3a-insights-repo (built on local `work-113a`)
Worktree: .claude/worktrees/agent-a64239553d86c5192

## Summary
New `insightsRepo(db)` in `@edmate/db`, wired as `repos.insights`:
- `weeklyTopQuestions(scope, weekStart)`: question groups opened in the week (any status).
- `openQuestionGroups(scope)`: question groups still open, any age (no window).
- `stickingTopics(scope, weekStart)`: topics students got wrong (`evidence_events.correct = false`, by `ts`).
- `unhelpfulAnswerCount(scope, weekStart)`: turns with move `ask_teacher` or a failed `grounding` guard entry; `null` under the floor.
- `computeAndSaveWeek(scope, weekStart)`: runs the four reads and upserts the payload on `insights_teacher_id_week_key`. The only write; `saveWeek` is internal (not on the repo object), so no caller can store a forged payload.
- `getWeek(scope, weekStart)`: the stored row or `null`. A stored payload that doesn't parse throws `integrity`.

`weekStart` is a Monday `YYYY-MM-DD` (anything else is `invalid`). The windowed reads use the fixed window [weekStart 00:00 UTC, +7 days), both bounds in SQL (`>= start AND < end`), so a caller can't pick nested or open-ended windows.

Privacy floor: every aggregate needs at least 5 **distinct students** (`INSIGHTS_MIN_STUDENTS`), enforced in SQL (`having count(distinct student_id) >= 5`); each list is capped at the top 5 (`INSIGHTS_TOP_N`). The teacher's own 8.5 preview rows (student id = teacher id) are excluded from every read (`student_id <> teacher_id`; `sessions.student_id <> sessions.teacher_id` for unhelpful turns). `student_id` appears only inside `count(distinct …)` and that filter: no read selects or returns it. The strict zod schema (`WeeklyInsightsPayloadSchema`, local to @edmate/db) checks the computed payload before it is stored.

Payload shape: `{ topQuestions: Group[], stickingTopics: Topic[], unhelpfulAnswers: number | null, openTeacherQuestions: Group[] }`. Group is `{ groupId, students, questions }` (no question text, no timestamp). Topic is `{ topicId, title, students, misses }`.

## Files
- `packages/db/src/repositories/insights.ts` (new)
- `packages/db/src/repositories/index.ts`: appended the `insights` repo and its barrel exports (additions only)
- `packages/db/test/insights.int.test.ts` (new, 27 tests)
- `packages/db/test/repositories.int.test.ts`: 6 `CASES` entries, plus fixtures past the floor inside week 2026-10-05 for teachers A (5 students) and B (6 students, more unhelpful turns so the two counts differ). Additions only; the earlier unrelated Prettier reformatting is reverted.

No migration, no schema edit, `teacher-questions.ts` untouched, no `packages/contracts` change.

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --continue` (own Postgres on port 55471) → `Tasks: 26 successful, 26 total`; db `Test Files 63 passed (63)`; `insights.ts | 100 | 100 | 100 | 100`; grid: each `insights.*` read `cases=22 leaks=0`, `insights.computeAndSaveWeek teacher write cases=4 leaks=0`. (A first run hit an unrelated 2000 ms timeout in `@edmate/harness` runner.test.ts under load; it passed on re-run.)
- insights.int.test.ts covers: 4 vs 5 distinct students for each read; many rows from fewer than 5 students dropped; for each of the four reads, 4 real students plus a teacher preview row → dropped / `null` (and preview turns don't add to the count); a row at weekStart − 1 ms and a row at weekStart + 7 days both excluded; top-5 ordering; cross-teacher isolation; `computeAndSaveWeek` stores exactly the reads' output, leaves next week's rows out, and the saved text has no `stu_`, student id, question text, `sample` or `oldestAt`; re-run replaces the week; the repo object has no payload-taking write; schema refuses under-floor, extra fields (`studentId`, `sample`, `oldestAt`) and over top-N; non-Monday week `invalid` on every windowed method; `integrity`; `not_found`; bad scope.
- `python3 .githooks/secret-scan.py --all` → clean.

## Deviations
- The floor is enforced in SQL `HAVING count(distinct student_id)` for the two question groupings too, not with the plan's in-memory count filter. The lead's answer requires distinct students, and the brief says no read may select a student id; an in-memory count would have to select it.

## Decisions
### 22 Oct 2026 · 11.3a The insights privacy floor counts distinct students, in the repository's own SQL · decided by builder · risk: high
- Decided: every insights aggregate (question groups, open-question groups, sticking topics, the unhelpful-answer count) needs `count(distinct student_id) >= 5`, enforced with SQL `HAVING` inside `insightsRepo`. Below the floor, a group or topic is dropped and the count is `null`. No read selects or returns `student_id`. The payload schema also refuses anything under the floor before it is stored. Risky path `packages/db/src/repositories/**`: reviewer security-reviewer.
- Why: the lead's answer (22 Oct 2026) says the floor counts students, never rows; acceptance says "no student identifiable". Doing it in SQL keeps student ids out of process memory and out of every caller.
- risk: high

### 22 Oct 2026 · 11.3a The insights payload stays a local zod schema in @edmate/db · decided by builder · risk: low
- Decided: `WeeklyInsightsPayloadSchema` lives in `insights.ts`, with no `packages/contracts` change and no ADR.
- Why: plan decision 1. No UI reads it yet; a later studio task decides whether to promote it.
- risk: low

### 22 Oct 2026 · 11.3a "Unhelpful answers" = ask_teacher move or failed grounding guard · decided by builder · risk: low
- Decided: count turns in the week whose move is `ask_teacher`, or whose `guards` hold `{name: 'grounding', ok: false}`; teacher ownership comes through the session join.
- Why: plan decision 3. There is no rating feature yet.
- risk: low

### 22 Oct 2026 · 11.3a Weeks are stored by their Monday date; openQuestionGroups has no time window · decided by builder · risk: low
- Decided: `computeAndSaveWeek`/`getWeek` and the windowed reads take the ISO week's Monday as `YYYY-MM-DD` and refuse any other day. `openQuestionGroups` counts open questions of any age.
- Why: the `insights.week` column comment says "Monday of the ISO week". "Currently open" means not yet answered, whatever its age.
- risk: low

### 22 Oct 2026 · 11.3a Teacher preview rows never count toward insights · decided by lead · risk: high
- Decided: every insights read excludes the teacher's own 8.5 test-chat rows (`student_id <> teacher_id` for question groups, open question groups and sticking topics; `sessions.student_id <> sessions.teacher_id` for the unhelpful-answer count). Each read has a test with 4 real students plus a preview row: the group is dropped or the count is `null`. Risky path `packages/db/src/repositories/**`: reviewer security-reviewer.
- Why: security review HIGH. Preview turns run with studentId = teacherId, so the teacher could be the fifth "student" and a group of 4 real students would pass the floor.
- risk: high

### 22 Oct 2026 · 11.3a Question groups carry only ids and counts: no sample text, no oldestAt · decided by lead · risk: high
- Decided: `sample` (one student's verbatim question) and `oldestAt` (one question's exact time) are dropped from the reads and the payload schema; a group is `{ groupId, students, questions }`. A later studio view resolves `groupId` to live text through `teacherQuestions.listGroupsForTeacher`, so erasure and answer state still apply. This also clears the `left()` vs zod length mismatch and the `array_agg` cost.
- Why: security review MEDIUM. A sample is one student's free text that can carry a name or contact detail and would outlive the student's erasure inside `insights.payload`; `oldestAt` is a per-student timestamp.
- risk: high

### 22 Oct 2026 · 11.3a Insights read a fixed week, and only computeAndSaveWeek writes · decided by lead · risk: high
- Decided: the reads take `weekStart` (a Monday, validated like the stored week) instead of a caller-chosen `since`; the repo derives [weekStart 00:00 UTC, +7 days) with both bounds in SQL. A new `computeAndSaveWeek(scope, weekStart)` runs the four reads, builds the payload and upserts it. `saveWeek` is internal and not on the repo object (the isolation grid tests `computeAndSaveWeek` instead), so no caller can store a forged payload. The file header now states exactly what the floor and window guarantee.
- Why: security review MEDIUM. With a caller-chosen open-ended window, two nested windows could be differenced down to one student; a delayed run would also count rows from after its week.
- risk: high

### 22 Oct 2026 · 11.3a Open question groups stay cumulative · decided by lead · risk: low
- Decided: `openQuestionGroups` keeps no time window ("currently open"), so its `students` count is cumulative; comparing two weeks can show that one new student asked a group. Accepted, not banded.
- Why: security review LOW. The teacher already sees each question in the 8.8 inbox, so the comparison reveals nothing new.
- risk: low

## Left to do (Phase B, apps/worker)
- `weeklyInsights.ts`: compute `weekStart` (the Monday of the week being reported, `YYYY-MM-DD`) and call only `repos.insights.computeAndSaveWeek(scope, weekStart)` for each teacher. Don't call the reads or build a payload in the worker; there is no public `saveWeek`.
- Scheduler, logSink and wiring as in the plan's Phase B.

Tool calls used: 101 (harness count: 56 build + 45 fix; the builders reported 37 + 30)
