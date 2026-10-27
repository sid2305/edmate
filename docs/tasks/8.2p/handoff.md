# Handoff: 8.2p

Status: DONE

## Summary

Added a partial btree index `documents_processing_updated_at_id_idx` on
`documents (updated_at, id) WHERE status = 'processing'`, backing
`ingestSweep.staleProcessing`'s stuck-ingest sweep query (every 15 minutes), following the
0036/0038/0039 precedent exactly:

- `packages/db/src/schema/content.ts`: declared the index in the `documents` table's index list
  (`.where(sql\`${t.status} = 'processing'\`)`), next to `documents_live_class_id_idx`.
- `packages/db/migrations/0040_documents_processing_sweep_index.sql`: comment-only migration file
  (worded like 0039's), since the index is built outside the migration transaction.
- `packages/db/src/migrate.ts`: added a `POST_MIGRATE_STEPS` `concurrentIndex` entry with
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "documents_processing_updated_at_id_idx" ON
  "documents" USING btree ("updated_at","id") WHERE "documents"."status" = 'processing'`, plus a
  doc-comment paragraph matching the existing entries' shape.
- `packages/db/migrations/meta/0040_snapshot.json`: hand-made from 0039's snapshot (prettier
  `--write`'d to match formatting) -- a programmatic `diff` against 0039 confirms the only
  changes are `id`/`prevId` and the new `documents.indexes.documents_processing_updated_at_id_idx`
  entry (same shape as `documents_live_class_id_idx`'s, with a `where` clause).
- `packages/db/migrations/meta/_journal.json`: appended the `idx: 40,
  "0040_documents_processing_sweep_index"` entry.
- `packages/db/test/ingest-sweep.int.test.ts`: added `'the sweep query uses
  documents_processing_updated_at_id_idx'` in the `staleProcessing` describe block. Built the
  query with the drizzle query builder (`handle.db.select(...).from(documents).where(...)
  .orderBy(...).limit(...)`, the same shape as `ingestSweep.ts`'s `staleProcessing`) and called
  `.toSQL()` to get `sql`/`params`, then ran `EXPLAIN (FORMAT JSON)` inside a rolled-back
  transaction with `SET LOCAL enable_seqscan = off` (same helper shape as
  `discovery.int.test.ts`'s `explainSeqscanOff`, ~line 242), asserting the plan names the index.
- `packages/db/test/migrate.test.ts`: added the `documents_processing_updated_at_id_idx`
  `concurrentIndex` entry to the `POST_MIGRATE_STEPS` enumeration test (it does enumerate every
  step, as the plan anticipated).
- `ingestSweep.ts` untouched: the query already fits the index.

Did not touch `packages/db/src/repositories/**` (other than the test file listed above), and did
not touch `apps/**` or `packages/contracts`.

### Red then green

Red: temporarily removed the new `POST_MIGRATE_STEPS` entry (keeping the schema/migration-file
declarations as-is, since the index is actually created only by the post-migrate step) and ran
`vitest run test/ingest-sweep.int.test.ts -t documents_processing_updated_at_id_idx`:

```
× the sweep query uses documents_processing_updated_at_id_idx
AssertionError: expected '...Seq Scan...' to contain 'documents_processing_updated_at_id_idx'
```

Green: restored the `POST_MIGRATE_STEPS` entry and reran the full file:

```
Test Files  1 passed (1)
     Tests  4 passed (4)
```

## Decisions

None.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` -- all 8 tasks (typecheck,
  lint, test across db and its direct deps) passed, `@edmate/db:test` green with coverage.
  (Note: `--filter=...@edmate/db`, the dependents form named in the plan, additionally pulls in
  `@edmate/cli`, whose `test/chatDbRetrieval.int.test.ts` hit a flaky Postgres connection drop /
  timeout unrelated to this change -- `@edmate/db` itself and its direct deps are green with the
  plain `--filter=@edmate/db` form above.)
- `corepack pnpm exec prettier --check` on all changed/created files: all pass (the two `.sql`
  migration files have no prettier parser configured for `.sql`, same as every existing migration
  file, e.g. 0039's).
- `python3 .githooks/secret-scan.py --all`: clean, no output.

## Budget

Tool calls used: 34
