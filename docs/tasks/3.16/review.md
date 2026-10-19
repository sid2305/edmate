# 3.16 review — APPROVE
Reviewers: security-reviewer (opus), database-reviewer (sonnet), typescript-reviewer (sonnet)

All three approved the build (3bccb92). A safety plan review before the build fixed the migration design and the summary-wipe race. One small fix round (616dd29, build-error-resolver on sonnet) handled the database HIGH and the cheap LOWs; the lead checked the migration diff. db 421 and harness 2,118 tests pass on Postgres with nothing skipped; the secret scan is clean.

## Findings
- [HIGH] [deferred 3.16b] packages/db/migrations/0009_session_package_pin.sql:58 — constraint validation scans `sessions` under ACCESS EXCLUSIVE. The fix round added NOT VALID + VALIDATE, but drizzle runs the file in one transaction, so the lock is still held to commit. No production data exists yet. The VALIDATE statements move to their own migration before the pilot has real sessions.
- [MEDIUM] [deferred 3.16b] packages/db/migrations/0009_session_package_pin.sql:59 — plain CREATE INDEX blocks writes while it builds. Can't be CONCURRENTLY inside drizzle's transaction; it goes in the same pre-pilot migration task.
- [MEDIUM] [deferred 3.16b] packages/db/migrations/0009_session_package_pin.sql:24 — the backfill has no partial index on open sessions. Fine at today's size; revisit in 3.16b.
- [MEDIUM] [deferred 3.17] packages/db/src/repositories/learner.ts:55 — `learnerProfiles.save` overwrites `last_summary` unconditionally. The future summary writer must write only while the session is open and pinned to the entitlement's package.
- [MEDIUM] [fixed] packages/harness/src/testing/memoryAccess.ts:39 — the fixture now enforces the pin invariant (an open session must have a pin; the pair is both-or-neither).
- [LOW] [fixed] packages/db/src/repositories/messages.ts:73 — `append` now requires an open session.
- [LOW] [fixed] packages/db/test/session-package.int.test.ts:292 — added 5 concurrent `load` calls: the session ends once.
- [LOW] [fixed] packages/db/migrations/0009_session_package_pin.sql:24 — a comment on pinning to today's subscription.
- [LOW] [fixed] packages/db/test/session-package-migration.int.test.ts:221 — deterministic ids.
