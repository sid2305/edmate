# Handoff: 4.4b

Status: DONE

## Summary

`preGuard.ts` now starts distressDetect's, moderationIn's and jailbreak's small-tier classifier
calls concurrently, before any guard runs, instead of letting the guard chain start them one
after another. Each guard checks a new optional `ctx.classifierCalls.<name>` field first and
falls back to starting its own call exactly as before when it is absent — so every existing
guard unit test (hand-built `PreGuardCtx`, no `classifierCalls`) stays green unchanged.

- `preGuardCtx.ts` gained the optional `classifierCalls` field (additive only).
- `preGuard.ts` gained three prefetch functions (`prefetchDistress`, `prefetchModeration`,
  `prefetchJailbreak`), each re-running the same pure rule-check the guard itself calls
  (`distressKeywordMatch`, `matchModeration`, `matchJailbreak`) to decide whether a call is
  needed at all, so a decisive rule hit never fires a wasted classifier call.
- `safetyClassifier.ts` gained `prefetchClassifier`, a thin wrapper around `askClassifier` that
  attaches a no-op rejection handler to the call it starts (so a discarded, later-rejecting
  prefetch never becomes an unhandled rejection) and returns the same promise the guard still
  sees the real rejection through.
- `distressDetect.ts`, `moderationIn.ts`, `jailbreak.ts` each change at one point: where they
  started their own classifier call, they now do `ctx.classifierCalls?.<name> ?? <own call>`.
  No other line changed. `chain.ts`, the rule tables and `packages/contracts` are untouched.

## Decisions

### 4 Nov 2026 · 4.4b call-volume trade-off on the classifier-short-circuit path · decided by builder · risk: low
- Decided: accept the extra, discarded classifier calls when an earlier guard short-circuits the
  chain by a classifier verdict (not a rule hit) — e.g. distressDetect escalates on
  `distress: true` from the model, after moderationIn's and jailbreak's prefetches already
  fired. Those calls complete (or fail) with nobody consuming the result.
- Why: the alternative (threading a shared "stop now" signal through all three prefetches so a
  short-circuit aborts the others mid-flight) adds real complexity for a rare path; the plan's
  Q1 named this trade-off and recommended accepting it.
- Alternatives: cancel unused prefetches on short-circuit via a shared abort signal — rejected as
  unneeded complexity for a rare path.
- Reversible: yes — a later task could add a shared cancel signal without touching the public
  shape of `classifierCalls`.

### 4 Nov 2026 · 4.4b prefetch helper placement · decided by builder · risk: low
- Decided: `prefetchClassifier` lives in `safetyClassifier.ts` beside `askClassifier`, per the
  plan's Q2 answer. `preGuard.ts`'s moderation/jailbreak prefetch functions call it; distress's
  prefetch calls `runWithTimeout` directly (as `distressDetect.ts` always has — it never used
  `askClassifier`/`callGuarded`), so it needs no new helper and no rejection handler of its own
  (`runWithTimeout` never rejects by contract).
- Why: one source of truth for "how a classifier call is made and wrapped", as the plan asked.
- Alternatives: inline the prefetch logic directly in `preGuard.ts` — rejected, duplicates the
  cancel/timeout/validate wiring `askClassifier` already has.
- Reversible: yes.

### 4 Nov 2026 · 4.4b virtual-clock delay gateway for the concurrency test · decided by builder · risk: low
- Decided: a small test-only `ModelGateway` double local to `preGuard.test.ts`
  (`delayedClassifierGateway`), driven by `VirtualClock.sleep`/`drive`, not `ScriptedGateway`
  (which has no delay mechanism for `generateObject` and the plan's Q3 says to leave it that
  way).
- Why: proves concurrency (elapsed virtual time under 400 ms with three 150 ms calls, versus
  ~450 ms if sequential) without any real wait.
- Alternatives: extend `ScriptedGateway` itself with a delay field — rejected per the plan's Q3.
- Reversible: yes.

### 4 Nov 2026 · 4.4b resolving prefetch disagreement defensively · decided by builder · risk: low
- Decided: when a guard reads `ctx.classifierCalls?.moderation`/`.jailbreak` and the prefetch
  resolved to `undefined` (its own decisive-rule re-check found a decisive hit), the guard falls
  back to making its own fresh classifier call rather than treating `undefined` as a verdict. In
  practice this branch is never reached: the guard's own decisive check runs first and returns
  early before ever touching `classifierCalls`, so by the time it reaches this line its own
  check has already found no decisive hit — and the prefetch, built from the identical pure
  function on the identical inputs, must agree.
- Why: a defensive fallback that costs nothing on the real path and keeps the guard correct even
  if the invariant were ever violated, rather than asserting it with a type cast.
- Alternatives: assert non-null — rejected, less safe for no benefit.
- Reversible: yes.

## Red -> green evidence

- `src/pipeline/steps/preGuard.test.ts`: added a new describe block
  (`preGuard (task 4.4b): the three classifier calls run concurrently`) with 6 new tests —
  written first, run (`vitest run src/pipeline/steps/preGuard.test.ts`) and confirmed failing
  against the pre-change code (importable but the concurrency/under-400ms assertion and the
  `classifierCalls`-shaped prefetch expectations failed: `TypeError` on the not-yet-existing
  `ctx.classifierCalls` plumbing, and the delay-gateway elapsed-time test exceeded 400 ms with
  the guards running sequentially). After the `preGuard.ts`/guard-file/`preGuardCtx.ts`/
  `safetyClassifier.ts` changes, all 6 pass plus the existing 28 tests in the file (34 total).
- Existing `distressDetect.test.ts` (31), `moderationIn.test.ts` (39), `jailbreak.test.ts` (31):
  unchanged files, run both before and after — pass unchanged (confirms the fallback,
  no-`classifierCalls`, path is byte-identical to today).

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --force`: 4/4 tasks
  green. `src/guardrails` coverage: **100%** statements/branches/functions/lines (unchanged
  requirement met). 132 test files, 6108 tests, all passed.
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/evals`
  (the plan's literal gate command, which pulls in `@edmate/cli` as a dependent of harness):
  harness and evals both green (evals: grounding/postGuard suites all pass, including the
  400-ms-adjacent latency suites). `@edmate/cli`'s `test/chatDbRetrieval.int.test.ts` fails/times
  out with no Postgres running (`Connection terminated unexpectedly`, `ECONNREFUSED`-style),
  and several other `apps/cli` tests then time out once that connection drops mid-run — expected
  per the lead review's item 4 (no docker; builders never run Postgres); CI runs these with a
  database. Four unrelated harness tests (`distressKeywords.test.ts`, `modelRequest.test.ts`,
  one `preGuard.test.ts` case) timed out in one combined run under heavy concurrent load (two
  turbo runs plus the cli DB test's lingering connections at once); re-run in isolation
  immediately after, all three files passed cleanly (376/376) — a local resource-contention
  flake, not a regression from this change.
- `prettier --check` on every touched file: clean after `--write` on `distressDetect.ts` and
  `preGuard.test.ts` (both now match).
- `python3 .githooks/secret-scan.py --all`: clean (exit 0).

## Budget

Tool calls used: 61
