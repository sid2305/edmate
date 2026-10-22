# Task 8.9 plan: Questions inbox — grouped open questions, answer with a module choice, dismiss

`python3 .claude/skills/board/board.py show 8.9`:
- Title: Questions inbox: grouped open questions, answer with a module choice, dismiss
- Accept (verbatim): **an answer reaches every grouped student and becomes a teacher note and eval case.**
- Deps: 1.3, 5.1, 5.2, 5.10, 8.1 (all done/available)

How it will be shown: an integration test (Phase A) proves `teacherQuestions.dismiss` closes one
question without touching its group or writing a note (the group-wide "answer" path is already
proven by 5.10's `teacher-question-answer.int.test.ts`). A route test (Phase B) proves a teacher's
GET lists groups with module choices, POST answer calls `teacherQuestions.answer` with a module id
and the whole group's counts come back, POST dismiss closes one row. A component test (Phase C)
proves the inbox view renders groups, lets the teacher pick a module and submit an answer or
dismiss, and calls the right endpoint with the right payload.

## What already exists (read, don't rebuild)

- `packages/db/src/repositories/teacher-questions.ts` (task 5.10, Phases C/D) already has
  `listGroupsForTeacher(scope, { limit })` (biggest group first, then oldest; never selects
  `student_id`) and `answer(scope, { questionId, moduleId, answer, noteQuestion? })` (answers the
  whole group in one transaction: one teacher note via `insertTeacherNote`, one message + one
  notification per distinct student, counts only returned). **8.9 does not touch either method.**
  This is the whole accept criterion already built and tested; 8.9's own job is the one missing
  write (`dismiss`) and the first web surface onto all three.
- `teacher_question_status` already has `'dismissed'` (`packages/db/src/schema/_shared.ts`), used
  nowhere yet — no migration needed (latest is `0019`).
- `packages/db/src/repositories/outline.ts`'s `outlineRepo().getOutline(scope)` already returns the
  teacher's modules (`id`, `title`) — this is the module picker's data source; read-only import, no
  new repo method.
- The studio API composition pattern to mirror is `apps/web/src/studio/{routes,runtime,index}.ts`
  (task 8.2) and 8.5's `apps/web/src/studio/testChat/**` (its own, separate composition root over
  the same `withRole(['teacher'], …)` + `/api/studio/**` policy row — no `auth/policy.ts` edit
  needed). 8.9 follows 8.5's precedent rather than extending the shared `studio/{routes,runtime}.ts`
  (which 8.3b is editing now), since the questions inbox needs only `teacherQuestions` + `outline`
  (no S3/Redis/queue).
- No `apps/web/app/teacher/questions` or `apps/web/app/api/studio/questions/**` exists yet
  (confirmed by glob) — 8.9 is greenfield on the web side, reachable by direct URL until a nav link
  lands (same precedent as 9.3/8.5).

## Phases

### Phase A — db: `teacherQuestions.dismiss` (packages/db only)

Files to create/modify:
- `packages/db/src/repositories/teacher-questions.ts` — add `dismiss(scope: TeacherScope,
  questionId: string): Promise<void>`: locks and updates **only** the named row (`status = 'open'`
  → `'dismissed'`, `answer`/`answeredAt` left null); another teacher's, a missing, or an
  already-answered/dismissed question is `not_found`; writes nothing else (no note, no group-wide
  effect — see open question 1). Once dismissed the row already drops out of `open`'s and
  `listGroupsForTeacher`'s `status = 'open'` candidate queries, so no other file changes.
- `packages/db/src/repositories/README.md` — one new sentence under "Ask the teacher" documenting
  `dismiss` and why it is single-row, not group-wide.
- `packages/db/test/teacher-question-answer.int.test.ts` — add `dismiss` cases: closes the named
  row only (other group members stay open); another teacher's/missing/already-closed → `not_found`,
  nothing written; still answerable group members are unaffected.
- `packages/db/test/repositories.int.test.ts` — add `teacherQuestions.dismiss` to the exhaustive
  `CASES` table (TS forces this), with a fixed fixture question created once in `beforeAll`,
  following the file's existing `answerTarget`-style convention.

Risky paths touched: `packages/db/src/repositories/**` → **security-reviewer** (risk-paths.txt,
"access filter / money / isolation" group). Plan a `risk: high` decision entry.

Shared files: `packages/db/test/repositories.int.test.ts` is also being edited by **8.5a**
(currently running) — do not build Phase A while 8.5a is still open; its `CASES` additions land on
different lines so a rebase is trivial once one merges.

Budget: 70 tool calls (1 phase, packages/db). Allowed tools: Read, Grep, Glob, Edit, Write, Bash (db
test/typecheck/lint only).

