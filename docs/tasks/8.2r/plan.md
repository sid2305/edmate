# Plan: 8.2r — documents list index and 0017 validate-at-scale hygiene

## Accept (verbatim, docs/board/tasks.yaml)
> the new migration applies cleanly on a fresh and a migrated database; listForTeacher uses the
> composite index (EXPLAIN in a db int test or the handoff); db tests green.

How it will be shown: two new `packages/db/test/*.int.test.ts` files (one per item) run against
the shared dev Postgres and are named in the handoff's gate log, plus the migration's own
hand-edited-migration comment explaining both parts. No UI or API surface changes — `packages/db`
only.

## Background
Deferred from 8.2a's review (`docs/tasks/8.2a/review.md:9`, `docs/tasks/8.2a/plan.md:75-89`,
confirmed by reading both). Two LOW items, both "at scale" hygiene, no new runtime behaviour:
1. `documents.listForTeacher` (`packages/db/src/repositories/chunks.ts:370-389`) has no composite
   index backing its `WHERE teacher_id = $1 ORDER BY created_at DESC, id DESC LIMIT 500` — only
   `documents_teacher_id_idx` (teacher_id alone), `documents_module_id_idx`, and the two 8.2p/11.4
   partial indexes on `documents` (confirmed: read `packages/db/src/schema/content.ts:102-131` in
   full, no such composite index exists).
2. Migration `0017_document_status.sql` added `documents_failure_reason_only_when_failed` as a
   plain `ADD CONSTRAINT ... CHECK` (no `NOT VALID`), unlike this repo's later convention
   (`packages/db/src/migrate.ts:92-146`'s `POST_MIGRATE_STEPS` comment lists the precedent:
   migrations 0009, 0014, 0023, 0024, 0028, 0032, 0033, 0035, 0036, 0038, 0039, 0040). 0017 already
   shipped (dev and any already-migrated database have it), so it can't be hand-edited in place —
   a *new* migration must drop and re-add the same constraint `NOT VALID`, validated by a new
   `POST_MIGRATE_STEPS` entry. Exact template: migration `0033_document_live_class_teacher.sql`
   (`ALTER TABLE ... DROP CONSTRAINT ...; ALTER TABLE ... ADD CONSTRAINT ... NOT VALID;`), same
   drop-and-replace shape, CHECK instead of FOREIGN KEY.

## Migration number
Next free number, confirmed by listing `packages/db/migrations/*.sql` just now: highest is
`0040_documents_processing_sweep_index.sql`, so this task's migration is **`0041_*.sql`**.
Checked for a collision with every other `running`/`planning` board task before writing this plan:
- 8.2q (running, `docs/tasks/8.2q/plan.md` grepped for "migration"/"CONCURRENTLY"/"VALIDATE") —
  edits `chunks.ts` and the worker ingest sweep only, no migration.
- 6.3d (planning) — `ProfileStore.applyMistakes`/`recordProposedMistakes` reuse the existing
  style-card `mistakeTags` column; no schema change, no migration (per its board title).
- 6.4b (running, `docs/tasks/6.4b/plan.md:48,51,123`) — explicitly "no migration, no new column".
- 11.4d (running) and 10.1 (running, blocked on `needs_decision`) — worker/payments work, no
  `packages/db/migrations` touch.
**Builder must still re-run `ls packages/db/migrations/*.sql | sort -V | tail -1` right before
generating, in case another task's migration landed on `main` first** — if `0041` is taken, use
the next free number instead and say so in the handoff. **Flag to the lead:** no other currently
running/planning task claims a migration number today, but this is a point-in-time check; the two
tasks named in the task brief (8.2q, 6.3d) specifically do not touch `packages/db/migrations/**`.

