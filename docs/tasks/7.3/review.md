# 7.3 review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

Both reviewers ran typecheck, lint and tests in a snapshot (1061 tests pass, 100% coverage on `perAgentSuite.ts`). The code reviewer traced the locked/accuracy routing: a package that excludes the answering module only ever gets a locked case built from the question text, never the answer.

## Findings
- [LOW] [deferred 7.3b] packages/evals/src/perAgentSuite.ts — `PerAgentSuiteError` declares `override name` without `readonly`, unlike its sibling error classes.
- [LOW] [deferred 7.3b] packages/evals/src/perAgentSuite.ts — `PerAgentSuiteError` takes no structured field and no `{ cause }` option, unlike the loader and recorder errors.
- [LOW] [deferred 7.3b] packages/evals/src/perAgentSuite.ts — the locked loop iterates `Object.entries(MODULE_MESSAGES)`, which widens the keys; iterating `LOCKED_TEMPLATES` instead would be clearer (the `Record` type already enforces exhaustiveness).
