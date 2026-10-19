# 3.16b handoff — Pre-pilot migration locking

**Status:** DONE
**Branch:** `m7/3.16b-migration-locking`
**Worktree:** `.claude/worktrees/agent-a8cb2f7cc59302e11`

Acceptance (board): "a migration test shows the constraints validate in a separate migration; no
long ACCESS EXCLUSIVE lock on sessions." The actual mechanism is a post-migrate step rather than a
second migration file (see Deviations: a second file would still run inside drizzle's one
migration transaction, so it would not shorten the lock). No contracts change. No model or
payment calls in any test.

## Acceptance evidence

Postgres: `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml -f apps/worker/test/compose.port.yaml up -d postgres redis`. Nothing skipped (no `SKIPPED` line in the db run).

| Command | Result (trimmed) |
|---|---|
| `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --force` | `Tasks: 14 successful, 14 total` |
| db test | `Test Files 23 passed (23)` · `Tests 428 passed (428)` · `All files 99.89 / 99.21 / 99.66 / 100` · `migrate.ts 100 / 100 / 100 / 100` |
| `test/migrate.int.test.ts` (new cases) | `validates the three 0009 constraints and builds the package-pin index outside the migration transaction` and `rejects a session that violates the 0009 package-pin constraints` pass; existing `apply cleanly`, `re-running is a no-op` and `tear down ... apply again from scratch` still pass (migrateDatabase runs twice across the suite already) |
| `test/migrate.test.ts` (new, unit, no Postgres needed) | 5 tests: skip-when-already-valid, run-when-not-valid, missing-constraint-row treated as nothing to validate, a concurrent-index step runs as its own statement, the default `POST_MIGRATE_STEPS` list shape |
| `test/session-package-migration.int.test.ts`, `test/session-package.int.test.ts`, `test/schema.test.ts` | pass (regression; unaffected by this change) |
| `corepack pnpm db:generate` (packages/db) | `No schema changes, nothing to migrate` — confirms removing the `CREATE INDEX` from 0009's SQL and keeping the index only in `src/schema/learning.ts` left drizzle's diff a no-op |
| `python3 .githooks/secret-scan.py --all` | no output, exit 0 |

Direct check of the mechanism (via the new `migrate.int.test.ts` case): after `migrateDatabase()`,
`pg_constraint.convalidated` is `true` for `sessions_package_version_fk`,
`sessions_package_pin_complete` and `sessions_open_has_package`, and
`pg_index.indisvalid`/`indisready` are both `true` for `sessions_package_id_package_version_idx`.
A session that violates any of the three constraints is still rejected (NOT VALID only skips
validating *existing* rows; new/updated rows are always checked).

### 19 Oct 2026 fix round (database-reviewer, PR #39)

[CRITICAL] `migrate.ts`'s `concurrentIndex` step ran `CREATE INDEX CONCURRENTLY IF NOT EXISTS`
unconditionally. After a failed or killed concurrent build, Postgres leaves the index behind as
INVALID, and `IF NOT EXISTS` would then skip it forever — the index exists, but is never usable
and never revalidated. Fixed: before the CREATE, `isIndexInvalid()` looks the index up by name in
`pg_class`/`pg_index`; if it exists and `indisvalid = false`, `DROP INDEX CONCURRENTLY IF EXISTS`
runs first (still autocommit, still outside any transaction), then the CREATE.

| Command | Result (trimmed) |
|---|---|
| Postgres + Redis up (`docker compose ... up -d postgres redis`) | running |
| `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --force` | `Tasks: 14 successful, 14 total` |
| db test | `Test Files 23 passed (23)` · `Tests 431 passed (431)` (+3 vs the first round) · `All files 99.89 / 99.21 / 99.66 / 100` · `migrate.ts 100 / 100 / 100 / 100` |
| `test/migrate.test.ts` (new unit cases) | `skips the drop when the index already exists and is valid`, `drops and rebuilds an INVALID leftover index (a failed or killed earlier build)`, plus the existing `runs a concurrent-index step...` case updated to also check the `pg_index` lookup call |
| `test/migrate.int.test.ts` (new int case) | `rebuilds an index left INVALID by a failed or killed earlier CREATE INDEX CONCURRENTLY`: forces `indisvalid = false` via `UPDATE pg_index` as superuser (the test DB role is superuser in the compose image), then runs `migrateDatabase()` again and asserts `indisvalid`/`indisready` are both `true` afterwards |
| `python3 .githooks/secret-scan.py --all` | no output, exit 0 |

