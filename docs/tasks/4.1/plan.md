# Task 4.1: Guard framework and registry

Board: `board.py show 4.1` · M4 · deps 3.1, 3.12 (both done) · branch `m4/4.1-guard-framework` · planner: sonnet.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Guard framework and registry"
Accept: "guards run in declared order and fail closed; `rewrite` returns replacement text."

### How it will be shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Declared order | `chain.test.ts`: a fixed `GUARD_ORDER` manifest per phase (`scrub`, `pre`, `post`) lists guard names in the build plan's guardrail-table order; `runGuardChain` with fake guards registered in scrambled call order still runs them in `GUARD_ORDER` order — asserted via a shared call-order spy, not import order. |
| Fail closed | `chain.test.ts`: (a) a guard that throws, (b) a guard that returns a value failing `GuardResultSchema`, and (c) a guard that times out past its own slice all stop the chain with `outcome: 'block'`, never `'ok'` — no later guard in the same phase runs, and the chain never throws (so the calling pipeline step's own fail-closed policy, already built by 3.1/3.2, still applies on top). |
| `rewrite` returns replacement text | `chain.test.ts`: a guard returning `{ ok: false, action: 'rewrite', text, reason }` makes the chain's returned `text` equal that `text`; a later guard in the same chain receives the rewritten text (not the original) as its input; two guards rewriting in sequence compose (second guard's output is the final `text`). |
| Registry rejects the undeclared | `registry.test.ts`: registering a guard whose `name` is not in that phase's `GUARD_ORDER`, or registering the same name twice, throws at registration time (fail closed at wiring time, not at turn time). |
| Trace shape unchanged | `chain.test.ts`: the chain's `guards` output is exactly `GuardTrace[]` (`{ name, ok, action? }`, no `reason`/`text`) for every outcome, matching `TurnTraceSchema.shape.guards` (ADR-0003: no guard text ever reaches the trace) — reuses the existing schema from `results.ts`, not a redefinition. |
| Usage carried through | `chain.test.ts`: `Usage[]` from every guard that ran (including the one that blocked/escalated) is concatenated into the chain result, matching how `PreGuardResultSchema`/`PostGuardResultSchema` already carry `usage` on every branch. |
| Safety-event seam exists, unused | `chain.test.ts`: `runGuardChain` accepts an optional `onGuardOutcome` callback invoked once per guard with `{ name, phase, outcome }` (no reason/text); a test double records calls for a block and a rewrite. No port, table or persistence is added (see Open Q1) — this is a hook future guard tasks or the composition root can wire, not a store. |
| Harness purity | `turbo run typecheck lint test --filter=@edmate/harness...` green; the new files import only `@edmate/contracts`, `zod` (if used for runtime checks) and the harness's own modules — no new dependency. |
| Nothing else regresses | Existing `preGuard.test.ts`/`postGuard.test.ts`-adjacent stub behaviour (`StepNotImplementedError`) is untouched; `runner.test.ts` still green (4.1 does not wire the pipeline steps — see Design). |

## Design

### What exists already (read only)
- `packages/contracts/src/safety.ts`: `GuardResultSchema` (frozen) — a plain union of `{ok:true}` / `{ok:false, action:'block', reason}` / `{ok:false, action:'rewrite', text, reason}` / `{ok:false, action:'escalate', alert}`. `reason` and `text` are capped (`LIMITS.guardReasonMaxLength` 500, `LIMITS.modelTextMaxLength` 8000). This is the per-guard return type; 4.1 builds on it unchanged, no ADR needed.
- `packages/harness/src/pipeline/types.ts`: `GuardTrace = TurnTrace['guards'][number]` (`{name, ok, action?}`, no text) is already defined and exported from `@edmate/harness` (`pipeline/index.ts`). `PreGuardResult`/`PostGuardResult`/`Scrubbed` already carry `guards: GuardTrace[]` and `usage: Usage[]`. **4.1 reuses this type (`import type { GuardTrace } from '../pipeline/index.js'`) instead of redefining it**, so the eventual pipeline-step wiring (4.2+) is a direct fit.
- `packages/harness/src/pipeline/steps/preGuard.ts` / `postGuard.ts`: still stubs (`StepNotImplementedError`), by design — `steps/index.ts`'s own comment says "each later task replaces its own file". **4.1 does not touch these three files.** Wiring them to the new framework is each guard task's job (4.2 for `scrub`'s `piiScrub`; 4.3 adds `distressDetect` into `preGuard`; 4.4 extends it with `moderationIn`/`jailbreak`; 4.5–4.9 build `postGuard`'s chain one guard at a time). Reasons below (Open Q2).
- The guard table (build plan, Guardrails and safety) fixes two phases beyond `scrub`:
  - `scrub` phase (step 3a): `piiScrub` only.
  - `pre` phase (step 3b, `steps.preGuard`): `distressDetect`, `moderationIn`, `jailbreak`, in that order.
  - `post` phase (step 9, `steps.postGuard`): `answerLeak`, `lockedLeak`, `grounding`, `adviceGuard`, `personaBoundary`, `tone`, in that order.
  (`piiScrub`'s table row is "pre" but it runs in the separate `scrub` sub-step per the pipeline spec and `types.ts`'s own phase split; kept as its own phase name here so the manifest doesn't collide with `preGuard`'s three.)
