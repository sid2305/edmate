# Task 3.2: `admit` and `entitle`

Board: `board.py show 3.2` · M3 · deps 2.6, 3.1, 3.13, M0 (all done) · branch `m3/3.2-admit-entitle` · **risky** (see Risky paths touched). Planner: opus.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "`admit` and `entitle`: rate limit, input limits, server-side entitlement for all three sources, rolling message limit"
Accept: "each rejection returns its code; paused and ended are refused; client-sent package ids are ignored; teacher preview and eval entitlements never need a subscription."

Spec it must honour:
- Build plan § Turn pipeline spec, step 1 `admit`: "Auth, rate limit (10 turns/min/student), input limits (≤ 4,000 chars, ≤ 2 attachments)", 50 ms, "`error` event; no model call".
- Step 2 `entitle` (as updated by 3.13): resolve server-side (subscription, teacher preview or eval); "refuse none, paused or ended; rolling 24-hour message limit; load the agent, package, style card and locale pack through `TurnConfigStore` (ADR-0004): the session must be open and belong to the entitlement's student, teacher and agent (a session id is never trusted on its own); the agent is loaded at the session's server-set `agent_version`; each loaded object must belong to the entitlement's teacher", 50 ms, "Fail closed: `no_access` or `limit_reached`".
- § Access filter 1 and 7: entitlements computed server-side, a client package id never trusted; `entitle` reads the subscription fresh every turn.
- ADR-0003 point 1; ADR-0004 Decision 3–5 and the **required tests** in its Consequences: (a) a session of another student, teacher or agent, or an ended one, gives `null` from `load` and `no_access` from `entitle`; (b) the agent is loaded at exactly the session row's `agent_version`, and an agent whose `id` or `teacherId` differs from the entitlement gives `no_access`.
- Contracts (frozen): `LIMITS.turnTextMaxChars/turnTextMaxLength/turnAttachmentsMax/skillPayloadMaxJsonLength`, `countChars`, `EntitlementSchema` (subscriptionId iff subscription; allowed ∩ locked = ∅), `PackageConfig.dailyMessageLimit` (rolling 24 h; seed/studio default 20, decision log 0.3), `ErrorCode`, `EntitlementStore`, `TurnConfigStore`.
- 3.1 policies (unchanged): `TurnRejection(code, retryable)` keeps its code; a throw/timeout in admit → `rate_limited`, in entitle → `no_access` retryable; runner re-checks student/agent/paused/ended (`entitledMismatch`).
- Rule 3 (harness purity), rule 4 (no model calls; `unusedPort` gateway proves it), 1.2 repository rules (scope first, parsed rows, isolation case per method).

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Each rejection returns its code | `steps/admit.test.ts` + `steps/entitle.test.ts`: a table test, one row per cause, run through `runTurn` with the real admit/entitle and `unusedPort` gateway/retrieval/profiles: text 4,001 code points, text 8,001 UTF-16 units, 3 attachments, skillPayload > 16 KB → `input_too_large` (retryable false); 11th turn in 60 s → `rate_limited` (true); resolve `null` → `no_access` (false); status `paused`, `ended` → `no_access`; config `null` → `no_access`; each ADR-0004 mismatch → `no_access`; count = `dailyMessageLimit` → `limit_reached` (false). Each asserts the single `error` event, no later step ran, gateway calls = [], trace `null`. |
| Paused and ended refused | rows above, for all three sources; plus the db adapter returns `null` for an ended subscription (int test). |
| Client package ids ignored | `entitle.test.ts`: an input carrying smuggled `packageId`, `packageVersion`, `allowedModuleIds`, `skills` (cast past the type) for teacher B's package yields exactly the server's entitlement/config for teacher A; the store spy shows `resolve` received only `{ studentId, agentId, source }`. The boundary still rejects them (existing contracts strict test, cited). |
| Preview and eval need no subscription | memory and db adapters: with no subscription row at all, `teacher_preview` (teacher previewing own agent) and `eval` resolve to a valid entitlement with no `subscriptionId`; a student id that is not the agent's teacher gets `null` for preview. |
| ADR-0004 required tests (a), (b) | `testing/memoryAccess.test.ts` and `packages/db/test/turn-config.int.test.ts`: `load` → `null` for another student's / teacher's / agent's session and an ended one, and `entitle` → `no_access`; session pinned to agent v1 while v2 is live → v1 returned; a store returning an agent with another `id` or `teacherId` → `no_access`. |
| Property test | `access/property.test.ts`: seeded PRNG (seed printed), 2,000 iterations over a two-teacher world: random student/agent/session/source, plus a "hostile" TurnConfigStore/EntitlementStore that randomly swaps in teacher B's agent, package, style card, locale or module ids. Invariant: entitle either rejects (`no_access`/`limit_reached`) or returns objects all owned by `e.teacherId` with ids/versions matching `e`, and `allowedModuleIds ⊆ pkg.moduleIds`. No fast-check (1.2 decision; harness purity). |
| Injected clock | rate-limit and 24 h window tests advance `virtualClock()`/`manualClock()`; window slides (turn 11 allowed at +60,001 ms; message 21 allowed 24 h + 1 ms after message 1). No `Date.now` in `src/`. |
| Gates | `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/db...` green; db int suite run against Postgres (CI) with repository coverage thresholds; `packages/contracts/**` untouched (Option A). |

