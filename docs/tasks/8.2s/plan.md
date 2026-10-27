# Plan: 8.2s — documents list index: record NULLS FIRST in the schema and snapshot

Status: READY (lead plan, small task)

## Why
8.2r added `documents_teacher_id_created_at_id_idx`. Its live SQL (migrate.ts POST_MIGRATE_STEPS) is
`("teacher_id","created_at" DESC,"id" DESC)`, and Postgres's default for DESC is NULLS FIRST. The drizzle
declaration in `packages/db/src/schema/content.ts` (~line 125) has `t.createdAt.desc()` and `t.id.desc()`
with no nulls annotation, so `packages/db/migrations/meta/0041_snapshot.json` records `"nulls": "last"` for
both. Runtime is unaffected (the columns are NOT NULL), but the schema and snapshot disagree with the live
index. `schema/operations.ts` (~line 68) already uses `.desc().nullsFirst()` for the same reason.

## Change (no live index change, no new migration)
1. `packages/db/src/schema/content.ts`: change to `t.createdAt.desc().nullsFirst()` and `t.id.desc().nullsFirst()`.
   Rewrite the comment above it (~lines 120-124): it currently says no nulls annotation is needed; say instead
   that `.nullsFirst()` matches the hand-written `DESC` SQL in migrate.ts (Postgres's DESC default), as
   operations.ts does, so the snapshot matches the live index.
2. `packages/db/migrations/meta/0041_snapshot.json`: in `documents.indexes.documents_teacher_id_created_at_id_idx.columns`,
   set `"nulls"` to `"first"` for `created_at` and `id` only (leave `teacher_id`, ascending, as `"last"`).
   Edit nothing else in the snapshot, the journal or any `.sql` file.
3. Drift check: `corepack pnpm --filter @edmate/db db:generate` (drizzle-kit, no database needed). Expect
   "No schema changes". If it writes a new migration, the snapshot edit is wrong: delete exactly the new
   files it printed (by name, with rm; never git clean or git restore on a directory), fix the snapshot,
   and run it again. Record the final output in the handoff.

## Tests
No new test. Red-then-green is the drift check: run db:generate after step 1 alone (it should report a change
to the index; then delete exactly the new files it created) and again after step 2 (no changes).
`packages/db/test/documents-list-index.int.test.ts` must still pass (it reads the live index and its EXPLAIN plan).

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/db`; `prettier --check` on the changed files;
`python3 .githooks/secret-scan.py --all`.

## Risk
Not a risky path (schema and migration meta, no DROP, no repositories change). Reviewers: database-reviewer.

## Budget
About 20 tool calls.
