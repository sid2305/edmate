# 9.2f review — APPROVE
Reviewers: code-reviewer, typescript-reviewer

Both reviewers approved. The double cast of the translator in the teacher page is gone (`Translate`
now derives from next-intl's `getTranslations`); one narrow `dynamicLabel` helper holds the only
remaining cast, used at the two runtime-built key sites. The scorecard cast became a real guard
that fails closed, and the format fallback throws instead of guessing.

## Findings
- [MEDIUM] [wontfix] apps/web/src/discovery/scorecard.ts — plan asked for a missing-key test; the guard is unreachable through the public entry point, and the deviation was not recorded. Now recorded as a lead decision.
- [LOW] [wontfix] apps/web/src/discovery/scorecard.test.ts — same gap seen by typescript-reviewer (no new test); covered by the decision above.
- [LOW] [wontfix] apps/web/src/discovery/format.ts — the new throw path is untested; Intl always resolves the digits, so it is unreachable in practice (lead decision).
