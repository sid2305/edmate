# Task 8.5b handoff: test chat API, teacher_preview composition (8.5 Phase B)

Status: DONE
Tool calls used: 38

- Branch: `m8/8.5b-test-chat-api` (built on local branch `work-85b`)
- Worktree: `.claude/worktrees/agent-a530986b47036281d`
- Plan: `docs/tasks/8.5/plan.md`, Phase B. Only `apps/web` changed (new files only). No edit to
  `apps/web/src/auth/**`, `src/turn/**`, `src/chat/**`, `src/studio/{index,routes,runtime,...}.ts`,
  `app/teacher/**`, `messages/en.json` or `packages/**`.

## What changed (for Phase C)

New directory `apps/web/src/studio/testChat/`:

- `scope.ts`: `teacherTestChatScope(agents, principal, agentId): Promise<TeacherScope | null>`
  (own agent, any status) and `previewScope(teacherScope): StudentScope` (student = the teacher).
- `deps.ts`: `testChatPorts(repos, { locales })`, `previewEntitlementsFor(process, packageId)`,
  `testChatDepsFor(process, scope, packageId): PipelineDeps`, `TestChatProcess`.
- `routes.ts`: `createTestChatHandlers(backend)` → `{ listPackages, startTestSession, postTestTurn,
  postCorrection }`; types `TestChatBackend`, `TestSessionRow`.
- `runtime.ts`: `createTestChatRuntime(env, hooks)` (same `RuntimeHooks` as the turn runtime).
- `index.ts`: `testChatHandlers` (production wiring) and re-exports `createTestChatHandlers`.

Routes (all `withRole(['teacher'])`, covered by the existing `/api/studio/**` policy row; errors
are the usual `{ error: { code, message, retryable } }`; JSON responses are `no-store`):

| Route | Body | Success | Errors |
|---|---|---|---|
| `GET /api/studio/agents/:agentId/packages` | — | 200 `{ packages: { packageId, name }[] }` (newest first, packages with ≥1 version) | 404 not own/unknown agent |
| `POST /api/studio/agents/:agentId/test-sessions` | `{ packageId }` (strict) | 201 `{ sessionId }` | 400 validation, 413, 404 agent/package not own or package of another agent, 503/500 |
| `POST /api/studio/test-sessions/:id/turns` | the student `ClientTurnSchema` (`{ agentId, kind, text?, lang: 'en', clientTs }`) | 200 SSE (same events as `/api/sessions/:id/turns`; parse with `readTurnStream`) | 400, 413, 404 session not own/ended/other agent, 503/500 |
| `POST /api/studio/corrections` | `{ moduleId, question, badAnswer, correctedAnswer }` (strict) | 201 `{ correctionId, chunkId, evalCaseId }` | 400 validation (incl. repo `invalid`: blank/over-cap text), 404 module not own/missing, 413, 503/500 |

The session is started on the agent's **newest** version (`agentVersions.latest`) and the
package's newest version (resolved through the same `teacher_preview` entitlement store the turn
uses). A turn's package is the session row's, never the client's.

## Evidence

`corepack pnpm vitest run src/studio/testChat src/auth/route-coverage.test.ts` (apps/web):

```
Test Files  4 passed (4)
     Tests  55 passed (55)
```

`routes.test.ts` (24 tests) runs real `runTurn` + `defaultSteps` turns over memory ports and the
scripted gateway: a teacher starts a preview session on a live agent (agent v2, pkg_a v2) and on a
draft agent, and runs a turn to `done`, with deps built for `{ studentId: tch_a, teacherId: tch_a }`
and the entitlement resolved as `teacher_preview`; teacher B, students and anonymous users are
refused; another agent's/teacher's package, ended/foreign sessions, bodies naming a student or
teacher, bad JSON and over-cap bodies are refused before any work; repo `not_found`/`invalid` on
corrections map to 404/400. Coverage of `src/studio/testChat/**`: 93% lines, 92% branches.

`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`:

```
@edmate/web:test:  Test Files  63 passed | 1 skipped (64)
 Tasks:    34 successful, 34 total
```

`python3 .githooks/secret-scan.py --all`: clean.

## Deviations

- `testChatDepsFor` spreads the student `turnDepsFor({ ...process, entitlements }, scope)` and
  overrides `entitlementSource`, instead of re-listing every field (see Decisions).
- The capped JSON body reader is a local copy in `routes.ts` (the turn route's is private and
  `src/turn/routes.ts` is outside this phase's file list). `configuredMarket` is copied into
  `runtime.ts` for the same reason.
- Added `runtime.test.ts` (not in the plan's list) to keep the new code above 80% coverage.
- `apps/web/src/auth/**` untouched: no risky-path edit.

## Decisions

### 22 Oct 2026 · 8.5b preview deps reuse the student turn deps · decided by builder · risk: low
- Decided: `testChatDepsFor` returns `{ ...turnDepsFor({ ...p, entitlements: previewEntitlementsFor(p, packageId) }, scope), entitlementSource: 'teacher_preview' }` rather than copying turnDepsFor's 40 lines.
- Why: one place for the queued ports, metered gateway, pricing and logging, so the preview can't drift from the student turn; the plan only asked not to import `processPorts`, which it doesn't.
- risk: low

### 22 Oct 2026 · 8.5b the preview entitlement store fails closed on a subscription resolve · decided by builder · risk: medium
- Decided: `previewEntitlementsFor` passes `learnerClear: async () => false` (the plan said `true`).
- Why: a preview only ever resolves `teacher_preview`, which never asks the age gate; answering false means that if a `subscription` resolve ever went through this store, it would refuse instead of skipping the age gate.
- risk: medium

### 22 Oct 2026 · 8.5b a preview turn uses the session's package and the signed-in teacher only · decided by builder · risk: medium
- Decided: the turn route reads the session in the scope `{ studentId: teacher, teacherId: teacher }` (from the principal, after `agents.get` confirms the body's agent is the teacher's), refuses ended sessions, sessions of another agent and sessions with no package, and builds the entitlement store from the session row's `packageId`. Starting a session resolves the same `teacher_preview` entitlement first, so a package of another agent or teacher is a 404 and nothing is created.
- Why: keeps one teacher's drafts and packages away from other teachers and from students, without touching the risky auth or repository paths.
- risk: medium

### 22 Oct 2026 · 8.5b small private helpers are copied, not shared · decided by builder · risk: low
- Decided: the capped body reader and the production market rule are local copies in `src/studio/testChat/` rather than exports from `src/turn/`.
- Why: `src/turn/**` is outside this phase's file list; a later clean-up can export them from one place.
- risk: low
