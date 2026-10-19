# 3.16 handoff — Sessions follow the package

**Status:** DONE
**Branch:** `m3/3.16-sessions-follow-package`
**Worktree:** `.claude/worktrees/agent-afa8a51db1bea816a`

Acceptance: "A student whose bigger package lapses keeps no access to its earlier module text
through history, sources or summary; tests cover downgrade and version change." No contracts
change. No model or payment calls in any test.

## Acceptance evidence

Postgres: `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`.
Nothing skipped (no `SKIPPED` line in the db run).

| Command | Result (trimmed) |
|---|---|
| `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --filter=@edmate/harness...` | `Tasks: 18 successful, 18 total` |
| db test (Postgres, `--force`) | `Test Files 22 passed (22)` · `Tests 419 passed (419)` · `All files 99.89 / 99.19 / 99.66 / 100` · `sessions.ts 100 / 100 / 100 / 100` · `ports.ts 100 / 100 / 100 / 100` |
| `test/session-package.int.test.ts` (new) | `8 tests` pass: control, **downgrade**, **version change**, stale turn never wipes a newer summary, concurrent end ends once, no-profile and out-of-scope calls, `sessions.create` package validation, teacher preview restarts on a new version |
| `test/session-package-migration.int.test.ts` (new) | `6 tests` pass; NOTICE `sessions package pin (3.16): 2 backfilled, 4 ended, 1 already ended` |
| `test/repositories.int.test.ts` | `57 tests` pass; new grid case `sessions.endOnPackageChange` (cross-tenant writes are `not_found`, nothing written) |
| `test/turn-config.int.test.ts`, `test/session-state.int.test.ts`, `test/schema.test.ts` | pass (regression) |
| harness test | `Test Files 34 passed (34)` · `Tests 2116 passed (2116)` · `memoryAccess.ts 100 / 98.78 / 100 / 100` |
| red run (harness, fixture reverted) | `Tests 5 failed | 77 passed (82)`: the 5 new pin cases; green after the fixture change |
| red run (db) | `session-package.int.test.ts` failed in setup before the repository change (seed and repo had no pin) |
| `python3 .githooks/secret-scan.py --all` | exit 0 |

### 19 Oct 2026 fix round (build-error-resolver)

| Command | Result (trimmed) |
|---|---|
| `corepack pnpm turbo run typecheck lint --filter=@edmate/db... --filter=@edmate/harness...` | `Tasks: 13 successful, 13 total` |
| `corepack pnpm turbo run test --filter=@edmate/db... --filter=@edmate/harness... --force` (Postgres up, nothing skipped) | db: `Test Files 22 passed (22)` · `Tests 421 passed (421)`; harness: `Test Files 34 passed (34)` · `Tests 2118 passed (2118)` |
| `python3 .githooks/secret-scan.py --all` | no output, exit 0 |

New/changed tests in this round: `messages.append also refuses an ended session (like saveHelpState)` (`session-state.int.test.ts`); `an open session with no package pin is a bad fixture: load throws` and `a session with only one of packageId/packageVersion is a bad fixture: load throws` (`memoryAccess.test.ts`, plus the existing "no package pin" case updated to an ended session); `turnConfigStoreFor(...).load ends the session exactly once under concurrent calls` (`session-package.int.test.ts`).

