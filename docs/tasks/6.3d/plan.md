# Implementation Plan: 6.3d — wire mistake tagging through the real db adapter (6.3c Phase B)

## Board context
- id: 6.3d, milestone M13, deps: [6.3c], risk: risky, status: planning (before this plan).
- Title (verbatim): "6.3c Phase B (split out by lead decision): implement ProfileStore.applyMistakes and
  recordProposedMistakes (ADR-0017) in packages/db profileStoreFor, passing the style card's
  mistakeTags as allowedTags and checking the scope against the adapter's bound pair like
  applyEvidence does; recordProposedMistakes stays a documented no-op until 6.3a; add the methods
  to the worker gate, studio test-chat, CLI chat and web test-backend adapters"
- Acceptance (verbatim): "a wrong practice answer in a scripted turn records the classified mistake
  tags on the learner profile (only tags on the style card) through the real db adapter; a call
  naming another pair is a scope error; no real model calls in tests."
- How it will be shown: a new `packages/db/test/profile-store.int.test.ts` case drives
  `profileStoreFor(repos, scope, sessionId).applyMistakes(scope, known, proposed)` against a real
  (throwaway) Postgres instance and asserts the row in `learner_profiles.mistakes`; a second case
  passes an off-list tag and asserts `RepositoryError('scope', ...)`; a third passes another pair's
  scope and asserts the same `kind`. These, plus the existing `applyEvidence`/mastery suites in the
  same file, are what `turbo run test --filter=@edmate/db` runs.

