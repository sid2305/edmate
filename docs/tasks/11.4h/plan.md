
# 11.4h plan — 11.4e review follow-ups (database guard + two test fixes)

## Acceptance (verbatim)
"a raw insert of a cross-teacher document/live class link fails; the cap test's arithmetic
matches its name; db typecheck, lint and test green."

How shown: gate output below (db typecheck/lint/test green) plus the handoff quoting the new
test that proves a raw cross-teacher insert now throws a foreign-key error, and the cap test's
name/assertions matching after clearing teacher A's earlier linked documents.

## Recommendation: composite FK, not a trigger
The repo has zero `CREATE TRIGGER`/`CREATE FUNCTION` in any migration — a trigger would be a new
pattern needing its own review scrutiny (procedural code, error message shape, idempotency on
replay). A composite FK is a direct extension of the existing NOT VALID → VALIDATE pattern
(migrations 0009, 0023, 0024; `packages/db/src/migrate.ts` `POST_MIGRATE_STEPS`), and the repo
already has the exact precedent for a composite FK referencing a composite *unique index* (not a
named UNIQUE constraint) on a second table: migration 0009's `sessions_package_version_fk`
references `package_versions(package_id, version)`, which is only a `uniqueIndex` in
`schema/agents.ts` (`package_versions_package_id_version_key`) — Postgres accepts a plain unique
btree index as an FK target. **Recommendation: composite FK `(documents.teacher_id,
documents.live_class_id)` → `live_classes(teacher_id, id)`**, needing a new unique index
`live_classes_teacher_id_id_key` on `(teacher_id, id)`.

`live_classes` is small (a teacher's own scheduled classes, same order of magnitude as
`documents`, which migration 0024 already built a plain, non-concurrent partial index on with the
same "table is small" reasoning) — so the new unique index and the FK's `NOT VALID` add both run
as plain statements inside the migration file's transaction; only `VALIDATE CONSTRAINT` (the scan)
runs as an autocommit post-migrate step, same as every other NOT VALID constraint in this repo.

## Files to create
- `packages/db/migrations/0033_document_live_class_teacher.sql` — run `corepack pnpm --filter
  @edmate/db db:generate` first off the schema changes below to get the journal entry and
  `meta/0033_snapshot.json` right, then hand-edit the generated `.sql` (same "hand-edited"
  pattern as 0024/0032):
  1. `CREATE UNIQUE INDEX "live_classes_teacher_id_id_key" ON "live_classes" USING btree
     ("teacher_id","id");` (plain, not CONCURRENTLY — table is small; comment why).
  2. `ALTER TABLE "documents" DROP CONSTRAINT "documents_live_class_id_live_classes_id_fk";`
  3. `ALTER TABLE "documents" ADD CONSTRAINT
     "documents_teacher_id_live_class_id_live_classes_fk" FOREIGN KEY ("teacher_id",
     "live_class_id") REFERENCES "public"."live_classes"("teacher_id","id") ON DELETE set null
     ON UPDATE no action NOT VALID;`
  Comment: references migration 0009's `sessions_package_version_fk`/`package_versions` precedent
  and 0024's plain-index precedent; notes the old single-column FK's `POST_MIGRATE_STEPS` entry is
  left in place (append-only list) and becomes a no-op once the constraint it names no longer
  exists (`isConstraintValidated` already treats "no such constraint" as nothing to validate).