## Changes

- `packages/db/src/migrate.ts`: a `PostMigrateStep` type and a fixed `POST_MIGRATE_STEPS` list
  (3 `validateConstraint` steps for 0009's FK and two CHECKs, 1 `concurrentIndex` step for
  `sessions_package_id_package_version_idx`), run by `runPostMigrateSteps()` after drizzle's
  `migrate()` commits inside `migrateDatabase()`. Each step is its own autocommit statement (no
  surrounding transaction): `ALTER TABLE ... VALIDATE CONSTRAINT` only when
  `pg_constraint.convalidated` isn't already `true`, and
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` (safe to repeat). Uses the pool `migrateDatabase`
  already opens (`MIGRATE_POOL_OPTIONS`, `max: 1`), so no second connection is needed and
  `CREATE INDEX CONCURRENTLY` (which Postgres refuses inside a transaction block) runs outside one.
- `packages/db/migrations/0009_session_package_pin.sql`: the FK and both CHECKs stay `ADD
  CONSTRAINT ... NOT VALID` with no `VALIDATE CONSTRAINT` in the file; the plain `CREATE INDEX` is
  removed (the index is built by the post-migrate step instead). A comment explains why.
- `packages/db/src/schema/learning.ts`: a one-line comment on the index saying it's built outside
  0009's SQL, so `db:generate` still has something to diff against and stays a no-op.
- `packages/db/test/migrate.int.test.ts`: two new cases (constraints validated + index valid;
  constraint violations still rejected).
- `packages/db/test/migrate.test.ts` (new): unit tests for `runPostMigrateSteps`'s branches that
  don't need Postgres (already-valid skip, not-yet-valid run, missing constraint row, a
  concurrent-index step, the default list's shape).
- Fix round: `packages/db/src/migrate.ts` gained `isIndexInvalid()`, checked before every
  `concurrentIndex` step; if the index already exists and is INVALID, `DROP INDEX CONCURRENTLY IF
  EXISTS` runs first. `packages/db/test/migrate.test.ts` and `packages/db/test/migrate.int.test.ts`
  gained the drop-and-rebuild cases described above.

## Deviations

- **A post-migrate step in `migrate.ts`, not a second migration file.** The board's one-line
  acceptance says "move 0009's VALIDATE CONSTRAINT statements to their own migration," but 0009's
  own fix round (task 3.16) already established that drizzle-orm 0.45's migrator runs **every**
  pending migration file in one transaction (verified in `pg-core/dialect.js`). A second file
  (e.g. `0010_validate_session_package_pin.sql`) applied by the same `migrateDatabase()` call
  would still run inside that one transaction, so it would not shorten the ACCESS EXCLUSIVE lock
  at all — the problem the task exists to fix. The task prompt I was given for this build
  describes the post-migrate-step mechanism explicitly, and it is the one that actually works with
  this migrator version; I followed it over the board's shorthand.
- **0009's `CREATE INDEX` statement was deleted from the already-committed migration file,** not
  wrapped in a new migration. 0009 is unreleased (no deployments yet, confirmed in the 3.16
  decision log and the lead's task framing), so editing it doesn't break any live database; a
  later, deployed migration would instead get a new file. The schema snapshot/journal for 0009
  were left untouched (they're drizzle-kit's record of the target schema, not executed SQL, so
  they don't need to change for this).
- **Out of scope (per the task prompt, though mentioned in the 3.16 review as a deferred
  MEDIUM):** a partial index on open sessions for the backfill query. The task I was given for
  3.16b lists three concrete asks (post-migrate step; change 0009 to not validate inline; don't
  break an existing database) and doesn't include this index. Left as a separate deferred
  finding; a follow-up task can pick it up.
- **`isConstraintValidated` treats a missing `pg_constraint` row as "nothing to validate"**
  (returns `true`, i.e. skip) rather than throwing. A constraint that doesn't exist can't be
  validated by `ALTER TABLE ... VALIDATE CONSTRAINT` either (it would itself throw "constraint
  does not exist"), so this only matters for an unusual partial/rolled-back database state; failing
  open here (skip) rather than crashing `migrateDatabase()` seemed safer for an idempotent,
  repeatable step.

## Decisions

### 19 Oct 2026 · 3.16b A post-migrate step runs lock-heavy statements as their own autocommit transactions after migrate() commits · decided by tdd-guide · risk: high
Decided: `migrateDatabase()` calls drizzle's `migrate()` to apply pending migration files (unchanged), then calls a new `runPostMigrateSteps()` against the same single-connection pool, running each of 0009's three `VALIDATE CONSTRAINT`s (skipped if already valid) and its `CREATE INDEX CONCURRENTLY IF NOT EXISTS` as separate, non-transactional statements. 0009's SQL file itself only adds the FK and two CHECKs as `NOT VALID` and no longer runs `CREATE INDEX`.
Why: drizzle-orm 0.45 runs every pending migration file in one transaction (established in the 3.16 review and decision log), so neither a `VALIDATE CONSTRAINT` nor a `CREATE INDEX CONCURRENTLY` written into any migration file — this one or a new one — ever escapes that transaction's ACCESS EXCLUSIVE lock, and `CREATE INDEX CONCURRENTLY` is refused by Postgres inside a transaction block at all. A step that runs after the migrator's transaction has committed is the only way to get the lighter `SHARE UPDATE EXCLUSIVE` lock (validate) or no blocking lock at all (concurrent index) before `sessions` grows past pilot scale.
Alternatives: a second migration file (doesn't help, see above); a separate CLI command the operator runs by hand after `db:migrate` (more steps to forget, no test coverage of the common path); switching migrators (bigger change, out of scope); accepting the lock duration permanently (what 3.16 already decided to accept for the pilot; this task removes the need to keep accepting it as `sessions` grows).
Reversible: yes — entirely inside `packages/db`; no port or contract change. The step list can be extended or retired in a later migration's own follow-up.

### 19 Oct 2026 · 3.16b 0009 is edited in place rather than fixed by a new migration file · decided by tdd-guide (per the task's framing) · risk: high
Decided: `packages/db/migrations/0009_session_package_pin.sql` had its `VALIDATE CONSTRAINT` and `CREATE INDEX` statements removed outright, rather than being left as-is with a new migration file added after it.
Why: 0009 has not been deployed anywhere yet (no pilot has run; confirmed in the 3.16 decision log), so there is no live database whose already-applied migration history this could break; editing it keeps the SQL honest about what actually runs (callers reading 0009 would otherwise see a `VALIDATE CONSTRAINT` that never executes, since the post-migrate step runs it instead).
Alternatives: leave 0009 as the 3.16 fix round wrote it (misleading: the file would claim to validate inline but drizzle's transaction means that claim was already false before this task); add a 0010 migration that's a no-op for execution but documents the move.
Reversible: yes, for as long as 0009 stays unreleased; once a real database has run it, a future change would need a new migration instead, which this task's rule (point 3 of the task description) already anticipates.

### 19 Oct 2026 · 3.16b fix round: drop and rebuild an INVALID leftover index before CREATE INDEX CONCURRENTLY IF NOT EXISTS · decided by tdd-guide (database-reviewer finding) · risk: high
Decided: the `concurrentIndex` post-migrate step now checks `pg_class`/`pg_index` for an existing index by name before running `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. If the index exists and `indisvalid = false`, it runs `DROP INDEX CONCURRENTLY IF EXISTS` first (its own autocommit statement, still outside any transaction), then the CREATE.
Why: a `CREATE INDEX CONCURRENTLY` that fails partway (a connection drop, a killed backend) leaves the index behind as INVALID rather than rolling it back; Postgres itself does not retry or revalidate it. `IF NOT EXISTS` alone would then see the index "already exists" on every future `migrateDatabase()` call and skip it forever, leaving the package-pin index permanently unusable and the 0009 fix effectively undone for queries that need it.
Alternatives: always `DROP INDEX CONCURRENTLY IF EXISTS` before every CREATE, unconditionally (works, but needlessly rebuilds a healthy index on every migrate run on a database that may eventually be large); have an operator notice and fix it by hand (no test coverage of the common path, easy to miss); drop `IF NOT EXISTS` and let the CREATE fail loudly on a second run (breaks the "re-running is a no-op" contract this task also had to preserve).
Reversible: yes — entirely inside `packages/db`; no port or contract change.
