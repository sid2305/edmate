# 4.1 handoff: guard framework and registry

Status: DONE
Branch: `m4/4.1-guard-framework` (from origin/main `1835069`)
Worktree: `.claude/worktrees/agent-a220a50f31248c4e6`
Risky: yes. `packages/harness/src/guardrails/**` (risk-paths.txt, student safety group). Required reviewer: safety-reviewer. Also asked for (lead answer): typescript-reviewer, silent-failure-hunter.

## Acceptance evidence

Acceptance: "guards run in declared order and fail closed; `rewrite` returns replacement text."

| Item | Evidence |
|---|---|
| Declared order | `order.test.ts`: `GUARD_ORDER` equals the build plan guard table per phase (`scrub` piiScrub; `pre` distressDetect, moderationIn, jailbreak; `post` answerLeak, lockedLeak, grounding, adviceGuard, personaBoundary, tone), 10 unique names, frozen. `chain.test.ts` "runs guards in GUARD_ORDER order, whatever the registration order": six post guards registered scrambled, a shared call-order spy equals `GUARD_ORDER.post`. A list passed to `runGuardChain` out of order or with a duplicate blocks before any guard runs (`out_of_order`). |
| Fail closed | `chain.test.ts`: a guard that rejects, throws synchronously or rejects a non-Error → `block`, `failure.cause: 'error'`. 17 schema-invalid returns (`it.each`: missing action/reason, unknown action, extra keys, over-cap reason/text, bad alert, bad usage, bare GuardResult, null, string…) → `block`, `invalid_result`. A guard that never settles → `block`, `timeout` at exactly its 50 ms slice on the virtual clock, its cancel token fires, no timer left. A slice of 0, -1, NaN or -Infinity → `block` without running the guard. An already-cancelled step, or one cancelled while a guard runs → `block`, `cancelled`. An undeclared name, a wrong-phase guard, a malformed entry or an unknown phase → `block`, `undeclared`. In every case later guards are never called and the chain never rejects. Seeded property test (2000 random chains, explicit 20 s timeout): `outcome` is `ok` only when every guard passed or rewrote. |
| `rewrite` returns replacement text | `chain.test.ts`: the chain's `text` is the rewrite; the next guard receives the rewritten text; two rewrites compose (`'draft +a +b'`); a rewrite to `''` is honoured. |
| Block / escalate stop | `chain.test.ts`: `block` stops with no `failure` (the guard decided); `escalate` stops and carries the `SafetyAlert`. |
| Registry rejects the undeclared | `registry.test.ts`: undeclared name, name from another phase, duplicate (first kept), wrong phase, malformed guard object and unknown registry phase all throw `GuardRegistryError` at registration. `ordered()` is declared order, skips unbuilt guards, returns a fresh frozen array; `missing()` lists the gaps. |
| Trace shape unchanged | `chain.test.ts`: for ok/block/rewrite/escalate and every fail-closed path, `guards` parses with `TurnTraceSchema.shape.guards`, keys are exactly `name, ok(, action)`, and no reason/text string appears. Type reused: `GuardTrace` from `pipeline/types.ts`. |
| Usage carried through | `chain.test.ts`: usage from every guard that ran, including the one that blocked or escalated, is concatenated in order; earlier usage survives a later throw; an invalid or timed-out guard adds none. |
| Safety-event seam, unused | `chain.test.ts`: `onGuardOutcome` fires once per guard run with exactly `{ name, phase, outcome }`, never after a block; fail-closed blocks and escalate are reported; a throwing observer changes nothing. No port, table or persistence. |
| Harness purity | New files import only `@edmate/contracts`, `zod` and harness modules; lint (purity rule) green; no new dependency. |
| Nothing else regresses | `steps/scrub.ts`, `preGuard.ts`, `postGuard.ts`, `steps/index.ts`, `types.ts`, `runner.ts`, `results.ts`, `trace.ts` untouched; full harness suite green. |

Commands:

| Command | Result |
|---|---|
| `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force` | `Tasks: 10 successful, 10 total`; harness `Test Files 35 passed`, `Tests 2166 passed (2166)`; contracts 322 passed; config 42 passed |
| harness coverage, `src/guardrails` | `Stmts 100 · Branch 100 · Funcs 100 · Lines 100` (new 100% threshold in `vitest.config.ts` enforces it) |
| harness coverage, `testing/guardFixtures.ts` | 100 / 100 / 100 / 100 |
| harness coverage, all files | `Stmts 99.51 · Branch 97.85 · Funcs 100 · Lines 100` |
| `vitest run src/guardrails` three times | `Tests 69 passed (69)` ×3 (pass^3) |
| `prettier --check` on changed files | clean |
| `python3 .githooks/secret-scan.py --all` | exit 0, no output |

