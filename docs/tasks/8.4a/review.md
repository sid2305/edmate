# 8.4a review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), security-reviewer (sonnet), database-reviewer (sonnet), lead

## Findings
- [LOW] [wontfix] packages/db/src/repositories/style-cards.ts — two teachers whose hashtext values collide serialise each other's saves; performance only, accepted in the builder's risk: high decision.
- [LOW] [deferred 8.4c] apps/web/src/studio/styleCardRoutes.ts — interview answers and the saved card text reach the drafter and every turn's prompt with length caps only; strip role-play and rule-override phrases before reuse.
- [LOW] [deferred 8.4c] apps/web/src/studio/styleCardRuntime.ts — style-card drafting is not metered; the usage ledger needs a teacher-side studio scope.
