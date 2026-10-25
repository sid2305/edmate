# 13.4a plan — retention indexes built CONCURRENTLY

Status: READY (lead-written plan, 25 Oct 2026)

## Goal
Migration `0032_retention_indexes.sql` (task 13.4) builds three indexes with a plain `CREATE INDEX`.
drizzle 0.45 runs every pending migration file in one transaction, so each build holds its table's
lock for the whole build. Move them to the existing schema-only + post-migrate pattern
(`POST_MIGRATE_STEPS` in `packages/db/src/migrate.ts`, as for migrations 0009, 0010 and 0028).

The three indexes (already declared in `src/schema/content.ts:140` and `src/schema/learning.ts:97,149`):
- `chunks_transcript_created_at_idx` on chunks (kind, created_at) WHERE kind = 'transcript'
- `sessions_created_at_idx` on sessions (created_at)
- `turn_traces_created_at_idx` on turn_traces (created_at)

## Steps
1. Test first (`packages/db/test/migrate.int.test.ts`): after `migrateDatabase` on a fresh database,
   all three indexes exist with `indisvalid` and `indisready` true; and a test that
   `POST_MIGRATE_STEPS` contains a `concurrentIndex` step for each of the three names.
2. Rewrite `packages/db/migrations/0032_retention_indexes.sql` to a comment-only file, like
   `0010_easy_maximus.sql`: say why (13.4 review deferral, 13.4a) and that the post-migrate step
   builds them. Keep the file name and the `_journal.json` entry unchanged; no snapshot change
   (the schema still declares the indexes, so `db:generate` stays a no-op — check it).
   - Before editing: confirm in `node_modules/drizzle-orm` (pg-core dialect `migrate`) that drizzle
     decides what to apply by `created_at` (folderMillis) and never re-checks the hash of an applied
     migration. Note the finding in the handoff. If it does re-check hashes, STOP and return BLOCKED.
   - A database that already applied the old 0032 keeps its indexes; the post-migrate steps use
     `IF NOT EXISTS` and the existing valid-index check, so they are no-ops there. No production
     database exists yet (pre-pilot), so no deploy has the old 0032.
3. Append three `concurrentIndex` steps to `POST_MIGRATE_STEPS` (append only, never reorder), with
   SQL that exactly matches what drizzle generated in the old 0032 (same columns, same partial
   predicate text), plus `CONCURRENTLY IF NOT EXISTS`. Update the doc comment above the list to
   mention migration 0032 (task 13.4a).
4. If `packages/db/src/repositories/README.md` lists schema-only indexes (around line 351), add the
   three.

## Out of scope
Any repository code, any other migration, apps/worker.

## Risk paths
None (`packages/db/src/migrate.ts` and `packages/db/migrations/**` are not in risk-paths.txt).
Reviewers: code-reviewer, typescript-reviewer, database-reviewer.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` with TEST_DATABASE_URL set,
and `corepack pnpm --filter @edmate/db db:generate` (or the package's generate script) leaves no diff.

## Budget
Small: about 40 tool calls.