## Design

### admit (`pipeline/steps/admit.ts`)
1. Input limits (no state): `text` UTF-16 length > `LIMITS.turnTextMaxLength` or `countChars` > `turnTextMaxChars`; `attachments.length` > `turnAttachmentsMax`; `skillPayload` JSON length > `skillPayloadMaxJsonLength` (or unserialisable) → `TurnRejection('input_too_large', false)`. Checked in code because CLI/eval callers may hand `runTurn` an unparsed object.
2. Rate limit: `deps.limits.rate.tryTake(studentId)` — 10 admitted turns per trailing 60,000 ms per student, across agents. Rejected turns do not consume a slot. Over → `TurnRejection('rate_limited', true)`.
3. "Auth": admit does not authenticate; the caller (web route, CLI) authenticates and merges `studentId` (contracts comment on `TurnInputSchema`). `unauthorized` stays the web layer's (decision, low).
4. admit does **not** full-parse `TurnInputSchema` (so a smuggled package id is *ignored* in the pipeline, as accepted; the web boundary's strict parse rejects it) — see Q4.

### entitle (`pipeline/steps/entitle.ts`)
1. `source = deps.entitlementSource` (set by the composition root: student web route `subscription`, studio/CLI preview `teacher_preview`, eval runner `eval`; never from `TurnInput`).
2. `e = await deps.entitlements.resolve({ studentId, agentId, source }, isoAt(clock.now()))`; `null` → `no_access`. `EntitlementSchema.safeParse` + `checkEntitlement(e, input, source)` (access module): source equal, student/agent equal, status not paused/ended → else `no_access` (false).
3. `cfg = await deps.turnConfig.load(e, input.sessionId)`; `null` → `no_access`.
4. `checkTurnConfig(e, cfg)` (access module): every ADR-0004 rule-5 equality, plus `e.allowedModuleIds ⊆ pkg.moduleIds` and `e.skills ⊆ pkg.skills` (defence in depth, decision medium). Any failure → `no_access` (false).
5. Rolling limit (only for sources in Q3): key `${e.studentId}:${e.packageId}`; `deps.limits.messages.tryTake(key, pkg.dailyMessageLimit)` over 86,400,000 ms; over → `limit_reached` (false). Take happens **synchronously as the last action** after all awaits, so concurrent turns can't both pass at limit − 1 and a rejected turn never counts.
6. Return `{ entitlement: e, agent, pkg, locale, styleCard }`.

### Limits (`pipeline/limits.ts`, Option A — Q1)
`slidingWindow({ clock, windowMs, max? })` → `{ tryTake(key, max?): boolean; count(key): number }`. Pure, in-memory, injected clock; prunes expired timestamps on every call and deletes empty keys (bounded memory; a test shows 10,000 one-off keys are gone after the window). Constants in `spec.ts`: `RATE_LIMIT_TURNS = 10`, `RATE_LIMIT_WINDOW_MS = 60_000`, `MESSAGE_WINDOW_MS = 86_400_000`. `PipelineDeps.limits: { rate; messages }` is long-lived, built once by the composition root (`createTurnLimits(clock)` exported from the harness).

### PipelineDeps (`pipeline/types.ts`)
Add `turnConfig: TurnConfigStore`, `entitlementSource: Entitlement['source']`, `limits: TurnLimits`. Update the `Entitled` comment (loading is decided: ADR-0004). `testing/testSteps.ts` `testDeps()` gets defaults (`unusedPort` for `turnConfig`, `'subscription'`, fresh limits) so 3.1 tests stay unchanged.

### Access checks (`packages/harness/src/access/`, new; risky)
`entitlement.ts`: `checkEntitlement`, `checkTurnConfig` — pure, return a reason enum (never text from the objects) for tests; `index.ts`. These are the "entitlement resolution, allowed modules and skills" checks the repo layout puts in `src/access`.

### In-memory adapters (`harness/src/testing/memoryAccess.ts`)
`memoryAccessWorld(seed)` → `{ entitlements: EntitlementStore; turnConfig: TurnConfigStore; world }` over synthetic teachers, agents (versions, status), packages (versions), style cards, modules, subscriptions, sessions (agentVersion, endedAt) and locale packs. Same semantics as the db adapter (below), including ADR-0004 rule 3/4. Also `twoTeacherWorld()` for the property and conformance tests. A shared conformance suite `turnConfigStoreCases` / `entitlementStoreCases` (plain data + expectations, no vitest import in src) is exported so the db int test runs the same cases.

### db adapters (`packages/db/src/repositories/`; risky)
- `entitlementStoreFor(repos, opts)` in `ports.ts` (beside `transcriptStoreFor`), built per request by the composition root. `opts: { market: string; packMarket(m): string; preview?: { packageId: string }; eval?: { packageId: string; version: number; market: string } }`.
  - `subscription`: `agents.owner(agentId)` → teacher (published agents only, status `live`); `subscriptions.findLive(studentScope)`; `packageVersions` row behind `packageVersionId`; require `pkg.agentId === agentId`; status `ended`/`paused` → still returned so entitle refuses with `no_access` (or null; either gives `no_access`).
  - `teacher_preview`: `agents.get(teacherScope(studentId), agentId)` (only the agent's own teacher; drafts allowed), package = `opts.preview.packageId` at its newest version, which must belong to that teacher and agent. Status `active`, no subscription.
  - `eval`: package/version from `opts.eval`, must belong to the agent's teacher; status `active`, no subscription.
  - `allowedModuleIds = pkg.moduleIds`; `lockedModuleIds = modules.ids(teacherScope) − allowed`; `skills = pkg.skills`; `market = packMarket(opts.market)` (the contract says market is the *locale pack's* code, so an unknown market maps to `global` here and `locale.market === e.market` still holds, matching 3.10's fallback); `periodEnd` = subscription's, else `at` (valid for this turn only). Output parsed with `EntitlementSchema`.
- `turnConfigStoreFor(repos, { locales(market): LocalePack | null })`: `sessions.get(studentScope(e), sessionId)` → null unless `agentId === e.agentId` and `endedAt === null`; `agentVersions.get(teacherScope, { agentId, version: session.agentVersion })`; `packageVersions.get(teacherScope, { packageId: e.packageId, version: e.packageVersion })`; `styleCards.get(teacherScope, agent.styleCardId)`; `locales(e.market)`. Any null → null. Fixture locale pack until 3.10.
- New repository methods (each with an isolation case in `repositories.int.test.ts` and in `RepositoryMethod`):
  - `style-cards.ts`: `styleCards.get(scope: TeacherScope, id)` → `StyleCard | null`, parsed, integrity if row teacher ≠ scope.
  - `modules.ts`: `modules.ids(scope: TeacherScope)` → `string[]` (MVP: one course per teacher).
  - `agents.ts`: `agents.get(scope: TeacherScope, agentId)` → `{ id, teacherId, status, liveVersion } | null`; `agents.owner(agentId)` → `{ teacherId } | null` for `live` agents only — the one **unscoped** method (agent ↔ teacher is public on teacher pages); its isolation case asserts it returns nothing but the owner id and nothing for draft/suspended agents. Security-reviewer must sign this off (Q5).
- No migration; no schema change.

## Files

Create: `packages/harness/src/access/{entitlement.ts,entitlement.test.ts,property.test.ts,index.ts}`, `packages/harness/src/pipeline/{limits.ts,limits.test.ts}`, `packages/harness/src/pipeline/steps/{admit.test.ts,entitle.test.ts}`, `packages/harness/src/testing/{memoryAccess.ts,memoryAccess.test.ts,prng.ts}`, `packages/db/src/repositories/{agents.ts,modules.ts,style-cards.ts}`, `packages/db/test/{entitlement-store.int.test.ts,turn-config.int.test.ts}`.
Modify: `packages/harness/src/pipeline/steps/{admit.ts,entitle.ts}`, `pipeline/{types.ts,spec.ts,index.ts}`, `src/index.ts`, `testing/{index.ts,testSteps.ts}`, `packages/harness/README.md` (admit/entitle built), `packages/db/src/repositories/{index.ts,ports.ts}`, `packages/db/src/index.ts` (exports), `packages/db/test/{repositories.int.test.ts,isolation-seed.ts,types.test.ts}`, `packages/db/package.json` (devDependency `@edmate/harness: workspace:*` for the conformance cases, as 2.3/3.12 did — only if the builder uses the shared cases).

Out of bounds: `packages/contracts/**` and `docs/adr/**` (unless Q1 = B), `runner.ts`/`policies.ts` logic (only re-read), other steps, `guardrails/**`, `content/**`, `apps/**` (3.9 wires the CLI), db schema/migrations, the real locale loader (3.10), the cost alarm and friendly limit text (2.5 / web UI), docs/edmate-harness-build-plan.md.

## Tests first (order)
1. `limits.test.ts` (window, slide, prune, sync take). 2. `access/entitlement.test.ts` (each check, each reason). 3. `memoryAccess.test.ts` incl. ADR-0004 (a)/(b). 4. `admit.test.ts`, `entitle.test.ts` (the rejection table through `runTurn`, smuggled ids, preview/eval without subscription). 5. `property.test.ts`. 6. db: isolation cases for the new methods, then `turn-config.int.test.ts` (same (a)/(b)), `entitlement-store.int.test.ts` (three sources, ended/paused, other teacher's package, locked = teacher modules − allowed, unknown market → `global`).

## Risky paths touched
Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/harness/src/access/**` (new) → **security-reviewer**.
- `packages/db/src/repositories/**` → **security-reviewer**.
- Option B only: `packages/contracts/**`, `docs/adr/**` → architect, security-reviewer, typescript-reviewer.
- Not risky: `harness/src/pipeline/**`, `harness/src/testing/**`, `packages/db/test/**`, `packages/db/package.json`.
Recommended (not required): typescript-reviewer, silent-failure-hunter, database-reviewer (new SQL).
Handoff `## Decisions` needs a **risk: high** entry, e.g. "3.2 entitle resolves all three sources server-side and fails closed on any ownership mismatch; adds the one unscoped repository read `agents.owner`."

## Open questions (lead), with recommendations
1. **Where the counts live.** No contracts port counts messages or turns. **A (recommended):** in-memory sliding windows in the harness on the injected clock (like `Clock`, a harness parameter, not an adapter); known gap: a restart or a second instance resets the 24 h count — log it, and make a durable store (Redis, by ADR) a follow-up before the 13.2 load test. **B:** a new contracts port (e.g. `TurnCounter.take(key, max, windowMs, at)`) with ADR-0005 drafted by architect, Redis/db adapter; adds contracts + ADR reviewers.
2. **Package for preview and eval.** `resolve` has no package id. Recommend binding it at adapter construction from trusted server state (studio session / CLI `--package` / eval config), never from `TurnInput`; preview = newest version, eval = pinned version.
3. **Which sources the limits apply to.** Recommend: rolling message limit → `subscription` only (preview billed to the teacher, evals to Edmate; a 200-case suite would hit 20/day); rate limit → `subscription` and `teacher_preview`, `eval` exempt.
4. **admit full-parse?** Recommend no (pipeline ignores extra fields; the web/CLI boundary's strict parse rejects them), matching "ignored". Alternative: parse in admit and return `validation`.
5. **`agents.owner` unscoped read** (and live-only). Recommend yes; alternative is a student-only scope type joining subscriptions → packages in one statement.
6. **Style card "latest version".** `style_cards` rows are immutable versions with their own ids, so ADR-0004's "latest version of `agent.styleCardId`" and its check `styleCard.id === agent.styleCardId` can't both hold once a newer version exists. Recommend loading the exact row `agent.styleCardId` now (keeps the fail-closed check and required tests) and flagging 8.4 to resolve "edits apply on the next turn" by ADR amendment.
7. **Overlap with 2.5.** Recommend 3.2 owns the `limit_reached` check at entitle; 2.5 keeps the cost alarm and the friendly message, and may swap in a durable counter.
8. **Agent status.** Recommend subscription refuses agents not `live` (suspended by trust); preview and eval allow drafts.

Status: **READY** once Q1–Q3 are answered (the rest have safe defaults the builder can take and log).

## Lead answers (18 Oct 2026)

- Q1: A for now. Rate-limit and rolling daily-message windows live in memory in the harness, behind a small interface injected through PipelineDeps, so a durable store can replace it without touching admit. A restart resets them; acceptable while building. Follow-up task 3.14 (M7) makes the daily count durable and shared before the pilot (a contracts port with ADR-0005 if needed).
- Q2: accepted (preview/eval package fixed from server state when the adapter is built).
- Q3: accepted (daily limit only for subscriptions; rate limit for every source except eval).
- Q4–Q8: accepted as recommended, except the style card: follow ADR-0004 — load the latest version of `agent.styleCardId` if style cards are versioned in the schema; if `styleCardId` already identifies one immutable row, load exactly that and record it in the handoff.
- Required tests from ADR-0004: a session that isn't the entitled student's/teacher's/agent's, or is ended → `no_access`; the agent version always comes from the session row.
- Before your final push: merge origin/main, regenerate the lockfile if it conflicts, re-run gates.
