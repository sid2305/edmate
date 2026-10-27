# 12.4e plan: an additive index backing `listForStaff`'s sort on `agents`

## Acceptance (verbatim, from `docs/board/tasks.yaml`)
> per docs/tasks/12.4a/review.md deferred finding; db typecheck, lint and test green.

The deferred finding (`docs/tasks/12.4a/review.md`):
> [MEDIUM] [deferred 12.4e] packages/db/src/repositories/regulated-subjects.ts — listForStaff
> sorts by (created_at desc, id desc) with no backing index on agents.

**How this is shown**: a migration that adds one plain btree index on `agents(created_at, id)`
(ascending — Postgres serves `ORDER BY created_at DESC, id DESC LIMIT 200` with a backward index
scan on an ascending index, no separate `DESC` columns needed), the matching schema-side
`index()` declaration so `db:generate` stays a no-op, and a new integration test that seeds
`agents` rows, runs `EXPLAIN` on a query shaped exactly like `listForStaff`'s, and asserts the
plan uses the new index with no `Sort` node. `corepack pnpm turbo run typecheck lint test
--filter=...@edmate/db` green, including that new test.

## Context read
- `packages/db/src/repositories/regulated-subjects.ts` `listForStaff` (around line 137): no
  `WHERE`, `orderBy(desc(agents.createdAt), desc(agents.id))`, `.limit(REGULATED_LIST_MAX)`.
- `packages/db/src/schema/agents.ts`: `agents` table's only index today is
  `agents_teacher_id_idx`; `...timestamps()` gives it `createdAt`/`updatedAt`, `id()` the text PK.
- `docs/tasks/12.4a/handoff.md` and `review.md`: confirms this is the sole deferred item from
  12.4a, otherwise APPROVE.
