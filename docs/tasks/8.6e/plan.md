# 8.6e plan: DeepReadonly MODEL_MIX and a named per-turn cost error

Written by the lead (two small 8.6a review LOWs; no planner run).

## Acceptance (verbatim, board)
A nested MODEL_MIX assignment fails typecheck; estimate.ts throws a named error class and tests match on the class, not the message.

### How it is shown (paste into handoff.md)
- A type-level test in packages/gateway/test/router/default-policy.test.ts: `// @ts-expect-error` on a nested assignment such as `MODEL_MIX.paid.<field> = ...` (and one level deeper if the policy has nested objects), so typecheck fails if the nesting ever becomes writable again.
- packages/gateway/test/pricing/estimate.test.ts asserts `toThrow(<NamedError>)` (the class) for each throw in estimate.ts, not a message string.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/gateway... --force --concurrency=1` green (the trailing ... includes apps/web, which imports MODEL_MIX).

## Design
1. A local `DeepReadonly<T>` type (in packages/gateway/src/router/default-policy.ts, or a small shared types file inside packages/gateway/src if one already exists) and `MODEL_MIX: DeepReadonly<Record<PackageMixTier, ModelPolicy>>`. Freeze nested objects too if they are not already frozen (deep freeze at definition), so runtime matches the type. `DEFAULT_MODEL_POLICY` and every consumer (apps/web/src/studio/publish.ts, publishRuntime.ts, packages.ts) must still typecheck; if a consumer passes MODEL_MIX.<tier> where a mutable `ModelPolicy` is expected, prefer widening that parameter to readonly over casting. No `as` casts to strip readonly.
2. `export class TurnCostError extends RangeError` (name `'TurnCostError'`, set `this.name`) in packages/gateway/src/pricing/estimate.ts, thrown by the three RangeErrors there (lines ~44, ~62, ~73). It extends RangeError so existing `instanceof RangeError` callers still work. Export it from the package index next to the estimate exports. Leave packages/gateway/src/pricing/cost.ts unchanged.
3. Search apps/ and packages/ for code or tests that log or compare `err.name === 'RangeError'` on an estimate error path; if one exists, keep its behaviour (update the expectation to the new name only where the test is about the estimate error) and note it in the handoff.

## Files to create/modify
- packages/gateway/src/router/default-policy.ts
- packages/gateway/src/pricing/estimate.ts
- packages/gateway/src/index.ts (or the pricing index that re-exports estimate)
- packages/gateway/test/router/default-policy.test.ts
- packages/gateway/test/pricing/estimate.test.ts
- apps/web/src/studio/{publish,publishRuntime,packages}.ts only if a readonly parameter type needs widening (no behaviour change)
- docs/tasks/8.6e/handoff.md

## Files out of bounds
packages/gateway/src/keys/** (risky path), packages/gateway/src/pricing/cost.ts, apps/web/app/staff/**, apps/web/src/staff/**, packages/db/** (9.3h is editing those).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
None.

## Questions
None.

## Budget
35 tool calls; stop at 45.