## Files to modify
- `packages/db/src/schema/operations.ts` — add `uniqueIndex('live_classes_teacher_id_id_key').on(t.teacherId, t.id)` to `liveClasses`'s config array, with a one-line comment that it exists only as the composite FK's target.
- `packages/db/src/schema/content.ts` — on `documents`: drop `.references(() => liveClasses.id, { onDelete: 'set null' })` from the `liveClassId` column (plain `text('live_class_id')`); add `foreignKey({ name: 'documents_teacher_id_live_class_id_live_classes_fk', columns: [t.teacherId, t.liveClassId], foreignColumns: [liveClasses.teacherId, liveClasses.id] }).onDelete('set null')` to the table's config array (import `foreignKey` from `drizzle-orm/pg-core`; `liveClasses` is already imported). Follow the `sessions_package_version_fk` shape in `schema/learning.ts:68-72` exactly.
- `packages/db/src/migrate.ts` — **append** (don't edit past entries) one new `POST_MIGRATE_STEPS` entry: `{ kind: 'validateConstraint', table: 'documents', constraint: 'documents_teacher_id_live_class_id_live_classes_fk' }`, with a one-line addition to the big comment block (task 11.4h, migration 0033).
- `packages/db/test/migrate.test.ts` — the `toHaveLength(7)` at line 152 becomes 8; add the new constraint to the `table === 'documents'` expected array (lines 153-161) alongside the existing (now-orphaned but still-listed) `documents_live_class_id_live_classes_id_fk` entry.
- `packages/db/test/documents.int.test.ts`, inside `live-class recordings (11.4a)`:
  - **Cap test** (`caps listRecordingsForTeacher...`, line 785): before the `generate_series` insert, `delete from documents where teacher_id = $1 and live_class_id is not null` for `RA` (clears `doc_rec_own`/`doc_rec_replace`/`doc_rec_nomat`/`doc_rec_search`/`doc_rec_list1` created by earlier tests in this block) so the 501 cap-test rows are the *only* linked documents teacher A has; no restore needed (no later test depends on them). This makes "dropping only the oldest" literally true.
  - **Cross-teacher test** (lines 804-822): the FK now refuses this raw insert outright, so the existing "insert then check join excludes it" shape no longer runs (the insert itself throws). Rewrite it to assert the insert is refused: `await expect(raw.query(... into live_class_id = LC_B for teacher A ...)).rejects.toThrow(/foreign key/)`, matching the style already used in `document-live-class-migration.int.test.ts:101-103`. This directly satisfies the board accept criterion and makes the old "teacher-B half is only a sanity check" LOW finding moot by removing that half entirely (no row is ever created, so there is nothing left to check against teacher B's list) — note this in the handoff rather than leaving a stale comment.

## Decisions to log in the handoff
- Composite FK over trigger, with the precedent above (not an open question — a clear call per the plan; still log it as a decision, `risk: low`).
- Rewriting the cross-teacher test's shape (insert-then-check → insert-is-refused) rather than keeping a parallel "still checks the join" test, since the scenario it guarded can no longer be constructed once the FK exists.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- None of `packages/db/src/schema/**`, `packages/db/src/migrate.ts`, `packages/db/migrations/**`
  or `packages/db/test/**` appear on any risk-paths.txt glob (the only `packages/db/**` entries
  listed are `packages/db/src/identity/**` and `packages/db/src/repositories/**`, both untouched
  here — no repository file changes, only schema/migration/test).
- Still risky by `merge_gate.py`'s own rule, not a path glob: **a migration that alters
  constraints on existing tables** needs `database-reviewer`. `Reviewers:` line in `review.md`
  must name `database-reviewer` (plus `code-reviewer`/`typescript-reviewer` as usual). No
  `risk: high` decision needed — this isn't on the risk-paths.txt list and build-plan rule 2
  (ADR-gated paths) doesn't apply (no `packages/contracts` change).

## Tests first
1. Update `migrate.test.ts`'s `POST_MIGRATE_STEPS` assertions first (red: length 7 → 8, missing
   new documents entry) before touching `migrate.ts`.
2. Add/update the two `documents.int.test.ts` cases, run against the dev DB before the migration
   exists, confirm they fail for the right reason (cap test still over-counts; cross-teacher
   insert still succeeds), then land the migration + schema changes and re-run green.
3. Re-run `document-live-class-migration.int.test.ts` unchanged — its `pg_get_constraintdef(oid)
   like '%live_classes%'` query at line ~123 should still match the new composite FK (still
   mentions `live_classes`) with `convalidated: true, confdeltype: 'n'`; confirm rather than
   assume.

## Out of bounds
`apps/cli/**` (another builder's task), `apps/web/**`, `packages/harness/**` (both reserved).
No repository-file changes (`packages/db/src/repositories/**`) — the join predicate in
`live-classes.ts` stays as-is; this task is defense-in-depth only.

## Gate
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
```
Plus `corepack pnpm --filter @edmate/db db:generate` once, to scaffold 0033 before hand-editing,
and a diff check afterward that `db:generate` run again is a no-op (same check the existing
hand-edited migrations rely on).

## Budget
Budget: 40 tool calls (1 phase, packages/db only)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (db:generate, the gate commands above, and
`python3 .githooks/secret-scan.py --all` only)

## Exit conditions
Status: DONE when the gate is green, `migrate.test.ts`'s updated counts pass, both
`documents.int.test.ts` changes are proven to fail without the migration and pass with it, and
`document-live-class-migration.int.test.ts` still passes unmodified. Status: PARTIAL past ~40
tool calls, or if `db:generate` wants to touch any file outside `packages/db/migrations/0033_*`
and the two schema files named above (stop and report rather than hand-editing further afield).

## Open questions
None — composite FK vs trigger is resolved above with a concrete recommendation; the exact
migration number may shift to 0034+ if another task's migration lands first, not a blocker.

READY
