# Plan: 8.2p — partial index for the ingest sweep

Status: READY (written by the lead; small, one phase)

## Acceptance (verbatim)
an EXPLAIN in an int test (or the migration test) shows the sweep query uses the new index; db typecheck, lint and test green

## Design
`ingestSweep.staleProcessing` (packages/db/src/repositories/ingestSweep.ts) runs every 15 minutes:
`WHERE status = 'processing' AND updated_at < $cutoff AND storage_key IS NOT NULL ORDER BY updated_at, id LIMIT n`.
Add a partial btree index `documents_processing_updated_at_id_idx` on `documents (updated_at, id) WHERE status = 'processing'`.
The query's `status = 'processing'` implies the index predicate, so Postgres can use it for both the range and the order.

Follow the 0036/0038/0039 precedent exactly (see docs/tasks/6.2a/handoff.md and the 0039 files):
1. Declare the index in `packages/db/src/schema/content.ts` in the `documents` table's index list, with `.where(sql\`${t.status} = 'processing'\`)`, like `documents_live_class_id_idx`.
2. Migration `packages/db/migrations/0040_documents_processing_sweep_index.sql`: a comment-only file (the index is built outside the migration transaction), worded like 0039.
3. `packages/db/src/migrate.ts`: add a `POST_MIGRATE_STEPS` entry with `CREATE INDEX CONCURRENTLY IF NOT EXISTS "documents_processing_updated_at_id_idx" ON "documents" USING btree ("updated_at","id") WHERE "documents"."status" = 'processing'`. Match the existing entries' shape and comments.
4. `packages/db/migrations/meta/0040_snapshot.json` and the `_journal.json` entry: hand-made from 0039's snapshot, changing only `id`/`prevId` and adding the one index (same shape as `documents_live_class_id_idx`'s entry). Confirm with a programmatic diff against 0039 that nothing else changed.
5. Do not change `ingestSweep.ts`; the query already fits the index.

## Files
- Modify: packages/db/src/schema/content.ts, packages/db/src/migrate.ts, packages/db/migrations/meta/_journal.json, packages/db/test/ingest-sweep.int.test.ts, packages/db/test/migrate.test.ts (only if it enumerates POST_MIGRATE_STEPS, as 6.2a did)
- Create: packages/db/migrations/0040_documents_processing_sweep_index.sql, packages/db/migrations/meta/0040_snapshot.json
- Out of bounds: packages/db/src/repositories/** (another builder is in learner.ts and index.ts), packages/contracts, apps/**

## Tests first
In `packages/db/test/ingest-sweep.int.test.ts`, add a test that runs `EXPLAIN (FORMAT JSON)` on the sweep's SQL inside a rolled-back transaction with `SET LOCAL enable_seqscan = off` (the table is tiny, so without it the planner picks a seq scan), and asserts the plan names `documents_processing_updated_at_id_idx`. Copy the helper shape from `packages/db/test/discovery.int.test.ts` (~line 242). Get the SQL from the drizzle query builder (`.toSQL()`) or write the same predicate by hand; either is fine, but say which in the handoff. Red: the test fails before the index exists (run migrations in the test setup as the file already does). Green: after steps 1-4.

## Risky paths
None: schema, migrations and migrate.ts are not in risk-paths.txt, and repositories/** is not touched. Reviewers: database-reviewer, code-reviewer, typescript-reviewer.

## Questions
None.

## Budget
30 tool calls, one phase.

## Allowed tools
Read, Write, Edit, Bash (tests, git, prettier, secret scan). No docker, docker compose or psql.

## Exit conditions
DONE: the EXPLAIN test is green and the db gate passes. PARTIAL: commit and push what works and list what is left.