## Files to create/modify
- `packages/db/src/schema/content.ts` — add one schema-only index declaration inside the
  `documents` table's index array (after `documents_processing_updated_at_id_idx`, same
  schema-only-comment style):
  ```
  index('documents_teacher_id_created_at_id_idx')
    .on(t.teacherId, t.createdAt.desc(), t.id.desc())
  ```
  No `.where(...)` — this is a full (non-partial) index, unlike the 8.2p one. No `.nullsFirst()`
  needed: `teacherId`, `createdAt` and `id` are all `NOT NULL` (confirmed: `_shared.ts:16` for
  `createdAt`, `id()`/`teacherId()` are primary/foreign keys), so default NULLS ordering never
  applies and the plain `desc()` the query already uses (`chunks.ts:386`,
  `.orderBy(desc(documents.createdAt), desc(documents.id))`) matches the index's native order
  exactly with no extra annotation.
- `packages/db/src/migrate.ts` — two new `POST_MIGRATE_STEPS` entries, appended at the end (never
  edit past entries, per the file's own comment):
  1. `{ kind: 'concurrentIndex', indexName: 'documents_teacher_id_created_at_id_idx', sql:
     'CREATE INDEX CONCURRENTLY IF NOT EXISTS "documents_teacher_id_created_at_id_idx" ON
     "documents" USING btree ("teacher_id","created_at" DESC,"id" DESC)' }` — `documents` already
     gets its indexes built this way (8.2p's own comment: a plain `CREATE INDEX` would hold
     `documents`'s `ACCESS EXCLUSIVE` lock for the whole build inside drizzle's one-transaction
     migration run).
  2. `{ kind: 'validateConstraint', table: 'documents', constraint:
     'documents_failure_reason_only_when_failed' }`.
  Extend the file's big top comment with one line naming migration 0041 and both steps (matching
  every prior entry's style).
- `packages/db/migrations/0041_<slug>.sql` (new; exact name decided by the builder, e.g.
  `0041_documents_list_index_failure_reason_validate.sql`) — hand-edited, comment-first (follow
  0033's and 0040's header-comment style exactly), body:
  ```sql
  -- Hand-edited (task 8.2r, 8.2a review deferral): ...
  ALTER TABLE "documents" DROP CONSTRAINT "documents_failure_reason_only_when_failed";--> statement-breakpoint
  ALTER TABLE "documents" ADD CONSTRAINT "documents_failure_reason_only_when_failed" CHECK ("documents"."failure_reason" is null or "documents"."status" = 'failed') NOT VALID;
  ```
  No `CREATE INDEX` statement in this file at all — same as 0040, which is comment-only because
  its index is built entirely by the post-migrate step. Generate the skeleton with
  `corepack pnpm --filter @edmate/db exec drizzle-kit generate` after the `content.ts` edit (it
  will emit the new index as a plain, non-concurrent `CREATE INDEX` plus update
  `meta/0041_snapshot.json` and `meta/_journal.json`); then **delete the generated plain
  `CREATE INDEX` statement** from the `.sql` file (replacing it with the comment above the
  constraint lines) and hand-add the two `DROP CONSTRAINT`/`ADD CONSTRAINT ... NOT VALID`
  statements — `db:generate` produces nothing for the constraint since `content.ts`'s `check()`
  text is unchanged (same exact CHECK expression, only its validity flag and timing change).
  Confirm after editing that `drizzle-kit generate` run again is a no-op (same precedent as every
  other hand-edited migration in this repo).
- `packages/db/migrations/meta/0041_snapshot.json`, `meta/_journal.json` — generated by
  `drizzle-kit generate`, committed as-is (these reflect the schema, not the hand-edited SQL, same
  as every prior hand-edited migration).
- New test file `packages/db/test/documents-list-index.int.test.ts` — item 1, modeled exactly on
  `packages/db/test/eval-runs-gate-passed-index.int.test.ts` (same `postgresUp`/`throwawayName`
  harness, same `set local work_mem = '64kB'; set local random_page_cost = 1.1;` trick to make the
  planner prefer the new index over a small fixture's sequential scan — this index is not partial,
  so a bigger fixture alone might still work, but keep the proven trick for determinism):
  - Seed one teacher with ~400+ documents spread across distinct `created_at` values (and a second,
    unrelated teacher's documents, so a plan that ignored `teacher_id` would be visibly wrong),
    `analyze documents`.
  - `it('creates the documents_teacher_id_created_at_id_idx index')` — read `pg_indexes`, assert
    the `indexdef` matches `/\(teacher_id, created_at DESC, id DESC\)/` (Postgres omits "NULLS
    LAST" / "NULLS FIRST" for a `NOT NULL`-irrelevant default the same way the eval_runs test's
    comment explains).
  - `it('accesses documents through the new index for a query shaped like listForTeacher')` —
    `EXPLAIN` (inside `BEGIN`/`ROLLBACK`, no data mutation) the exact shape of `chunks.ts`'s query:
    `select ... from documents where teacher_id = $1 order by created_at desc, id desc limit 500`;
    assert the plan contains `documents_teacher_id_created_at_id_idx`, matches `/Index( Only)?
    Scan/`, and does not contain `Sort`.
- New test file `packages/db/test/documents-failure-reason-validate-migration.int.test.ts` — item
  2, modeled on `packages/db/test/document-status-migration.int.test.ts`'s `folderBefore`/
  `migrateWith` pattern (migrate up to the journal entry *before* `0041_*`, insert rows that
  exercise both sides of the constraint — one `ready` row with `failure_reason` null, one `failed`
  row with a `failure_reason` set — then migrate the rest of the way):
  - `it('keeps existing rows valid across the drop-and-reinstate')` — both pre-existing rows are
    still readable with their same `status`/`failure_reason` after migrating forward (the
    `DROP`/`ADD ... NOT VALID` never touched data).
  - `it('the constraint is validated (not just present) after migrateDatabase')` — query
    `pg_constraint.convalidated` for `documents_failure_reason_only_when_failed`, assert `true`
    (proves the post-migrate `VALIDATE CONSTRAINT` step ran, not just the `NOT VALID` add).
  - `it('still rejects a failure_reason on a non-failed row after the migration')` — insert attempt
    with `status = 'ready', failure_reason = 'x'`, expect the insert to throw (constraint still
    enforced, same as before 0041 — proves nothing was weakened).
  This directly answers the accept line's "applies cleanly on a fresh and a migrated database":
  "fresh" is covered by every other int test's own `beforeAll` (`migrateDatabase` from empty), and
  this file's `folderBefore` step is the "already migrated [past 0017, before 0041]" case.

## Files out of bounds
- `packages/db/src/repositories/chunks.ts` — **no change**. `listForTeacher`'s existing
  `.orderBy(desc(documents.createdAt), desc(documents.id))` (after its `eq(documents.teacherId,
  teacherId)` filter) already matches the new index's column order exactly; the accept line is met
  by the index alone. Confirmed by reading the function in full
  (`chunks.ts:370-389`). This also means 8.2q's concurrent edits to `chunks.ts` (and the worker
  ingest sweep) cannot conflict with this task.
- `packages/db/src/repositories/ports.ts` — untouched (6.3d's file; this task never opens it).
- Any other migration file — forward-only; 0017 itself is never edited in place.
- No apps/web or apps/worker changes; this is a `packages/db`-only task.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
None of this task's files literally match a listed glob (`packages/db/src/schema/content.ts` and
`packages/db/src/migrate.ts` are not under `packages/db/src/repositories/**` or
`packages/db/src/identity/**`, the only `packages/db` globs listed). **But** `merge_gate.py`'s own
migration-content scan (`merge_gate.py:58-59`, independent of risk-paths.txt — see its file header
and the risk-paths.txt footer note) flags any migration file matching
`ALTER\s+TABLE\b[^;]*?\bDROP\b` or a bare `DROP CONSTRAINT` as "drops or deletes data", which our
`0041_*.sql`'s `ALTER TABLE "documents" DROP CONSTRAINT ...` will match. **This makes the PR risky
via `MIGRATION_REVIEWERS = ("database-reviewer",)`, not via a risk-paths.txt glob.** `review.md`
must name `database-reviewer` as a reviewer, and the handoff's `## Decisions` needs a `risk: high`
entry per the merge gate's rule for any risky PR (even though nothing is actually deleted — it's a
constraint drop-and-reinstate, not a data loss; database-reviewer should confirm that reading).

