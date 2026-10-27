# Handoff: 13.regatea

Status: DONE

## Summary

Added the partial index `eval_runs_gate_passed_agent_id_published_at_id_idx` on
`eval_runs (agent_id, published_at DESC, id DESC) WHERE suite = 'gate' AND status = 'passed' AND
published_at IS NOT NULL`, backing `regateRepo(db).liveAgentsWithMaterialChange`'s `last` CTE
scan (deferred from 13.regate's review). No change to `packages/db/src/repositories/publish.ts`.

Files created:
- `packages/db/migrations/0038_eval_runs_gate_passed_index.sql` — comment-only migration (next
  free number after 0037, confirmed against `packages/db/migrations/` before creating it).
- `packages/db/migrations/meta/0038_snapshot.json` and the matching entry in
  `packages/db/migrations/meta/_journal.json` — the drizzle-kit companion artifacts every other
  migration has; generated with `npx drizzle-kit generate --name eval_runs_gate_passed_index`,
  then the generated `.sql` file's body was replaced with the comment-only text above (same
  "schema-only + post-migrate `CREATE INDEX CONCURRENTLY`" pattern as every prior index-on-a-
  populated-table migration). Not listed in the plan's "Files to create"; added because
  `test/schema.test.ts`'s existing "has the same index names as src/schema" check reads the
  migration snapshot, not just `src/schema/operations.ts` (see Decisions).
- `packages/db/test/eval-runs-gate-passed-index.int.test.ts` — new int test, modeled on
  `teacher-profiles-pending-index.int.test.ts`: one teacher, one anchor agent/agent_version (FK
  satisfier, lead answer Q2: shared across all synthetic rows), 400 distinct `live` agents, 10
  passed/published `gate` eval_runs rows per agent (so the `last` CTE's `DISTINCT ON` has a real
  pick-the-newest problem) plus 20 non-gate `accuracy` rows per agent (so the table's existing
  unfiltered `eval_runs_agent_id_created_at_idx`/`eval_runs_agent_version_id_suite_idx` have far
  more rows to filter through than the new partial index — closer to production, where most
  `eval_runs` rows are not publish-gate runs). Test 1 checks `pg_indexes.indexdef` for the index
  name, column list and `WHERE` clause; test 2 `explain`s a query shaped exactly like the `last`
  CTE's `where`/`order by`/`distinct on` (same literal SQL, no added `nulls` annotations — see
  Decisions) and asserts the plan uses the new index with an Index Scan and no `Sort`.

Files modified:
- `packages/db/src/schema/operations.ts` — added the index to `evalRuns`'s index array:
  `t.agentId, t.publishedAt.desc().nullsFirst(), t.id.desc().nullsFirst()`, partial `where`. The
  `.nullsFirst()` calls are a deviation from the plan's draft (see Decisions).
