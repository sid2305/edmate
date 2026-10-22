# 8.6a review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings
- [LOW] [deferred 8.6e] packages/gateway/src/router/default-policy.ts — MODEL_MIX is typed only shallowly readonly although the value is deep-frozen; a nested assignment type-checks and silently no-ops. Use a DeepReadonly type.
- [LOW] [deferred 8.6e] packages/gateway/src/pricing/estimate.ts — missing-tier and bad-count errors are plain RangeErrors matched by message in tests; consider a named error class like UnpricedModelError.
