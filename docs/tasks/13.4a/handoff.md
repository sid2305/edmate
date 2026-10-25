# 13.4a handoff

Status: DONE

## Summary
Migration 0032's three retention indexes (`chunks_transcript_created_at_idx`,
`sessions_created_at_idx`, `turn_traces_created_at_idx`) moved from a plain `CREATE INDEX` to the
existing schema-only + post-migrate pattern (0009, 0010, 0028), so each build no longer holds its
table's lock for the whole migration transaction.

- `packages/db/migrations/0032_retention_indexes.sql`: rewritten to a comment-only file (like
  `0010_easy_maximus.sql`), explaining the deferral and that the post-migrate step builds the
  indexes. File name and `_journal.json` entry unchanged; `db:generate` confirmed a no-op (the
  schema still declares all three indexes).
- `packages/db/src/migrate.ts`: appended three `concurrentIndex` steps to `POST_MIGRATE_STEPS`
  (after the existing entries, never reordered), with SQL matching the old 0032 exactly (same
  columns, same partial predicate text) plus `CONCURRENTLY IF NOT EXISTS`. Updated the doc comment
  above the list to mention migration 0032 (task 13.4a).
- `packages/db/src/repositories/README.md`: added a short paragraph after the existing
  schema-only-index paragraph (~line 351), noting the three retentionRepo cutoff-scan indexes
  follow the same pattern.
- `packages/db/test/migrate.int.test.ts`: added a DB-independent unit test (`POST_MIGRATE_STEPS
  (task 13.4a)`) asserting a `concurrentIndex` step exists for each of the three names, and a new
  integration test (`builds the three 13.4 retention indexes outside the migration transaction`)
  asserting all three exist with `indisvalid`/`indisready` true after `migrateDatabase`, plus the
  partial predicate on `chunks_transcript_created_at_idx`.
- `packages/db/test/migrate.test.ts`: the existing exact-list assertion on
  `POST_MIGRATE_STEPS.filter(... 'concurrentIndex')` needed updating to include the three new
  entries (not named in the plan's file list, but it broke without this change — it's the unit
  test that already pins the exact `concurrentIndex` list).

Drizzle finding (plan step 2): read
`node_modules/drizzle-orm/pg-core/dialect.js`'s `migrate()` — it reads only the single most
recently applied migration row (`order by created_at desc limit 1`) and compares each pending
migration's `folderMillis` (from the journal's `when`) against that row's `created_at`; it never
re-reads or re-checks the `hash` column of an already-applied migration. So rewriting 0032's SQL
content is safe: no re-apply, no hash-mismatch error, as confirmed by the "re-running is a no-op"
and full apply/re-apply tests passing.

## Decisions
None beyond the drizzle finding above (plan already told us what to do if it disagreed; it
didn't, so no BLOCKED and no new decision to log).

### 25 Oct 2026 · 13.4a merge · decided by lead · risk: high
- Decided: merge 13.4a. The diff touches packages/db/src/repositories/README.md (a risky path group), so security-reviewer ran alongside database-reviewer, code-reviewer and typescript-reviewer; all four approved with no CRITICAL or HIGH. Rewriting the committed migration 0032 to comment-only is accepted: drizzle-orm 0.45.4 never re-checks the hash of an applied migration (builder finding, independently confirmed by typescript-reviewer), the post-migrate steps use IF NOT EXISTS, and no production database exists yet.
- Why: the retention indexes now build CONCURRENTLY outside drizzle's migration transaction, as the 13.4 database review asked, before sessions, turn_traces or chunks grow large.

### 25 Oct 2026 · 13.4a wontfix LOW · decided by lead · risk: low
- Decided: wontfix the typescript-reviewer LOW on packages/db/test/migrate.int.test.ts (the INVALID-index rebuild test still forces INVALID on sessions_package_id_package_version_idx rather than one of the three new indexes).
- Why: the rebuild path in runPostMigrateSteps is generic over every concurrentIndex step, so the existing test already covers the three new ones; a duplicate test adds runtime without new coverage.

### 25 Oct 2026 · 13.4a budget · decided by lead · risk: low
- Decided: accept 69 harness tool calls against a planned 40 (the builder reported 46).
- Why: the builder read drizzle-orm's migrator source to clear the hash question before editing a committed migration, and updated an exact-list unit test the plan didn't name; the work stayed in scope.

## Gate
- `export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
  → 26/26 tasks successful (typecheck, lint, test across @edmate/db and its dependents).
- `corepack pnpm --filter @edmate/db run db:generate` → `No schema changes, nothing to migrate`
  (confirmed no snapshot/journal diff; `git status --porcelain` showed no changes under
  `packages/db/migrations`).
- `corepack pnpm exec prettier --check` on the changed files → `.ts`/`.md` files clean after
  `--write` (two pre-existing lines in `migrate.ts` were reflowed to the repo's prettier config,
  unrelated to this change's content); the `.sql` migration file has no prettier parser configured
  (same as every other `*.sql` migration in this repo — not a failure).
- `python3 .githooks/secret-scan.py --all` → clean, no output.

## Budget
Tool calls used: 69 (harness count; the builder reported 46)
