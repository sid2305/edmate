# 11.2b: teacher live-classes question queue UI + student ask-form

## Summary
Phase B of `docs/tasks/11.2/plan.md`. The teacher's live-classes studio page now shows two
read-only queues: the student-fed pre-class topic queue (`classQuestions.listQueueForTeacher`,
11.2a) and the existing ask-the-teacher queue (`teacherQuestions.listGroupsForTeacher`), both
rendered as plain React text (never `dangerouslySetInnerHTML` or markdown-to-HTML). A new
`POST /api/live-classes/[id]/questions` route lets a signed-in student submit a question for one
of their own upcoming, entitled live classes; the teacher scope is resolved by trying the
student's configured candidate agents' owning teachers in turn (same pattern `/home`'s own
`homeLiveClasses()` already uses), so every failure mode — wrong teacher, unentitled student,
unknown class — reads alike as `not_found`. `/home` gained an `AskQuestionForm` under each listed
live class, using the client-fetch-wrapper pattern (never rejects, wraps parse errors, zod-checks
the shape).

## Files
- `apps/web/app/api/live-classes/[id]/questions/{handlers.ts,route.ts,route.test.ts}` (new)
- `apps/web/src/auth/policy.ts` (append-only: one new `ROUTE_POLICY` row)
- `apps/web/src/studio/liveClasses/loadLiveClasses.ts` (extended to also load both queues)
- `apps/web/app/teacher/live-classes/{page.tsx,page.test.tsx}` (pass queues through)
- `apps/web/app/teacher/live-classes/{LiveClassesView.tsx,LiveClassesView.test.tsx}` (two new
  sections, incl. the XSS-literal-text test)
- `apps/web/src/liveClasses/submitClassQuestionAction.ts` (new, client fetch wrapper)
- `apps/web/app/home/{AskQuestionForm.tsx,AskQuestionForm.test.tsx}` (new)
- `apps/web/app/home/{view.tsx,view.test.tsx}` (wire the form in)
- `apps/web/messages/en.json` (append-only: `studentQueue`/`askQueue`/`ask*` keys)

No `packages/db`, `packages/contracts`, `apps/worker` or `docs/adr` files touched.

## Tests
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` after merging `origin/main`:
32/34 tasks from cache + the web typecheck/lint/test tasks ran fresh. `@edmate/web#test`:
1672 passed, 2 failed, 10 skipped (1684 total). The 2 failures are both in
`src/auth/index.test.ts` ("a guarded route without sign-in config is 500…" and one neighbour) —
a file this task does not touch; run in isolation (`npx vitest run src/auth/index.test.ts`) all
16 tests pass, confirming a pre-existing cross-test env-pollution flake in the full-suite run, not
a regression from this task. `route-coverage.test.ts` and `src/chat/no-raw-html.test.ts` (the
banned-API sweep over `app/teacher/**`) are both part of the passing set.
`python3 .githooks/secret-scan.py --all`: clean (exit 0).

## Decisions

### 22 Oct 2026 · 11.2b new ROUTE_POLICY row · decided by builder · risk: high
- Decided: added exactly one row to `apps/web/src/auth/policy.ts` — `pattern:
  '/api/live-classes/*/questions'`, `methods: ['POST']`, `access: ['student']`, `clearance:
  'agent'` — same clearance as the existing `/api/sessions` row, appended at the end of
  `ROUTE_POLICY` per the append-only rule for this shared file.
- Why: the plan calls for a student-facing write route; `route-coverage.test.ts` requires every
  exported HTTP method to carry a matching policy row, deny-by-default.
- risk: high — touches the authorization policy table (a risky path). Needs `security-reviewer`
  and `typescript-reviewer` sign-off per the plan's "Risky paths touched" section.

### 22 Oct 2026 · 11.2b teacher-scope resolution via candidate agents · decided by builder · risk: medium
- Decided: the ask-question route resolves `{studentId, teacherId}` for `classQuestions.submit`
  by calling `chatAgentCandidates(env)` for the student's configured agents, resolving each to an
  owning teacher via `agents.owner({agentId})`, deduping teacherIds, and trying `submit()` against
  each candidate teacher in turn until one succeeds; any exhausted list (wrong teacher, no
  candidates, unentitled student, unknown/mismatched class) is folded into a single `not_found`.
- Why: the plan's Phase B doesn't specify the lookup mechanism, and `packages/db` is out of
  bounds this phase so no new repository method could be added. This reuses the exact pattern
  already proven in `/home`'s own `homeLiveClasses()` (11.1c), and avoids an existence oracle (no
  response ever distinguishes "wrong teacher" from "not your class" from "no agents configured").
- risk: medium — new runtime logic in a request handler, but no schema/contract change and fully
  covered by `route.test.ts`'s memory-backend and real-guard tests.

### 22 Oct 2026 · 11.2b mocking AskQuestionForm in view.test.tsx · decided by builder · risk: low
- Decided: `app/home/view.test.tsx` mocks `./AskQuestionForm` with a stub span (same pattern
  `page.test.tsx` already uses for `LiveClassesView`), rather than wrapping `HomeView`'s render in
  a real `NextIntlClientProvider`. The form's own interactive behaviour (submit, busy state,
  trimming, errors) is covered separately by `AskQuestionForm.test.tsx` under `renderIntl()`.
- Why: `HomeView` is a server component tested with a `next-intl/server` mock that has no client
  provider wiring; `AskQuestionForm` is a client component needing `useTranslations`. Mirroring
  the existing stub pattern keeps `view.test.tsx` focused on composition (one form per listed
  class) without duplicating the form's own test coverage.
- risk: low — test-only change, no production behaviour affected.

## Left to do
- A reviewer should confirm the new `/api/live-classes/[id]/questions` `ROUTE_POLICY` row (risk:
  high decision above) — security-reviewer and typescript-reviewer per the plan.
- The 2 pre-existing `src/auth/index.test.ts` flakes under the full-suite run are unrelated to
  this task; worth a separate look if they recur (not filed as a new board task here to stay in
  scope).

Status: DONE
Tool calls used: 112
