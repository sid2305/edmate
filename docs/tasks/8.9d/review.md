# 8.9d review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

The studio questions routes now map every RepositoryError kind to its own status with a test each, the route tests build a real NextRequest, and the inbox shows the error banner when answering or dismissing fails. The code review found nothing. The TypeScript review's one MEDIUM (the switch is not compiler-enforced exhaustive) moves to 8.9e. The builder's local web run skipped 4 database test files for lack of TEST_DATABASE_URL; none are in scope, and CI runs them.

## Findings
- [MEDIUM] [deferred 8.9e] apps/web/src/studio/questions/routes.ts:126 — fromError has no `never` default, so a new RepositoryErrorKind would fall through to a 500 instead of failing to compile, despite the comment.