Exit: DONE once the new tests pass and `turbo run typecheck lint test --filter=@edmate/db...` is
green. PARTIAL past ~70 calls or if `dismiss` turns out to need group-wide behaviour after all
(it should not per the open-question recommendation below).

### Phase B — web: questions API (new composition root, apps/web only, no UI)

Reads Phase A's handoff first (exact `dismiss` signature).

Files to create (new directory; does not touch `apps/web/src/studio/{index,routes,runtime,profile,
files}.ts`, `outline.ts` or `apps/web/app/api/studio/{documents,outline,packages}/**`):
- `apps/web/src/studio/questions/routes.ts` — `createQuestionsHandlers(backend)` over an injected
  backend (`teacherQuestions: Pick<Repositories['teacherQuestions'], 'listGroupsForTeacher' |
  'answer' | 'dismiss'>`, `modules: Pick<Repositories['outline'], 'getOutline'>`, `log`): `list`
  (GET, groups + the teacher's modules for the picker, one response), `answer` (POST, body
  `{ questionId, moduleId, answer, noteQuestion? }` → `AnswerResult` counts), `dismiss` (POST, body
  `{ questionId }` → 204). A repository `not_found` is 404, `invalid` is 400, same error-mapping
  shape as `studio/routes.ts`.
- `apps/web/src/studio/questions/runtime.ts` — lazily built backend from `serverDatabase().repos`
  (no S3/Redis/queue needed — the simplest of the composition roots so far).
