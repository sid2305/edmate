# 3.2 handoff — `admit` and `entitle`

Status: DONE
Branch: `m3/3.2-admit-entitle`
Worktree: `.claude/worktrees/agent-ae649827d04bf2a56` (under the repo root)

## Acceptance evidence

Node 22.22.3 from nvm, pnpm through corepack. Postgres from
`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`,
stopped afterwards. All after merging origin/main (1.6 audit log) into the branch.

| Item | Evidence |
|---|---|
| Each rejection returns its code | `pipeline/steps/admit.test.ts` + `pipeline/steps/entitle.test.ts`, run through `runTurn` with the real admit/entitle and `unusedPort` gateway, retrieval and profiles (`testing/accessTurn.ts`). Text of 4,001 code points, 4,001 emoji, 8,001 UTF-16 units, 3 attachments, skillPayload > 16 KB, unserialisable payloads → `input_too_large` (false); 11th turn in 60 s → `rate_limited` (true); resolve `null`, paused, unknown/draft agent, config `null` (other student/teacher/agent/ended/unknown session), malformed ids, every ADR-0004 mismatch → `no_access` (false); message 21 at `dailyMessageLimit` 20 → `limit_reached` (false); store throw/hang → `no_access` (true); limiter throw/hang → `rate_limited` (true). Each asserts the single `error` event, no step after admit/entitle, model calls `[]`, trace `null`. |
| Paused and ended refused | entitle table: `subscription`, `teacher_preview`, `eval` × `paused`/`ended` → `no_access` (and `active` passes). `entitlement-store.int.test.ts`: the db adapter returns `null` for an ended subscription and returns paused as stored. |
| Client package ids ignored | `entitle.test.ts`: input with smuggled `packageId: 'pkg_b'`, `packageVersion`, `allowedModuleIds`, `lockedModuleIds`, `skills`, `teacherId`, `source` (cast past the type) yields exactly the clean turn's entitlement/config for teacher A; the store spy shows `resolve` received only `{ studentId, agentId, source }`. The boundary's strict parse still rejects them (contracts `TurnInputSchema` is a strict object, covered by the contracts strict tests). |
| Preview and eval need no subscription | memory (`memoryAccess.test.ts`, `entitle.test.ts` with zero subscription rows) and db (`entitlement-store.int.test.ts`, `tch_a` has no subscription row): `teacher_preview` and `eval` resolve with no `subscriptionId`; a student id that is not the agent's teacher gets `null` for preview. |
| ADR-0004 required tests (a), (b) | `testing/memoryAccess.test.ts` and `packages/db/test/turn-config.int.test.ts` (the db test runs the real harness `entitle` on the db adapters): `load` → `null` for another student's / teacher's / agent's session, an ended one and an unknown one, and `entitle` → `no_access`; session pinned to v1 while v2 is live → v1 (and changing the row's `agent_version` changes the loaded version); a store returning an agent with another `id` or `teacherId` → `no_access`. |
| Property test | `access/property.test.ts`: seed 20261018 (printed), 2,000 iterations over the two-teacher world with hostile EntitlementStore / TurnConfigStore wrappers swapping in teacher B's agent, package, style card, module ids, skills, status, market. Outcomes `{"no_access":1755,"subscription:ok":173,"teacher_preview:ok":32,"eval:ok":40}`; every accepted turn returns objects all owned by `e.teacherId`, ids/versions matching `e`, allowed ⊆ package modules, skills ⊆ package skills, the session the entitlement's own, open, and the agent at its pinned version. |
| Injected clock | `limits.test.ts`, admit and entitle tests advance `virtualClock()`: turn 11 refused at +59,999 ms after turn 1 and allowed at +60,001 ms (only one slot freed); message 21 refused at 24 h − 1 ms and allowed at 24 h + 1 ms after message 1; refused takes never count; 10,000 one-off keys are pruned after the window. No `Date.now` in `src/`. |
| Harness gates | `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=...@edmate/db --filter=@edmate/db...` → `Tasks: 25 successful, 25 total`; harness `Tests 308 passed (308)`, coverage `src/access` 100/100/100/100, `pipeline/steps` 100/100/100/100, all files 99.3 % statements / 96.7 % branches. |
| DB gates | `corepack pnpm turbo run test --filter=@edmate/db --force` (Postgres up) → `Test Files 11 passed (11)`, `Tests 268 passed (268)`, no skips; `[isolation] 26 methods` incl. `agents.get`, `agents.owner`, `modules.ids`, `styleCards.get`, `packageVersions.getById`, `packageVersions.latest` with 0 leaks; coverage `src/repositories` 100/100/100/100 (`ports.ts` 100). |
| Dependents | gateway `222 passed`, evals `103 passed`, cli `29 passed`, contracts `282 passed`, config `34 passed`. |
| Format | `prettier --check packages/db packages/harness` → all formatted. (`pnpm format:check` at the root flags `.github/workflows/ci.yml`, which this branch does not touch; it is the same on main.) |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0, no output. |
| Contracts | `packages/contracts/**` untouched (Option A). |