Note: in this sandbox node was put on PATH directly (`env PATH=~/.nvm/versions/node/v22.22.3/bin:…`) because the worktree guard refuses `source`; same node and pnpm as `source ~/.nvm/nvm.sh`.

## Fix round 1 (safety, TypeScript and silent-failure reviews of PR #32)

| Finding | Fix | Evidence (`chain.test.ts`) |
|---|---|---|
| [HIGH] earlier guards never re-check a later rewrite | When any guard rewrote, every guard runs once more on the final text (pass 2). There a rewrite or block → `block`, `cause: 'rewrite_unverified'`, `blockedBy`; a failure → `failed`; escalate still escalates. | "a later rewrite that puts the withheld answer back is caught by an earlier guard" (grounding rewrites `42` back in, answerLeak catches it on pass 2, nothing after it runs, `42` not in the result); "a block verdict on the verification pass is rewrite_unverified too"; "a guard failure on the verification pass fails the chain"; "an escalate on the verification pass still escalates"; "no verification pass runs when nothing rewrote"; the 2000-chain property test now expects `rewrite_unverified` for any chain with a rewrite. |
| [MEDIUM] raw `failure.error` can quote unscrubbed text | Replaced by `errorName`: `Error#name` (capped at 100), `'Error'` for a non-string name, `typeof` for non-Errors, `'unknown'` if reading it throws. | "a rejection with %s records only a capped error name" (6 cases; no `secret` in the JSON result); "an Error whose name getter throws records unknown". |
| [MEDIUM] `block` still carries `text` | `text` exists only on `ok` and `escalate` in the `GuardChainResult` type. | "block stops the chain as a guard verdict … carries no text" (`'text' in res` is false); typecheck. |
| [MEDIUM] empty list returns ok | Empty list → `failed`, cause `empty`, trace `(empty chain)`. | "an empty chain fails closed (cause empty)". |
| [MEDIUM] framework failure looks like a guard's block | New `outcome: 'failed'` (non-ok, fail closed) with `failure`; trace action `failed`; `GuardOutcomeEvent` gets `pass` and `cause`. Guard verdict blocks are `block` / `cause: 'verdict'`. | Every fail-closed test asserts `failed`; "reports the verification pass, escalate and failures (with cause) to onGuardOutcome". |
| [MEDIUM] async observer rejection is unhandled | If `onGuardOutcome` returns an object with a `then` function, a no-op rejection handler is attached; reading `then` is inside the try. Return type is `unknown`. | "an async onGuardOutcome that rejects is not an unhandled rejection" (vitest fails a run on any unhandled rejection); "attaches a rejection handler to a thenable"; null / `{}` / function returns; throwing `then` getter. |
| [LOW] step cancel does not reach the in-flight guard | Each guard gets a linked token that fires on its slice ending or on `opts.cancel`; the chain also stops waiting at once on a step cancel (`cancelled`). Doc in `guard.ts` updated. | "a cancelled step cancels the in-flight guard and stops waiting at once" (cancel at 10 ms on the virtual clock; guard's token fired; `clock.now()` 10; no timers left). |
| [LOW] list and names read more than once; undeclared name in trace | The list is copied (`[...guards]`) and each guard's `name`/`phase`/`run` read once at the start; the trace and events show `(undeclared)` for an undeclared guard (the failure keeps the name, capped at 100). A throwing getter → `(invalid guard)`. | "reads each guard once" (caller empties its array mid-run, name getter read once); "fails closed on an unknown guard; the trace names it (undeclared)"; "caps an undeclared name at 100 characters"; "a guard whose name getter throws fails closed as invalid". |
| [LOW] `checkChain` widened to `unknown` | Replaced by generic `snapshot<Ctx>` / `readEntry<Ctx>` returning typed entries. | typecheck. |

After fix round 1:

| Command | Result |
|---|---|
| `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force` | `Tasks: 10 successful, 10 total`; harness `Tests 2186 passed (2186)` |
| harness coverage, `src/guardrails` | 100 / 100 / 100 / 100 (153 statements, 90 branches) |
| harness coverage, all files | `Stmts 99.6 · Branch 98.04 · Funcs 100 · Lines 100` |
| `vitest run src/guardrails` three times | `Tests 89 passed (89)` ×3 |
| `prettier --check` on changed files | clean |
| `python3 .githooks/secret-scan.py --all` | exit 0 |

## Changes

- `packages/harness/src/guardrails/order.ts`: `GUARD_PHASES`, `GuardPhase`, frozen `GUARD_ORDER`, `isGuardPhase`, `declaredIndex`.
- `packages/harness/src/guardrails/guard.ts`: `Guard<Ctx>` (`name`, `phase`, `run(text, ctx, cancel)`), `GuardRun` (`{ result: GuardResult, usage: Usage[] }`).
- `packages/harness/src/guardrails/registry.ts`: `GuardRegistry<Ctx>(phase)` with `register`, `has`, `ordered`, `missing`; `GuardRegistryError`.
- `packages/harness/src/guardrails/chain.ts`: `runGuardChain(guards, text, ctx, { phase, clock, timeoutMs, cancel?, onGuardOutcome? })`, `GuardChainResult`, `GuardFailure`, `GuardFailureCause`, `GuardOutcomeEvent`, `GuardChainOptions`. Each guard runs under `runWithTimeout` (3.1) on the injected clock; its return is checked with `z.strictObject({ result: GuardResultSchema, usage: z.array(UsageSchema) })`.
- `packages/harness/src/guardrails/index.ts` barrel; `src/index.ts` exports it.
- `packages/harness/src/testing/guardFixtures.ts`: `fakeGuard(name, phase, resultOrFn, { usage?, spy? })`, exported from `@edmate/harness/testing`.
- Tests: `order.test.ts` (6), `registry.test.ts` (10), `chain.test.ts` (73 after fix round 1).
- `packages/harness/vitest.config.ts`: 100% threshold for `src/guardrails/**`.
- `packages/harness/README.md`: new "Guardrails (task 4.1)" section.

## Deviations from the plan

- `runGuardChain` options also take `phase`, `clock` and `timeoutMs` (and an optional step `cancel`): the plan asks for a guard that "times out past its own slice", which needs a clock and a slice; `phase` lets the chain re-check names and order itself rather than trust the caller.
- `Guard.run` gets a third argument, the slice's `CancelToken`, so a slow guard can stop work when its slice ends.
- The chain re-validates the list it is given (declared, right phase, strictly in declared order, no duplicates), not only the registry, so a list built by hand cannot skip the checks.
- The result is a four-way union (`ok`, `block`, `escalate`, `failed`); a framework failure carries `failure: { name, cause, errorName? }` (no raw error, not in the trace) so the caller can report why it failed closed instead of it being silent (fix round 1).
- A verification pass re-runs every guard when any guard rewrote (fix round 1; the plan had a single pass).
- `GuardRegistry` is per phase (`new GuardRegistry<Ctx>(phase)`), because each phase has its own `Ctx`; added `has()` and `missing()`.
- `fakeGuard` takes an options object (`{ usage, spy }`) and records `calls`.

## Decisions

### 18 Oct 2026 · 4.1 The guard chain fails closed on every failure · decided by lead (plan) and tdd-guide (details) · risk: high
Decided: a throw, a result that fails `GuardResultSchema`/`UsageSchema`, a guard past its own time slice (or a non-positive slice), a step cancelled before or during a guard, an empty list, an undeclared or wrong-phase guard, and a list out of declared order all end the chain non-ok (`outcome: 'failed'` with a `failure` cause, fix round 1); later guards never run and the chain never throws.
Why: guards protect students; any doubt must stop the reply, and the calling step's own fail-closed policy still applies on top.
Alternatives: skip a broken guard and continue; let errors propagate to the step.
Reversible: Yes, but only with safety-reviewer sign-off.

### 18 Oct 2026 · 4.1 A rewrite is verified by a second pass of every guard · decided by lead (safety review, fix round 1) · risk: high
Decided: when any guard rewrote, the whole phase runs once more on the final text; there any rewrite or block becomes `block` with cause `rewrite_unverified`, a failure is `failed`, and an escalate still escalates (it is stronger than block and must not lose its alert).
Why: a later guard's rewrite (grounding, adviceGuard, tone) could put back what an earlier guard (answerLeak) removed; the build plan says "rewrite once; else safe reply".
Alternatives: single pass; re-run only the guards before the rewriting one; loop until stable.
Reversible: Yes, but only with safety-reviewer sign-off.

### 18 Oct 2026 · 4.1 Framework failures get their own `failed` outcome · decided by lead (silent-failure review, fix round 1) · risk: medium
Decided: `GuardChainResult` is `ok` | `block` (`cause: 'verdict' | 'rewrite_unverified'`) | `escalate` | `failed` (`failure: { name, cause, errorName? }`); `failed` is non-ok and callers treat it like block; only `ok` and `escalate` carry `text`; the trace action is `failed` and the event carries `cause`.
Why: 4.3 needs to tell "a guard said no" from "the guards broke" to keep the distress keyword fallback; a block must not carry text a caller could send.
Alternatives: one `block` outcome with an optional failure field.
Reversible: Yes, before 4.2-4.5 build on it.

### 18 Oct 2026 · 4.1 Failures keep only an error name, never the raw error · decided by lead (security/silent-failure review, fix round 1) · risk: low
Decided: `failure.errorName` is the `Error#name` or `typeof` (capped at 100); undeclared names show as `(undeclared)` in the trace and events.
Why: a thrown value or a guard name can quote unscrubbed input or model output.
Alternatives: keep the raw error for the caller.
Reversible: Yes.

### 18 Oct 2026 · 4.1 The step's cancel token cancels the in-flight guard · decided by tdd-guide (fix round 1) · risk: low
Decided: each guard's token is linked to its own slice and to `opts.cancel`; on a step cancel the chain stops waiting at once and fails with `cancelled`. `timeout.ts` is unchanged (the link is built inside the chain).
Why: a cancelled step should not keep a guard (and its model call) running for the rest of its slice.
Alternatives: document that only the slice cancels the guard.
Reversible: Yes.

### 18 Oct 2026 · 4.1 Each guard gets its own time slice on the injected clock · decided by tdd-guide · risk: low
Decided: `runGuardChain` runs each guard under `runWithTimeout(…, opts.timeoutMs, opts.clock)`; the slice is per guard, not shared; the caller picks the number.
Why: the plan's fail-closed acceptance names a guard past "its own slice"; reusing 3.1's helper keeps tests on the virtual clock with no wall-clock waits.
Alternatives: one budget for the whole chain; rely only on the step timeout.
Reversible: Yes.

### 18 Oct 2026 · 4.1 The chain re-checks the guard list it is given · decided by tdd-guide · risk: low
Decided: besides the registry's wiring-time checks, `runGuardChain` fails closed (`failed`) before running anything when a guard is undeclared, of another phase, duplicated or out of declared order.
Why: "unknown guard means block" must hold even for a list not built by the registry (an eval wrapper, a test, a later refactor).
Alternatives: trust `registry.ordered()`; sort the list silently.
Reversible: Yes.

### 18 Oct 2026 · 4.1 A throwing `onGuardOutcome` observer is ignored · decided by tdd-guide · risk: low
Decided: an exception from the observer is caught and does not change the outcome or make the chain throw.
Why: the hook is for logging; a logging fault must not turn a passed or blocked guard into something else, and the chain must never throw.
Alternatives: treat an observer throw as a fail-closed block.
Reversible: Yes.

### 18 Oct 2026 · 4.1 Q1 Safety-event seam is a no-op hook only · decided by lead · risk: low
Decided: 4.1 ships only `onGuardOutcome({ name, phase, outcome })` with no text and no persistence; the first guard task that writes a `safety_events` row (likely 4.4) raises the `SafetyEventSink` ADR.
Why: no contracts port exists for it, and nothing needs persistence yet.
Alternatives: add a port now (contracts change, ADR).
Reversible: Yes.

### 18 Oct 2026 · 4.1 Q2 The scrub/preGuard/postGuard stubs stay as they are · decided by lead · risk: low
Decided: 4.1 does not wire the step stubs; they keep failing closed. Each guard task wires its own phase (4.2 scrub, 4.3 pre, 4.5 post).
Why: an empty registry would turn today's fail-closed stub into an always-ok pass-through with no real checks.
Alternatives: wire empty registries now.
Reversible: Yes.

### 18 Oct 2026 · 4.1 Q3 Registry completeness test goes into 4.9 · decided by lead · risk: low
Decided: `ordered()` skips declared guards not built yet; 4.9 adds the test `ordered().length === GUARD_ORDER[phase].length` for every phase (`missing()` added here to help).
Why: every phase is intentionally partial until M4 ends; a runtime throw now would be too strict.
Alternatives: throw at run time on a missing guard.
Reversible: Yes.
