# Task 11.2: Pre-class question queue grouped by topic, fed by students and by unanswered ask-the-teacher questions

Board: milestone M11 · deps `11.1` (11.1a/b done, 11.1c running), `5.10` (done), `8.1` (done),
`9.1` (done), `M6`. **Risky** (`packages/db/src/repositories/**`, `apps/web/src/auth/policy.ts`).
Two phases, one branch (`m11/11.2-preclass-queue`), one PR; each phase a fresh builder.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Pre-class question queue grouped by topic, fed by students and by unanswered
ask-the-teacher questions."
Accept: "the teacher sees questions grouped by topic."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Fed by students | A student entitled to an upcoming live class submits a question (`POST /api/live-classes/:id/questions`); it lands in `class_questions`, tied to that class. Another student's class, a class that isn't theirs, or a class that has already started is refused (`not_found`), nothing written. `packages/db/test/class-questions.int.test.ts`. |
| Fed by unanswered ask-the-teacher questions | The teacher's open `teacher_questions` groups (`teacherQuestions.listGroupsForTeacher`, unchanged, from 5.10) appear in the same queue. `packages/db/test/repositories.int.test.ts` (CASES, already covers this method; no new case needed for correctness, only for call-through). |
| Grouped by topic | Both feeds are shown as clusters of similarly worded questions: the existing lexical `group_id` clustering for `teacher_questions` (5.10), and a new, equivalent in-memory clustering for the student feed (`clusterQuestions`, extending `question-similarity.ts`). `packages/db/test/question-similarity.test.ts` (new cases) and `class-questions.int.test.ts` (`listQueueForTeacher` groups similar questions, separates dissimilar ones, never returns a student id — the table has none). |
| Teacher sees it | `apps/web/app/teacher/live-classes/page.tsx` loads both feeds server-side and `LiveClassesView.tsx` renders two sections, "From students" and "Unanswered ask-the-teacher questions," each as topic clusters. `apps/web/app/teacher/live-classes/LiveClassesView.test.tsx`. |
| No contracts change | `git diff origin/main -- packages/contracts docs/adr` is empty. |

## Spec it must honour

- Build plan § 11.2 (one line; no longer spec section exists for M11 beyond the board text).
  PRD T9/S9 ("collect questions in advance" / "send questions in advance") — 11.1's plan already
  carved question collection out of its own scope and left it to this task.
- 5.10's grouping convention: lexical (Jaccard ≥ `QUESTION_GROUP_MIN`, ≥ 2 shared terms over
  `queryTerms`), reused rather than re-invented (Q1 below).
- `packages/db/src/repositories/README.md` rules 1–10: scope first and validated before SQL,
  ownership checked in the same statement, no existence oracle, no student id in a teacher-scoped
  read, errors scrubbed.
