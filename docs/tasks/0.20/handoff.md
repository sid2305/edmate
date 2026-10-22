# Task 0.20 handoff: harness tests that time out under CI load

Status: DONE
Tool calls used: 21

## Acceptance evidence

```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/harness
...
 Tasks:    4 successful, 4 total
  Time:    11.259s
```

Grep for remaining explicit timeouts below 10 s (none, except the latency assertion listed below):
```
$ grep -rnE "timeout: [0-9]{1,4}[,}]|^const T = [0-9]{1,4}_?[0-9]{0,3};" src --include="*.test.ts"
(no matches outside the 5_000 latency test, which is left alone)
```

## Files changed

- `packages/harness/vitest.config.ts` — added `testTimeout: 20_000` (was: vitest default, 5000 ms).
- `src/pipeline/runner.block.test.ts` — `const T` 3_000 → 20_000.
- `src/guardrails/moderationIn.test.ts`, `jailbreak.test.ts`, `decodeAttempts.test.ts`, `moderationPatterns.test.ts`, `jailbreakPatterns.test.ts` — `const T` 2_000 → 20_000.
- `src/guardrails/safetyClassifier.test.ts`, `blockReplies.test.ts` — `const T` 1_000 → 20_000.
- `src/pipeline/steps/postGuard.advice.test.ts` (4 sites), `src/pipeline/steps/postGuard.grounding.test.ts` (2 sites) — `{ timeout: 5_000 }` → `{ timeout: 20_000 }`.
- `src/pipeline/steps/route.accuracy.test.ts` — no explicit timeout; now covered by the new 20 s config default (was: 5000 ms default).
- `src/access/*.property.test.ts`, `src/tools/calculator.fuzz.test.ts` — no explicit timeout below 10 s; covered by the new default where relevant (`calculator.fuzz.test.ts` already had its own `{ timeout: 60_000 }`, left alone).

In every file above, the `const T` / `{ timeout: ... }` value was only ever used as the third (timeout) argument to `it()` — never read inside the test body or passed into the function under test — so raising it changes no test logic or behavior, only how long vitest will wait.

Checked but not a timeout (same `const T = ...` spelling, different meaning, left alone): `src/pedagogy/coverage.test.ts` (`T = DEFAULT_COVERAGE_THRESHOLD`), `src/tools/demoPracticeBank.test.ts` (`T = DEMO_PRACTICE_TEACHER_ID`).

## Latency assertions left alone (9.4a / 8.2a material)

- `src/guardrails/piiPatterns.test.ts:555` — `it('handles a 4,000-character adversarial message quickly', { timeout: 5_000 }, ...)` asserts `expect(Date.now() - started).toBeLessThan(2_000)` on real wall-clock time. Untouched per plan scope.

## Deviations

None. Scope stayed inside `packages/harness/vitest.config.ts` and `*.test.ts` files, as the plan required.

## Decisions

### 21 Oct 2026 · 0.20 raise test timeouts to a shared 20s value instead of removing the per-test third argument · decided by builder · risk: low
- Decided: Where a test had an explicit per-test timeout below 10 s (`const T = ...` passed as `it()`'s third argument, or an inline `{ timeout: N }`), raise the value to 20_000 rather than deleting the argument so the global config default applies.
- Why: Confirmed in each file that the constant/object is used only as the `it()` timeout argument, never read by the test body or passed to the code under test, so raising it is equivalent to removing it and relying on the new config default, but touches one line instead of restructuring call sites across many files (lower risk of a slip, same outcome, well under the 25-call budget).
- risk: low
