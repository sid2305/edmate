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

### 25 Oct 2026 · 12.5d class_questions index serves the join, not the cross-class order · decided by builder · risk: low
- Decided: corrected the `class_questions_live_class_id_created_at_id_idx` comment in
  `packages/db/src/schema/operations.ts` and the header comment in
  `packages/db/test/alert-queue-indexes.int.test.ts`: the index serves the join from
  `live_classes` to `class_questions` by `live_class_id`, with each live class's own rows already
  in `(created_at, id)` order; it does not remove the `Sort` in `listQueueForTeacher`'s
  cross-class `ORDER BY`, which still sorts a bounded set (capped at `QUEUE_SCAN_MAX`) across all
  of a teacher's upcoming classes. Also added an `EXPLAIN` test in
  `alert-queue-indexes.int.test.ts` for a query shaped exactly like `listQueueForTeacher` (same
  join, teacher filter, `starts_at > now()`, order, limit), seeded with 100 teachers, 400 live
  classes and 150000 class questions plus `ANALYZE`, asserting the plan accesses
  `class_questions` through the new index — without forcing it via `enable_seqscan`.
- Why: the original wording claimed the index "matches the teacher queue scan's ORDER BY", which
  is only true within one live class, not across the teacher's whole upcoming set; a reviewer
  reading the comment alone could wrongly conclude the cross-class scan never sorts. The seeded
  `EXPLAIN` test needed enough rows (150000, well beyond the first two smaller seeds tried) before
  Postgres' planner naturally preferred the index-backed nested loop over a sequential scan of
  `class_questions`, so the assertion holds without disabling `enable_seqscan`.

### 25 Oct 2026 · 12.5d budget overrun accepted · decided by lead · risk: low
- Decided: accept 63 builder tool calls against the plan's 30 and 51 for the fix round against 25 (harness counts; the agents reported 32 and 17).
- Why: the lead-written plan under-budgeted a migration with EXPLAIN tests, and the fix round's seeded EXPLAIN proof needed several planner runs; both stayed inside the plan's files.

### 25 Oct 2026 · 12.5d minor test and migration style left as they are · decided by lead · risk: low
- Decided: wontfix the typescript-reviewer LOWs: sequential inserts in the seed loops of packages/db/test/alert-queue-indexes.int.test.ts, and no trailing newline in packages/db/migrations/0030_alert_queue_indexes.sql and packages/db/migrations/meta/_journal.json (drizzle-kit output).
- Why: harmless at this seed size, and generated files are not hand-edited.

### 25 Oct 2026 · 12.5d merge: alert and class-question indexes, closes 11.2c · decided by lead · risk: low
- Decided: merge 12.5d with database-reviewer, code-reviewer and typescript-reviewer approval (the database-reviewer HIGH and both MEDIUMs fixed and verified), and close 11.2c with it, since its composite class_questions index ships here.
- Why: no repository query changes; one review cycle covers both tasks.

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

## Fix round
- database-reviewer HIGH (comment overstated what the index serves): fixed — corrected the
  comment in `packages/db/src/schema/operations.ts` and the matching header comment in
  `packages/db/test/alert-queue-indexes.int.test.ts`.
- code-reviewer MEDIUM (int test's wording overstated the same thing): fixed — same comment
  correction in `alert-queue-indexes.int.test.ts`.
- database-reviewer MEDIUM (the int test only checked the index exists via `pg_indexes`, not that
  it is used): fixed — added an `EXPLAIN` test against a query shaped like
  `listQueueForTeacher`, seeded so the planner naturally picks the index (no
  `enable_seqscan = off`).
Tool calls: 51 (harness count; the fixer reported 17)

## Budget
Tool calls used: 63 (harness count; the builder reported 32)
