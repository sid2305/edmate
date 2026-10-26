# 3.9c plan: warm preGuard's pattern matchers at web/worker start

## Task (verbatim)

- **Title:** Cold first turn (found by 3.9b): the first turn in a fresh process spends about 150 ms
  in preGuard on an idle laptop against its 400 ms budget, so on a busy server a real student's
  first turn can fail closed (safe message). Warm the harness (classifiers, mathjs, access) at
  web/worker start, or measure cold-start latency on the deploy target and confirm the budget has
  headroom.
- **Accept (verbatim):** a cold-process first turn under CPU load passes preGuard in a test or a
  measured run on the deploy target; the warm-up (if added) is covered by a test; no step budget
  is loosened without a logged decision.
- **Deps:** 3.9b (done). **Milestone:** M13.

## How this will be shown

`corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` and the equivalent for
`@edmate/web` and `@edmate/worker` all green; the new cold-start test demonstrates (by guard-chain
*outcome*, not a brittle millisecond assertion — see Design notes) that a freshly loaded guard
chain, under simulated CPU load, completes inside the real `PRE_GUARD_SLICE_MS` / step-3 budget
once the warm-up has run. Handoff quotes the test name and its pass output.

## Root cause recap (from 3.9b, for context only — not re-litigated here)

`packages/harness/src/pipeline/steps/preGuard.ts` runs three guards in order
(`distressDetect`, `moderationIn`, `jailbreak` — `defaultPreGuardRegistry`,
`packages/harness/src/pipeline/steps/preGuard.ts:34`). Each guard's first call in a fresh process
pays to lazily compile its (large) regex tables and JIT its matching code
(`packages/harness/src/guardrails/distressKeywords.ts` `distressKeywordMatch`,
`packages/harness/src/guardrails/moderationPatterns.ts` `matchModeration`,
`packages/harness/src/guardrails/jailbreakPatterns.ts` `matchJailbreak` — all pure, synchronous,
already exported from `packages/harness/src/guardrails/index.ts`). 3.9b measured this at
~150 ms cold vs 1–8 ms warm, inside preGuard's 300 ms-per-guard slice
(`PRE_GUARD_SLICE_MS`, `preGuard.ts:20`) and step 3's 400 ms total
(`STEP_SPEC.preGuard`, `packages/harness/src/pipeline/spec.ts:31`).

`mathjs` is used only by tool-call code reachable from `generate` (step 8, 15 s budget) —
`packages/harness/src/tools/calculator.ts`, `sandbox.ts`, `practiceItems.ts` — never from
preGuard. The access filter (`packages/harness/src/access/**`) runs in `entitle` (step 2, 50 ms),
not in preGuard. Neither is on the path the accept criterion cares about, so this plan does not
warm them; it is a **decision**, not an omission, and goes in the handoff.

## Design

### 1. The warm-up function (production code)

New file `packages/harness/src/guardrails/warmup.ts`:

```
export function warmPreGuardPatterns(): void
```

Pure, synchronous, no I/O, calls only the harness's own already-exported pure functions:
`distressKeywordMatch`, `matchModeration` (once with no recent turns, once with a recent-turn
array, to exercise the `sexual` + minor-marker branch), `matchJailbreak` (with a representative
`packageNames`/`currentPackageName`), each on a short fixed list of representative benign and
pattern-shaped sample strings (covering decisive, ambiguous and decode-attempt — ROT13, backwards,
base64 — branches, since those are separate code paths inside each matcher). Each call wrapped in
its own `try/catch` that swallows and does nothing (defensive only: these functions are not
expected to throw on string input; a throw here must never block startup). No new imports beyond
contracts/zod/mathjs and the harness's own modules — this file imports only from
`./distressKeywords.js`, `./moderationPatterns.js`, `./jailbreakPatterns.js`. Idempotent and safe
to call more than once (e.g. `next dev` reloads).

Re-exported from `packages/harness/src/guardrails/index.ts`, which `packages/harness/src/index.ts`
already re-exports with `export *`, so callers use `import { warmPreGuardPatterns } from
'@edmate/harness'`.

### 2. Call it once at web start

`apps/web/instrumentation.ts` already has a `register()` that runs once per server process
(task 9.0c, warms the DB pool) with a `NEXT_RUNTIME !== 'nodejs'` guard and a comment explaining
why it avoids a static import of anything that pulls in `@edmate/harness`'s dependency graph.
Add a second, independent fire-and-forget-style call inside the same `nodejs`-gated branch:
dynamically `import('@edmate/harness')` (same pattern as the existing dynamic `./src/auth`
import) and call `warmPreGuardPatterns()`. It is synchronous CPU work (no network), so it can run
directly rather than needing `void`, but still wrapped in its own `try/catch` logging only the
error's name (never a message) — matching the file's existing style — so a throw here can never
block `register()` or `/api/health`. Keep the two warm-ups (DB pool, harness patterns) as two
clearly separate, independently-failing blocks: one dynamic import and one try/catch each.