- `packages/evals/src/agent.ts` (3.12): `EvalAgent.reply(input): Promise<EvalAgentReply>` is deliberately narrower than the full pipeline — its own comment says "a later task adapts the real pipeline (**or a guard wrapper**) to this interface". This is why the chain runner's public shape matters beyond the pipeline steps: a later task (one of 4.2–4.9, or a shared adapter) will wrap just a `GuardRegistry`'s chain as an `EvalAgent` to run the `locked`/`leak`/`safety` eval suites (4.0) against one guard phase directly, without a full turn. 4.1's job is only to make that wrapping possible (clean, exported, no pipeline coupling) — no `EvalAgent` adapter is built in this task.

### New module: `packages/harness/src/guardrails/`
1. **`order.ts`** — the manifest, not logic: `GuardPhase = 'scrub' | 'pre' | 'post'` and `GUARD_ORDER: Readonly<Record<GuardPhase, readonly string[]>>` listing guard names in the build plan's table order (see above). This is the single source of truth for "declared order" — the registry's insertion order never decides it, so guard tasks landing out of order (e.g. if 4.4 merges before 4.3) can't silently reorder anything.
2. **`guard.ts`** — the `Guard<Ctx>` shape: `{ readonly name: string; readonly phase: GuardPhase; run(text: string, ctx: Ctx): Promise<{ result: GuardResult; usage: Usage[] }> }`. Generic over `Ctx` (deliberately): `scrub`/`pre` guards need locale/entitlement context, `post` guards need `TurnContext`/`decision`/retrieved chunks — those concrete shapes belong to each guard task (4.2–4.9), not to the framework. A guard closes over whatever ports/config it needs (locale pack, gateway, persona) via a factory function; the framework only ever threads `text` and `ctx` through unchanged.
3. **`registry.ts`** — `GuardRegistry<Ctx>`: `register(guard: Guard<Ctx>)` throws if `guard.name` isn't in `GUARD_ORDER[guard.phase]` or is already registered (fail closed at wiring time: a misnamed or duplicated guard never silently joins the chain). `ordered(): Guard<Ctx>[]` returns registered guards in `GUARD_ORDER` order, **skipping any declared name with no registered implementation yet** (so the registry is usable incrementally as 4.2–4.9 land one guard at a time — see Open Q3 on the risk this implies and the recommended mitigation).
4. **`chain.ts`** — `runGuardChain<Ctx>(guards: readonly Guard<Ctx>[], initialText: string, ctx: Ctx, opts?: { onGuardOutcome?(e: GuardOutcomeEvent): void }): Promise<GuardChainResult>`. Iterates in the given order (callers pass `registry.ordered()`); per guard:
   - wraps `guard.run` in a `try/catch`; a throw is fail-closed `block` (no reason text kept — thrown errors can quote model output, so only `{name, ok:false, action:'block'}` goes in the trace; the raw error is for the caller's own background-failure reporting, not this module's concern);
   - validates the returned `result` against `GuardResultSchema.safeParse` before trusting it; a failed parse is also fail-closed `block`;
   - `ok: true` → push `{name, ok:true}`, keep `text`, continue;
   - `action: 'block'` → push `{name, ok:false, action:'block'}`, stop, `outcome: 'block'`;
   - `action: 'rewrite'` → push `{name, ok:false, action:'rewrite'}`, set `text = result.text`, **continue the chain on the rewritten text** (later guards in the same phase see the rewrite, matching e.g. `lockedLeak` needing to check `answerLeak`'s already-rewritten draft);
   - `action: 'escalate'` → push `{name, ok:false, action:'escalate'}`, stop, `outcome: 'escalate'`, carry `result.alert`;
   - `usage` from every guard that ran (regardless of outcome) is concatenated;
   - `opts.onGuardOutcome` (the safety-event seam, Open Q1) fires after each guard, with no reason/text — a no-op by default.
   Returns `{ outcome: 'ok' | 'block' | 'escalate', text, guards: GuardTrace[], usage: Usage[], alert?: SafetyAlert }`.
5. **`index.ts`** — barrel: `GuardPhase`, `GUARD_ORDER`, `Guard`, `GuardRegistry`, `runGuardChain`, `GuardChainResult`, `GuardOutcomeEvent`.
6. **`packages/harness/src/index.ts`**: add `export * from './guardrails/index.js';` alongside `access`/`pedagogy` (same pattern).
7. **`packages/harness/README.md`**: new "## Guardrails (task 4.1)" section mirroring the existing per-task sections (framework shape, phases, "replacing a stub" note pointing at 4.2–4.9).

### Deliberately not built here
- No concrete guard (`piiScrub`, `distressDetect`, …) — those are 4.2–4.9.
- No wiring of `steps/scrub.ts`/`preGuard.ts`/`postGuard.ts` to the new framework — each guard task does its own wiring as it lands its first guard in that phase (4.2 for `scrub`, 4.3 for `pre`'s first guard, 4.5 for `post`'s first guard), extending the same `GuardRegistry` instance rather than rewriting it. Rationale: an empty-registry `scrub`/`preGuard` would turn today's fail-closed stub (`StepNotImplementedError` → blocked turn) into an always-`ok` pass-through with zero real checks — a regression on a safety-reviewed path, for no benefit before any guard exists to register. Flagged as Open Q2 for the lead's confirmation.
- No `safety_events` persistence. The build plan's data model lists a `safety_events` table (trust console), and the guard table says `moderationIn`'s failure action is "`block` with redirect; log `safety_event`" — but no port for it exists in `packages/contracts/src/ports.ts` today (only `AlertSink`/`TraceSink`, which serve `SafetyAlert`/`TurnTrace`, not this). 4.1 ships only the generic `onGuardOutcome` hook (no payload beyond name/phase/outcome, no persistence, no contracts change). Whichever guard task first needs to actually write a `safety_events` row (most likely 4.4, `moderationIn`) should raise the ADR to add a `SafetyEventSink`-style port (contracts change → architect, security-reviewer, typescript-reviewer, `risk: high`). Flagged as Open Q1.

## Files

Create:
- `packages/harness/src/guardrails/order.ts`, `order.test.ts`
- `packages/harness/src/guardrails/guard.ts` (types only, no test needed beyond compile)
- `packages/harness/src/guardrails/registry.ts`, `registry.test.ts`
- `packages/harness/src/guardrails/chain.ts`, `chain.test.ts`
- `packages/harness/src/guardrails/index.ts`
- (optional, recommended) `packages/harness/src/testing/guardFixtures.ts` + export from `src/testing/index.ts`: a `fakeGuard(name, phase, result, usage?)` factory so every guard task (4.2–4.9) writes its own tests against the same fake-guard shape instead of re-deriving one; low risk, saves repeated boilerplate the way 4.0's `suites.test.ts` did for eval-author.

Modify:
- `packages/harness/src/index.ts` (export `./guardrails/index.js`)
- `packages/harness/README.md` (new Guardrails section)

Out of bounds:
- `packages/contracts/**` — no change; `GuardResult`/`SafetyAlert`/`GuardTrace`-shape stay exactly as they are. If review decides 4.1 needs a real port for the safety-event seam, that is a separate ADR'd task, not this one.
- `packages/harness/src/pipeline/steps/{scrub,preGuard,postGuard}.ts`, `packages/harness/src/pipeline/steps/index.ts`, `packages/harness/src/pipeline/types.ts`, `runner.ts`, `results.ts`, `trace.ts` — untouched; the pipeline's `Steps` interface and runner wiring are 3.1's frozen shape, consumed later by 4.2+.
- `content/prompt-packs/**`, `content/skills/**`, `content/locales/**`, `evals/suites/safety/**`, `evals/suites/locked/**`, `apps/worker/src/alerts/**` — unrelated to the framework; no guard content or alert delivery changes here.
- Any concrete guard logic (regex patterns, classifiers, n-gram overlap, etc.) — 4.2–4.9.

## Tests first (tdd-guide order)
1. `order.test.ts`: `GUARD_ORDER` has exactly the guard-table names per phase, no duplicates across phases, matches the table's declared order (a literal array equality against values copied from the build plan table, with a comment citing the table rows so a future table edit is easy to diff against).
2. `registry.test.ts`: register in-order, register out-of-order (still returns `ordered()` in `GUARD_ORDER` order), register an undeclared name (throws), register a duplicate name (throws), `ordered()` with a gap (some declared names unregistered) skips the gap and keeps the rest in order.
3. `chain.test.ts`, red first: ordering with scrambled registration order; fail-closed on throw; fail-closed on a schema-invalid result; rewrite plumbing (single and chained); block stops the chain (later guards never called — assert via a spy); escalate stops the chain and carries the alert; usage concatenation across all three outcomes; `onGuardOutcome` called once per guard actually run, never for guards after a block/escalate; trace entries never carry `reason`/`text`.
4. Build `guard.ts`, `registry.ts`, `chain.ts` to turn the above green, in that order (types → registry → chain, since chain consumes registry's `ordered()` output).
5. `packages/harness` full gate: `turbo run typecheck lint test --filter=@edmate/harness...`.

## Risky paths touched (checked against risk-paths.txt)
- `packages/harness/src/guardrails/**` → **reviewers: safety-reviewer** (student safety and teaching behaviour group; this is the guard framework itself, even though no concrete guard logic lands yet — ordering and fail-closed behaviour are exactly what the safety reviewer needs to sign off before any guard is built on top).
- No other risk-paths.txt glob is touched: no `packages/contracts/**`/`docs/adr/**` change (no ADR needed, see Open Q1), no `packages/harness/src/access/**`, no `packages/harness/src/pedagogy/**`, no `.claude/**`.
- `docs/decisions/log.md` gets a `risk: high` entry at merge (new safety-relevant framework in a risk-paths.txt path), per rule 6.
- Reviewers for this PR: **safety-reviewer** (required), plus **typescript-reviewer** and **silent-failure-hunter** recommended (generic/typed chain code; "never silently drop a guard outcome" is exactly a silent-failure-hunter concern) — not required by risk-paths.txt but worth asking for given the fail-closed acceptance line.

## Open questions (recommendations)

- **Q1 The `safety_event` logging seam has no contracts port.** The build plan's data model names a `safety_events` table and `moderationIn`'s row says to log one, but `ports.ts` has no matching port today. *Recommend:* 4.1 ships only the typed, no-op-by-default `onGuardOutcome` hook (name/phase/outcome only, no text) with no persistence; whichever guard task needs to actually write the row (likely 4.4) raises the ADR for a `SafetyEventSink` port then. Low risk to defer — nothing depends on persistence existing yet.
- **Q2 Should 4.1 wire `scrub.ts`/`preGuard.ts`/`postGuard.ts` to an (empty) registry now, or leave the stubs as-is?** *Recommend:* leave the stubs; an empty-registry pass-through would turn today's fail-closed stub into an always-`ok` turn with zero real checks before any guard exists — worse than the current state on a safety path. Each guard task wires its own phase's first guard. If the lead prefers wiring now (e.g. to unblock a pipeline integration test sooner), flag it back and 4.1 can include it; it's a small, reversible addition either way.
- **Q3 Incremental registries silently skip undeclared-yet guards.** `ordered()` must tolerate a partial registry while 4.2–4.9 land one at a time, but that means a guard that *should* exist going forward but fails to register (bug, not "not built yet") also passes silently. *Recommend:* once all nine guards exist (end of M4), add a one-line completeness test (`ordered().length === GUARD_ORDER[phase].length` for every phase) as part of the last guard task (4.9) or a small M4-exit task, rather than a runtime throw here (a runtime throw would be too strict today, while every phase is intentionally partial). Not blocking 4.1.

## Decisions to log on merge
- `risk: high`: new guard framework in `packages/harness/src/guardrails/**` (risk-paths.txt safety group), reviewed by safety-reviewer.
- Q1–Q3 above, once the lead/human picks (Q1 and Q2 have real design consequences for 4.2–4.4; Q3 is a note for later).

## Lead answers (18 Oct 2026)

- Q1: agreed. 4.1 ships only the no-op `onGuardOutcome` hook (name, phase, outcome; no text). The first guard task that writes a `safety_events` row (likely 4.4) raises the `SafetyEventSink` ADR.
- Q2: agreed. Leave the scrub/preGuard/postGuard stubs failing closed; each guard task wires its own phase.
- Q3: agreed. The completeness test (`ordered().length === GUARD_ORDER[phase].length` for every phase) goes into 4.9; the lead adds that to 4.9's notes on the board.
- Reviewers: safety-reviewer (opus), typescript-reviewer (sonnet), silent-failure-hunter (sonnet). risk: high entry for the fail-closed chain.
- Builder: tdd-guide on opus, when a builder slot frees up (max 2 builders). Scripted gateway only.
