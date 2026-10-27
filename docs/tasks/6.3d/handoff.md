# Handoff: 6.3d
Status: DONE

## Summary
Wired `ProfileStore.applyMistakes`/`recordProposedMistakes` (ADR-0017, frozen port shape from the
merged 6.3c Phase A) through the real db adapter (6.3c Phase B).

- `packages/db/src/repositories/ports.ts` — `profileStoreFor` now takes an optional third
  `sessionId` constructor parameter. `applyMistakes` checks the scope against the bound pair first
  (fails fast, no DB touch on a scope violation), is a no-op for an empty `known`, and otherwise
  resolves the style card's `mistakeTags` allow-list lazily via
  `sessions.get` -> `agentVersions.get` -> `styleCards.get` (same chain `turnConfigStoreFor.load`
  already uses), then calls `repos.learnerProfiles.applyMistakes(bound, known, allowedTags)`
  (6.3b's real merge/lock/allow-list check, untouched). A missing `sessionId` or any break in that
  chain throws `RepositoryError('integrity', ...)` (lead answer 1: a wiring mistake, not a silent
  drop; the session is resolved whatever its status). `recordProposedMistakes` does the same scope
  check and is otherwise a documented no-op (6.3a's job).
- `packages/db/test/profile-store.int.test.ts` — seven new cases against a real throwaway
  Postgres, each building its own style card + agent version + session (never mutating the seed's
  `sty_a`/agent version 1):
  - **Red-then-green, wrong-practice-answer case**: a known tag on the style card
    (`applyMistakes(scope, [{tag: 'late_carry', ...}], [])` through
    `profileStoreFor(repos, scope, sessionId)`) lands on `learner_profiles.mistakes` through the
    real db adapter — failed before the `ports.ts` change (no `applyMistakes` method existed on
    the returned object; TS wouldn't even compile the old test file without `!`-asserting into a
    non-existent method), passes after.
  - **Red-then-green, mismatched-scope case**: an off-list tag (not on the style card) is a
    `scope` error and writes nothing; a call naming another teacher for the same student is also
    `scope` and writes nothing (checked before any session lookup, since `checkPair` runs first).
  - `recordProposedMistakes` resolves for the bound pair (no-op, no write) and is `scope` for
    another pair.
  - A missing/unresolvable `sessionId` with a non-empty `known` is `integrity` (not a silent
    drop); no `sessionId` at all with non-empty `known` is also `integrity`; an empty `known` with
    no `sessionId` is a no-op (no DB touch, no error — matches `commit.ts`'s
    "only call when non-empty" gate).
  - All pre-existing `applyEvidence`/mastery/`get` cases in this file pass unchanged, proving the
    new parameter is additive.
- `apps/web/src/turn/deps.ts` — `turnDepsFor(p, scope, sessionId?)` threads `sessionId` straight to
  `profileStoreFor(p.repos, scope, sessionId)`.
- `apps/web/src/turn/routes.ts` — `TurnBackend.depsFor(scope, sessionId?)`; `postTurn`'s call site
  passes the `sessionId` it already has in scope (`b.depsFor(scope, sessionId)`).
- `apps/web/src/turn/runtime.ts` — `depsFor: (scope, sessionId) => turnDepsFor(turnProcess, scope, sessionId)`.
- `apps/web/test/turn-backend.ts` — `depsFor` accepts (and ignores) the new optional `sessionId`
  parameter for signature compatibility; its own `profiles()` helper has no sessionId concept and
  is already a safe no-op for the new methods.
- `apps/web/src/studio/testChat/deps.ts` — read for confirmation only, no change: it spreads
  `...turnDepsFor(p, scope)` (no sessionId, harmless — `previewProfileStore()` overrides `profiles`
  right after) and still compiles.
- CLI (`apps/cli/src/commands/chat/deps.ts`) and worker gate (`apps/worker/src/gate/ports.ts`)
  tracking additions: dropped per Lead answer 2 (droppable, out of scope) — neither needed any
  change to keep compiling (both already call the optional methods through `?.()`/are unaffected).

## Decisions
### 27 Oct 2026 · 6.3d sessionId as profileStoreFor's third optional constructor parameter · decided by builder · risk: low
- Decided: `profileStoreFor(repos, scope, sessionId?)` resolves the style card's `mistakeTags`
  allow-list lazily (only when `known.length > 0`) by threading the session id from the
  composition root, following the plan's design section 2/5 and Lead answer 1 unchanged.
- Why: the style card is not available at composition-root time; `sessionId` is the cheapest value
  that is, and the plan/lead answer already settled the design and the `integrity` error kind — no
  new judgment call, just confirming the plan was followed as written.

### 27 Oct 2026 · 6.3d packages/db/src/repositories/ports.ts is a risky path · decided by builder · risk: high
- Decided: this PR touches `packages/db/src/repositories/ports.ts`
  (`packages/db/src/repositories/**`, risky path per `.claude/skills/merge-gate/risk-paths.txt`).
  `review.md` must name **security-reviewer** and **database-reviewer** as required reviewers for
  this group before merge.
- Why: non-negotiable #6 and the plan's own "Risky paths touched" section — a repository adapter
  change needs a security pass (scope/allow-list correctness) alongside the usual database review.

### 27 Oct 2026 · 6.3d recordProposedMistakes made async · decided by builder · risk: low
- Decided: `profileStoreFor.recordProposedMistakes` is declared `async` (not a plain function
  returning `Promise.resolve()`), so its scope-check throw becomes a rejected promise rather than
  a synchronous throw.
- Why: the port is called as `profiles.recordProposedMistakes?.(scope, proposed)` and tested via
  `await kind(store.recordProposedMistakes!(...))`, which expects a promise it can `.then()`/catch
  on; a synchronous throw from a non-async function broke that at the first scope-violation test
  case (caught during red-then-green testing, not spec'd either way by the plan).

## Gate
- `corepack pnpm turbo run typecheck lint --filter=...@edmate/db --filter=@edmate/web...` — **green**
  (30 tasks, 30 successful; two pre-existing unrelated eslint warnings in
  `apps/web/test/lighthouse-a11y.test.ts`, 0 errors).
- `corepack pnpm turbo run test --filter=@edmate/db --filter=@edmate/web` — one unrelated flake
  under machine load: `apps/web/src/turn/runtime.test.ts` timed out once in the full parallel run
  (shared dev Postgres across builders); re-ran that file alone: **21/21 passed**, including the
  `depsFor` test. `packages/db/test/profile-store.int.test.ts` (the 30 tests, including the 7 new
  6.3d cases): **30/30 passed**.
- A separate full-repo run (`--filter=...@edmate/db --filter=@edmate/web...`, which also pulls in
  `@edmate/cli`) hit the same kind of flake: `apps/cli/test/chatDbRetrieval.int.test.ts` timed out
  once under load; re-ran alone: **passed** (1 passed, 1 skipped).
- `corepack pnpm exec prettier --check` on the six changed files: **clean** (ran `--write` once
  first to fix 4 files' formatting, then confirmed clean).
- `python3 .githooks/secret-scan.py --all`: **clean**, no output.

## Budget
Tool calls used: 56
