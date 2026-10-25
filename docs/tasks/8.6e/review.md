# 8.6e review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

code-reviewer approved the build. typescript-reviewer asked for changes on one HIGH: `DeepReadonly<T>` left array types mutable. A fresh Sonnet fixer made the array branch recurse (`readonly DeepReadonly<U>[]`) and added type-level tests. The same reviewer then verified the fix with scratch compiles under the repo's strict flags, and confirmed the apps/web consumers of MODEL_MIX still compile without casts. `TurnCostError extends RangeError` follows the existing `UnpricedModelError` pattern and is in the exports allowlist.

## Findings
- [HIGH] [fixed] packages/gateway/src/router/default-policy.ts:15 — DeepReadonly's array branch returned arrays unchanged, so `.push` and index assignment still typechecked; now recurses into elements.
- [LOW] [wontfix] packages/gateway/test/router/default-policy.test.ts:28 — the `nested.a[0].b = 1` expect-error also passes from noUncheckedIndexedAccess; the `string[]` `.push` and index-assignment cases in the same file already fail under the old branch, so the array branch is pinned.