- Rule 3: the harness is untouched by this task (pure db + web work).
- MVP first / English-only pilot / US first: no locale branching, no email, in-app only (matches
  11.1's own "in-app, pull-based" decision).

## Contracts: no change, no ADR

`class_questions` and `live_classes` are already in `packages/db/src/schema/operations.ts`
(migration `0001_data_model.sql`) with every column this task needs. New shapes
(`TopicQuestionGroup`, `ClassQuestionInput`) stay local to `@edmate/db`, the same pattern as
`TeacherQuestionGroup` (5.10) and `LiveClassRow` (11.1a). `TeacherQuestion`/`TeacherQuestionGroup`
are used exactly as 5.10 built them.

## Design

1. **"Topic" = the existing lexical cluster, not the curriculum `topics` table (Q1).** Neither
   `class_questions` nor `teacher_questions` carries a `topic_id`. 5.10, 8.9 and 11.3a already call
   a lexically-similar cluster of open questions a "group"/implicitly a topic; this task keeps that
   convention rather than introducing a dependency on `topics`.
2. **`clusterQuestions` (pure, `packages/db/src/repositories/question-similarity.ts`).** Extends
   the file 5.10 wrote: a greedy clusterer over a flat list (`{ id, text, createdAt }[]`) using the
   same `questionSimilarity` + shared-term floor as `bestGroup`, returning
   `{ groupId: string, ids: string[] }[]` (biggest first, ties to the oldest member). `bestGroup`
   itself is unchanged (5.10's transactional grouping still works exactly as before); this is a new
   sibling export, not a rewrite.
3. **`class-questions.ts` (new repository).**
   - `submit(scope: StudentScope, { liveClassId, text })`: validates `text` (non-empty, ≤
     `LIMITS.turnTextMaxLength`, same cap 5.10 used for the teacher's answer). Checks the class
     belongs to a package the student holds a **live** (`trial`/`active`) subscription to, and that
     `startsAt > now` — the same entitlement/window 11.1a's `listUpcomingForStudent` already checks
     — else `not_found`, nothing written. Writes one `class_questions` row. Returns `{ id }`.
   - `listQueueForTeacher(scope: TeacherScope, { limit ≤ 100 })`: reads the teacher's own classes'
     pending (`startsAt > now`) `class_questions` (join on `live_classes.teacher_id = scope`, newest
     200 scanned, same `GROUPING_SCAN_MAX`-style cap 5.10 used), clusters them with
     `clusterQuestions`, returns `TopicQuestionGroup[] = { groupId, count, oldestAt, sample,
     liveClassIds: string[] }[]` (biggest first, then oldest) — `liveClassIds` because one cluster
     can span more than one class. The table has no student id to leak.
   - Follows README rule set exactly like `live-classes.ts` (11.1a): scope validated before any
     SQL, ownership checked in the same statement, no existence oracle.
4. **Teacher page (apps/web), no new API route.** `apps/web/app/teacher/live-classes/page.tsx`
   (11.1b, done) additionally loads `repos.classQuestions.listQueueForTeacher(scope)` and
   `repos.teacherQuestions.listGroupsForTeacher(scope, { limit: 5 })` server-side (same
   direct-repos-read pattern as 8.8's insights page), passed as new props to `LiveClassesView`,
   which renders two new read-only sections underneath the existing schedule form and list. No
   change to `/api/studio/live-classes/route.ts` — this is a server-component read, not a fetch.
5. **Student submission (apps/web), one new route.** `apps/web/app/api/live-classes/[id]/questions
   /route.ts`, `POST` only, `access: ['student']`, `clearance: 'agent'` (same clearance as
   `/api/sessions`). New `apps/web/src/auth/policy.ts` row: `{ pattern:
   '/api/live-classes/*/questions', methods: ['POST'], access: ['student'], clearance: 'agent' }`
   — **this is a risky-path edit** (see below). A small "Ask a question" input is added to the
   existing "Upcoming live classes" block on `/home` (11.1c), one per listed class, following the
   lesson in `docs/lessons.md` ("UI state and server replies: trust neither, reset everything"):
   try/catch the body read, try/catch/finally around the busy flag, no stuck button on a bad reply.

## Phase A: packages/db — `class-questions.ts`, clustering, wiring

Budget: ~90 tool calls.

- **Create:** `src/repositories/class-questions.ts`; `test/class-questions.int.test.ts`.
- **Modify:**
  - `src/repositories/question-similarity.ts` (`clusterQuestions`), `test/question-similarity
    .test.ts` (new cases: a loose cluster of 3 similar questions across two classes groups
    together; two unrelated questions stay separate; empty input returns `[]`).
  - `src/repositories/index.ts` (one import, one `classQuestions: guardAll('classQuestions',
    classQuestionsRepo(db))` line, append only).
  - `src/repositories/README.md` (a short "Pre-class question queue (task 11.2)" section,
    following the file's existing style).
  - `test/repositories.int.test.ts` (CASES entries for `classQuestions.submit` and
    `classQuestions.listQueueForTeacher` — **shared file**, pull `main` first), `test/scope.test.ts`
    (bad-scope sweep for both new methods).
- **Tests first:**
  - `submit`: happy path writes one row; a student with no live subscription to the class's
    packages, a `paused`/`past_due`/`ended` subscription, another student's unrelated class, and a
    class whose `startsAt` has already passed each give `not_found` with nothing written.
  - `listQueueForTeacher`: another teacher's classes never appear; similar questions (honestly
    similar wording, reusing the 5.10 test fixtures' shape) cluster into one group spanning two of
    that teacher's classes; dissimilar questions stay in separate groups; the result's keys never
    include `studentId`/`student_id` (explicit key sweep, same pattern as 5.10's `listGroupsForTeacher`
    test).
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --force
  --concurrency=1` with Postgres up; `python3 .githooks/secret-scan.py --all`.
- **State after:** both repository methods exist and are proven over Postgres. No web change yet.
  Green commit.

## Phase B: apps/web — teacher view, student submission, policy row

Budget: ~90 tool calls. Depends on Phase A merged, **and on 11.1c merging first** (see "Shared
files" below) — if 11.1c is still running when this phase starts, the builder waits, or builds the
teacher-side half (page/view) only and hands back `PARTIAL` with the student-submission half noted
as blocked on 11.1c, rather than hand-resolving a conflict in `home/page.tsx`/`view.tsx`.

- **Create:**
  - `apps/web/app/api/live-classes/[id]/questions/route.ts`, `route.test.ts` (rejects a
    non-entitled student, a malformed body, and an id that isn't the caller's upcoming class; a
    200 on the happy path).
- **Modify:**
  - `apps/web/src/auth/policy.ts` (one new `PolicyRow`) — **risky path**; its route-coverage test
    (`apps/web/src/auth/route-coverage.test.ts`) must still pass, and any existing policy unit test
    gets one new case for the row.
  - `apps/web/app/teacher/live-classes/page.tsx` (load the two queue reads), `LiveClassesView.tsx`
    (two new sections), `LiveClassesView.test.tsx` (cases for both, plus an empty-state case for
    each).
  - `apps/web/app/home/page.tsx`, `apps/web/app/home/view.tsx` (add the per-class "ask a question"
    form to the existing live-classes block), their `*.test.tsx` (new cases only; 11.1c's existing
    cases must stay green, unchanged).
  - `apps/web/messages/en.json` (**shared file**): new keys inside the existing `liveClassesStudio`
    namespace (teacher queue section) and inside `home.liveClasses` (the student form) — pure
    additions, nothing reworded or reordered.
- **Tests first:** as listed above, plus the lesson-driven cases (a malformed 200 body never leaves
  the submit button stuck; a non-200 re-enables the form and shows an error).
- **Gate:** `corepack pnpm turbo run typecheck lint test --filter=apps-web...` green;
  `route-coverage.test.ts` green; `git diff --stat` for this phase touches no file under
  `apps/web/src/auth/**` other than the one new `policy.ts` row.
- **State after:** acceptance met — the teacher's `/teacher/live-classes` page shows both feeds,
  grouped by topic; a student can feed the queue from `/home`.

## Files out of bounds

- `packages/harness/**`, `packages/contracts/**`, `docs/adr/**`.
- `packages/db/src/repositories/teacher-questions.ts`'s `bestGroup`/`open` transactional grouping
  (5.10) — used as-is, not modified.
- `apps/web/app/teacher/view.tsx` (no nav change; `/teacher/live-classes` is already reachable by
  direct URL per 11.1b's own precedent).
- 11.3's weekly aggregation (`insights.ts`, `openQuestionGroups`) — not touched; this task is a
  live, on-demand queue, not a stored weekly payload.
- Dismissing a question, editing/cancelling a live class (11.1d), email/push notification of a new
  student question to the teacher.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/**` (Phase A: `class-questions.ts`, `question-similarity.ts`,
  `index.ts`, `README.md`) — group "access filter / money / isolation," reviewers:
  **security-reviewer**. Precedent (5.10, 11.1a) also adds **database-reviewer**,
  **code-reviewer**, **typescript-reviewer**.
- `apps/web/src/auth/policy.ts` (Phase B: one new `PolicyRow`) — same group, reviewers:
  **security-reviewer** (plus code-reviewer/typescript-reviewer on every PR).
- Checked and not risky: `apps/web/app/teacher/live-classes/**`, `apps/web/app/home/**`,
  `apps/web/app/api/live-classes/**` itself (the route file, as opposed to the policy row),
  `apps/web/messages/en.json`, `packages/db/src/schema/**` (unchanged), `packages/db/test/**`.
  No contracts, ADR, guardrails, pedagogy, content, evals, `.claude`, `.github` or `.githooks` path
  is touched.
- `review.md` names: `Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer`.
- Planned handoff decision (`risk: high`): "11.2 Pre-class question queue: the student feed
  (`class_questions`) is clustered in memory with a new sibling of 5.10's lexical grouping
  (`clusterQuestions`); a new student-write route needs one new `policy.ts` row
  (`/api/live-classes/*/questions`, access student, clearance agent)."

## Shared files with other in-flight tasks

- `apps/web/app/home/page.tsx` and `apps/web/app/home/view.tsx` are **11.1c's own files**, status
  `running` (branch `m11/11.1c-home-live-classes`) at plan time. Phase B must start after 11.1c
  merges; its builder pulls `main` first and re-applies its own additive block if 11.1c lands
  mid-build, same precedent as 8.8's wait on 8.4b/8.3c.
- `apps/web/messages/en.json` and `packages/db/test/repositories.int.test.ts` are both named as
  commonly-shared files; each phase's builder pulls `main` immediately before editing them.

## Open questions (each with a recommendation)

- **Q1. What does "topic" mean when neither table has a `topic_id`?** *Recommend:* the existing
  lexical-similarity cluster (5.10/8.9/11.3a's own convention), not the curriculum `topics` table.
  Keeps this task free of a schema change and consistent with how "group"/"topic" is already used
  elsewhere for the same kind of clustering.
- **Q2. Should the ask-the-teacher feed be filtered to classes' subjects, or shown whole?**
  *Recommend:* show the teacher's whole open-question queue as-is (`listGroupsForTeacher`, limit 5,
  same call 8.8 already makes) — matches the board text literally ("fed by... unanswered
  ask-the-teacher questions") without inventing a relevance filter.
- **Q3. Can a student-fed cluster span more than one of the teacher's classes?** *Recommend:* yes —
  return `liveClassIds: string[]` per cluster rather than forcing one-class-per-group; simpler
  (one query, one clustering pass) and avoids an arbitrary tie-break when a cluster's members come
  from different classes.
- **Q4. The submission window.** *Recommend:* only while `startsAt > now`, mirroring 11.1a's own
  entitlement window for `listUpcomingForStudent` — a question for a class that already happened is
  out of scope for "pre-class."
- **Q5. Build order against 11.1c.** *Recommend:* queue Phase B behind 11.1c's merge (see "Shared
  files"); Phase A has no dependency on it and can start immediately.

## Budget

Budget: 180 tool calls (2 phases: A packages/db ~90, B apps/web ~90)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test for `@edmate/db` and
`apps/web`; secret scan only — no payment or model calls, no new migration expected since both
tables already exist from migration `0001`).

## Exit conditions

- Phase A: `Status: DONE` once `@edmate/db` is green, both new repository methods pass every test
  above, and the "no studentId anywhere in `listQueueForTeacher`'s result" sweep passes. `Status:
  PARTIAL` past ~90 tool calls, or if the schema turns out to need a change (stop and hand back
  rather than writing a migration outside this plan).
- Phase B: `Status: DONE` once the teacher page renders both grouped sections, the student route
  works end to end with the new policy row, `route-coverage.test.ts` and every existing
  `home`/`live-classes` test stay green, and no file outside this phase's list is touched. `Status:
  PARTIAL` past ~90 tool calls, or if 11.1c has not merged and a real conflict (not a mechanical
  re-apply) appears in `home/page.tsx`/`view.tsx` — hand back rather than resolving someone else's
  in-flight hunk by hand.

## Lead answers (22 Oct 2026)
- Phases run as board tasks: Phase A is **11.2a** (packages/db), Phase B is **11.2b** (apps/web). Each phase has its own handoff in `docs/tasks/<phase id>/`.
- Q1–Q4: accepted as recommended (lexical clusters, the ask-the-teacher feed shown whole, a cluster may span classes, submissions only while `startsAt > now`).
- Q5: 11.1c has merged (22 Oct 2026), so 11.2b can start once 11.2a merges.
- Reviewers: security-reviewer, database-reviewer (11.2a), typescript-reviewer and code-reviewer; each phase logs a `risk: high` decision.
