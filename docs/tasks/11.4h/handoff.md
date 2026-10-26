# 11.4h handoff

Status: DONE

## Summary

Added a database-level guard against linking a document to another teacher's live class
(11.4e review follow-up), per the plan's composite-FK recommendation:

- `packages/db/src/schema/operations.ts` — `liveClasses` gets a new `uniqueIndex
  live_classes_teacher_id_id_key` on `(teacher_id, id)`, existing only as the new composite FK's
  target.
- `packages/db/src/schema/content.ts` — `documents.liveClassId` is now a plain nullable `text`
  column (no single-column `.references()`); a `foreignKey()` config entry adds
  `documents_teacher_id_live_class_id_live_classes_fk` on `(teacher_id, live_class_id)` ->
  `live_classes(teacher_id, id)`.
- `packages/db/migrations/0033_document_live_class_teacher.sql` (new, hand-edited after
  `db:generate`) — creates the unique index, drops the old single-column FK, adds the new
  composite FK `NOT VALID` with the column-list form `ON DELETE SET NULL ("live_class_id")`
  (Postgres 15+) so deleting a live class nulls only `live_class_id`, not `teacher_id` (which is
  `NOT NULL`) — see Decisions below.
- `packages/db/migrations/meta/_journal.json` / `meta/0033_snapshot.json` — generated entries for
  migration 0033.
- `packages/db/src/migrate.ts` — appended one `POST_MIGRATE_STEPS` entry to validate the new FK
  outside the migration transaction; left the old entry in place (now a no-op) and extended the
  comment block.
- `packages/db/test/migrate.test.ts` — updated the `POST_MIGRATE_STEPS` count (7 -> 8) and the
  `documents`-table expected array to include the new constraint.
- `packages/db/test/documents.int.test.ts`:
  - Cap test (`caps listRecordingsForTeacher at RECORDING_LIST_MAX...`): clears teacher A's
    earlier linked documents (and their chunks, since `chunks.document_id` has no `ON DELETE`)
    before the `generate_series` insert, so the cap-test rows are the only linked documents
    teacher A has.
  - Cross-teacher test: rewritten from "insert then check the join excludes it" to "the insert is
    refused", asserting `rejects.toThrow(/foreign key/)` — the FK now refuses the raw insert
    outright, so there is no row left to check a join against.
- `packages/db/test/schema.test.ts` (not named in the plan; see Decisions) — added a
  `REVIEWED_CONSTRAINT_DROPS` allowlist (mirroring the existing `REVIEWED_INDEX_DROPS` pattern)
  and a matching `drops only reviewed constraints, by name` test, so the migration's
  `DROP CONSTRAINT` passes the create-only migrations check.

`document-live-class-migration.int.test.ts` was left unmodified and passes unchanged, including
the `convalidated: true, confdeltype: 'n'` check against the new composite FK (query still
matches `%live_classes%`).

Both `documents.int.test.ts` changes were confirmed to fail for the right reason before the
migration/schema changes landed (cap test over-counted; cross-teacher insert resolved instead of
rejecting), then confirmed green after.

## Decisions

### 25 Oct 2026 · 11.4h composite FK over trigger · decided by builder · risk: low
- Decided: used a composite FK (`documents(teacher_id, live_class_id)` -> `live_classes(teacher_id,
  id)`) rather than a trigger, per the plan's own recommendation.
- Why: the repo has zero `CREATE TRIGGER`/`CREATE FUNCTION` in any migration; a composite FK is a
  direct extension of the existing `NOT VALID` -> `VALIDATE` pattern and reuses the exact
  precedent of migration 0009's `sessions_package_version_fk` referencing a plain unique index
  (`package_versions_package_id_version_key`), not a named `UNIQUE` constraint.

### 25 Oct 2026 · 11.4h cross-teacher test rewritten to insert-is-refused · decided by builder · risk: low
- Decided: replaced the old "insert then check the join excludes it" test with "the raw insert
  is refused", asserting `rejects.toThrow(/foreign key/)` (same style as
  `document-live-class-migration.int.test.ts:101-103`).
- Why: once the FK exists, the insert itself throws, so the scenario the old test guarded
  (a cross-teacher row existing but being excluded from the join) can no longer be constructed;
  no row is ever created, so there is nothing left to check against teacher B's list.

### 25 Oct 2026 · 11.4h column-list ON DELETE SET NULL · decided by builder · risk: low
- Decided: the migration's composite FK uses the Postgres 15+ column-list form, `ON DELETE SET
  NULL ("live_class_id")`, instead of a plain `ON DELETE SET NULL`. `documents.teacherId`'s
  schema-level `.onDelete('set null')` call stays as schema-only bookkeeping so `db:generate`
  remains a no-op; the deployed clause lives only in the hand-edited migration SQL.
- Why: a plain (non-column-list) `SET NULL` on a composite FK nulls every referencing column,
  including `teacher_id` — which is `NOT NULL` on `documents` — so deleting a live class would
  have failed with a not-null violation instead of unlinking the recording. This surfaced as a
  real test failure (`document-live-class-migration.int.test.ts`'s "refuses a link to a missing
  class, and unlinks (keeps) recordings when a class is deleted") when first run against the
  plan's literal `ON DELETE set null` text, and is why the plan's SQL snippet needed this one
  change. drizzle-orm's `foreignKey().onDelete()` type (`UpdateDeleteAction`) can't express a
  column list, so this is unavoidably a hand-edit, same category as the existing `NOT VALID`
  hand-edits in this file.

### 25 Oct 2026 · 11.4h schema.test.ts touched, not named in the plan · decided by builder · risk: low
- Decided: added a `REVIEWED_CONSTRAINT_DROPS` allowlist and a new test in
  `packages/db/test/schema.test.ts`, which the plan's "Files to modify" list didn't name.
- Why: `schema.test.ts`'s "migrations are create-only" test flags any `DROP CONSTRAINT` as
  destructive SQL by default (same `DESTRUCTIVE_SQL` regex `merge_gate.py` uses); the plan's own
  migration SQL (dropping the old single-column FK) fails that check unless it is reviewed and
  allowlisted by name, the same way `REVIEWED_INDEX_DROPS` already allowlists reviewed
  `DROP INDEX` statements in other migrations. Without this, "db typecheck, lint and test green"
  (the plan's acceptance) is unreachable, so this was a necessary, same-package, in-scope-by-
  necessity addition rather than an open question.

Also clears chunks for the documents it deletes in the cap test (not spelled out in the plan's
exact SQL), since `chunks.document_id` -> `documents.id` has no `ON DELETE` action and
`doc_rec_search` (deleted by the cap-test cleanup) has rows in `chunks` from an earlier test in
the same block.

## Gate

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
```
-> 26/26 tasks successful (typecheck, lint, test, each cached once green), including
`document-live-class-migration.int.test.ts` passing unmodified and `migrate.test.ts`'s updated
counts passing.

```
corepack pnpm exec prettier --check <changed non-SQL files>
```
-> "All matched files use Prettier code style!" (the new `.sql` migration file has no prettier
parser registered for SQL, same as every other hand-edited migration in this repo; not checked).

```
python3 .githooks/secret-scan.py --all
```
-> clean, no output.

```
corepack pnpm --filter @edmate/db db:generate
```
-> "No schema changes, nothing to migrate" after the hand-edit, confirming the generate-again
no-op check.

## Budget

Tool calls used: 46
