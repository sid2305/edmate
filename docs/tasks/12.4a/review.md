# 12.4a review — APPROVE

Reviewers: security-reviewer (sonnet; also as typescript-reviewer and code-reviewer), database-reviewer (sonnet), lead

The repository keeps the regulated-subject flag and approval staff-only. A role check runs before any agent SQL, and every write commits its update with one audit row. The staff list returns no personal columns. The lock order is user, then agent, the same as publish. The database reviewer's HIGH on migration 0023 was fixed in round 1: the new FK and both CHECK constraints are added NOT VALID and validated in POST_MIGRATE_STEPS outside the migration transaction, like 0009. A re-check by database-reviewer confirmed the fix and found nothing new.

## Findings
- [HIGH] [fixed] packages/db/migrations/0023_agents_regulated_subject.sql — the FK and CHECK validation scans ran under the migration's ACCESS EXCLUSIVE lock on agents; now NOT VALID plus validateConstraint post-migrate steps, with a test that all three end validated.
- [MEDIUM] [deferred 12.4e] packages/db/src/repositories/regulated-subjects.ts — listForStaff sorts by (created_at desc, id desc) with no backing index on agents.
