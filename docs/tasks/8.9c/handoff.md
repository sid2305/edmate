# Task 8.9c handoff: teacher questions inbox UI (8.9 Phase C)

Status: DONE
Tool calls used: 83

- Branch: `m8/8.9c-questions-inbox` (built on local branch `work-89c`)
- Worktree: `.claude/worktrees/agent-af0107ccc94738b81`
- Plan: `docs/tasks/8.9/plan.md`, Phase C. Read Phase B's handoff
  (`docs/tasks/8.9b/handoff.md`) first for the exact route paths and response shapes.

## Summary

The `/teacher/questions` page: a card per grouped open question (count, oldest date, every
member's question text -- no student name, id or email anywhere), a module picker and answer
textarea that answer the whole group through Phase B's `POST /api/studio/questions/answer`, and
a per-question "Dismiss" through `POST /api/studio/questions/dismiss` (single row only, per plan
Q1 -- a sibling with different wording stays open). The guard runs before any database read; the
teacher is always the signed-in principal. English only. One nav entry (`Questions`) added to
the shared `apps/web/app/teacher/view.tsx`.

Every POST settles to a result and never rejects: a network failure, a non-2xx, or a 2xx with a
malformed body is a fixed error code that shows an alert and re-enables the button (lessons: "a
studio page that trusts a 200 response gets stuck"). The answer/dismiss buttons each carry their
own busy flag inside a `try/finally`.

## Files

- `apps/web/src/studio/questions/loadQuestions.ts` (+ test) -- the page's server-side load:
  reads the signed-in teacher's open groups and modules directly from the repositories (same
  precedent as 8.5 Phase C's `loadTestChat`, no HTTP round trip for first paint). Reuses Phase
  B's exported `QUESTIONS_LIST_LIMIT`.
- `apps/web/src/studio/questions/sendQuestionAction.ts` (+ test) -- `answerGroup(...)` and
  `dismissQuestion(...)`, the browser side, POSTing to Phase B's routes; fetch is always
  injected in tests.
- `apps/web/src/studio/questions/QuestionsInboxView.tsx` (+ test) -- the client component: one
  card per group; each member question has its own Dismiss button; one shared module `<select>`
  + answer `<textarea>` + "Send answer" per card; a confirmation (`role="status"`) after either
  action, an error (`role="alert"`) on failure; an empty state when no open groups remain.
- `apps/web/app/teacher/questions/page.tsx` (+ test) -- `requireRole(['teacher'])` guard,
  `loadQuestions`, renders `QuestionsInboxView` inside `AppShell`.
- `apps/web/messages/en.json` -- additive only: new top-level `questionsInbox` namespace, and
  `teacher.questionsLink`. No existing key edited.
- `apps/web/app/teacher/view.tsx`, `view.test.tsx` -- one new nav entry/test case for
  `/teacher/questions` (plan Q5), appended after 8.8b's `insights` link (kept both sides on
  merge).

## Tests

- `loadQuestions.test.ts`: loads the teacher's groups + modules in scope; no outline yet -> no
  modules; the guard refusing reads nothing.
- `sendQuestionAction.test.ts`: `answerGroup`/`dismissQuestion` POST the right payload and
  return the right shape; a non-2xx maps to its error code; a network failure, non-JSON 200, or
  wrong-shape 200 is a retryable `provider_error`, never a rejection.
- `QuestionsInboxView.test.tsx`: empty state; renders every group's question texts and count;
  sending an answer calls `answerGroup` with the picked module and removes the whole group;
  dismissing one question removes only that question (its sibling stays); a failed answer or
  dismiss shows an alert and re-enables the button, leaving the question listed; an empty answer
  is refused client-side without calling the backend; no axe violations.
- `page.test.tsx`: the guard runs first; groups/modules are read only in the signed-in teacher's
  scope; the guard refusing reads nothing.
- `view.test.tsx`: new case for the `Questions` nav link to `/teacher/questions`.

## Evidence

`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` (after merging
`origin/main`): 34/34 tasks successful; `src/studio/questions` coverage 97.82% stmts / 90%
branch / 96.15% funcs / 100% lines (the two new files, `loadQuestions.ts` and
`QuestionsInboxView.tsx`'s lines inside the aggregate, are both 100%; Phase B's pre-existing
`routes.ts` lines 51/146 are the only uncovered lines).

`python3 .githooks/secret-scan.py --all`: clean.

## Decisions

### 22 Oct 2026 · 8.9c Dismiss is per question row, not per group card · decided by builder · risk: low
- Decided: "Dismiss" is a per-row button inside a group's card, not a single whole-card action.
- Why: plan Q1 made dismiss single-row only, so one "Dismiss" button on a multi-member group would be ambiguous about which wording it closed; per-row buttons make the behaviour visible and match the exit walkthrough ("dismiss another").
- risk: low

### 22 Oct 2026 · 8.9c Send answer uses the group's first remaining question id · decided by builder · risk: low
- Decided: "Send answer" posts the id of the group's first remaining question; the teacher never picks an id.
- Why: per 5.10's repository, any member id answers the whole group, so the effect is the same whichever id is sent.
- risk: low

### 22 Oct 2026 · 8.9c Merged 8.8b's nav link and en.json namespace additively · decided by builder · risk: low
- Decided: kept 8.8b's `insights` nav link and `en.json` namespace; `questionsLink` and `questionsInbox` land after `insights`.
- Why: the plan's shared-file rule says keep both sides.
- risk: low

## Left to do

None for this phase.
