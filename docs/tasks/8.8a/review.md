# 8.8a review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), security-reviewer (sonnet), lead

## Findings
- [HIGH] [fixed] packages/db/src/repositories/turn-traces.ts — a capped `listForTeacherSince` returned the oldest traces in the window instead of the newest; now orders desc, limits, reverses, with an integration test.
- [LOW] [fixed] apps/web/src/studio/insights.ts — `capped` compared with `===`; now `>=`.
