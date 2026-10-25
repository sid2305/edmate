# 13.4 review — APPROVE (Phases A and B; Phase C moved to 13.4b)

Reviewers: code-reviewer, typescript-reviewer, security-reviewer, database-reviewer, silent-failure-hunter

Phase A (packages/db) adds `identity.anonymise` (clears a student's personal fields and free text, deletes sign-in sessions, linked accounts and tokens, dismisses their open questions, and keeps safety alerts, payments and audit logs) and bounded retention purges for sessions, turn traces and transcript chunks, with migrations 0031 (platform actor role 'student') and 0032 (retention cutoff indexes). Phase B (apps/worker) adds a daily retention job that loops each purge until a call returns fewer than the limit, dry run by default with placeholder periods. Phase C (apps/web export and DELETE /api/me) is not in this PR.

## Findings
- [HIGH] [fixed] packages/db/src/identity/store.ts — anonymise left auth sessions, accounts and verification tokens, so a signed-in device kept working.
- [HIGH] [fixed] packages/db/src/identity/store.ts — anonymise left learner_profiles.last_summary, sessions.summary and teacher_questions.text.
- [HIGH] [fixed] packages/db/src/identity/store.ts — the fix round's emptied question text collided on the dedup index; the student's open questions are now dismissed in the same update.
- [HIGH] [fixed] packages/db/src/repositories/retention.ts — cutoff predicates had no indexes; migration 0032 adds them.
- [HIGH] [fixed] packages/db/src/repositories/retention.ts — purges were unbounded; each call now deletes at most RETENTION_PURGE_LIMIT rows.
- [MEDIUM] [wontfix] packages/db/src/identity/store.ts — no "account closed" flag; with sessions and accounts deleted and the email cleared, a later sign-in creates a new empty account (builder decision).
- [MEDIUM] [deferred 13.4a] packages/db/migrations/0032_retention_indexes.sql — plain CREATE INDEX; move to the concurrent post-migrate pattern before the tables grow.
- [MEDIUM] [deferred 13.4c] apps/worker/src/retention/workers.ts — a failure on a later loop call loses the count already deleted.
- [MEDIUM] [deferred 13.4c] apps/worker/src/retention/workers.ts — purgeLimit is not passed to the purge call, so the two limits can drift.
- [LOW] [deferred 13.4c] apps/worker/src/retention/config.ts — cutoffFor accepts zero or negative days.
- [LOW] [deferred 13.4c] apps/worker/src/retention/schedule.ts — no warning when a run is live rather than a dry run.
- [LOW] [deferred 13.4c] apps/worker/src/index.ts — a failed retention schedule registration only logs.
- [LOW] [fixed] packages/db/src/index.ts — import line over 100 characters.
- [LOW] [fixed] packages/db/test/retention.int.test.ts — FUTURE_CUTOFF named for a past date.
- [LOW] [fixed] packages/db/migrations/0031_platform_actor_role_student.sql — comment on enum value use in the same deploy.