### 3. Call it once at worker start

`apps/worker/src/index.ts` is a top-level script (no `register()` convention). Add a static
`import { warmPreGuardPatterns } from '@edmate/harness'` at the top (the worker already imports
large production deps; no bundle-size concern here, unlike the web Edge runtime) and call it in a
`try/catch` (logged through the existing `log()`/`describeError()` helpers, consistent with every
other startup error in this file) before the first queue worker is constructed. Must not throw out
of module scope (would crash the whole process); must not delay queue registration meaningfully
(it is the same pure, synchronous, sub-second call as the web side).

### 4. Tests (packages/harness only; no new imports)

**a. `packages/harness/src/guardrails/warmup.test.ts`** — unit test: calling
`warmPreGuardPatterns()` does not throw, returns `undefined`, and is safe to call twice in a row
(idempotency). Fast, deterministic, no timing assertion.

**b. `packages/harness/src/guardrails/warmup.coldStart.test.ts`** — the task's required
cold-process/CPU-load test. Design notes (read before building):

- **Simulating "fresh process" without spawning one.** Spawning a real child process needs a
  pre-built `dist/` (Node 22.x cannot run `.ts` directly — see
  `packages/harness/scripts/loadTest50.ts`'s header comment, which hit exactly this and chose to
  require a build step and run only by hand, never in CI). To stay inside a normal vitest run with
  no extra build step, use `vi.resetModules()` then a fresh dynamic `await
  import('../../guardrails/moderationPatterns.js')` (and the other two matcher modules) to get a
  genuinely new module instance whose top-level `RegExp` literals have never been executed —
  V8 lazily compiles a regex on its first use, so a fresh module instance reproduces the cold-compile
  cost without a new OS process. Build `defaultPreGuardRegistry()`/`createPreGuardStep` from this
  freshly-imported graph (dynamic import of `../preGuard.js` too, after `vi.resetModules()`, so the
  guard registry it builds closes over the fresh matcher modules, not the ones already warmed by
  earlier tests in the same file/process).
- **Simulated CPU load.** Start a short-lived `node:worker_threads` `Worker` (or a `setInterval`-driven
  busy loop on the main thread, whichever is simpler to tear down cleanly) that burns CPU for the
  duration of the assertion, to stand in for "a busy server", then stop it in the test's cleanup
  (no lingering handle; vitest's open-handle check must stay clean).
- **No real model call.** Use `@edmate/harness/testing`'s `spyGateway` (already built for this) as
  the `PreGuardCtx.gateway`, and `sequentialIds`/`manualClock` (or a real `Clock` — either is fine,
  this is not timing the clock) from the same testing fixtures for `ids`/`clock`. Build a minimal
  `safetyEvents` stub (`record` resolves `undefined`) and a benign input message that does **not**
  hit any guard's decisive rule table (so all three guards actually run their full matching code,
  which is the realistic "ordinary first message" case 3.9b measured — not the hard-keyword
  escalate shortcut, which only exercises guard 1).
- **The assertion that avoids lessons.md's "wall-clock bounds fail on shared CI runners" trap.**
  Do not assert a literal millisecond number as the primary check. Call `warmPreGuardPatterns()`
  from the fresh module graph, then run the real guard chain (`createPreGuardStep`'s registry,
  via `runGuardChain`, with the real `PRE_GUARD_SLICE_MS` and the real `STEP_SPEC.preGuard.timeoutMs`
  — imported, never redefined or widened) under the simulated load, and assert on the chain's
  **outcome**: it resolves to `'ok'` (not `'failed'` with cause `'timeout'`), and no guard's trace
  entry (`GuardOutcomeEvent`) reports `outcome: 'failed'`/`cause: 'timeout'`. That is the thing the
  accept line actually requires ("passes preGuard"), and it is robust on a slow CI runner in a way
  a tight millisecond bound is not. A loose wall-clock measurement (e.g. logging the elapsed ms,
  or a generous backstop bound well above any plausible real budget, in the spirit of the 0.14
  lesson) may be added as a secondary, non-blocking diagnostic, but the pass/fail must rest on the
  outcome check.
- **Do not assert the "without warm-up it's slow" half.** A test that expects cold (unwarmed)
  behaviour to time out would depend on the CI box's speed and flake in both directions, which is
  the exact trap 3.9b's own evidence (and 0.14) warns about. Skip that half; only prove the
  warmed path passes. If the builder wants evidence for the handoff that the warm-up matters, time
  one cold run informally and quote the number in the handoff text, not in an assertion.