- `apps/web/src/studio/questions/index.ts` (new barrel) — `questionsHandlers`.
- `apps/web/app/api/studio/questions/route.ts` (new, `GET`)
- `apps/web/app/api/studio/questions/answer/route.ts` (new, `POST`)
- `apps/web/app/api/studio/questions/dismiss/route.ts` (new, `POST`)
- `apps/web/src/studio/questions/routes.test.ts`, `runtime.test.ts` (new; fake-repo tests mirroring
  `studio/routes.test.ts`'s patterns)

No `apps/web/src/auth/policy.ts` edit needed: `/api/studio/**` already covers these routes;
`route-coverage.test.ts` picks them up once wrapped in `withRole(['teacher'], …)`.

Risky paths touched: none (`apps/web/src/studio/questions/**` and
`apps/web/app/api/studio/questions/**` are not in risk-paths.txt).

Budget: 110 tool calls (1 phase, apps/web). Allowed tools: Read, Grep, Glob, Edit, Write, Bash (web
test/typecheck/lint only).

Exit: DONE once `routes.test.ts`/`runtime.test.ts` pass, `route-coverage.test.ts` still passes, and
the web package's typecheck/lint/test is green. PARTIAL past ~110 calls or if a `PipelineDeps`-style
field turns out to be needed that isn't covered above.

### Phase C — web UI: inbox list, module picker, answer/dismiss

Reads Phase B's handoff first (exact route paths and response shapes).

Files to create:
- `apps/web/app/teacher/questions/page.tsx` (new) — `requireRole(['teacher'])` guard (same pattern
  as `app/teacher/uploads/page.tsx`); server-side loads groups + modules via Phase B's `list`.
- `apps/web/src/studio/questions/loadQuestions.ts` (new) — the page's server-side load.
- `apps/web/src/studio/questions/sendQuestionAction.ts` (new) — `answerGroup(...)` and
  `dismissQuestion(...)` POSTing to Phase B's routes.
- `apps/web/src/studio/questions/QuestionsInboxView.tsx` (new client component) — one card per
  group (count, oldest date, member question texts); each card has a module `<select>` (from the
  loaded modules), an answer textarea and "Send answer" / "Dismiss" actions; a brief confirmation
  after either (no page reload); an empty state when there are no open groups.
- `apps/web/messages/en.json` — **additive only**: one new top-level `questionsInbox` namespace
  (title, module-picker label, answer/dismiss button text, confirmation/error text). No edits to
  any existing key.
- `apps/web/app/teacher/questions/page.test.tsx`, `apps/web/src/studio/questions/
  QuestionsInboxView.test.tsx` (new; RTL, injecting fake `answerGroup`/`dismissQuestion`, following
  `app/teacher/uploads/page.test.tsx`'s pattern).

Risky paths touched: none.

Budget: 110 tool calls (1 phase, apps/web). Allowed tools: Read, Grep, Glob, Edit, Write, Bash (web
test/typecheck/lint only).

Exit: DONE once the new component/page tests pass and the web package's typecheck/lint/test is
green, and the handoff walks through: open the inbox → pick a module → answer a group → see it
drop off the list → dismiss another. (Phase A already proves dismiss is single-row; this phase
doesn't re-prove retrieval or the note write — 5.10 and Phase A already cover those.) PARTIAL past
~110 calls or if `ChatView`/shared chat components turn out to be needed (they are not — this is a
plain form, no chat thread).

## Budget

Budget: 290 tool calls (3 phases, packages/db + apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test only, scoped to the touched package per
phase; no publish, no `gh pr merge`, no `git push --force*`)

## Exit conditions

Status: DONE when all three phases are green and merged in sequence (A before B before C — B needs
Phase A's `dismiss`; C needs Phase B's routes to exist to call).
Status: PARTIAL when a phase's builder is past its own budget, or discovers a file outside this plan
needs changing (e.g. `outline.ts`, `studio/{routes,runtime,index}.ts`, or a contracts file) — stop
and hand back rather than widening scope.

## Files out of bounds

- `packages/contracts/**` — no port or type change needed (`TeacherQuestion.status` already has
  `'dismissed'`; `AnswerResult` already covers the answer path). Touching it pulls in an ADR and
  architect/security/typescript review for no reason.
- `apps/web/src/auth/**` — the existing `/api/studio/**` policy row already covers every new route.
- `apps/web/src/studio/{index,routes,runtime,profile,files,outline,testChat}/**`,
  `apps/web/app/api/studio/{documents,profile,outline,packages,agents,test-sessions,corrections}/**`
  — other tasks' surface (8.2, 8.3b, 8.4, 8.5, planned 8.6); 8.9 only adds new, separate files under
  `apps/web/src/studio/questions/**` and `apps/web/app/api/studio/questions/**`.
- `packages/harness/**` — `runTurn`/grouping/`insertTeacherNote` already support this end to end
  (task 5.10); nothing there needs to change.
- `packages/db/src/repositories/question-similarity.ts` — grouping logic is 5.10's and unchanged.

## Risky paths touched (full list, checked against risk-paths.txt)

- `packages/db/src/repositories/teacher-questions.ts`, `README.md` (Phase A only) →
  **security-reviewer** (group: "access filter / money / isolation").
- No other phase touches a listed path: Phase B and C stay inside
  `apps/web/src/studio/questions/**` and `apps/web/app/{api/studio/questions,teacher/questions}/**`,
  none of which match `apps/web/src/auth/**`, `apps/web/app/api/webhooks/**`,
  `apps/web/app/api/auth/**`, `packages/harness/**`, `content/**`, `.claude/**`, `.github/**`,
  `.githooks/**` or `packages/contracts/**`.
- Plan a `risk: high` decision entry for Phase A's handoff (repository change on a risky path, same
  shape as the 5.10/8.1/8.5 merges already logged this way).

## Lead answers (22 Oct 2026)
- Q1: accepted. Dismiss closes one question only.
- Q2: accepted. The module picker reuses `outlineRepo().getOutline(scope).modules`.
- Q3: accepted. There is one inbox per teacher across all their agents.
- Q4: accepted. Changes to `messages/en.json` are additive only; the lead orders Phase C after the other UI phases that edit it.
- Q5: accepted for now. The page is reachable by direct URL; a link from the teacher home goes in whichever UI phase next edits `apps/web/app/teacher/view.tsx` (8.6 Phase D, or a small follow-up), so the human can find it when testing.

## Open questions (with recommendations)

1. **Does dismiss close the whole group, or only the one question?** `answer` is deliberately
   group-wide because it writes one shared teacher note that teaches every member; `dismiss` writes
   nothing that benefits the rest of the group. Recommend: **single-row only** — dismissing one
   wording never silently closes a differently-worded sibling that might still deserve an answer.
   A teacher can dismiss each member individually if they truly want the whole group gone.
2. **Module picker data source.** Recommend reusing `outlineRepo().getOutline(scope).modules`
   (read-only import) rather than a new repo method — it is already scoped to the teacher and
   already returns exactly `{ id, title }`.
3. **Per-agent filtering.** `listGroupsForTeacher` already spans all of the teacher's agents (no
   agent filter). Recommend: keep it that way for the inbox — the build plan describes one inbox
   per teacher, not per agent, and 8.9's accept criterion doesn't ask for agent scoping.
4. **`apps/web/messages/en.json` is shared** with 8.3b, 8.4 and planned 8.6 (each adding their own
   namespace) and possibly still being touched by 8.5c. Recommend: additive-only, one new top-level
   `questionsInbox` key, and the lead sequences Phase C so it isn't building at the exact same time
   as another task's edit to the same file.
5. **No nav link to `/teacher/questions` yet** (no teacher shell/nav task has landed). Recommend:
   same precedent as 8.5/9.3 — ship reachable by direct URL; don't block 8.9 on a nav task.

READY
