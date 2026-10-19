# 3.16b review — APPROVE
Reviewers: database-reviewer (sonnet), team lead (opus)

The post-migrate step runs 0009's VALIDATE CONSTRAINT statements and the sessions package index CONCURRENTLY as autocommit statements after drizzle's single migration transaction commits. database-reviewer confirmed:
- the lock levels are right;
- the window between migrate and post-migrate is safe (NOT VALID still enforces new rows);
- editing the unreleased 0009 is safe, because drizzle 0.45 compares only the journal timestamp;
- `db:generate` stays a no-op.

Its one CRITICAL is fixed in 156af7b and re-verified: an INVALID leftover index is now dropped and rebuilt, with a real int test. db 431 tests pass on Postgres with nothing skipped; migrate.ts is at 100% coverage.

## Findings
- [CRITICAL] [fixed] packages/db/src/migrate.ts:73 — `CREATE INDEX CONCURRENTLY IF NOT EXISTS` skipped an INVALID leftover index forever. It is now detected, dropped and rebuilt; re-verified by database-reviewer.
- [MEDIUM] [deferred 3.16c] packages/db/src/migrate.ts:76 — the index lookup isn't schema-qualified. Use `to_regclass('public.<name>')` or join pg_namespace.
- [MEDIUM] [deferred 3.16c] packages/db/src/migrate.ts:99 — overlapping migrateDatabase() runs could drop a healthy in-progress concurrent build. Take an advisory lock around migrateDatabase(), or skip the drop while pg_stat_progress_create_index shows a build in progress.
- [MEDIUM] [deferred 3.16c] packages/db/migrations/0009_session_package_pin.sql:24 — a partial index on open sessions for the backfill (from the 3.16 review).
