# Task 8.9b handoff: web, teacher questions inbox API (8.9 Phase B)

Status: DONE
Tool calls used: 95 (harness count)

- Branch: `m8/8.9b-questions-api` (built on local branch `work-89b`)
- Worktree: `.claude/worktrees/agent-ad5c885b18d2fd999`
- Plan: `docs/tasks/8.9/plan.md`, Phase B. Only `apps/web/src/studio/questions/**` and
  `apps/web/app/api/studio/questions/**` added; no `apps/web/src/auth/**`,
  `apps/web/src/studio/{index,routes,runtime,outline}.ts`, no `view.tsx`, no `en.json` edit.

## What changed

A new, separate composition root (same precedent as 8.4a's style card API), the simplest so far
— no S3, Redis or queue, just the shared auth runtime's database repositories read lazily on
first request:

- `apps/web/src/studio/questions/routes.ts` — `createQuestionsHandlers(backend, fallbackLog)` ->
  `{ list, answer, dismiss }` over an injected `QuestionsBackend`
  (`teacherQuestions: Pick<Repositories['teacherQuestions'], 'listGroupsForTeacher' | 'answer' |
  'dismiss'>`, `modules: Pick<Repositories['outline'], 'getOutline'>`, `log`). `GET` returns
  `{ groups, modules }` (modules trimmed to `{ id, title }`, never the topics); `POST answer`
  parses a strict body (`questionId`, `moduleId`, `answer`, optional `noteQuestion`) and returns
  5.10's `AnswerResult` counts; `POST dismiss` parses `{ questionId }` and returns 204. Same
  error-mapping shape as `studio/routes.ts`/`outline.ts`: a backend that can't be built is 503, a
  repository `not_found` is 404, `invalid` is 400, anything else a logged 500 (error name only,
  never question/answer text). A declared `content-length` over 16 KiB is refused (413) before
  any parsing; every response is `cache-control: no-store`. The teacher is always
  `ctx.principal.userId`, never a body field.
- `apps/web/src/studio/questions/runtime.ts` — `createQuestionsRuntime(hooks)`: a memoised
  backend factory over `hooks.repos(): Pick<Repositories, 'teacherQuestions' | 'outline'>` (same
  "cache the promise, drop a failed build" shape as `createStudioRuntime`); `realHooks` reads
  `serverDatabase().repos`.
- `apps/web/src/studio/questions/index.ts` — the barrel; `questionsHandlers`, built once.
- `apps/web/app/api/studio/questions/route.ts` (`GET`), `.../answer/route.ts` (`POST`),
  `.../dismiss/route.ts` (`POST`) — each `withRole(['teacher'], …)`; `/api/studio/**` already
  covers them, confirmed by `route-coverage.test.ts` (no `auth/policy.ts` edit).
- `apps/web/src/studio/questions/routes.test.ts`, `runtime.test.ts` — fake-repo tests (no real
  database or model call), mirroring `studio/outline.test.ts`'s patterns: list returns groups +
  trimmed modules (and an empty module list when `getOutline` is `null`); answer/dismiss call the
  repository with the scoped teacher and the exact body; 400 on a bad shape, an empty answer, an
  unknown field (strict body) and a missing `questionId`; 413 on an oversized declared
  content-length before parsing; 404 on repository `not_found`; 500 logged by error name only
  (asserted the logged fields never contain the answer text); 503 when the backend can't build.

## Evidence

`corepack pnpm --filter @edmate/web typecheck`: clean.
`corepack pnpm --filter @edmate/web lint`: clean.
`corepack pnpm --filter @edmate/web test` (after merging `origin/main`):
```
 Test Files  71 passed | 1 skipped (72)
      Tests  1034 passed | 4 skipped (1038)
 ...udio/questions |   98.33 |     87.5 |     100 |     100 |
  routes.ts        |   98.03 |     87.5 |     100 |     100 | 51,146
```
(runtime.ts and index.ts both 100% line/branch covered — only `routes.ts` shows above because the
other two files have no uncovered line to list; confirmed via `coverage-final.json`:
`routes.ts` 50/51 statements, `runtime.ts` 7/7, `index.ts` 2/2, all three route files 2/2.)

`python3 .githooks/secret-scan.py --all`: clean.

Note: an earlier `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` run hit a
batch of unrelated test timeouts (`src/auth/index.test.ts`, `src/turn/runtime.test.ts`,
`src/chat/ChatView.test.tsx`'s axe check, `route-coverage.test.ts`'s cold-import timing) under
heavy concurrent system load — none in `src/studio/questions/**`, and they cleared on the clean
reruns above (`typecheck`/`lint`/`test` run separately, not through `turbo`'s combined pipeline).

## Deviations

None from the plan. `AnswerSchema`'s optional `noteQuestion` needed a conditional spread
(`...(body.noteQuestion === undefined ? {} : { noteQuestion: body.noteQuestion })`) before calling
`teacherQuestions.answer`, to satisfy `exactOptionalPropertyTypes` — not a deviation, just the
mechanical fix the compiler asked for.

## Left to do

None for this phase. Phase C (web UI) can now read this handoff for the exact route paths and
response shapes (`GET /api/studio/questions` -> `{ groups: TeacherQuestionGroup[], modules: {
id, title }[] }`; `POST /api/studio/questions/answer` body `{ questionId, moduleId, answer,
noteQuestion? }` -> `AnswerResult`; `POST /api/studio/questions/dismiss` body `{ questionId }` ->
204).

## Notes on decisions

No risky path touched (`apps/web/src/studio/questions/**` and
`apps/web/app/api/studio/questions/**` are not in `risk-paths.txt`), and no spec gap arose beyond
what Phase A's handoff and the plan's lead answers already resolved.

## Decisions

None