## A note on how this plan was built
I do not have shell/git access in this planning session, only Read/Grep/Glob/Write. I could not run
`git show origin/m13/6.3c-mistake-tagging:<path>` as the task brief suggested. I confirmed
`docs/adr/0017-mistake-tag-port.md` and `docs/tasks/6.3c/review.md` do not exist on `main`
(Phase A genuinely unmerged), and worked instead from `docs/tasks/6.3c/plan.md` (committed to main,
written before Phase A's build started) plus the already-merged 6.3b code
(`packages/db/src/repositories/learner.ts`). Two things in that draft plan turned out to be wrong
once traced concretely, corrected below (see "Corrections to the 6.3c draft").

## Design

### 1. The allow-list problem
The frozen port shape (per the 6.3c draft and the task brief) is
`ProfileStore.applyMistakes?(scope, known, proposed): Promise<void>` — no `allowedTags` parameter,
and this cannot change (`packages/contracts` already shipped with Phase A's ADR-0017; changing it
again needs a second ADR, out of scope here). The adapter must get the style card's `mistakeTags`
some other way.

`repos.learnerProfiles.applyMistakes(scope, patch, allowedTags)` (merged in 6.3b,
`packages/db/src/repositories/learner.ts`) is the method that does the real allow-list check
(`RepositoryError('scope', ...)` on an off-list tag, before any row is touched) — Phase B's job is
only to resolve `allowedTags` and call through.

### 2. Resolving the style card: thread `sessionId`, not the style card itself
The style card is not available at the point `profileStoreFor` is constructed (composition-root
time) — it is only loaded later, inside the harness pipeline itself
(`packages/harness/src/pipeline/steps/entitle.ts`, `deps.turnConfig.load(e, sessionId)`). The
cheapest value that *is* available at composition-root time, in production, is the `sessionId` —
`apps/web/src/turn/routes.ts`'s `postTurn` handler already fetches the session row before building
deps.

Proposed change: give `profileStoreFor` an optional third parameter:

```ts
export function profileStoreFor(
  repos: Repositories,
  scope: StudentScope,
  sessionId?: string,
): ProfileStore
```

Optional so every existing call site that never invokes `applyMistakes` (all ~15+ call sites in
`packages/db/test/profile-store.int.test.ts`, plus any other `profileStoreFor(repos, scope)` caller)
keeps compiling unchanged. Inside `applyMistakes`, only when `known.length > 0` (the method is a
no-op otherwise — mirrors `commit.ts`'s own "only call when non-empty" convention from Phase A),
resolve the chain exactly as `turnConfigStoreFor.load` already does in the same file:

```
repos.sessions.get(scope, sessionId)
  -> { agentId, agentVersion }
  -> repos.agentVersions.get({ teacherId }, { agentId, version: agentVersion })
  -> AgentConfig.styleCardId
  -> repos.styleCards.get({ teacherId }, styleCardId)
  -> StyleCard.mistakeTags
```

No new repository methods are needed — every method in this chain already exists and is already
used for this exact purpose elsewhere in `ports.ts`. Agent versions and style cards are each an
immutable row per version, so none of these reads need a lock; only
`learnerProfilesRepo.applyMistakes`'s own transaction takes one, and this adds no new locking
(no new deadlock risk).

If `sessionId` is missing (not passed, e.g. a caller with no session context) or the chain breaks
(session not found/ended, agent version missing, style card missing), this is a wiring mistake, not
a user-facing error — throw `RepositoryError('integrity', 'profileStoreFor.applyMistakes')`
immediately rather than silently defaulting `allowedTags` to `[]` (which would turn every mistake
tag into a false scope rejection) or to "allow everything" (which would defeat the allow-list).
This mirrors the 9.4d convention already in this file for a composition root that omits something
an adapter needs. **Open question for the lead/builder** (see below) — flagged, not blocking: is
`integrity` the right kind here, or should a missing/ended session instead be tolerated as a silent
no-op? Recommendation: `integrity` — a wrong-answer commit with no live session is already an
unusual path and should fail loudly in tests rather than silently drop mistake data in production.

### 3. Scope check (closes 6.3c's security-reviewer LOW)
Both `applyMistakes` and `recordProposedMistakes` must check their `scope` argument against the
adapter's already-bound pair, mirroring `applyEvidence`'s existing inline check, and do this
**before** any session/style-card resolution (fail fast and cheaply on an obvious scope violation,
without touching the database for the mistaken pair):

```ts
if (scope.studentId !== bound.studentId || scope.teacherId !== bound.teacherId) {
  throw new RepositoryError('scope', method);
}
```

### 4. `recordProposedMistakes` stays a documented no-op
Per the board task and 6.3c's own open-question 3 (lead already accepted this): the real
persistence of proposed tags is 6.3a's job. `profileStoreFor.recordProposedMistakes` does the scope
check above and otherwise returns `Promise.resolve()`, with a doc comment saying so and naming 6.3a.

### 5. Threading `sessionId` through the real call chain
To make `sessionId` reach `profileStoreFor` for a genuine student turn:

- `apps/web/src/turn/routes.ts`: `TurnBackend.depsFor(scope: StudentScope): PipelineDeps` becomes
  `depsFor(scope: StudentScope, sessionId?: string): PipelineDeps`. The `postTurn` handler already
  has `sessionId` in scope at its `deps = b.depsFor(scope)` call (it just fetched `session` with
  that exact id) — change the call to `b.depsFor(scope, sessionId)`.
- `apps/web/src/turn/runtime.ts`: `depsFor: (scope) => turnDepsFor(turnProcess, scope)` becomes
  `depsFor: (scope, sessionId) => turnDepsFor(turnProcess, scope, sessionId)`.
- `apps/web/src/turn/deps.ts`: `turnDepsFor(p, scope)` becomes `turnDepsFor(p, scope, sessionId?)`,
  passing it straight through to `profileStoreFor(p.repos, scope, sessionId)`.
- `apps/web/test/turn-backend.ts`: `memoryBackend()`'s `depsFor = (scope) => ...` needs the same
  optional second parameter added to stay type-compatible with the updated `TurnBackend` interface;
  its body can ignore the parameter (this backend's own `profiles()` helper has no sessionId
  concept and is already a safe no-op for the new methods).

### 6. Other adapters (worker gate, studio test-chat, CLI chat)
- `apps/worker/src/gate/ports.ts` (`gateCasePorts`) and `apps/cli/src/commands/chat/deps.ts`
  (`memoryProfileStore`) build `ProfileStore` objects with only `get`/`applyEvidence`. Because
  Phase A's `commit.ts` calls the new methods through optional chaining
  (`profiles.applyMistakes?.(...)`) and only when non-empty, both are *already* safe no-ops with
  zero code change required for correctness.
- `apps/web/src/studio/testChat/deps.ts` (`testChatDepsFor`) spreads `...turnDepsFor(p, scope)` and
  then overrides `profiles: previewProfileStore()` — the override happens after, so this file needs
  no functional change; `turnDepsFor`'s new third parameter can default to `undefined` here with no
  effect.
- The board task's phrase "add the methods to the worker gate, studio test-chat, CLI chat and web
  test-backend adapters" is read as: make sure each keeps compiling against the (unchanged)
  `ProfileStore` port shape and, where cheap, add in-memory tracking of calls for test visibility —
  **not** that any of them need real persistence. Given the acceptance criteria only requires
  proof through "the real db adapter," and the budget below, tracking additions to the CLI and
  worker adapters are **nice-to-have, droppable if the builder is tight on budget** — correctness
  does not depend on them. If time allows, mirror the shape of the harness's own
  `packages/harness/src/testing/memoryPorts.ts` `MemoryProfileStore` (currently: `{ applied:
  EvidenceEvent[] }`) with a parallel `appliedMistakes`/`proposedMistakes` array — but that file
  itself is Phase A's / harness's territory, not this task's, so only the CLI's and worker's own
  separate (same-named-but-distinct) in-memory stores are candidates for this, and only if budget
  allows.

### Corrections to the 6.3c draft plan
The pre-split `docs/tasks/6.3c/plan.md` Phase B section has two things that don't hold once this is
traced concretely, corrected here so the builder doesn't propagate them:
1. It names the test file as `packages/db/src/repositories/ports.test.ts` — that file does not
   exist. The real, existing int-test file for this adapter is
   `packages/db/test/profile-store.int.test.ts`; extend it, don't create a new file.
2. It claims `apps/web/src/turn/deps.ts` is "already wires `profileStoreFor` — no change needed, it
   inherits the new methods automatically through the same function." That's true only if
   `allowedTags` is ignored — once the style card's `mistakeTags` has to reach the adapter somehow,
   `deps.ts` (and its callers `routes.ts`/`runtime.ts`) need the `sessionId`-threading change in
   section 5 above, or every real turn would call `applyMistakes` with `sessionId === undefined` and
   always throw.

## Files to create/modify
- `packages/db/src/repositories/ports.ts` — real `applyMistakes`/`recordProposedMistakes` on
  `profileStoreFor`, optional third `sessionId` constructor parameter, scope check.
- `packages/db/test/profile-store.int.test.ts` — extend with the new cases (see Tests first).
- `apps/web/src/turn/deps.ts` (+ its existing test file if any) — thread `sessionId` through
  `turnDepsFor`.
- `apps/web/src/turn/routes.ts` — `TurnBackend.depsFor` signature; `postTurn`'s call site.
- `apps/web/src/turn/runtime.ts` — `depsFor` wiring.
- `apps/web/test/turn-backend.ts` — signature compat only (accept and ignore the new parameter).
- `apps/cli/src/commands/chat/deps.ts` (+ `deps.test.ts`) — optional, droppable under budget.
- `apps/worker/src/gate/ports.ts` — optional, droppable under budget.
- `apps/web/src/studio/testChat/deps.ts` — read for confirmation only; no change expected.

## Files out of bounds
- `packages/contracts/**`, `docs/adr/**` — Phase A's (6.3c) territory; the port shape is frozen for
  this task.
- `packages/harness/**` (including `packages/harness/src/testing/memoryPorts.ts` and
  `packages/harness/src/pipeline/steps/commit.ts`) — Phase A's / 6.4c's territory.
- `packages/db/src/repositories/learner.ts`'s `applyMistakes` method body — already shipped in 6.3b;
  call through to it, do not modify it.
- 6.3a's territory: any real persistence for `recordProposedMistakes`, the proposals table.
- 6.4c's files: `packages/harness/src/pipeline/runner.ts`, `packages/harness/src/tools/practice.ts`,
  the `apps/web` sessions-end route. 6.4c is still `status: todo`; if it starts before 6.3d lands,
  do not touch its files from this branch.
- 8.2q's files: `apps/web` upload routes, `apps/web` S3 presign code, and (not yet reached by that
  task) `packages/db` chunks.ts and the ingest sweep. 8.2q is `status: running` right now.

## Overlap with other in-flight tasks
- **8.2q** (running): touches `apps/web` upload routes and S3 presign code, later
  `packages/db/chunks.ts` and the ingest sweep. No file overlap with this plan's list — both touch
  `apps/web` and `packages/db` but disjoint subpaths (`turn/**` vs upload/presign routes;
  `repositories/ports.ts`+`test/profile-store.int.test.ts` vs `chunks.ts`+ingest). Safe to run
  concurrently; the builder should still pull `main` before opening the PR in case 8.2q merges
  first, since both land commits in `packages/db`.
- **6.4c** (todo): will touch `packages/harness/src/pipeline/runner.ts` and
  `packages/harness/src/tools/practice.ts`, and the `apps/web` sessions-end route. No direct file
  overlap with this plan either, but 6.4c depends on 6.3c and likely builds on the same
  `commit.ts`/pipeline wiring this task's design assumes is already in place. Recommend to the lead:
  keep the existing sequencing — 6.3d (this task) after 6.3c merges, 6.4c after 6.3d, so 6.4c's
  builder sees the finished `applyMistakes` wiring rather than a half-built one.

## Tests first
All in `packages/db/test/profile-store.int.test.ts`, using the file's existing `up`/`repos`/`own`/
`kind()` fixtures and `isolation-seed.ts`'s seeded teacher A / student 1 (`own`). New style cards and
agent versions are created as fresh immutable rows (never mutating the seeded `sty_a`/agent-version
1 that other tests in this file and others may depend on), mirroring `isolation-seed.ts`'s own
direct-insert pattern for agent versions (no `agentVersionsRepo.create` exists) and
`repos.styleCards.create` for the style card itself.

1. **Known tag lands on the profile.** `repos.styleCards.create({teacherId: A}, {text, mistakeTags:
   ['late_carry']})` → new style card row. Insert a new `agent_versions` row for agent A pointing
   `styleCardId` at it (direct schema insert, as `isolation-seed.ts` does — no repo `create` method
   exists for agent versions). `repos.sessions.create(own, {agentId: ids.agent('A'), agentVersion:
   <new version>, packageId: ids.pkg('A'), packageVersion: 1})` → `{id: sessionId}`. Call
   `profileStoreFor(repos, own, sessionId).applyMistakes(own, [{tag: 'late_carry', ...}], [])`.
   Assert `repos.learnerProfiles.get(own)` (or a direct `select` on `learner_profiles`) now has
   `'late_carry'` in `mistakes`.
2. **Off-list tag is refused.** Same session, call `applyMistakes(own, [{tag: 'not_on_card', ...}],
   [])`. Assert `await kind(...)` is `'scope'`, and that the profile's `mistakes` is unchanged from
   before the call (no partial write).
3. **Other-pair scope error.** Using the same adapter instance (bound to `own`), call
   `applyMistakes({studentId: own.studentId, teacherId: teacherId('B')}, [...], [])` (or student 2 /
   teacher A). Assert `await kind(...)` is `'scope'`, and confirm via a direct check that no session
   lookup for the mismatched pair happened (optional — the important assertion is no write).
4. **`recordProposedMistakes` is a documented no-op.** Call it with a non-empty `proposed` array for
   the bound pair; assert it resolves and leaves `learner_profiles` unchanged. Call it with another
   pair's scope; assert `kind === 'scope'`.
5. **Missing/unresolvable session is an `integrity` error, not a silent drop.** Call
   `profileStoreFor(repos, own, 'session-does-not-exist').applyMistakes(own, [{tag: 'late_carry',
   ...}], [])`; assert `await kind(...)` is `'integrity'`.
6. **No `sessionId` and a non-empty `known` array is also an `integrity` error** (the composition
   root forgot to pass it): `profileStoreFor(repos, own).applyMistakes(own, [{tag: 'late_carry',
   ...}], [])` → `kind === 'integrity'`.
7. Existing `profileStoreFor(repos, own)` / `profileStoreFor(repos, fresh)` calls for `get`/
   `applyEvidence` throughout this file must keep compiling and passing unchanged (no test changes
   needed there — proves the new parameter is additive, not breaking).

Optional, budget-permitting: a unit test in `apps/web/src/turn/deps.test.ts` (if it exists) or a new
one, asserting `turnDepsFor` passes `sessionId` through to `profileStoreFor`'s constructor call
(can be checked with a lightweight spy/fake `repos.sessions`/`createRepositories`-shaped stub if the
existing test setup supports it; if not, this is covered well enough by the db-backed cases above
plus the unchanged `apps/web/test/turn-backend.ts` compiling, and can be skipped).

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/db/src/repositories/**` → **risky** (matches `packages/db/src/repositories/**`,
  `# reviewers: security-reviewer`). `ports.ts` is the one file in this task's list under this
  path. Reviewer required: **security-reviewer**. The lead logs a `risk: high` decision entry on
  merge (per non-negotiable #6).
- `apps/web/src/turn/**`, `apps/web/test/**`, `apps/cli/**`, `apps/worker/src/gate/**`,
  `apps/web/src/studio/testChat/**` — **not listed** in `risk-paths.txt` (only `apps/web/app/api/**`
  and `apps/web/src/auth/**` subpaths are called out for `apps/web`). No extra reviewer beyond the
  standard code-reviewer/typescript-reviewer pass.
- `packages/contracts/**`, `docs/adr/**` — not touched by this task (Phase A's territory); no ADR
  review needed here.

## Decisions draft (for the handoff's `## Decisions` → decision log)
- `risk: high` — `packages/db/src/repositories/ports.ts` (risky path, security-reviewer required).
- The design decision in section 2 above (`sessionId` as the third optional constructor parameter,
  resolved lazily via the session→agentVersion→styleCard chain, `integrity` error kind on an
  unresolvable chain) is not directly specified by the board task text and should be logged as a
  decision if the builder proceeds with it unchanged.

## Open questions
1. Is `RepositoryError('integrity', ...)` the right kind for a missing/ended session or a
   missing `sessionId` when `known` is non-empty, or should this instead be a silent no-op (drop the
   mistake tags quietly)? **Recommendation: `integrity`** — matches the 9.4d convention for a
   composition-root wiring mistake, and a silent drop would hide a real bug in production.
2. Are the CLI/worker in-memory tracking additions (section 6) in scope for this task, or fully
   droppable? **Recommendation: droppable** — the acceptance text only requires proof "through the
   real db adapter"; CLI/worker tracking is test-visibility polish with no bearing on acceptance.

## Budget
Budget: 65 tool calls (1 phase, packages/db + apps/web + apps/cli + apps/worker)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm test/typecheck/lint for @edmate/db and @edmate/web, and
the merge-gate/secret-scan scripts only — no other shell use).

## Exit conditions
`Status: DONE` once `packages/db/src/repositories/ports.ts`'s `applyMistakes`/
`recordProposedMistakes` are real, the `sessionId` threading through `apps/web/src/turn/{routes,
runtime,deps}.ts` and `apps/web/test/turn-backend.ts` compiles and gates green, the six new
`packages/db/test/profile-store.int.test.ts` cases pass against a real throwaway Postgres instance,
`corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` and
`--filter=@edmate/web...` are green, the secret scan is clean, and the handoff logs the
`risk: high` decision for `packages/db/src/repositories/**`. `Status: PARTIAL` past ~65 tool calls,
if 6.3c (Phase A) hasn't actually merged to `main` yet when the build starts, or if the CLI/worker
tracking additions are the only thing left and budget is tight (drop them per Open question 2 and
finish DONE on everything else instead of going over budget for them).

## Lead answers (27 Oct 2026)
1. **Integrity error, yes.** A missing `sessionId`, or a session or agent version that can't be found, while `known` is non-empty throws `RepositoryError('integrity', ...)`, the same way `applyEvidence` surfaces wiring mistakes. Resolve the style card through the session row whatever its status (don't require an active session), so a tag write racing session end still lands.
2. **Droppable.** The CLI and worker tracking additions are out of scope; leave those adapters as they are unless the typecheck needs a change.
3. **6.3c Phase A is now merged on main** (PR #376). The builder reads the merged `packages/contracts/src/ports.ts`, `packages/harness/src/pipeline/steps/commit.ts` and `packages/harness/src/testing/memoryPorts.ts` first, and if anything in this plan disagrees with them, follows the merged code and logs a decision.