## Tests first (red before green)
1. Write `documents-failure-reason-validate-migration.int.test.ts` against the *unmodified*
   migrations folder first (no `0041` yet) — expect `folderBefore('0017_document_status')` +
   forward `migrateWith(MIGRATIONS_DIR)` to leave `convalidated` true already (it's the same
   before/after this task, since 0017's original `ADD CONSTRAINT` was never `NOT VALID` in the
   first place) — this confirms the *baseline* is unaffected until `0041` exists, then add `0041`
   and re-run to confirm the DROP/ADD/VALIDATE sequence still lands at `convalidated = true` and
   the two pre-existing rows survive.
2. Write `documents-list-index.int.test.ts`'s first assertion (`pg_indexes` lookup) against the
   unmodified schema first — expect it to fail (`def` is `undefined`, the index doesn't exist yet)
   — then add the `content.ts` index and the `migrate.ts` post-migrate step and re-run to green.
3. Run the full `@edmate/db` int suite once both files are green, to catch any snapshot/journal
   drift from `drizzle-kit generate`.

## Test commands (no docker/psql; shared dev Postgres assumed already running, per precedent gates
in `docs/tasks/8.2a/handoff.md`'s "against the shared dev Postgres")
- `corepack pnpm --filter @edmate/db exec tsc --noEmit -p .`
- `corepack pnpm --filter @edmate/db exec vitest run test/documents-list-index.int.test.ts test/documents-failure-reason-validate-migration.int.test.ts`
- `corepack pnpm --filter @edmate/db exec vitest run test/migrate.int.test.ts test/document-status-migration.int.test.ts` (regression: the new post-migrate steps must not break the existing migration/migrate-twice tests)
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` (full package gate)
- `corepack pnpm exec prettier --check` on every changed file
- `python3 .githooks/secret-scan.py --all`
- `python3 .claude/skills/merge-gate/merge_gate.py 8.2r`

## Risks
- CONCURRENTLY index build can't run inside drizzle's migration transaction (already solved by the
  existing `runPostMigrateSteps` machinery — no new risk, just following precedent).
- `isIndexInvalid`/`isConstraintValidated` already make every step idempotent on retry; no new
  idempotency work needed.
- A migration-number collision with another task landing first — mitigated by the re-check
  instruction above; low probability given today's board state.

## Open questions
None — the plan is fully determined by existing precedent (0033, 0040, the `POST_MIGRATE_STEPS`
comment, `eval-runs-gate-passed-index.int.test.ts`, `document-status-migration.int.test.ts`). No
ADR, no contracts change, no decision needed from the lead beyond the standard risky-PR sign-off.

## Budget
Budget: 45 tool calls (1 phase, packages/db only)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm drizzle-kit generate, vitest, tsc, eslint, prettier,
secret-scan, merge_gate.py — no docker/psql directly)

## Exit conditions
Status: DONE when both new int test files are green against the shared dev Postgres, the full
`@edmate/db` typecheck/lint/test gate passes, `drizzle-kit generate` is confirmed a no-op after the
hand-edit, and the migration-number re-check at build time still shows `0041` (or the next free
number, noted in the handoff) free. Status: PARTIAL past ~45 tool calls, or if the shared dev
Postgres is unreachable (write the handoff and stop rather than fabricating a passing run), or if
`0041` turns out to collide with another task's merged migration (re-number and note it rather than
guessing which one is "right").