- `packages/db/src/migrate.ts` — added the `POST_MIGRATE_STEPS` `concurrentIndex` entry for
  migration 0038 (exact `indexdef` confirmed against `pg_indexes` via the int test, per the
  plan's instruction), and extended the `POST_MIGRATE_STEPS` doc comment with one more sentence.
- `packages/db/test/migrate.test.ts` — the `POST_MIGRATE_STEPS` `toEqual` array gained one more
  entry (`indexName: 'eval_runs_gate_passed_agent_id_published_at_id_idx'`,
  `stringMatching(/CREATE INDEX CONCURRENTLY IF NOT EXISTS.*WHERE.*"suite" = 'gate'/)`).

## EXPLAIN evidence (acceptance's required evidence)

From the new int test's second case, against the fixture described above (`set local work_mem =
'64kB'` and `set local random_page_cost = 1.1` so the planner's cost model behaves like
production's much larger table and SSD-backed storage, without needing a production-sized
fixture — see Decisions), running the exact, unmodified `last`-CTE-shaped query:

```
explain select distinct on (agent_id)
  agent_id, teacher_id, (basis->>'materialRevision')::bigint as published_revision
from eval_runs
where suite = 'gate' and status = 'passed' and published_at is not null
order by agent_id, published_at desc, id desc
```

```
Unique  (cost=0.28..228.07 rows=271 width=55)
  ->  Index Scan using eval_runs_gate_passed_agent_id_published_at_id_idx on eval_runs  (cost=0.28..226.96 rows=444 width=55)
```

The index is named in the plan, there is an Index Scan, and no `Sort` node.

## Red (before this change)

Running the same new int test's two cases against the migrations before this task (no schema
change, no migration 0038) failed as expected: no such index exists, and the EXPLAIN showed a
`Seq Scan on eval_runs` + `Sort` plan (confirmed while iterating, before adding the schema index
and migration). `migrate.test.ts`'s `POST_MIGRATE_STEPS` `toEqual` also failed (missing entry)
before the `migrate.ts` edit.

## Decisions

### 27 Oct 2026 · 13.regatea migration snapshot files · decided by builder · risk: low
- Decided: generate and include `packages/db/migrations/meta/0038_snapshot.json` and the
  matching `_journal.json` entry (via `drizzle-kit generate`, then hand-replacing the generated
  migration's SQL body with the plan's comment-only text), in addition to the plan's listed
  files.
- Why: `packages/db/test/schema.test.ts`'s existing "has the same index names as src/schema"
  test compares `src/schema`'s index names against the migration snapshot's recorded index names
  per table, not against `operations.ts` directly. Without regenerating the snapshot, that
  existing test failed (`eval_runs` snapshot missing the new index name) even though the schema
  and `POST_MIGRATE_STEPS` changes were otherwise correct. This follows the exact same
  schema-only + post-migrate pattern as every prior migration in this family (0010/0028/0032/
  0035/0036): only the snapshot/journal bookkeeping is drizzle-kit-generated, the actual index
  build still happens via `CREATE INDEX CONCURRENTLY` in the post-migrate step, not the migration
  file.

### 27 Oct 2026 · 13.regatea nullsFirst on the index columns · decided by builder · risk: low
- Decided: declare the index's descending columns as `.desc().nullsFirst()` (drizzle-orm 0.45.4
  `ExtraConfigColumn` method, confirmed in its type declarations), rather than the plan draft's
  plain `.desc()`.
- Why: publish.ts's `last` CTE writes `order by agent_id, published_at desc, id desc` with no
  `nulls` annotation. Postgres's default null ordering for an un-annotated `desc` is `nulls
  first`. Drizzle's own default for `.desc()` on an index column is `DESC NULLS LAST` (confirmed:
  the first attempt, without `.nullsFirst()`, generated `... DESC NULLS LAST ...`). That mismatch
  meant the planner could not recognize the index's native order as satisfying the CTE's
  `order by` -- EXPLAIN on the plan draft's query (unmodified, matching `publish.ts` exactly)
  showed a `Bitmap Heap Scan` + explicit `Sort`, not the intended plan, even though the index's
  predicate and column list were otherwise an exact match and in use (visible as a `Bitmap Index
  Scan` feeding the `Recheck Cond`). Adding `.nullsFirst()` to both descending columns fixed this
  without needing any change to `publish.ts`'s query (kept out of this plan's files, as the
  design required) -- published_at/id can never actually be null for rows the partial predicate
  lets through, so this has no behavioral effect beyond matching the query's implicit ordering.
  Flagging as a decision since the plan's draft SQL (`.desc()`, no `nullsFirst()`) would not
  have produced the "no Sort node" result the acceptance requires, once tested against the real,
  unmodified CTE shape.

### 27 Oct 2026 · 13.regatea EXPLAIN test's session-level planner settings · decided by builder · risk: low
- Decided: the EXPLAIN test sets `work_mem = '64kB'` and `random_page_cost = 1.1` (`set local`,
  inside a transaction that's rolled back) before running the EXPLAIN, and uses a fixture with
  10 gate/passed rows per agent plus 20 non-gate rows per agent (not the single row per agent a
  literal reading of the plan's "one eval_runs row per agent" suggested) to make the planner
  genuinely favor the new index at this fixture's (intentionally small, per the plan) row count.
- Why: at the row counts available in a fast int test, Postgres's default cost settings
  (`random_page_cost = 4`, generous default `work_mem`) make a sequential or bitmap scan plus an
  explicit sort cheaper than using the new index to avoid the sort, even once the index is used
  and its predicate/column list match exactly -- this is a property of the test's necessarily
  small synthetic table, not of the index design. Lowering `random_page_cost` to reflect the
  production host's actual (SSD) storage and lowering `work_mem` to make an on-disk sort's cost
  estimate realistic for a much bigger production table are both legitimate planner-config
  choices (not query hacks: no `enable_seqscan`/`enable_bitmapscan` disabling was used, and the
  EXPLAIN's query text is the CTE's exact, unmodified shape) that let a small fixture demonstrate
  the same plan a much larger production `eval_runs` table would get under its own cost settings.

## Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run
  typecheck lint test --filter=@edmate/db` → green: 8/8 tasks successful (one run hit the
  pre-existing, unrelated `test/retrieval-leak.int.test.ts` SLO timing assertion failing once;
  re-ran that file alone and it passed 25/25 — confirmed flaky/transient, not caused by this
  task's files; the next full gate run was clean start to finish).
- `corepack pnpm exec prettier --check` on every changed `.ts` file → "All matched files use
  Prettier code style!" The two changed JSON files under `packages/db/migrations/meta/` are
  drizzle-kit-generated (same as every prior migration's meta files, e.g. `0037_snapshot.json`,
  confirmed to also fail `prettier --check` unmodified) and were not reformatted.
- `python3 .githooks/secret-scan.py --all` → clean, no output.

## Budget

Tool calls used: 78
