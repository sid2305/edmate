# Task 8.5 plan: test chat as a student per package; mark and correct answers

`python3 .claude/skills/board/board.py show 8.5`:
- Title: Test chat as a student per package; mark and correct answers
- Accept (verbatim): **a correction changes the next answer and becomes an eval case.**
- Deps: 1.3, 5.1, 5.2, 8.1 (all done/available)

How it will be shown: an integration test (Phase A) proves a correction writes a `corrections`
row, a `teacher_eval_cases` row, and a teacher-note chunk that the next similar-question search
returns first. A route test (Phase B) proves a teacher can start a `teacher_preview` session for
one of their agent's packages and run a real turn through `runTurn`. A component test (Phase C)
proves marking an agent reply wrong opens a correction form whose submit calls the Phase A/B
wiring, and that the next reply in the same thread can cite the new note (via a second real turn
in the same int/e2e-ish test, or inspected through the Phase A assertion if a full browser-level
proof is too heavy for RTL — see open question 3).

## What already exists (read, don't rebuild)

- `Entitlement.source` already has `'teacher_preview'` (`packages/contracts/src/access.ts`), and
  `entitlementStoreFor` in `packages/db/src/repositories/ports.ts` already resolves it end to end:
  studentId = the teacher's own user id, any agent status (drafts included, since this is "test
  before publish"), package at `opts.preview.packageId`'s **newest** version. This is exercised
  today only by `packages/db/test/entitlement-store.int.test.ts`,
  `packages/db/test/session-package.int.test.ts` and the harness's `entitle.test.ts`/`admit.test.ts`
  — never by a real web route. 8.5 is the first task that wires it to one.
- `CorrectionStore.addTeacherNote` (`packages/db/src/repositories/ports.ts`,
  `correctionStoreFor`) and `insertTeacherNote` (`packages/db/src/repositories/chunks.ts`, task
  5.10) already turn a `{moduleId, question, answer, origin}` into a teacher-note chunk + a
  `teacher_eval_cases` row + a material-revision bump, in one transaction. 8.5 does **not** touch
  this port or its contracts type.
- The `corrections` table (`packages/db/src/schema/content.ts`) exists since migration 0001
  (`teacher_id, module_id, question, bad_answer, corrected_answer`) but nothing writes to it yet —
  `insertTeacherNote` only writes `documents`/`chunks`/`teacher_eval_cases`. 8.5 is the first task
  to populate it (the one new fact this plan adds to the data model's actual behaviour).
- The web student turn (`apps/web/src/turn/*`, task 9.4) is the pattern to mirror, not the file to
  edit: `routes.ts` (SSE handlers over an injected `TurnBackend`), `deps.ts` (`turnDepsFor`,
  `processPorts`, `systemClock`, `systemIds`), `runtime.ts` (`anthropicFactories`, `contentDir`,
  `openRedis`, `devFactories`), `scope.ts` (`studentTurnScope`). 8.5 adds a **second, teacher-scoped
  composition root** under `apps/web/src/studio/testChat/`, the same way `apps/cli/src/commands/
  chat/deps.ts` is already a separate composition root from the web one — both call the same
  `runTurn` from `@edmate/harness`. This is reuse of the pipeline and the wire format (SSE events,
  `ClientTurnSchema`, `formatSseEvent`/`readTurnStream`), not a second pipeline.
- `/packages/[agentId]/page.tsx` (task 9.3) is the precedent for "no agent-listing page yet, so the
  page takes an explicit `agentId` param" — 8.3 (outline), 8.4 (style interview) and 8.6 (package
  builder) are all still `todo`, so there is **no** production flow yet that creates an `agents` /
  `agent_versions` / `packages` / `package_versions` row. 8.5 follows the same precedent: route is
  `/teacher/test-chat/[agentId]`, reachable by direct URL until 8.3/8.6 add navigation into it
  (flagged as open question 1, not blocking).

## Phases

Three phases, each a fresh builder reading this plan and the prior phase's handoff; each ends in
a green commit.

### Phase A — db: make preview and corrections queryable (packages/db only)