## Changes

Harness (`packages/harness`):
- `src/pipeline/steps/admit.ts`: input limits from `LIMITS` (`input_too_large`; a wrongly typed `text` or `attachments` is `validation`), then the rate limit via `deps.limits.rate` (10 per trailing 60 s per student; skipped for `eval`). Exported `checkInputLimits`.
- `src/pipeline/steps/entitle.ts`: validates the three ids, resolves with only `{ studentId, agentId, source }` (source from `deps.entitlementSource`), `checkEntitlement`, `deps.turnConfig.load`, `checkTurnConfig`, then (subscriptions only) one take from `deps.limits.messages` keyed `studentId:packageId` with the package's `dailyMessageLimit`, as the last action.
- `src/access/{entitlement.ts,index.ts}` (new, risky): pure `checkEntitlement` and `checkTurnConfig` returning reason codes; every ADR-0004 Decision 5 equality plus allowed modules ⊆ package modules and skills ⊆ package skills.
- `src/pipeline/limits.ts` (new): `TurnCounter` interface (`tryTake(key, max)`, may be async), in-memory `slidingWindow` with sweep-based pruning, `createTurnLimits(clock)`. Constants `RATE_LIMIT_TURNS`, `RATE_LIMIT_WINDOW_MS`, `MESSAGE_WINDOW_MS` in `spec.ts`.
- `src/pipeline/types.ts`: `PipelineDeps` gains `turnConfig`, `entitlementSource`, `limits`; `Entitled` comment updated.
- `src/testing/`: `memoryAccess.ts` (`twoTeacherWorld()`, `memoryEntitlementStore`, `memoryTurnConfigStore`, `packMarket`), `accessTurn.ts` (`accessTurns()` drives turns through `runTurn` with the real admit/entitle), `prng.ts` (mulberry32); `testDeps()` defaults `turnConfig: unusedPort`, `entitlementSource: 'subscription'`, fresh limits.
- `src/pipeline/runner.test.ts`: the stub test no longer lists admit/entitle; the fail-closed test now shows the real entitle with a failing store gives `no_access` (retryable).
- Exports from `src/index.ts`, `pipeline/index.ts`, `testing/index.ts`; README section on admit/entitle.

DB (`packages/db`, no migration, no schema change):
- `src/repositories/ports.ts` (risky): `entitlementStoreFor(repos, { market, packMarket, preview?, eval? })` and `turnConfigStoreFor(repos, { locales })`.
- `src/repositories/agents.ts` (new): `agents.get(teacherScope, agentId)` and `agents.owner({ agentId })` (live agents only, returns `{ teacherId }` only; the one public read).
- `src/repositories/modules.ts` (new): `modules.ids(teacherScope)`.
- `src/repositories/style-cards.ts` (new): `styleCards.get(teacherScope, id)`, parsed with `StyleCardSchema`.
- `src/repositories/package-versions.ts`: `getById(teacherScope, packageVersionId)` and `latest(teacherScope, packageId)`.
- `src/repositories/index.ts` and README: new repositories and exports; README rule 11 (the public read) and the ports paragraph.
- Tests: isolation cases for all six new methods (a new `public` case kind for `agents.owner`), `test/access-seed.ts`, `test/entitlement-store.int.test.ts`, `test/turn-config.int.test.ts`, type checks in `test/types.test.ts`.
- `package.json`: devDependency `@edmate/harness: workspace:*` (as gateway has), so the db int test runs the real `entitle`; `pnpm-lock.yaml` regenerated.

## Deviations

1. **Eval options carry `teacherId`** (`eval: { teacherId, packageId, version, market }`; the plan had no teacher). Eval allows draft agents, which `agents.owner` (live only) cannot see, so the teacher comes from the trusted eval config and every read is scoped by it.
2. **Two extra repository methods**, `packageVersions.getById` (a subscription points at a `package_versions` row id) and `packageVersions.latest` (preview uses the newest version). Each has an isolation case.
3. **`agents.owner` takes `{ agentId }`**, parsed like a scope (`scope` error before SQL), not a bare id, so `scope.test.ts`'s "every method rejects a bad scope" covers it unchanged.
4. **No shared conformance case suite** exported from the harness. Instead the db int tests run the real harness `entitle` against the db adapters and repeat the same cases as `memoryAccess.test.ts`.
5. **Style card: the exact row `agent.styleCardId` names.** In the schema each style card version is its own immutable row with its own id (unique on teacher + version), so per the lead answer the adapter loads that row, not a "latest version". A test shows a newer row does not change the loaded card. 8.4 should resolve "edits apply on the next turn" by ADR amendment.
6. **A built entitlement that fails the contract throws** (`RepositoryError('integrity')` in db; a Zod error in memory) instead of returning `null`; both end the turn with `no_access` (retryable), and the failure is loud.
7. `memoryAccessWorld(seed)` became `twoTeacherWorld()` plus the two store factories; `accessTurn.ts` is an extra test helper.

