# 8.1 review — APPROVE

Reviewers: security-reviewer (opus), database-reviewer (sonnet), typescript-reviewer (sonnet), code-reviewer (sonnet)

All four approved with no CRITICAL or HIGH findings. security-reviewer and database-reviewer ran the db int suites against Postgres (26/26 tasks, 746 passed). The MEDIUMs and LOWs go to 8.1b (with 8.7); the product question on edits after verification is B-30.

## Findings

- [MEDIUM] [deferred 8.1b] packages/db/src/repositories/teacher-profiles.ts:173 — the publish guard reads without a lock and a later reject doesn't suspend live agents; a reject racing 8.7's publish could let the agent go live. Fix in 8.7: check inside the publish transaction with FOR SHARE; a reject suspends live agents.
- [MEDIUM] [deferred 8.1b] packages/db/src/repositories/README.md — rule 9 and "Adding a method" don't mention the role-lock.ts pattern for role checks.
- [LOW] [deferred 8.1b] packages/db/src/repositories/teacher-profiles.ts:110 — update and setVerification don't use translateWrite, unlike create.
- [LOW] [deferred 8.1b] packages/db/src/repositories/teacher-profiles.ts:110 — a verified teacher's subject/bio edits are not re-reviewed (product question B-30).
- [LOW] [deferred 8.1b] packages/db/src/cli.ts:226 — `--by` is operator-typed; 8.1a and 12.1 must take it from the signed-in session (noted in the 8.1 plan for 8.1a).
- [LOW] [deferred 8.1b] packages/db/src/cli.ts:209 — the CLI writes to whatever DATABASE_URL is set without showing the redacted target (same as grant-role).
- [LOW] [deferred 8.1b] packages/db/src/cli.ts:150 — the teacher's email goes on argv (shell history); accept --user-id.
- [LOW] [deferred 8.1b] packages/db/src/repositories/teacher-profiles.ts:49 — free-text --reason is stored in audit_log; the usage text should say no personal details.
- [LOW] [wontfix] packages/db/migrations/0016_teacher_verification_status.sql:3 — USING cast omits the intermediate ::text that 0005 used; functionally equivalent.
