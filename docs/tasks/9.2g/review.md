# 9.2g review — APPROVE

Reviewers: security-reviewer, code-reviewer, typescript-reviewer, database-reviewer

## Findings
- [LOW] [deferred 9.2h] packages/db/test/teacher-profiles.int.test.ts — no Postgres int test covers `listPendingForStaff`/`findBySlugForStaff` with a NULL `display_name` falling back to the slug (security-reviewer)
- [LOW] [deferred 9.2h] apps/web/app/staff/client.ts — `QueueItemSchema.displayName` has no `.min(1)`, looser than the db row schema (security-reviewer)