## Decisions

### 18 Oct 2026 · 3.2 entitle resolves all three sources server-side and fails closed on any ownership mismatch · decided by builder (tdd-guide) on the plan and lead answers · risk: high
Decided: `entitle` sends only `{ studentId, agentId, source }` to `EntitlementStore.resolve`, with the source set by the composition root, and never reads package, module or skill ids from the input. It refuses `null`, paused and ended, loads the turn's config through `TurnConfigStore`, and ends the turn with `no_access` unless every object belongs to the entitlement (ADR-0004 Decision 5) and the entitlement's allowed modules and skills are within the package's. The db adapter adds the one repository read without a teacher or student scope, `agents.owner({ agentId })`, which returns only the owner's teacher id and only for live agents. Preview and eval packages are bound from trusted server state when the store is built.
Why: build plan § Access filter 1 and 7, ADR-0003 point 1 and ADR-0004; the subscription path needs the agent's teacher before any student-scoped read, and that link is public on teacher pages.
Alternatives: a student-only scope joining subscriptions to packages in one statement; trusting a client package id when it matches.
Reversible: yes (code only; no contract or schema change). Needs security-reviewer sign-off on `agents.owner`.

### 18 Oct 2026 · 3.2 Rate and daily message limits are in-memory sliding windows · decided by team lead (Q1 = A, Q3) · risk: medium
Decided: admit allows 10 admitted turns per student per trailing 60 s, for every source except eval; refused turns don't count, turns that entitle later refuses do. entitle allows `dailyMessageLimit` messages per student × package per rolling 24 h, for subscriptions only; the take is the last action after every await, so a refused turn never counts and concurrent turns can't both take the last slot. Both are `TurnCounter`s in `PipelineDeps.limits`, built once on the injected clock; a restart or a second instance resets them until task 3.14.
Why: no contracts port counts turns; the lead chose to defer a durable store.
Alternatives: a contracts port with ADR-0005 now; per student × agent keys.
Reversible: yes; 3.14 swaps the counter (the interface allows an async `tryTake`).

### 18 Oct 2026 · 3.2 Teacher preview and eval accept any agent status · decided by builder (tdd-guide) · risk: medium
Decided: subscriptions need a `live` agent; teacher preview (only the agent's own teacher) and eval accept draft, live and suspended agents.
Why: plan Q8 allows drafts for preview and eval; a teacher may still preview, and the trust team evaluate, a suspended agent. Students can never reach it.
Alternatives: refuse suspended agents for preview and eval too.
Reversible: yes.

### 18 Oct 2026 · 3.2 admit does not authenticate or full-parse TurnInput · decided by builder (tdd-guide), plan Q4 · risk: low
Decided: the caller authenticates and merges `studentId`; `unauthorized` stays in the web layer. admit checks the limits in code (wrongly typed `text` or `attachments` is `validation`) and ignores fields it does not read; the boundary's strict parse rejects them.
Why: "client-sent package ids are ignored" and CLI/eval callers may pass unparsed objects.
Alternatives: parse `TurnInputSchema` in admit and return `validation`.
Reversible: yes.

### 18 Oct 2026 · 3.2 The style card is the exact row agent.styleCardId names · decided by team lead (Q6 answer) · risk: low
Decided: style card rows are immutable versions with their own ids, so `turnConfigStoreFor` loads exactly `agent.styleCardId`, keeping the `styleCard.id === agent.styleCardId` check. ADR-0004's "latest version" wording is left for 8.4 to settle by ADR amendment.
Why: the schema has no style card lineage id, so "latest version of `styleCardId`" and the fail-closed id check cannot both hold.
Alternatives: load the teacher's newest style card row (breaks the id check).
Reversible: yes, with 8.4's ADR amendment.

### 18 Oct 2026 · 3.2 An entitlement that cannot be valid throws instead of returning null · decided by builder (tdd-guide) · risk: low
Decided: when stored rows build an entitlement that fails `EntitlementSchema` (for example a bad market mapping), `entitlementStoreFor` throws `RepositoryError('integrity')`; entitle turns it into `no_access` (retryable).
Why: corrupt data should be loud, not look like "no subscription".
Alternatives: return `null`.
Reversible: yes.