## Files touched

- **New:** `packages/harness/src/guardrails/warmup.ts` (production)
- **New:** `packages/harness/src/guardrails/warmup.test.ts` (test)
- **New:** `packages/harness/src/guardrails/warmup.coldStart.test.ts` (test)
- **Edit:** `apps/web/instrumentation.ts` (one file; add the second dynamic-import warm-up block)
- **Edit:** `apps/worker/src/index.ts` (one file; add the static import + one `try/catch` call)
- **No change** to `packages/content` or any other `apps/web` file. A concurrent builder on
  `packages/content` or other `apps/web` routes/pages does not collide with this task.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/guardrails/**` — matches the "Student safety and teaching behaviour"
  group. Required reviewer per that group's current (MVP-first, pre-13.3) rule: **code-reviewer**
  (runs on every PR anyway). The handoff must still log a `risk: high` decision per the MVP-first
  standing rule, even though no behaviour changes (the new file is additive, read-only warm-up of
  existing pure functions; no guard logic, ordering or reply text changes).
- `apps/web/instrumentation.ts` and `apps/worker/src/index.ts` — **not** on any
  `risk-paths.txt` glob (not under `apps/web/app/api/**`, `apps/web/src/auth/**`,
  `apps/worker/src/alerts/**`, `.claude/**`, etc.). No extra reviewer required for these two
  edits beyond code-reviewer.
- `packages/harness/src/pipeline/**` (preGuard.ts itself, spec.ts) — **not touched** by this plan;
  no step budget or guard order changes. Confirms the accept line's "no step budget is loosened"
  by construction, not just by promise.

## Packages/apps edited (for the lead's no-shared-files check)

- `@edmate/harness` (packages/harness) — new files only, no existing file edited.
- `@edmate/web` (apps/web) — one file: `instrumentation.ts`.
- `@edmate/worker` (apps/worker) — one file: `src/index.ts`.
- Not touched: `packages/content`, any `apps/web/app/**` route or page, `packages/db`,
  `packages/contracts`, `packages/gateway`, `packages/payments`.

## Gate commands

```bash
source ~/.nvm/nvm.sh && corepack pnpm install
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...
python3 .claude/skills/merge-gate/merge_gate.py 3.9c
python3 .githooks/secret-scan.py --all
```

(`...` pulls in each package's dependents per the "gate dependents in briefs" lesson; `@edmate/web`
and `@edmate/worker` both depend on `@edmate/harness`, so their own gate runs also re-check the
harness change compiles and lints from their side.)

## Tests first

1. Write `warmup.test.ts` (idempotency/no-throw) against a not-yet-existing `warmup.ts` — red,
   then implement `warmup.ts` to green.
2. Write `warmup.coldStart.test.ts` against the real (already-merged) `preGuard.ts`/guard
   registry first, confirming it currently can report a `'failed'`/`'timeout'` outcome under
   simulated load with no warm-up called (this is allowed to be flaky/slow — it is not the test
   that ships) — then add the `warmPreGuardPatterns()` call and the outcome assertion that must
   ship green.
3. Only then wire `instrumentation.ts` and `apps/worker/src/index.ts` (no test added there: both
   are startup glue with existing precedent — `warmPool` in `instrumentation.ts` — that is not
   itself unit-tested either; the harness-level tests are the real coverage the accept line asks
   for).

## No real model calls

`warmup.ts` never touches a `ModelGateway`. The cold-start test uses `@edmate/harness/testing`'s
`spyGateway` fixture, never a real adapter or network call, per build-plan rule 4.

## Open questions

None blocking. One scoping decision made above (mathjs/access are out of scope — accept line is
about preGuard only) will be logged as a `risk: high` decision alongside the guardrails-path one
at merge, per the MVP-first standing rule.

## Budget

Budget: 45 tool calls (1 phase, packages/harness + apps/web + apps/worker)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (install, build, typecheck/lint/test gate commands, secret
scan only — no network/model calls)

## Exit conditions

Status: DONE when all four gate commands above are green and `warmup.coldStart.test.ts`'s shipped
assertion passes on an outcome basis (no tight ms assertion as the pass/fail condition). Status:
PARTIAL past ~45 tool calls, or if simulating CPU load inside vitest proves unworkable within that
budget (worker_threads teardown flakiness, etc.) — in that case fall back to the accept line's
other branch (a measured run on the deploy target, written up in the handoff with real numbers)
instead of spending further rounds forcing an in-process simulation.

## READY

READY. No open decision blocks the build; the one scoping call (mathjs/access out of scope) is
made above and will be logged, not asked.
