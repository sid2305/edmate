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

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` → all 10 tasks
  successful; `src/tools` at 100% coverage (statements/branches/functions/lines); the fuzz test's
  2000 seeded inputs resolved 637 and rejected 1363, both well above the 10% floor.
- `corepack pnpm exec prettier --check` on the four changed files → "All matched files use
  Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Budget

Tool calls used: 29
