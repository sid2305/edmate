# 3.16d handoff — Migration follow-ups

**Status:** DONE
**Branch:** `m7/3.16d-migration-followups`
**Worktree:** `.claude/worktrees/agent-a188896f3d82a1dda`

Migration follow-ups from the 3.16c database review (`docs/tasks/3.16/review.md`, the "3.16c"
section): `isIndexInvalid`'s schema qualification, a bounded post-migrate step timeout, and
releasing the advisory lock only when it was actually acquired. No contracts change. No model or
payment calls in any test. The merge gate maps this lettered sub-task to
`docs/tasks/3.16/handoff.md`'s `## 3.16d` section and `## Decisions`; this file carries the same
content for the record.

## Acceptance evidence

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

## Changes

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

## Deviations

- None.

## Decisions

See `docs/tasks/3.16/handoff.md`'s `## Decisions` section (the three `3.16d` entries dated
19 Oct 2026): `withMigrateLock` as a unit-testable helper, `set_config` over a plain `SET` for the
step timeout, and the blocker-reproduction note for the integration test.