Migration path used in tests: all three. `ses_ok` (active, own agent) and `ses_paused` (paused,
own agent) were **backfilled**; `ses_other` (live subscription is another agent's package),
`ses_lapsed` (ended subscription), `ses_none` (no subscription) and `ses_preview` (teacher
preview, no subscription) were **ended** and their pairs' summaries cleared; `ses_old` was
**already ended** and left alone (no pin, same `ended_at`, its pair's summary kept). Every session,
message and profile row is still there afterwards.

## Changes

- `packages/db/src/schema/learning.ts`: `sessions` gains `package_id` and `package_version`
  (nullable), a composite foreign key to `package_versions (package_id, version)`, an index on
  the pair, and two checks: the pin is both-or-neither, and every open session has one.
- `packages/db/migrations/0009_session_package_pin.sql` (+ snapshot, journal; generated, then the
  backfill block added by hand between the new columns and the constraints): for each open
  session, backfill the pin from the student's live (not ended) subscription with that teacher
  when its package is the session's agent's; otherwise clear that pair's `last_summary` and end
  the session. Already-ended sessions get no pin. Counts reported with `RAISE NOTICE`.
- `packages/db/src/repositories/sessions.ts`: `SessionRow` gains `packageId`/`packageVersion`;
  `create` takes and validates them (the package must be the given agent's and the scope
  teacher's, at an existing version, else `not_found`); new
  `endOnPackageChange(scope, sessionId) → { ended }`: in one transaction ends the scope's own open
  session and clears the pair's summary **only when this call ended it**; an already-ended own
  session is `{ ended: false }` with no write; another pair's or a missing session is
  `not_found`. A comment says why `help_state` is kept.
- `packages/db/src/repositories/ports.ts`: `turnConfigStoreFor.load`, after the ownership/open/
  agent check, compares the session's pin with the entitlement's package and version; on any
  difference it calls `endOnPackageChange` with the scope taken from the entitlement and returns
  `null` (so `entitle` gives `no_access`).
- `packages/harness/src/testing/memoryAccess.ts`: `MemorySession` gains the pin; every
  `twoTeacherWorld()` session is pinned to what its entitlement resolves to; the in-memory
  `load` mirrors the mismatch (ends the session, returns `null`).
- Tests: new `session-package.int.test.ts`, `session-package-migration.int.test.ts`; seeds pin
  their sessions; isolation grid case for the new method plus two package mismatches for
  `sessions.create`; `turn-config.int.test.ts` swaps its "missing package version" check for a
  corrupt-row check (a version mismatch now ends the session); `schema.test.ts` allows exactly
  0009's reviewed `UPDATE`s and checks which columns they set; harness `entitle.test.ts`,
  `memoryAccess.test.ts`, and the property test's invariant (session pinned to the returned
  package version).
- `packages/harness/README.md`: one sentence on the pin under entitle.

## Deviations

- **Pin columns are nullable** (plan said `NOT NULL`): the security plan review says already-ended
  sessions get no pin, so the columns can't be `NOT NULL`. The CHECK `sessions_open_has_package`
  gives the same guarantee for every session that can still be used.
- **Foreign key is to `package_versions (package_id, version)`** rather than `packages.id`: it
  also proves the version exists.
- **The migration updates data** (`UPDATE sessions`, `UPDATE learner_profiles`). The merge gate's
  destructive-SQL check flags it, so database-reviewer is required. `schema.test.ts` allows
  exactly these three statements in 0009 and nothing else.
- **`packages/harness/src/access/property.test.ts`** was touched (the plan's optional invariant
  strengthening), although the plan also listed `src/access/**` as out of bounds. Test-only; the
  path is in security-reviewer's group, which is required anyway.

## 3.16c

Migration hardening follow-ups from the 3.16b database review (`docs/tasks/3.16b/review.md`):
the deferred MEDIUM findings on `packages/db/src/migrate.ts` and migration 0009. No contracts
change. No model or payment calls in any test. See also `docs/tasks/3.16c/handoff.md` (same
content, for the record).

### Acceptance evidence

Postgres and Redis: `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml
-f apps/worker/test/compose.port.yaml up -d postgres redis`. Nothing skipped (no `SKIPPED` line).

| Command | Result (trimmed) |
|---|---|
| `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --force` | `Tasks: 18 successful, 18 total` |
| db test (Postgres, `--force`) | `Test Files 23 passed (23)` · `Tests 436 passed (436)` · `migrate.ts 100 / 100 / 100 / 100` · `All files 99.9 / 99.22 / 99.67 / 100` |
| `test/migrate.test.ts` (unit) | new `acquireMigrateLock` describe block (returns immediately, polls to success, times out and throws); new `isIndexInvalid` schema-qualification case; the default-step-list case extended to the new open-session index |
| `test/migrate.int.test.ts` (integration) | new `two concurrent migrateDatabase() calls against a fresh database both resolve, and the second finds the index valid and skips the drop` (starts both with `Promise.all` against a throwaway database, then checks the index is valid/ready and all three 0009 constraints validated); the existing "validates the three 0009 constraints and builds the ... index" case extended to also build and check the new partial index's predicate |
| red run (unit) | `isIndexInvalid` schema-qualification case failed against the old bare-`relname` query before the fix |
| red run (integration) | the concurrent-run case failed with `duplicate key value violates unique constraint "pg_namespace_nspname_index"` (both calls racing `CREATE SCHEMA IF NOT EXISTS "drizzle"`) before the lock was added; after a first (blocking `pg_advisory_lock`) attempt it instead hung forever — see Decisions |
| `db:generate` | after declaring the new partial index in `src/schema/learning.ts`, produced `migrations/0010_easy_maximus.sql` (not a no-op, unlike 0009's combined column+index migration); its SQL was then trimmed to a comment (the index is built by the post-migrate step, same as 0009's), after which `db:generate` reports "No schema changes, nothing to migrate" again |
| `python3 .githooks/secret-scan.py --all` | exit 0 |

### Changes

- `packages/db/src/migrate.ts`: `migrateDatabase()` now opens a dedicated `pg.Client` (not the
  migrator's own `max: 1` pool — sharing it would deadlock) and polls a new
  `acquireMigrateLock()`/`pg_try_advisory_lock(MIGRATE_LOCK_KEY)` before running drizzle's
  `migrate()` and `runPostMigrateSteps()`, releasing with `pg_advisory_unlock` in `finally`. A
  fixed, exported `MIGRATE_LOCK_KEY` bigint documents itself as not reused elsewhere.
  `isIndexInvalid()`'s lookup is now `to_regclass('public.' || $1)` instead of a bare
  `pg_class.relname` match. `POST_MIGRATE_STEPS` gains a fourth entry,
  `sessions_open_teacher_id_student_id_idx` (`(teacher_id, student_id) WHERE ended_at IS NULL`),
  built the same `concurrentIndex` way as the package-pin index.
- `packages/db/src/schema/learning.ts`: `sessions` gains the partial index, declared with
  drizzle's `.where()` so a future `db:generate` stays a no-op; the comment explains it is built
  by the post-migrate step, not by migration SQL.
- `packages/db/migrations/0010_easy_maximus.sql` (+ snapshot, journal; generated by `db:generate`,
  then hand-trimmed to a comment, following 0009's pattern): declaring this index was not a
  no-op for `db:generate` the way 0009's combined column-and-index migration was (there, the new
  index and the new columns were diffed together into one not-yet-existing file; here the index
  is the only change, so drizzle-kit necessarily emits a new migration file to carry the schema
  diff forward). The file's SQL was trimmed to a comment so the index is still built only by the
  post-migrate step; the generated snapshot and journal entries were kept as-is, which is what
  keeps a later `db:generate` a no-op.
- `packages/db/test/migrate.test.ts`: new `acquireMigrateLock` cases; a new `isIndexInvalid`
  schema-qualification case; the default-step-list case extended.
- `packages/db/test/migrate.int.test.ts`: new concurrent-`migrateDatabase()` case; the existing
  "validates ... outside the migration transaction" case extended to the new index and its
  partial predicate.

### Deviations

- None beyond the `db:generate` non-no-op noted above, which the task anticipated and asked to be
  reported.

## 3.16d

Migration follow-ups from the 3.16c database review (`docs/tasks/3.16/review.md`, the "3.16c"
section): `isIndexInvalid`'s schema qualification, a bounded post-migrate step timeout, and
releasing the advisory lock only when it was actually acquired. No contracts change. No model or
payment calls in any test. See also `docs/tasks/3.16d/handoff.md` (same content, for the record).

### Acceptance evidence

Postgres and Redis: `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml
-f apps/worker/test/compose.port.yaml up -d postgres redis`. Nothing skipped (no `SKIPPED` line).

| Command | Result (trimmed) |
|---|---|
| `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --force` | `Tasks: 14 successful, 14 total` |
| db test (Postgres, `--force`) | `Test Files 23 passed (23)` · `Tests 449 passed (449)` · `migrate.ts 100 / 100 / 100 / 100` · `All files 99.9 / 99.25 / 99.67 / 100` |
| `test/migrate.test.ts` (unit) | new `isIndexInvalid` case asserting `to_regclass(format('%I.%I', 'public', $1::text))`, not string concatenation, plus a mixed-case-name param case; new `withMigrateLock` describe block (unlocks on success, unlocks when `fn` throws, does **not** call `pg_advisory_unlock` when the acquire itself timed out or the connection was already dead); new `stepTimeoutMs` describe block (default 15 min, `options` wins over env, env fallback, empty env treated as unset, throws on non-numeric/non-positive env) |
| `test/migrate.int.test.ts` (integration) | new `runs post-migrate steps against a mixed-case index name, quoted correctly by format(%I.%I)` (a fresh throwaway db, a `"T"`/`"MixedCaseIdx"` table and index, run twice to also exercise the idempotent re-run path); new `a bounded step timeout fails the step when a stray open transaction blocks it, and a re-run after it ends rebuilds the index valid` (marks the package-pin index INVALID, holds an actively-running `pg_sleep(2)` in a second connection, calls `migrateDatabase(url, { stepTimeoutMs: 200 })`, asserts it rejects with `canceling statement due to statement timeout`, then calls `migrateDatabase(url)` again and asserts the index is valid/ready) |
| red run (unit) | the `isIndexInvalid` SQL-text and mixed-case-param cases failed against the old `'public.' \|\| $1` query; the `withMigrateLock` "does not call pg_advisory_unlock" cases failed against the old always-unlock code before the `locked` flag was added |
| red run (integration) | first attempt at the timeout test used an idle-in-transaction blocker (`BEGIN; select 1;`) with no delay before the post-migrate call — it did **not** reproduce a block (see Decisions): `CREATE INDEX CONCURRENTLY` completed in a few ms despite `pg_stat_activity` showing the blocker as `idle in transaction`. Switched to an actively-running `pg_sleep(2)` plus a short delay before the timed call, which reliably reproduces the Postgres-documented wait |
| `python3 .githooks/secret-scan.py --all` | exit 0 |

### Changes

- `packages/db/src/migrate.ts`: `isIndexInvalid()`'s lookup is now
  `to_regclass(format('%I.%I', 'public', $1::text))` (the `::text` cast is needed because
  `format`'s variadic `"any"` signature otherwise leaves Postgres unable to infer `$1`'s type),
  so a mixed-case or otherwise-needs-quoting index name resolves correctly instead of matching
  nothing. New exported `withMigrateLock(lockClient, key, fn, maxWaitMs?)` factors the
  acquire-then-run-then-conditionally-unlock pattern out of `migrateDatabase()`, tracking a
  `locked` flag so `pg_advisory_unlock` is only called after a successful acquire — an acquire
  failure (poll timeout, or a dead connection) now propagates its own error unmasked.
  `migrateDatabase()` gains an `options: MigrateOptions` parameter
  (`{ stepTimeoutMs? }`); new exported `stepTimeoutMs()` resolves it from `options`, then env
  `EDMATE_MIGRATE_STEP_TIMEOUT_MS`, then a new exported `DEFAULT_STEP_TIMEOUT_MS` (15 minutes),
  throwing on a set-but-invalid env value. Before `runPostMigrateSteps` runs,
  `migrateDatabase()` sets this timeout on the post-migrate connection with
  `select set_config('statement_timeout', $1, false)` (session-level, parameterized — `SET` itself
  doesn't take a bind parameter); drizzle's own `migrate()` keeps the pool's original unbounded
  timeout. Added code comments on both `isIndexInvalid` and `runPostMigrateSteps` about a stray
  idle-in-transaction session elsewhere being able to hang `CREATE`/`DROP INDEX CONCURRENTLY`
  indefinitely, and on how the bounded timeout and the existing invalid-index repair interact.
- `packages/db/test/migrate.test.ts`: updated the `isIndexInvalid` SQL-shape case for the new
  query text; new mixed-case-name case; new `withMigrateLock` and `stepTimeoutMs` describe
  blocks.
- `packages/db/test/migrate.int.test.ts`: new mixed-case index name case; new bounded-timeout
  case with a real blocking connection and a re-run that rebuilds the index.

### Deviations

- None.

## Decisions

### 18 Oct 2026 · 3.16 Any package or version change ends the session, and the summary is cleared only by the call that ended it · decided by team lead (plan decision 1 and security plan review) · risk: high
Decided: `turnConfigStoreFor.load` ends the session (and the db clears the pair's `last_summary`) whenever the entitlement's package or version differs from the session's pin, by any source; the clear happens in the same transaction and only if that UPDATE moved the session from open to ended.
Why: earlier history, sources and summary of a lapsed package must never reach the model, and a retried or stale turn must never wipe a newer session's summary.
Alternatives: end only on a downgrade (compare module sets); clear the summary on every call; two separate repository methods.
Reversible: yes, inside packages/db; no port changes.

### 18 Oct 2026 · 3.16 Migration 0009 backfills each open session's pin from its live entitlement, or ends it and clears the pair's summary · decided by team lead (lead answer and security plan review) · risk: high
Decided: an open session whose student has a live (not ended, paused included) subscription with that teacher to a package of the session's agent gets that package version; any other open session is ended and its pair's `last_summary` is set to NULL; already-ended sessions stay as they are with no pin. No row is deleted; counts are reported as a NOTICE. Tests used all three paths.
Why: the lead's rule that the migration never loses rows, without leaving an open session that could carry content from an unknown package.
Alternatives: 0007-style "stop if rows exist" guard; backfill everything with a guessed pin; leave unpinned open sessions open.
Reversible: the pins and `ended_at` values can be cleared or changed later; a cleared `last_summary` can't be restored (it's the intended effect, like `endOnPackageChange`).

### 18 Oct 2026 · 3.16 Pin columns are nullable, with checks that every open session has a full pin to a real package version · decided by builder (tdd-guide) · risk: medium
Decided: `package_id`/`package_version` are nullable, with a composite foreign key to `package_versions (package_id, version)`, a both-or-neither check and an "open sessions have a pin" check.
Why: already-ended sessions get no pin (security plan review), so `NOT NULL` is impossible; the checks keep the guarantee for usable sessions.
Alternatives: `NOT NULL` with a fake pin on ended sessions; a foreign key to `packages.id` only.
Reversible: yes, by a later migration.

### 18 Oct 2026 · 3.16 `sessions.create` checks the package against the agent and teacher · decided by team lead (plan decision 3) · risk: low
Decided: the INSERT … SELECT joins the package and version and requires them to be the given agent's and the scope teacher's; anything else is `not_found` and nothing is written.
Why: the same defense in depth as the existing agent-version check.
Alternatives: trust the caller's pin.
Reversible: yes.

### 18 Oct 2026 · 3.16 `endOnPackageChange` returns `{ ended }` and treats an own, already-ended session as a no-op · decided by builder (tdd-guide) · risk: low
Decided: the method returns `{ ended: true }` when it ended the session, `{ ended: false }` for the scope's own already-ended session, and `not_found` for anything outside the scope.
Why: retries are safe, a cross-tenant call still fails closed for the isolation grid, and tests can see which call did the work.
Alternatives: return void; throw on an already-ended session.
Reversible: yes.

### 19 Oct 2026 · 3.16 0009's FK and both CHECKs are added `NOT VALID` then validated in separate statements; the plain `CREATE INDEX` stays as it is · decided by build-error-resolver (fix round) · risk: low
Decided: `sessions_package_version_fk`, `sessions_package_pin_complete` and `sessions_open_has_package` are each added `NOT VALID` and validated by a following `ALTER TABLE ... VALIDATE CONSTRAINT`, so the ACCESS EXCLUSIVE lock needed to add them is held only briefly and the table-scan runs under `VALIDATE CONSTRAINT`'s lighter SHARE UPDATE EXCLUSIVE lock instead. The index stays a plain (non-`CONCURRENTLY`) `CREATE INDEX`: drizzle runs every migration file in one transaction, and `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, so splitting it out would need a second migration file for no real benefit on a table this small.
Why: minimise how long `sessions` is unavailable for reads and writes while 0009 runs, without changing the schema or the backfill.
Alternatives: leave the FK and CHECKs as plain `ADD CONSTRAINT` (longer lock); move the index to its own non-transactional migration.
Reversible: yes; a later migration can re-order or re-validate.

### 19 Oct 2026 · 3.16 Migration lock duration accepted for the pilot · decided by team lead · risk: medium
Decided: 0009's constraints are validated inside drizzle's migration transaction. drizzle 0.45 runs every pending migration in one transaction, so a split file wouldn't shorten the ACCESS EXCLUSIVE lock. At pilot scale (about 500 students) the `sessions` scan takes milliseconds, so the finding is re-rated from HIGH to MEDIUM, and 3.16b adds a VALIDATE path outside the migrator before the table grows.
Why: the reviewer's HIGH assumed a large production table, which doesn't exist; a correct fix needs migration tooling, not a file split.
Alternatives: a second migrate() run; an ops script with autocommit; switching migrators.
Reversible: yes.

### 19 Oct 2026 · 3.16c The migration lock is polled with `pg_try_advisory_lock`, not held by blocking on `pg_advisory_lock` · decided by tdd-guide (red run) · risk: medium
Decided: `migrateDatabase()` acquires `MIGRATE_LOCK_KEY` by polling `pg_try_advisory_lock` on its own dedicated connection every 50 ms (10-minute default give-up), instead of a single blocking `pg_advisory_lock` call.
Why: the int test (two concurrent `migrateDatabase()` calls against a fresh database) hung forever with a blocking `pg_advisory_lock`: that call itself holds an open snapshot on its connection for the whole wait, and `CREATE INDEX CONCURRENTLY` (the post-migrate index steps) must wait out every transaction with an older snapshot, table or not — so the lock holder's own index build waited on the second caller's still-blocked lock request, which only clears once the first caller releases the lock after finishing the build: a self-deadlock, reproduced and confirmed with debug logging before the fix.
Alternatives: a blocking lock on a separate, short-statement-timeout connection (still holds a snapshot for the timeout's duration); skipping `CREATE INDEX CONCURRENTLY` while any other session is active (defeats the point); moving the lock inside the same pool as the migration (ruled out separately — pool `max: 1` would deadlock against itself).
Reversible: yes; an internal implementation detail of `migrateDatabase()`.

### 19 Oct 2026 · 3.16c A plain `CREATE INDEX CONCURRENTLY` lookup is schema-qualified with `to_regclass('public.' || $1)` · decided by tdd-guide (3.16b review deferral) · risk: low
Decided: `isIndexInvalid()`'s lookup now resolves the index name with `to_regclass('public.' || $1)` instead of a bare `pg_class.relname = $1` match.
Why: a bare name match could find a same-named index in another schema (a stray test schema, `drizzle`, or a future multi-schema layout) and wrongly skip or drop it; `to_regclass` with an explicit schema prefix only ever resolves the one in `public`.
Alternatives: join `pg_namespace` and filter `nspname = 'public'` (same result, more verbose); leave it unqualified (the review's finding).
Reversible: yes.

### 19 Oct 2026 · 3.16c The open-session partial index is its own migration (0010), not folded into 0009 · decided by tdd-guide (3.16b review deferral) · risk: low
Decided: `sessions_open_teacher_id_student_id_idx` is declared in `src/schema/learning.ts` the same schema-only way as 0009's package-pin index, but ships as its own generated-then-trimmed migration file (`0010_easy_maximus.sql`), because `db:generate` is not a no-op for a schema change with no matching not-yet-released migration to diff it into (0009's index was a no-op only because it was invented and declared together with 0009's new columns, before 0009 existed). The generated file's SQL was trimmed to a comment, same as 0009's hand-edit, so the index is still built only by the post-migrate step; the generated snapshot and journal entries were kept, which is what keeps `db:generate` a no-op again afterwards.
Why: the task asked for whichever option keeps the journal consistent; trimming the generated file's SQL while keeping its snapshot/journal entries does that without inventing a parallel, undeclared index that `db:generate` would try to add on some future run.
Alternatives: skip declaring the index in drizzle at all (keeps `db:generate` a no-op trivially, but then nothing stops a future `db:generate` from "discovering" it missing and adding a real, blocking `CREATE INDEX`); hand-write a fake empty migration/snapshot pair instead of using drizzle-kit's own output (more error-prone, diverges from 0009's precedent).
Reversible: yes; a later migration can rename or rebuild it.

### 19 Oct 2026 · 3.16d The advisory-lock acquire/release pattern is factored into an exported `withMigrateLock` helper · decided by tdd-guide · risk: low
Decided: `withMigrateLock(lockClient, key, fn, maxWaitMs?)` wraps `acquireMigrateLock` + `fn()` + a conditional `pg_advisory_unlock`, tracked by a `locked` flag set only after `acquireMigrateLock` returns; `migrateDatabase()` now calls it instead of inlining the same `try`/`finally`.
Why: the review's finding (unlock only when the lock was actually taken) needs a unit test, and `migrateDatabase()` itself isn't unit-testable (it always opens a real `pg.Client`/pool against a URL); factoring the lock logic into a small function that takes an injectable client makes the "no unlock after a failed acquire" behaviour directly testable without touching `migrateDatabase()`'s signature or needing a real database.
Alternatives: add a client-factory parameter to `migrateDatabase()` for test injection (keeps one function, but widens its public signature for a test-only need); test the behaviour only at the integration level (real Postgres, no quick unit coverage of the "connection already dead" branch).
Reversible: yes; an internal implementation detail of `migrateDatabase()`.

### 19 Oct 2026 · 3.16d The post-migrate step timeout is set on the connection with `set_config`, not a plain `SET` · decided by tdd-guide · risk: low
Decided: `migrateDatabase()` runs `select set_config('statement_timeout', $1, false)` (parameterized, session-level — the third argument `false` means "not transaction-local") on the post-migrate connection before `runPostMigrateSteps`, instead of string-building a `SET statement_timeout = <value>` statement.
Why: Postgres's `SET` doesn't accept a bind parameter, so a literal value would have to be built with string interpolation even though `stepTimeoutMs()` already validates it is a safe positive integer; `set_config` takes the value as a normal parameterized argument, which is both simpler and avoids ever building SQL by concatenating a number into a string, as a matter of habit.
Alternatives: `SET statement_timeout = ${n}` (works given the validation, but trains the eventual next reader/editor that string-built SQL is fine here); a second, dedicated pool just for the post-migrate steps with `statement_timeout` baked into its `pg.PoolConfig` (more connections and a second `close()` to manage, for no behavioural difference since the migrator pool is already `max: 1`).
Reversible: yes.

### 19 Oct 2026 · 3.16d Reproducing the blocked-`CREATE INDEX CONCURRENTLY` test needed an actively running blocker statement, not just an idle-in-transaction one · decided by tdd-guide (int test red run) · risk: low
Decided: the integration test's blocking connection runs `BEGIN; select pg_sleep(2)` (not awaited; rolled back afterwards) and the test waits ~300 ms before calling the timed `migrateDatabase()`, rather than `BEGIN; select 1` with no delay.
Why: the first attempt (`BEGIN; select 1`, no delay) did not reproduce a wait: `CREATE INDEX CONCURRENTLY` completed in a few milliseconds even though `pg_stat_activity` showed the blocker as `idle in transaction` at that instant, confirmed with debug logging before the fix; a manual `psql` reproduction with the same table and a `pg_sleep`-based blocker reliably blocked and timed out as the Postgres documentation describes. The exact reason for the gap wasn't tracked down further (not needed for the test itself), but a blocker with an in-flight statement and a short lead time reproduces the behaviour deterministically.
Alternatives: keep polling `pg_stat_activity`/`pg_locks` until some specific lock or wait-event condition is observed before issuing the timed call (more precise, meaningfully more complex for a test); accept flakiness with the idle-in-transaction form.
Reversible: yes; an internal detail of the test, not of `migrate.ts` itself.

