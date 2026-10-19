# 3.16 review — APPROVE
Reviewers: security-reviewer (opus), database-reviewer (sonnet), typescript-reviewer (sonnet)

All three approved the build (3bccb92). A safety plan review before the build fixed the migration design and the summary-wipe race. One small fix round (616dd29, build-error-resolver on sonnet) handled the database HIGH and the cheap LOWs; the lead checked the migration diff. db 421 and harness 2,118 tests pass on Postgres with nothing skipped; the secret scan is clean.

## Findings
- [MEDIUM] [deferred 3.16b] packages/db/migrations/0009_session_package_pin.sql:58 — constraint validation scans `sessions` under ACCESS EXCLUSIVE. The database reviewer rated this HIGH for a large production table, and noted it doesn't block this PR. The lead re-rates it MEDIUM: the pilot is about 500 students, so the scan takes milliseconds. The fix round's NOT VALID + VALIDATE doesn't help yet, because drizzle 0.45 runs ALL pending migrations in one transaction (verified in pg-core/dialect.js). 3.16b adds a VALIDATE path outside drizzle's transaction before sessions grow. See the 3.16 decision.
- [MEDIUM] [deferred 3.16b] packages/db/migrations/0009_session_package_pin.sql:59 — plain CREATE INDEX blocks writes while it builds. Can't be CONCURRENTLY inside drizzle's transaction; it goes in the same pre-pilot migration task.
- [MEDIUM] [deferred 3.16b] packages/db/migrations/0009_session_package_pin.sql:24 — the backfill has no partial index on open sessions. Fine at today's size; revisit in 3.16b.
- [MEDIUM] [deferred 3.17] packages/db/src/repositories/learner.ts:55 — `learnerProfiles.save` overwrites `last_summary` unconditionally. The future summary writer must write only while the session is open and pinned to the entitlement's package.
- [MEDIUM] [fixed] packages/harness/src/testing/memoryAccess.ts:39 — the fixture now enforces the pin invariant (an open session must have a pin; the pair is both-or-neither).
- [LOW] [fixed] packages/db/src/repositories/messages.ts:73 — `append` now requires an open session.
- [LOW] [fixed] packages/db/test/session-package.int.test.ts:292 — added 5 concurrent `load` calls: the session ends once.
- [LOW] [fixed] packages/db/migrations/0009_session_package_pin.sql:24 — a comment on pinning to today's subscription.
- [LOW] [fixed] packages/db/test/session-package-migration.int.test.ts:221 — deterministic ids.

## 3.16c (PR #45) — APPROVE
Reviewer: database-reviewer (sonnet). It confirmed:
- the advisory lock is session-scoped and released on every path;
- polling `pg_try_advisory_lock` removes the self-deadlock with CREATE INDEX CONCURRENTLY;
- the concurrency int test really runs two migrations against a fresh database;
- the partial index is correct;
- the trimmed 0010 migration is safe for drizzle, and `db:generate` stays a no-op.

db 436 tests pass on Postgres with nothing skipped.

- [MEDIUM] [deferred 3.16d] packages/db/src/migrate.ts:120 — `to_regclass('public.' || $1)` doesn't quote the identifier; use `format('%I.%I', 'public', $1)`.
- [MEDIUM] [deferred 3.16d] packages/db/src/migrate.ts:172 — an unrelated idle-in-transaction session can hang CREATE INDEX CONCURRENTLY indefinitely; add a bounded statement_timeout on the post-migrate connection, and a caveat.
- [LOW] [deferred 3.16d] packages/db/src/migrate.ts:184 — unlock only when the lock was taken, so a dead-connection error isn't masked.

## 3.16d (PR #46) — APPROVE
Reviewer: database-reviewer (sonnet). It confirmed:
- `format('%I.%I', ...)` quoting (with a mixed-case int test);
- the session-level statement_timeout is scoped to the dedicated, closed migration pool;
- a timed-out concurrent build leaves an INVALID index that the next run rebuilds;
- env parsing;
- an acquire failure isn't masked.

db 449 tests pass on Postgres.

- [MEDIUM] [wontfix] packages/db/src/migrate.ts:208 — if fn throws and the unlock then throws (dead connection), the unlock error replaces fn's. Accepted; see the 3.16d decision.
- [LOW] [wontfix] packages/db/test/migrate.int.test.ts:191 — the timeout test uses a 2 s blocker with a 300 ms lead (a ~1.5 s margin); revisit if it flakes. See the 3.16d decision.
