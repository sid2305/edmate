**Status:** DONE

## What changed
- `packages/gateway/src/router/default-policy.ts`: added a local `DeepReadonly<T>` type and typed `MODEL_MIX` as `DeepReadonly<Record<PackageMixTier, ModelPolicy>>`. The mix was already deep-frozen at definition (`mix()` uses nested `Object.freeze`), so no runtime change was needed to match the new type.
- `packages/gateway/src/pricing/estimate.ts`: added `export class TurnCostError extends RangeError` (name `'TurnCostError'`) and replaced the three `RangeError` throws at the "no tier", "smallCallsPerTurn" and "too large to store exactly" sites with `TurnCostError`. The negative-token-count throw stays a `RangeError` because it comes from `cost.ts` (out of bounds, left unchanged), not from estimate.ts.
- `packages/gateway/src/pricing/index.ts`: exported `TurnCostError` next to the other estimate exports.
- `packages/gateway/test/router/default-policy.test.ts`: added a type-only (never-called) function with three `@ts-expect-error` nested assignments (`tiers`, `tiers.main`, `tiers.main.model`) proving MODEL_MIX is read-only at every nesting level.
- `packages/gateway/test/pricing/estimate.test.ts`: the three estimate.ts throw-site tests now assert `toThrow(TurnCostError)` instead of a message string or bare `RangeError`; added a test that `TurnCostError` is also `instanceof RangeError` (name `'TurnCostError'`); added `TurnCostError` to the package-exports assertion. The negative-token-count test is unchanged (`toThrow(RangeError)`, from cost.ts).
- `packages/gateway/test/keys/exports.test.ts`: added `'TurnCostError'` to the expected export-name list (not in the plan's Files list, but required once `TurnCostError` became a new named export — this test enumerates every export by name).

Searched apps/ and packages/ for `err.name === 'RangeError'` on an estimate error path: none found. `packagesRuntime.ts` catches `UnpricedModelError` specifically (unaffected); test files that assert `RangeError` (publish.test.ts, routes.test.ts, etc.) are all unrelated error paths (storage, rate-limit, DB), not estimate.ts.

apps/web consumers (`publish.ts`, `publishRuntime.ts`, `packages.ts`, `packagesRuntime.ts`) all typechecked unchanged against the new `DeepReadonly<ModelPolicy>` MODEL_MIX — no widening or cast needed.

## Evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway... --force --concurrency=1` — 14/14 tasks successful, gateway test suite: all files green including `test/router/default-policy.test.ts` and `test/pricing/estimate.test.ts`.
- `corepack pnpm turbo run typecheck --filter=@edmate/web` — 8/8 tasks successful (apps/web, which imports MODEL_MIX, typechecks against the new deep-readonly type).
- `python3 .githooks/secret-scan.py --all` — no output, clean.
- Test names: `MODEL_MIX (B-42) > is frozen all the way down, so no caller can change the mix at runtime` (unchanged, still passes); type-only `typeOnlyNestedAssignmentsAreRejected` function in default-policy.test.ts (three `@ts-expect-error` lines, checked by `tsc --noEmit` in the typecheck step, not at runtime); `turnCostMicroUsd > a policy without a %s tier is rejected`, `rejects smallCallsPerTurn %s`, `rejects a total too large to store exactly` (all now `toThrow(TurnCostError)`); `TurnCostError is also a RangeError, so existing instanceof RangeError callers still work`.

## Decisions

### 25 Oct 2026 · 8.6e type-only ts-expect-error test does not run at runtime · decided by builder · risk: low
- Decided: the three `@ts-expect-error` nested-assignment checks live in a module-scope function that is never called (referenced once via `void fn;` to satisfy lint), not inside an `it()` body.
- Why: `MODEL_MIX` is deep-frozen at runtime (`Object.freeze`), so executing the assignment inside a test body throws `TypeError: Cannot assign to read only property` at runtime before the `@ts-expect-error` comment's compile-time check is reached; a type-only, uncalled function gets the same `tsc --noEmit` guarantee without a spurious runtime failure.

### 25 Oct 2026 · 8.6e added TurnCostError to the keys/exports.test.ts export-name list · decided by builder · risk: low
- Decided: added `'TurnCostError'` to `packages/gateway/test/keys/exports.test.ts`'s sorted list, one file outside the plan's Files list.
- Why: that test enumerates every named export from the package root and fails if the list drifts; exporting `TurnCostError` (required by the plan) made it fail with no code-behaviour change, so updating the list was the minimal fix rather than skipping the new export.

### 25 Oct 2026 · 8.6e budget overrun (69 calls against 35) · decided by lead · risk: low
- Decided: accept 8.6e at 69 tool calls (harness count: build 47, fix round 22) against the plan's 35; no rework.
- Why: the build ran 47 including setup the lead-written budget left out, and the fix round for the typescript-reviewer's HIGH (DeepReadonly arrays) was a separate fresh agent; the reviewer verified the fix.

## Fix round

### HIGH: `DeepReadonly<T>`'s array branch returned array types unchanged
- Finding (typescript-reviewer): `packages/gateway/src/router/default-policy.ts:15-21` — the array branch (`T extends readonly unknown[] | undefined | null ? T : ...`) returned `T` unchanged for arrays, so `DeepReadonly<string[]>` still allowed `.push()` and index assignment, contradicting the doc comment and the plan's "correct for arrays".
- Change: replaced the array branch so it recurses into the element type: `T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] : ...`, keeping the `undefined | null` short-circuit, the function short-circuit, and the plain-object recursion unchanged. Primitives still fall through to `T` at the end.
- Tests added (`packages/gateway/test/router/default-policy.test.ts`): a second type-only, never-called function `typeOnlyArrayElementsAreDeeplyReadonly` with three `@ts-expect-error` lines — `DeepReadonly<string[]>.push(...)`, index assignment on the same array, and `DeepReadonly<{ a: { b: number }[] }>`'s `nested.a[0].b = 1` (a field on an element inside an array).
- Evidence:
  - `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway... --force` → 14/14 tasks successful (gateway lint, typecheck, test; harness and config as dependencies), gateway test suite all green including the two type-only functions in `default-policy.test.ts` (checked by `tsc --noEmit`, not at runtime).
  - `corepack pnpm turbo run typecheck --filter=@edmate/web` → 8/8 tasks successful; apps/web (`packagesRuntime.ts` and other MODEL_MIX consumers) still compiles with no casts against the now-truly-deep-readonly `DeepReadonly<ModelPolicy>`.
  - `python3 .githooks/secret-scan.py --all` → no output, clean.
- Commit: see sha below.

## Budget
Tool calls used: 69 (harness count: build 47 + fix round 22)
