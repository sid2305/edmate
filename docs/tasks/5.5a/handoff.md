# 5.5a handoff — calculator follow-ups

Status: DONE

## Summary

All three deferred 5.5 findings fixed in `packages/harness/src/tools/sandbox.ts`, test-first:

1. **Implicit multiplication (MEDIUM).** The tokenizer now tracks `lastWasValueEnd` — whether the
   most recently completed token ended a value (a number, a constant, or a closing `)`) —
   instead of the old `afterNumber` flag, which whitespace reset to `false` and so missed
   spaced cases. Whitespace no longer changes this state. A number, a name, or an opening `(`
   immediately after a value-ending token is refused (`bad_character` for a number or `(`,
   `bad_name_use` for a name), covering `1 e 2`, `2 pi`, `sqrt(4)pi`, `(1)(2)`, `(1)(2)(3)`,
   `sin(1)(2)`, `2 3`, `2 (3)`, `pi e` — not just the already-refused glued forms (`2pi`). An
   explicit operator between two parenthesised terms (`(1)*(2)`, `-(2)`, `2^(3)`) still resets
   the state and is accepted. The file's doc comments (`checkExpression`'s header) were updated
   to describe this; scientific notation was already refused by the existing tests and is
   unaffected.
2. **gcd/lcm above 2^53 (LOW).** Chose the "refuse unsafe arguments" option over dropping the
   functions: `grep -rn "gcd|lcm" packages evals docs` showed `turn.integration.test.ts` uses
   `lcm(2,3)` as its example tool call, and 5.5's handoff/decision log names both functions as
   part of the calculator's allowed set — dropping them would ripple into files outside this
   plan's scope. `getRestrictedMath()` now wraps the original `gcd`/`lcm` with a
   `requireSafeIntegers` check that throws (caught and reported as `evaluation_failed`, same
   reason the existing non-integer-argument tests already expect) for any argument outside
   `Number.isSafeInteger` range. `gcd(2^1000, 3)` now throws instead of returning 3.
3. **Lazy mathjs instance.** `restrictedMath` (an eagerly created module-level value) is replaced
   by `getRestrictedMath()`, which builds and caches a single instance on first call via
   `cached ??= buildRestricted()`; `evaluateExpression` uses the same cache. mathjs's own
   `evaluate` is captured before being overridden to throw (`disabled`), so calling it after
   lazy build still works. No behaviour change; a dedicated test confirms `getRestrictedMath()`
   returns the same instance across two evaluations.

### Files changed

- `packages/harness/src/tools/sandbox.ts` — tokenizer fix, gcd/lcm guard, lazy instance.
- `packages/harness/src/tools/sandbox.test.ts` — rejection-table additions for implicit
  multiplication and gcd/lcm overflow, three new accept cases (`(1)*(2)`, `-(2)`, `2^(3)`),
  updated `restrictedMath` references to `getRestrictedMath()`, and a singleton-reuse test.
- `packages/harness/src/tools/calculator.fuzz.test.ts` — new attack-corpus entries for the
  implicit-multiplication forms and `gcd(2^1000, 3)`; updated `restrictedMath` references to
  `getRestrictedMath()`.
- `packages/harness/src/tools/index.ts` — doc comment updated (`restrictedMath` →
  `getRestrictedMath`, still not re-exported from the barrel).

## Decisions

### 25 Oct 2026 · 5.5a gcd/lcm overflow fix · decided by builder · risk: low
- Decided: Refuse any `gcd`/`lcm` argument outside `Number.isSafeInteger` range (reported as
  `evaluation_failed`) rather than dropping the functions from the allow-list.
- Why: `turn.integration.test.ts` (outside this plan's file list) uses `lcm(2,3)` as its example
  tool call, and 5.5's own handoff/decision log names both functions as part of the calculator's
  declared scope; dropping them would widen this task's blast radius beyond `sandbox.ts` and its
  own tests for no safety gain, since the overflow case is just as well handled by refusing the
  unsafe input.

### 25 Oct 2026 · 5.5a merge · decided by lead · risk: low
- Decided: merge 5.5a. code-reviewer and typescript-reviewer both raised one HIGH (packages/harness/src/tools/sandbox.ts: lcm checked its inputs but not its result, so two large safe-integer arguments returned a wrong float above 2^53); one fix round made lcm refuse an unsafe result, and both reviewers re-reviewed and approved. Keeping gcd and lcm with safe-integer guards (the builder's decision) is accepted.
- Why: every implicit-multiplication form in the plan is refused with tests, gcd and lcm can no longer return a silently wrong answer, and src/tools keeps 100% coverage.

### 25 Oct 2026 · 5.5a budget · decided by lead · risk: low
- Decided: accept 82 harness tool calls (build 50, fix round 32) against a planned 60.
- Why: the overrun is the fix round for a real HIGH; the build itself stayed under its cap.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` → all 10 tasks
  successful; `src/tools` at 100% coverage (statements/branches/functions/lines); the fuzz test's
  2000 seeded inputs resolved 637 and rejected 1363, both well above the 10% floor.
- `corepack pnpm exec prettier --check` on the four changed files → "All matched files use
  Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Budget

Tool calls used: 50 (harness count; the builder reported 29)

## Fix round

Raised by `code-reviewer` and `typescript-reviewer`: `requireSafeIntegers` only checked `gcd`/
`lcm` inputs, so `lcm(9007199254740990, 9007199254740988)` and
`lcm(9007199254740881, 9007199254740879)` — both safe-integer inputs — silently returned a wrong
float above 2^53.

- `packages/harness/src/tools/sandbox.ts` — `lcm`'s wrapper now also refuses when
  `originalLcm(...)`'s result fails `Number.isSafeInteger`, via the same refusal message/reason
  path as the input check. `gcd` needs no result check: a one-line comment explains why (its
  result is always `<= min(|a|, |b|)`, so a safe-integer input guarantees a safe-integer result).
- `packages/harness/src/tools/sandbox.test.ts` — test-first: added the two overflow cases to the
  `evaluation_failed` rejection table, plus `lcm(2, 3)` → `6` and the large-but-safe
  `lcm(4294967296, 3)` → `12884901888` to the accept table. Both overflow cases failed before the
  fix (no `CalculatorError` thrown) and passed after.
- `packages/harness/src/tools/calculator.fuzz.test.ts` — added both overflow cases to the
  `ATTACKS` corpus.

### Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` → 10/10 tasks
  successful; `src/tools` stays at 100% coverage (statements/branches/functions/lines). One
  unrelated test (`modelRequest.test.ts`'s linear-time timing check) failed once under full
  parallel load and passed cleanly on its own and on a second full run — a pre-existing flake,
  not touched by this change.
- `corepack pnpm exec prettier --check` on the three changed files → "All matched files use
  Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

Tool calls used: 32 (harness count; the fixer reported 15)
