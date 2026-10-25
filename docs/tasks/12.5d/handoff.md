# Handoff: 12.5d — safety-alert and class-question indexes (folds 11.2c)

**Status:** DONE

## What changed
- `packages/db/src/schema/operations.ts`:
  - `safety_alerts`: replaced `safety_alerts_open_created_at_id_idx` (created_at, id) with
    `safety_alerts_open_created_at_created_id_idx`, an expression index on
    `((acknowledged_at is not null), (escalated_at is null), created_at, id)` WHERE
    `acknowledged_at is null`, matching `listForStaff`'s open-list `ORDER BY` exactly. The
    repository (`packages/db/src/repositories/safety-alerts.ts`) was not touched.
  - Added `safety_alerts_acknowledged_by_idx` on `acknowledged_by`, partial WHERE
    `acknowledged_by is not null` (12.5a LOW).
  - `class_questions`: replaced `class_questions_live_class_id_idx` (live_class_id) with
    `class_questions_live_class_id_created_at_id_idx` (live_class_id, created_at, id), matching
    the teacher queue scan's `ORDER BY` in `class-questions.ts` (11.2c). The repository was not
    touched.
- `packages/db/migrations/0030_alert_queue_indexes.sql` + `packages/db/migrations/meta/*`:
  generated with `pnpm db:generate` (drizzle-kit), not hand-edited. Drops the two old indexes,
  creates the three new ones; no data statement.
- `packages/db/test/alert-queue-indexes.int.test.ts` (new): seeds a handful of open safety alerts
  and class questions, asserts all three new indexes exist in `pg_indexes` with the expected key
  and partial predicate, asserts the two old index names are gone, and an `EXPLAIN` test (inside a
  rolled-back transaction, `SET LOCAL enable_seqscan = off`) that the open-alert list query plan
  uses `safety_alerts_open_created_at_created_id_idx` with no `Sort` node.
- `packages/db/test/schema.test.ts`: updated the existing safety_alerts index assertion to the new
  index name/columns and the new `acknowledged_by` index; added a `REVIEWED_INDEX_DROPS` allow-list
  (mirrors the existing `REVIEWED_UPDATES` pattern) so the "migrations are create-only" destructive
  check doesn't flag the two reviewed `DROP INDEX` statements, plus a test asserting only those two
  named indexes are dropped, only in `0030_alert_queue_indexes.sql`.

## Decisions

### 25 Oct 2026 · 12.5d old safety_alerts open-list index dropped · decided by builder · risk: low
- Decided: drop `safety_alerts_open_created_at_id_idx` in the same migration that adds its
  replacement, rather than keeping both.
- Why: grepped `packages/db/src` for any other query filtering/ordering on the open-alert set by
  created_at/id alone; only `listForStaff` does, and the new expression index serves that same
  partial scan (plus the full ORDER BY), so the old index has no remaining user.

### 25 Oct 2026 · 12.5d DROP INDEX allowed via a reviewed allow-list in schema.test.ts · decided by builder · risk: low
- Decided: added a `REVIEWED_INDEX_DROPS` map (and a matching assertion test) to
  `packages/db/test/schema.test.ts`, modelled on the file's existing `REVIEWED_UPDATES` pattern,
  naming the two index names `0030_alert_queue_indexes.sql` may drop.
- Why: the file's "migrations are create-only" test treats any `DROP INDEX` as destructive SQL
  (same regex as the merge gate's `DESTRUCTIVE_SQL`); an index drop touches no row data, and the
  file already had a precedent (reviewed `UPDATE SET` statements) for naming an exception per
  migration file rather than loosening the regex itself. Not in the plan's `Files` list, but the
  plan's own existing-index/migration-test instruction covers it; this is the file that already
  asserted on the old index name, so it had to change either way.

## Evidence
`TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db`:
```
 Tasks:    8 successful, 8 total
Cached:    5 cached, 8 total
  Time:    2m25.186s
```
int tests ran (not skipped): `test/alert-queue-indexes.int.test.ts (4 tests)`, `test/safety-alerts.int.test.ts (14 tests)`, `test/class-questions.int.test.ts (10 tests)` all passed on a real Postgres connection
(`describe.skipIf(!up)` resolved `up = true`); `test/schema.test.ts (50 tests)` passed, including
the new `REVIEWED_INDEX_DROPS` assertion.

`python3 .githooks/secret-scan.py --all` → no output, exit clean.

## Budget
Tool calls used: 32
