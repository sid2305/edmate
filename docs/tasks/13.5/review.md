# 13.5 review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer

**Phase A (packages/db).** security-reviewer, database-reviewer and code-reviewer approved. typescript-reviewer found a HIGH: the integrity guard dropped `src/repositories/**` coverage below 100%. The fix round moved `exact()` into map.ts and reused it, and the re-review approved with coverage back at 100%.

**Phase B (apps/web).** code-reviewer, typescript-reviewer and security-reviewer approved, with LOWs only.

## Findings
- [HIGH] [fixed] packages/db/src/repositories/subscriptions.ts — the activeCountByPackage integrity guard was untested, so repositories coverage fell below 100%.
- [MEDIUM] [fixed] packages/db/src/repositories/README.md — rule 11 did not list the two new unscoped reads.
- [MEDIUM] [fixed] packages/db/test/usage-ledger.int.test.ts — no boundary-tie test at since and until.
- [LOW] [fixed] packages/db/src/repositories/subscriptions.ts — duplicated exact() pattern.
- [LOW] [deferred 13.5a] packages/db/src/repositories/usage-ledger.ts — costByPackageSince accepts until < since; returns empty, no guard.
- [LOW] [deferred 13.5a] packages/db/test/usage-ledger.int.test.ts — teacher B totals not cross-checked with raw SQL.
- [LOW] [deferred 13.5a] apps/web/app/api/staff/cost/handlers.ts — no maximum window span on since and until.
- [LOW] [deferred 13.5a] apps/web/app/staff/cost/client.ts — GET has no same-origin check; inherited app-wide pattern.
- [LOW] [deferred 13.5a] apps/web/app/api/staff/cost/handlers.ts — sequential per-teacher and per-package reads; use Promise.all if staff use grows.
- [LOW] [deferred 13.5a] apps/web/app/api/staff/cost/handlers.ts — a RepositoryError of kind scope maps to 400, although the scoped values are internal; 500 fits better.