- Precedent for **plain, same-transaction** additive indexes on tables the repo judges small
  (not ever-growing per-turn/per-session tables): migration `0024_document_live_class.sql`
  (documents) and `0033_document_live_class_teacher.sql` (`live_classes_teacher_id_id_key`,
  comment: "live_classes is small ... same order of magnitude as documents ... run as plain
  statements"). `agents` is bounded by how many agents a teacher builds — smaller again than
  `documents` or `live_classes` — so the same reasoning applies: a plain `CREATE INDEX` inside
  the migration's transaction, not the `CREATE INDEX CONCURRENTLY` / `POST_MIGRATE_STEPS` pattern
  migration `0032_retention_indexes.sql` uses for `chunks`, `sessions` and `turn_traces` (tables
  that grow with every turn/session, where holding the table lock for a whole migration batch is
  the real risk). **If the builder judges `agents` has grown large enough by build time that this
  no longer holds**, use the `0032` pattern instead (schema-only index + a new `concurrentIndex`
  entry appended to `POST_MIGRATE_STEPS` in `packages/db/src/migrate.ts`, which also means
  updating the shape-assertion test in `packages/db/test/migrate.test.ts`); log that choice as a
  decision either way.
- Model for the test: `packages/db/test/alert-queue-indexes.int.test.ts` — seeds rows, reads
  `pg_indexes` for the index definition, then runs `explain select ... order by ... limit ...`
  and asserts the plan contains the index name and no `Sort` node.
- Migration numbering: the next free number on `main` right now is `0034`, but per the task note
  other branches may land `0034+` first. **Take the next free number at build time** (`ls
  packages/db/migrations/*.sql | sort | tail -1` after merging/rebasing on current `main`), not a
  hardcoded `0034`.

## Files to create/modify
- `packages/db/src/schema/agents.ts`: append
  `index('agents_created_at_id_idx').on(t.createdAt, t.id)` to the `agents` table's index array
  (after `agents_teacher_id_idx`), with a one-line comment pointing at `listForStaff`.
- `packages/db/migrations/00NN_<slug>.sql` (new, number per above): one statement,
  `CREATE INDEX "agents_created_at_id_idx" ON "agents" USING btree ("created_at","id");`
  Generate with `corepack pnpm --filter @edmate/db run db:generate` from the schema change above,
  then check the output matches this exactly (no unrelated diff — if drizzle-kit emits anything
  else, stop and ask).
- `packages/db/migrations/meta/00NN_snapshot.json` and `meta/_journal.json`: produced by
  `db:generate`; do not hand-edit.
- `packages/db/test/agents-staff-list-index.int.test.ts` (new): the test below.
- `docs/tasks/12.4e/handoff.md` (new, at the end): summary, files, test output, `## Decisions`
  (plain-vs-concurrent index choice, migration number used), tool calls used.

## Files out of bounds
- `packages/db/src/repositories/regulated-subjects.ts` — no behaviour change, `listForStaff`'s
  query is unchanged; touching it would pull in `security-reviewer` for no reason (see risky
  paths below). If a typecheck/lint fix forces a touch here, say so in the handoff and keep the
  diff to that line only.
- `packages/db/src/migrate.ts` / `packages/db/test/migrate.test.ts` — only touch these if the
  builder takes the `concurrentIndex` branch above; otherwise leave untouched.
- Everything else in `packages/db` not listed above.

## Test first
Write `packages/db/test/agents-staff-list-index.int.test.ts` before the schema/migration change
(it will fail — no such index — against a migrated throwaway database), following
`alert-queue-indexes.int.test.ts`'s shape:
1. `beforeAll`: `createDatabase` / `migrateDatabase` a throwaway DB, seed ~500 `agents` rows
   (varied `created_at`, via a raw `insert ... select ... from generate_series`, each with its
   own `users` teacher row to satisfy the FK) plus a couple of real rows through
   `repositories.agents` if that repo exists, then `analyze agents`.
2. Test: `pg_indexes` on `agents` contains `agents_created_at_id_idx` with key `(created_at, id)`.
3. Test: `explain select id from agents order by created_at desc, id desc limit 200` — plan
   contains `agents_created_at_id_idx` (`Index Scan Backward` or `Index Only Scan Backward`) and
   no `Sort` node.
4. `afterAll`: drop the throwaway DB.

Run it red first (`corepack pnpm vitest run test/agents-staff-list-index.int.test.ts`) against a
disposable Postgres container (see `test/pg.ts` for how other int tests start one — no docker
compose), then green after the migration + schema change.

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/db/src/repositories/**` → **security-reviewer**, but this plan does not touch any
  repository file (see "files out of bounds" above). If the builder ends up touching one, add
  security-reviewer to `review.md`'s `Reviewers:` line and say why in the handoff.
- `packages/db/src/schema/agents.ts`, `packages/db/migrations/**`, the new test file: not on the
  risk-paths list. The merge-gate note on migrations ("Migrations that drop or delete data are
  risky too") doesn't apply — this migration is a single additive `CREATE INDEX`, nothing
  dropped, deleted or altered.
- Net: **no risky-path reviewer required** by the path list. Still log one `risk: low` decision
  for the index-locking choice (plain vs. concurrent) per CLAUDE.md rule 8, since it's a judgment
  call the spec didn't make — not `risk: high`.

## Open questions
None — the deferred finding, the target index shape and the sort it backs are all stated exactly
in `listForStaff` and the 12.4a review. The only judgment call (plain vs. `CONCURRENTLY`/
post-migrate) is resolved above with a fallback instruction, not left open.

## Gate
```
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/db
python3 .githooks/secret-scan.py --all
```
No docker compose — use the package's own disposable-Postgres test helper (`test/pg.ts`).

## Budget
Budget: 20 tool calls (1 phase, packages/db)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm db:generate, vitest, turbo gate, secret-scan, disposable
Postgres container start/stop only — no docker compose).

## Exit conditions
Status: DONE once the new int test is green, `db:generate` produced no unrelated diff, the full
`@edmate/db` gate (typecheck, lint, test) is green, and the handoff is written. Status: PARTIAL
past ~20 tool calls, or if `db:generate` emits anything beyond the one index (stop and flag it as
a question rather than hand-editing a snapshot), or if the next free migration number is already
contested by a landed branch (rebase once; if it conflicts again, stop and ask).
