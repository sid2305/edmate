# 13.4d review — APPROVE

Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer

## Findings
- [MEDIUM] [deferred 13.4e] apps/web/src/export/accountExport.ts — listAllForStudent returns one row per historical subscription, so a student who re-subscribes gets duplicate teacher entries, each re-reading the same history; the pair fan-out has no cap (database-reviewer)
- [MEDIUM] [deferred 13.4e] packages/db/src/identity/store.ts — `row.grantedBy as 'self' | 'parent'` casts with no runtime check; parse it with a zod enum (typescript-reviewer)
- [LOW] [wontfix] packages/db/src/repositories/subscriptions.ts — prettier reformatting of unrelated lines widens the diff; no logic change (code-reviewer)
