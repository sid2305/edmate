# 8.9b review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings
- [MEDIUM] [deferred 8.9d] apps/web/src/studio/questions/routes.test.ts — `req()` casts a plain Request to NextRequest instead of building a real `NextRequest` like the sibling studio tests.
- [LOW] [deferred 8.9d] apps/web/src/studio/questions/routes.ts — only `not_found` and `invalid` repository kinds are mapped; the rest fall through to the logged 500, the same as the existing studio routes.
