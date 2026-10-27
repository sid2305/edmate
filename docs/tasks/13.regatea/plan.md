# Plan: 13.regatea — partial index on eval_runs for the regate sweep's candidate query

## Acceptance (verbatim from board)

> a migration adds the index; the sweep's candidate query uses it (EXPLAIN in the handoff); db
> typecheck, lint and test green

How this will be shown: the handoff pastes the `EXPLAIN` output from the new int test (run
against `TEST_DATABASE_URL`, never a production database), showing the index name in the plan and
no `Sort` node for the "last" CTE's `DISTINCT ON`/`ORDER BY`; plus the green
`turbo run typecheck lint test --filter=@edmate/db` gate.

## Context

13.regate's review (`docs/tasks/13.regate/review.md`) deferred this MEDIUM (database-reviewer,
security-reviewer): `packages/db/src/repositories/publish.ts`'s `regateRepo(db)
.liveAgentsWithMaterialChange()` has a `last` CTE that scans `eval_runs` for

```sql
where suite = 'gate' and status = 'passed' and published_at is not null
order by agent_id, published_at desc, id desc   -- feeds select distinct on (agent_id)
```

with no index backing that filter + order. Existing `eval_runs` indexes
(`eval_runs_teacher_id_idx`, `eval_runs_agent_version_id_suite_idx`,
`eval_runs_agent_id_created_at_idx`, `eval_runs_agent_id_open_key`) don't cover it. The deferral
decision (handoff.md, 27 Oct 2026) says this is low urgency — the sweep runs every 15 minutes, off
any request path, with small pilot data — but still wants the index, its own migration and review.

No change to `publish.ts`'s query itself: its `where`/`order by` already matches the index this
plan adds, so the repository file is untouched (keeps this plan off the
`packages/db/src/repositories/**` risky path).

## Design

Same schema-only + post-migrate `CREATE INDEX CONCURRENTLY` pattern already used for every index
on a populated table in this codebase (migrations 0010/0028/0032/0035/0036, documented in
`packages/db/src/migrate.ts`'s `POST_MIGRATE_STEPS` comment): a plain migration-file `CREATE INDEX`
takes the table's `ACCESS EXCLUSIVE` lock for the whole build; `CONCURRENTLY` run by the
post-migrate step only needs it briefly, and `eval_runs` is written by every gate run.

Index: `eval_runs_gate_passed_agent_id_published_at_id_idx` on
`eval_runs (agent_id, published_at DESC, id DESC) WHERE suite = 'gate' AND status = 'passed' AND
published_at IS NOT NULL`.

- Partial on `suite = 'gate' AND status = 'passed' AND published_at IS NOT NULL` — the exact three
  filters the `last` CTE applies (not `eval_runs_agent_id_created_at_idx`'s unfiltered shape),
  so Postgres can match it only for the rows the sweep's `last` CTE scans.
- Leading column `agent_id` (plain ascending) — matches `DISTINCT ON (agent_id)` / the CTE's
  `order by agent_id, ...`.
- `published_at DESC, id DESC` (not ascending) — the CTE orders `published_at desc, id desc`
  within each `agent_id` group; a uniformly-ascending index can only be scanned forward (all
  columns ascending) or backward (all columns descending, including `agent_id`), neither of which
  matches "agent_id ascending, the other two descending" needed for Postgres's `Unique` strategy to
  avoid a `Sort` node. drizzle-orm 0.45.4's `ExtraConfigColumn` has `.asc()`/`.desc()` (confirmed in
  `drizzle-orm/pg-core/columns/common.d.ts`), so the schema declares the same mixed-direction index
  `db:generate` would otherwise want to add, keeping it a no-op.
- `pg_indexes.indexname` stays within Postgres's 63-char identifier limit (50 chars).

Schema declaration (`packages/db/src/schema/operations.ts`, inside `evalRuns`'s `(t) => [...]`
array, same style as `chunks_transcript_created_at_idx` in `content.ts`):

```ts
// Task 13.regatea (13.regate review deferral): regateRepo(db).liveAgentsWithMaterialChange's
// `last` CTE scan (newest passed, published gate run per agent). Partial on exactly the CTE's
// filter; agent_id ascending with published_at/id descending matches its
// `order by agent_id, published_at desc, id desc` so the DISTINCT ON can use the index without a
// Sort. Built CONCURRENTLY by the post-migrate step (migrate.ts), not this file — see migration
// 0038's comment.
index('eval_runs_gate_passed_agent_id_published_at_id_idx')
  .on(t.agentId, t.publishedAt.desc(), t.id.desc())
  .where(sql`${t.suite} = 'gate' and ${t.status} = 'passed' and ${t.publishedAt} is not null`),
```

Post-migrate step (`packages/db/src/migrate.ts`'s `POST_MIGRATE_STEPS`, appended at the end, same
shape as the existing `concurrentIndex` entries):

```ts
// Migration 0038 (task 13.regatea, 13.regate review deferral): regateRepo's candidate scan.
{
  kind: 'concurrentIndex',
  indexName: 'eval_runs_gate_passed_agent_id_published_at_id_idx',
  sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "eval_runs_gate_passed_agent_id_published_at_id_idx" ON "eval_runs" USING btree ("agent_id","published_at" DESC,"id" DESC) WHERE "eval_runs"."suite" = 'gate' AND "eval_runs"."status" = 'passed' AND "eval_runs"."published_at" is not null`,
},
```

The builder confirms the exact `indexdef` Postgres reports (via `pg_indexes` in the new int test)
before finalizing this SQL string — DESC column ordering and partial-predicate quoting in
`indexdef` output can differ slightly in whitespace/parenthesisation from what's typed above; match
reality, not this draft.

Migration file (`packages/db/migrations/0038_eval_runs_gate_passed_index.sql`, next free number
after 0037): comment-only, same style as 0032/0036 — explains the schema-only + post-migrate
pattern and names this migration's one index.

`packages/db/src/migrate.ts`'s `POST_MIGRATE_STEPS` doc comment (the paragraph listing migrations
0009/0010/.../0036) gets one more sentence for migration 0038.

## Files to create

- `packages/db/migrations/0038_eval_runs_gate_passed_index.sql` — comment-only migration.
- `packages/db/test/eval-runs-gate-passed-index.int.test.ts` — new int test, modeled on
  `packages/db/test/teacher-profiles-pending-index.int.test.ts`: throwaway database via
  `test/pg.ts`'s `postgresUp`/`createDatabase`/`throwawayName`/`urlFor`/`dropDatabase`,
  `migrateDatabase(TEST_URL)`, then:
  - Fixtures: one teacher (`users` + `teacher_profiles`), one "anchor" `agents` row and one
    `agent_versions` row (to satisfy `eval_runs.agent_version_id`'s `NOT NULL` FK — its value
    isn't semantically tied to this test, so every synthetic row may reuse the same
    `agent_version_id`), then ~300-500 distinct `agents` rows (bulk `generate_series` insert, each
    `status = 'live'`, satisfying `eval_runs.agent_id`'s FK) and one `eval_runs` row per agent:
    `suite = 'gate'`, `status = 'passed'`, `published_at` set (spread over distinct timestamps so
    there's a real sort to avoid), `basis` a small jsonb object (not required by the index, any
    valid jsonb). Reference `packages/db/test/publish.int.test.ts` (read-only — don't edit it) for
    the `users`/`teacher_profiles`/`agents`/`agent_versions`/`eval_runs` column lists and FK order;
    model the bulk-insert shape on `teacher-profiles-pending-index.int.test.ts`'s
    `generate_series` pattern.
  - `analyze eval_runs` before querying (matches the teacher_profiles precedent).
  - Test 1: query `pg_indexes` for `tablename = 'eval_runs'`, assert
    `eval_runs_gate_passed_agent_id_published_at_id_idx`'s `indexdef` contains the three columns and
    the `WHERE` clause's `suite = 'gate'` and `status = 'passed'`.
  - Test 2: `explain` (or `explain analyze`) a query shaped exactly like the `last` CTE (same
    `where`/`order by`/`distinct on`, as literal SQL — not through `regateRepo`, which is a
    repository method and this test only needs the query *shape*). Assert the plan text contains
    the new index name, an `Index` (or `Index Only`) scan, and does **not** contain `Sort`.
  - Paste this test's `EXPLAIN` output into the handoff as the acceptance's required evidence.

## Files to modify

- `packages/db/src/schema/operations.ts` — add the index to `evalRuns`'s index array (see Design).
- `packages/db/src/migrate.ts` — add the `POST_MIGRATE_STEPS` entry and extend the doc comment.
- `packages/db/test/migrate.test.ts` — the existing `POST_MIGRATE_STEPS` snapshot-style `toEqual`
  (around the list ending with `teacher_profiles_pending_created_at_id_idx`) gains one more
  `{ kind: 'concurrentIndex', indexName: 'eval_runs_gate_passed_agent_id_published_at_id_idx', sql:
  expect.stringContaining('CREATE INDEX CONCURRENTLY IF NOT EXISTS') }` entry, same style as its
  neighbours.

## Files out of bounds

- `packages/db/src/repositories/publish.ts` — no query change needed; this is a repositories-path
  file (`.claude/skills/merge-gate/risk-paths.txt`) and touching it would need security-reviewer.
- `packages/db/test/publish.int.test.ts` — read for fixture reference only, never edited (another
  builder's concern is unrelated — 5.4a doesn't touch this file either, but it's 13.regate's
  existing test file and this plan has no reason to change it).
- `packages/db/test/migrate.int.test.ts` — owned by 5.4a later; its own `POST_MIGRATE_STEPS`
  describe block only asserts the three named 13.4a retention indexes by name, so this plan's new
  entry needs no change there. Do not touch this file.
- `packages/db/src/repositories/**`, `packages/db/test/repositories.int.test.ts`,
  `packages/db/src/repositories/chunks.ts`, `packages/db/src/repositories/map.ts`,
  `apps/web` studio files, `apps/worker` ingest files — concurrent builders (12.2f, 8.2i).
- `packages/harness/**`, `packages/db/src/repositories/retrieval.ts`,
  `packages/db/test/access-audit*.test.ts`, `packages/db/test/retrieval-leak*.test.ts` — concurrent
  builder (5.4a).

## Tests first

1. Write `eval-runs-gate-passed-index.int.test.ts`'s two `it`s (index exists with the right
   columns/predicate; `EXPLAIN` on a last-CTE-shaped query uses it with no `Sort`) against the
   **current** migrations (no 0038 yet, no schema change) — confirm both fail (no such index;
   `EXPLAIN` shows `Seq Scan` + `Sort`).
2. Write `migrate.test.ts`'s new array entry — confirm the existing `toEqual` test fails (missing
   entry).
3. Add the schema index, the migration file and the `POST_MIGRATE_STEPS` entry; re-run both test
   files — confirm green. Paste the passing `EXPLAIN` plan text into the handoff.
4. Run the full `@edmate/db` gate (`typecheck`, `lint`, `test`) once, green.

## Risky paths checked (`.claude/skills/merge-gate/risk-paths.txt`)

None of this plan's files match a listed glob:

- `packages/db/src/schema/operations.ts`, `packages/db/src/migrate.ts`,
  `packages/db/migrations/0038_eval_runs_gate_passed_index.sql`,
  `packages/db/test/eval-runs-gate-passed-index.int.test.ts`,
  `packages/db/test/migrate.test.ts` — none match `packages/db/src/repositories/**` (the only
  `packages/db/**` glob listed) or any other group's globs.
- The migrations risk note ("migrations that drop or delete data are risky too") doesn't apply:
  this migration is comment-only (additive index built by the post-migrate step), drops nothing.

No `risk: high` decision entry is needed for this task's own files; `risk: medium` on the board is
the review-deferral label, not a risky-path signal.

## Questions

1. Mixed-direction index (`agent_id` ascending, `published_at`/`id` descending) vs. a simpler
   uniformly-ascending composite index that still gets used but leaves a `Sort` node in the plan?
   **Recommend**: mixed-direction, as designed above — drizzle-orm 0.45.4 supports `.desc()` on an
   index column (confirmed in its type declarations), it matches the sweep's exact `ORDER BY`, and
   "the sweep's candidate query uses it" reads more convincingly in the handoff's `EXPLAIN` when no
   `Sort` node remains, for the same build cost as any other index shape.
2. Should the new int test's fixture reuse one `agent_version_id` across every synthetic
   `eval_runs` row (fine for this index, since the FK's existence is all that matters, not its
   per-row correctness) rather than create a distinct `agent_versions` row per `agents` row?
   **Recommend**: yes, reuse one anchor `agent_version_id` — cuts fixture row count roughly in half
   with no loss of test fidelity for an index on `(agent_id, published_at, id)`.

## Budget

Budget: 60 tool calls (1 phase, packages/db only)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for @edmate/db, prettier --check,
secret-scan.py --all; no other shell use needed)

## Exit conditions

- **DONE**: the migration, schema index and post-migrate step all exist; `migrate.test.ts`'s
  snapshot and the new int test are green; `TEST_DATABASE_URL`-backed
  `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` is green; the handoff pastes the
  new test's `EXPLAIN` output showing the new index name and no `Sort` node; prettier and the
  secret scan are clean.
- **PARTIAL**: past ~60 tool calls with the index/migration/post-migrate step done but the int
  test's fixtures still failing on an FK or data-shape issue not resolved in two attempts; or a
  file outside this plan's list turns out to need changes (e.g. `migrate.int.test.ts` turns out to
  assert something broader than checked here) — stop and hand back rather than touching it.

## Lead answers (27 Oct 2026)
- Q1: use mixed column directions, matching the sweep's ORDER BY exactly; the EXPLAIN test asserts the index is used and there is no Sort node.
- Q2: yes, the synthetic eval_runs rows may share one anchor agent_version_id.
- Confirm the migration number against packages/db/migrations/ on main right before creating the file.