Files to create/modify:
- `packages/db/src/repositories/agent-versions.ts` — add `latest(scope: TeacherScope, agentId):
  Promise<{ version: number; config: AgentConfig } | null>` (newest `agent_versions` row for the
  scope's teacher's agent; mirrors `packageVersions.latest`'s shape and ordering).
- `packages/db/src/repositories/package-versions.ts` — add `listForAgent(scope: TeacherScope,
  agentId): Promise<{ packageId: string; name: string }[]>`: the scope's teacher's packages for
  that agent that have **at least one** version (inner join `packages` → `package_versions`),
  newest-created first. (`liveForAgent` stays student-only and live-only; this is the teacher-side,
  any-status equivalent.)
- `packages/db/src/repositories/corrections.ts` (new) — `correctionsRepo(db)` with one method:
  `record(scope: TeacherScope, input: { moduleId: string; question: string; badAnswer: string;
  correctedAnswer: string }): Promise<{ correctionId: string; chunkId: string; evalCaseId: string
  }>`. One transaction: insert a `corrections` row (teacher-scoped, `badAnswer` capped at
  `LIMITS.turnTextMaxLength` from `@edmate/contracts`, same cap `teacherNoteParts` already enforces
  on question/answer) **and** call the existing `insertTeacherNote(tx, teacherId, { moduleId,
  question, answer: correctedAnswer, origin: 'correction' })` from `chunks.ts` (not duplicated —
  `chunks.ts`/`retrieval.ts` stay the only files naming the chunks table, per
  `packages/db/src/repositories/README.md`'s ownership rule). An unowned `moduleId` is `not_found`;
  an empty or over-cap field is `invalid` — same translation `insertTeacherNote` already gives.
- `packages/db/src/repositories/index.ts` — register `corrections: guardAll('corrections',
  correctionsRepo(db))`; export any new named types (e.g. `CorrectionRecordInput`).
- `packages/db/src/repositories/README.md` — document the new repo and the two new methods next to
  the existing "Ask the teacher" section.
- `packages/db/test/corrections.int.test.ts` (new) — the acceptance proof at the repo layer: after
  `corrections.record`, (1) a `corrections` row exists with the bad answer, (2) a
  `teacher_eval_cases` row exists with `origin: 'correction'`, (3) a retrieval search for a close
  variant of the question returns the new teacher-note chunk, ranked first, as
  `askTeacher.integration.test.ts` (5.10) already proves for `teacher_answer`. Also: ghost
  `moduleId` → `not_found`; another teacher's module → `scope`/`not_found` (not leaked); empty or
  over-cap `badAnswer`/`correctedAnswer` → `invalid`.
- `packages/db/test/repositories.int.test.ts` — add the three new methods
  (`corrections.record`, `agentVersions.latest`, `packageVersions.listForAgent`) to the exhaustive
  `CASES: Record<RepositoryMethod, IsolationCase>` table (TS forces this; a missing entry fails
  `tsc`, not just a runtime test).

Risky paths touched: `packages/db/src/repositories/**` → **security-reviewer** (per
`.claude/skills/merge-gate/risk-paths.txt`, "money... sign-in, keys, keeping each teacher's and
student's data apart" group). Plan a `risk: high` decision entry on this phase's handoff.

Budget: 110 tool calls (1 phase, packages/db). Allowed tools: Read, Grep, Glob, Edit, Write, Bash
(db test/typecheck/lint only).

Exit: DONE once `corrections.int.test.ts` and the updated `repositories.int.test.ts` pass and
`turbo run typecheck lint test --filter=@edmate/db...` is green. PARTIAL past ~110 calls or if a
migration turns out to be needed after all (it should not — the table and columns already exist).

### Phase B — web: teacher_preview composition + API routes (apps/web only, no UI)

Reads Phase A's handoff first (exact new method names/signatures).

Files to create (new directory, does not touch `apps/web/src/studio/{index,routes,runtime,
profile,files}.ts` or any file 8.3b/8.4 might be editing):
- `apps/web/src/studio/testChat/scope.ts` — `teacherTestChatScope(agents, principal, agentId):
  Promise<TeacherScope | null>`: `repos.agents.get({ teacherId: principal.userId }, agentId)` (any
  status — drafts included, unlike the student flow's live-only `studentTurnScope`); null when
  missing or another teacher's.
- `apps/web/src/studio/testChat/deps.ts` — `testChatDepsFor(process, scope, packageId):
  PipelineDeps`, a sibling of `apps/web/src/turn/deps.ts`'s `turnDepsFor` (same `queuedTurnPorts`,
  `gatewayFor`, `priceUsage`, logging shape) but: `entitlements` is built **fresh per call** via
  `entitlementStoreFor(repos, { market, packMarket, learnerClear: async () => true, preview: {
  packageId } })` (teacher_preview never asks the age gate), and `entitlementSource:
  'teacher_preview'`. `turnConfig` and `retrieval` are the same kind of port as `processPorts`
  builds (built directly here, not by importing the student `processPorts`, to avoid a shared
  `entitlements` field going unused and confusing readers).
- `apps/web/src/studio/testChat/routes.ts` — `createTestChatHandlers(backend)` with four handlers
  over an injected `TestChatBackend` (mirrors `TurnBackend`'s shape, teacher-scoped):
  - `listPackages` (GET, agentId from the path): `repos.packageVersions.listForAgent`.
  - `startTestSession` (POST, agentId from the path, body `{ packageId }`): checks ownership via
    `teacherTestChatScope`, loads the agent's **newest** version via `agentVersions.latest` (not
    `liveVersion` — drafts must be previewable), creates a session with `entitlementSource:
    'teacher_preview'`, `source: 'teacher_preview'` passed through to usage metering (already
    handled by the existing gateway/metering code per task 2.4/2.5 — no change there).
  - `postTestTurn` (POST, SSE, mirrors `postTurn`): same `runTurn`/`sseBody`/`formatSseEvent` as
    the student route, `cancelOf(req.signal)`, same body cap and validation
    (`ClientTurnSchema`/`toTurnInput` reused, read-only import from `../../turn/clientInput`).
  - `postCorrection` (POST, body `{ moduleId, question, badAnswer, correctedAnswer }`):
    `repos.corrections.record(scope, …)`.
- `apps/web/src/studio/testChat/runtime.ts` — production wiring: reuses `anthropicFactories`,
  `contentDir`, `openRedis`, `devFactories`/`devModelEnabled`, `consoleLog` from
  `../../turn/runtime` (read-only imports) and `systemClock`/`systemIds` from `../../turn/deps`
  (read-only imports), so key/Redis/content-dir handling isn't duplicated; builds its own
  `TestChatBackend` the way `turn/runtime.ts` builds `TurnBackend`.
- `apps/web/src/studio/testChat/index.ts` (new barrel; does not touch `src/studio/index.ts`) —
  exports `testChatHandlers` built from `createTestChatHandlers(createTestChatRuntime(...))`.
- `apps/web/app/api/studio/agents/[agentId]/test-sessions/route.ts` (new, `POST`)
- `apps/web/app/api/studio/agents/[agentId]/packages/route.ts` (new, `GET`)
- `apps/web/app/api/studio/test-sessions/[id]/turns/route.ts` (new, `POST`, SSE)
- `apps/web/app/api/studio/corrections/route.ts` (new, `POST`)
- `apps/web/src/studio/testChat/routes.test.ts`, `deps.test.ts` (new; memory-ports/fake-repo tests
  mirroring `apps/web/src/turn/routes.test.ts` and `deps.test.ts`'s patterns)

No `apps/web/src/auth/policy.ts` edit needed: `{ pattern: '/api/studio/**', methods: ['GET','POST',
'PUT','DELETE'], access: ['teacher'] }` already covers every new route; the route-coverage test
(`apps/web/src/auth/route-coverage.test.ts`) picks them up automatically once each is wrapped in
`withRole(['teacher'], …)`.

Risky paths touched: none (`apps/web/src/studio/**` and `apps/web/app/api/studio/**` are not in
risk-paths.txt; this phase never touches `apps/web/src/auth/**` or any listed glob). No `risk: high`
decision required for this phase; standard code-reviewer + typescript-reviewer.

Budget: 140 tool calls (1 phase, apps/web). Allowed tools: Read, Grep, Glob, Edit, Write, Bash
(web test/typecheck/lint only).

Exit: DONE once `routes.test.ts`/`deps.test.ts` pass, `route-coverage.test.ts` still passes, and
`turbo run typecheck lint test --filter=@edmate/web...` (or the app's actual filter name) is green.
PARTIAL past ~140 calls or if `testChatDepsFor` needs a `PipelineDeps` field not covered above.

### Phase C — web UI: package picker, chat, mark wrong, correction form

Reads Phase B's handoff first (exact route paths and response shapes).

Files to create:
- `apps/web/app/teacher/test-chat/[agentId]/page.tsx` (new) — `requireRole(['teacher'])` guard
  (teachers always clear the student age-gate clearance, same comment pattern as
  `app/teacher/uploads/page.tsx`); loads the agent's package list via Phase B's `listPackages`
  (server-side) and renders `TestChatView`. An agent with zero previewable packages (no
  `package_versions` row yet, since 8.6 doesn't exist) shows a plain empty-state message, no dead
  link.
- `apps/web/src/studio/testChat/loadTestChat.ts` (new) — the page's server-side load, mirrors
  `apps/web/src/chat/loadChat.ts`'s shape but simpler (no `?s=` session-reopen support for v1 — a
  fresh preview session every page load is acceptable for "test chat"; flagged as open question 2).
- `apps/web/src/studio/testChat/sendTestTurn.ts` (new) — `startTestSession(agentId, packageId)` and
  `sendTestTurn(...)` POSTing to Phase B's routes, and `submitCorrection(...)` POSTing to
  `/api/studio/corrections`; reuses `readTurnStream`/`responseError` from `../../chat/sse`
  (read-only import) so the SSE parsing isn't duplicated.
- `apps/web/src/studio/testChat/TestChatView.tsx` (new client component) — package `<select>`
  (switching package starts a new preview session); the thread, read-only-importing and reusing
  `MessageBubble`, `Composer`, `SourcesList` from `../../chat/*` and `reduceTurn`/`initialTurn`/
  `StreamItem` from `../../chat/turnState` (same reducer, same stream semantics as the student
  chat — "provisional", `replace`, retry-on-retryable-error all carry over unchanged); a "Mark
  wrong" action under each agent `MessageBubble` that opens an inline correction form (module
  select, corrected-answer textarea, pre-filled `question` = the preceding student message and
  `badAnswer` = the agent's shown text) whose submit calls `submitCorrection` and shows a brief
  confirmation (no page reload).
- `apps/web/messages/en.json` — **additive only**: a new top-level `testChat` namespace (title,
  package-picker label, "mark wrong", correction-form labels, submit/success/error text). No edits
  to any existing key, to keep this the smallest possible diff on a file 8.3b/8.4 may also touch
  (see open question 4 / collision note below).
- `apps/web/app/teacher/test-chat/[agentId]/page.test.tsx`, `apps/web/src/studio/testChat/
  TestChatView.test.tsx` (new; RTL, injecting fake `start`/`send`/`submitCorrection`, following
  `apps/web/app/learn/[agentId]/page.test.tsx`'s and `ChatView`'s own test patterns)

Risky paths touched: none.

Budget: 140 tool calls (1 phase, apps/web). Allowed tools: Read, Grep, Glob, Edit, Write, Bash (web
test/typecheck/lint only).

Exit: DONE once the new component/page tests pass and `turbo run typecheck lint test
--filter=@edmate/web...` is green, and a manual note in the handoff walks through: pick a package →
send a message → mark the reply wrong → submit a correction → (Phase A's repo-level proof already
covers "the next similar question is answered from the new note"; this phase doesn't need to
re-prove retrieval, only that the form calls the right endpoint with the right payload). PARTIAL
past ~140 calls or if `ChatView` itself turns out to need changing (it should not — see "Files out
of bounds").

## Budget

Budget: 390 tool calls (3 phases, packages/db + apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test only, scoped to the touched package per
phase; no publish, no `gh pr merge`, no `git push --force*`)

## Exit conditions

Status: DONE when all three phases are green and merged in sequence (A before B before C — B and C
both depend on Phase A's new repo methods; B must land before C's routes exist to call).
Status: PARTIAL when a phase's builder is past its own budget, or discovers a file outside this
plan needs changing (e.g. `ChatView.tsx`, `src/studio/index.ts`, `src/studio/routes.ts`, or a
contracts file) — stop and hand back rather than widening scope.

## Files out of bounds

- `packages/contracts/**` — no port or type change is needed (`CorrectionStore`, `Entitlement`
  already cover this feature); touching it would pull in an ADR and architect/security/typescript
  review for no reason.
- `apps/web/src/auth/**` (policy.ts, guard.ts) — the existing `/api/studio/**` policy row already
  covers every new route.
- `apps/web/src/studio/{index,routes,runtime,profile,files}.ts` and `apps/web/app/api/studio/
  documents/**`, `apps/web/app/api/studio/profile/**` — 8.3b and 8.4's surface; 8.5 only adds new,
  separate files under `apps/web/src/studio/testChat/` and `apps/web/app/api/studio/{agents,
  test-sessions,corrections}/**`.
- `apps/web/src/chat/**` (ChatView, MessageBubble, Composer, sendTurn, sse, turnState) — read-only
  imports throughout; no edits. If Phase C finds it genuinely needs a change here, stop at PARTIAL
  and raise it rather than editing a file 9.4/9.5 own.
- `packages/harness/**` — the pipeline (`runTurn`), `teacherNote.ts` and the `entitle` step already
  support `teacher_preview` end to end (tested by `entitle.test.ts`, `admit.test.ts`,
  `runner.generate.test.ts`); nothing there needs to change.

## Risky paths touched (full list, checked against risk-paths.txt)

- `packages/db/src/repositories/**` (Phase A: `agent-versions.ts`, `package-versions.ts`,
  `corrections.ts` (new), `index.ts`, `README.md`) → **security-reviewer** (group: "money...
  sign-in, keys, keeping each teacher's and student's data apart").
- No other phase touches a listed path: Phase B and C stay inside `apps/web/src/studio/testChat/**`
  and `apps/web/app/{api/studio/{agents,test-sessions,corrections},teacher/test-chat}/**`, none of
  which match `apps/web/src/auth/**`, `apps/web/app/api/webhooks/**`, `apps/web/app/api/auth/**`,
  `packages/harness/**`, `content/**`, `.claude/**`, `.github/**`, `.githooks/**` or
  `packages/contracts/**`.
- Plan a `risk: high` decision entry for Phase A's handoff (repository change on a risky path, same
  shape as the 8.1/8.2/5.10/9.3 merges already logged this way).

## Open questions (with recommendations)

1. **No agent/package creation UI exists yet (8.3, 8.4, 8.6 are all `todo`).** 8.5's accept
   criterion is real and testable at the repository layer (Phase A) and at the route layer (Phase
   B) today, using fixture agents/packages created directly through the repos — exactly how
   `entitlement-store.int.test.ts` and `session-package.int.test.ts` already do. The UI (Phase C)
   is reachable only by direct URL (`/teacher/test-chat/<agentId>`) until 8.3/8.6 add a nav link,
   same precedent as `/packages/[agentId]` (9.3). Recommend: proceed on this basis; do not block
   8.5 on 8.3/8.4/8.6.
2. **Session reopening.** The student chat supports `?s=` to reopen an open session; Phase C's
   plan skips that for v1 (every page load starts a fresh teacher_preview session). Recommend:
   accept for v1 — a teacher testing a package rarely needs to resume a stale preview thread, and
   adding resume support is a small, separable follow-up if a reviewer disagrees.
3. **How deep must the "a correction changes the next answer" proof go in the UI tests?** Recommend
   Phase C's tests stop at "the correction form calls the right endpoint with the right payload";
   Phase A's integration test is the one place that actually re-runs retrieval and proves the note
   is returned first. Re-proving that through a full browser-level round trip in RTL would mean
   stubbing the whole harness pipeline in a component test, which is disproportionate.
4. **`apps/web/messages/en.json` is shared.** Phase C must touch it (new `testChat` namespace) and
   8.3b/8.4 may touch it too (their own namespaces) in parallel. Recommend: additive-only edits,
   one new top-level key, so a collision is a trivial merge, not a conflict; if the lead sequences
   builders, note this file as the one unavoidable shared touch.

READY

## Lead answers (22 Oct 2026)
- Q1: agreed. Proceed with the direct URL `/teacher/test-chat/[agentId]` (the 9.3 precedent) and fixture-created agents and packages in tests. Don't wait for 8.6.
- Q2: agreed. There's no session reopen in v1; each load starts a fresh preview session.
- Q3: agreed. The UI tests stop at the endpoint and payload; Phase A proves retrieval.
- Q4: noted. `messages/en.json` (one new top-level `testChat` key), `packages/db/src/repositories/index.ts` and `packages/db/test/repositories.int.test.ts` are shared with 8.3b and 8.4. Under the no-shared-files rule, Phase A doesn't build at the same time as either of them; the lead orders the builds.
- Each phase runs as a fresh builder (sub-tasks 8.5a, 8.5b and 8.5c on the board), with its own handoff.
