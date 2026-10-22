# 12.3f review — APPROVE
Reviewers: security-reviewer, database-reviewer

security-reviewer and database-reviewer (both sonnet) reviewed the change. rightsDeclared is now `z.literal(true)` with no `.optional()` on documents create (including the web-link path) and startReplace, so leaving it out is a typecheck error; zod runs before any SQL, so a missing or non-true value returns invalid with nothing written. rights_declared_at is set on every create and replace. Every db and worker test caller passes the field; the one apps/web test edit (apps/web/app/api/staff/reports/route.int.test.ts) was lead-approved. The 12.3b tests were updated to the new behaviour, and the read path for legacy null rows keeps its coverage. No migration or contracts change. No findings.

## Findings
