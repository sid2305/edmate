# 12.4a handoff: regulated-subject flag and staff approval (12.4 Phase A)

Status: DONE

- Branch: `m12/12.4a-regulated-flag-repo` (built on local `work-124a`)
- Worktree: `.claude/worktrees/agent-a8bbfa1ea7b013a37` (under the repo root)
- Plan: `docs/tasks/12.4/plan.md`, Phase A

## Summary
Staff can now flag an agent's regulated subject (`investing | health | law`) and approve or revoke
it, in the database only. Publish is not blocked yet (that is 12.4b). Three nullable columns on
`agents` (`regulated_subject`, `regulated_approved_at`, `regulated_approved_by` FK users) with two
check constraints, migration `0023_agents_regulated_subject` (generated, plus one hand-added
backfill `UPDATE`), and a new staff-only, audited repository `regulatedSubjects`
(`listForStaff`, `setSubject`, `setApproval`). No contracts change.

## Files
- `packages/db/src/schema/agents.ts`: three columns, `agents_regulated_subject_check`,
  `agents_regulated_approval_check` (approval columns both null or both set; approval needs a subject).
- `packages/db/migrations/0023_agents_regulated_subject.sql`, `meta/0023_snapshot.json`,
  `meta/_journal.json` (appended): `ADD COLUMN` x3, FK, two checks, backfill `UPDATE`. No drop, no delete.
- `packages/db/src/repositories/regulated-subjects.ts` (new): the repository, lock order in its header.
- `packages/db/src/repositories/map.ts`: appended `RegulatedAgentRow` schema and `toRegulatedAgentRow`.
- `packages/db/src/repositories/index.ts`: registered `regulatedSubjects` last; appended exports.
- `packages/db/src/repositories/README.md`: appended "Regulated subjects (12.4)".
- Tests (new): `test/regulated-subjects.test.ts`, `test/regulated-subjects.int.test.ts`,
  `test/regulated-subject-migration.int.test.ts`.
- Tests (appended): `test/repositories.int.test.ts` (three `CASES`), `test/scope.test.ts`
  (grid exclusion for the `by`-first methods), `test/leak.test.ts` (driver errors never carry
  ids or the note).

## Tests
Integration tests ran against a disposable container (`pg-124a-builder`, pgvector 0.8.1-pg16,
127.0.0.1:55491), removed afterwards.

- `TEST_DATABASE_URL=… corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --force`
  → `Tasks: 26 successful, 26 total`; `@edmate/db: Test Files 68 passed (68)`;
  `All files | 99.83 | 98.01 | 99.86 | 99.85`; `regulated-subjects.ts` 42/42 statements,
  20/20 branches, 11/11 functions (clover.xml).
- Isolation grid: `regulatedSubjects.listForStaff public read cases=5 leaks=0`,
  `setSubject cases=10 leaks=0`, `setApproval cases=10 leaks=0`.
- `regulated-subjects.int.test.ts` (16 tests): flag with audit row (actorRole staff, before/after,
  trimmed note as reason); same subject is a no-op that keeps the approval and writes no audit row;
  subject change and clearing clear the approval; approve then revoke (two audit rows); double
  approve and revoke-unapproved are no-ops; approve unflagged is `invalid` with nothing written;
  non-staff / unknown callers `scope` with nothing written; unknown agent `not_found`; two
  concurrent approvals on two connections change once and audit once; concurrent subject change
  and approval serialise; DB check constraints reject bad subject / half-set / subjectless approval
  / unknown approver; list shape, slug join, no personal data, newest-first order and 200 cap.
- `regulated-subject-migration.int.test.ts`: migrates to 0022, seeds agents and versions, runs
  0023: the newest version's subject is copied (an older different one is ignored), a newest
  version without a subject leaves the agent unflagged, an out-of-set value is never copied, all
  backfilled agents are unapproved, no agent or version is lost.
- `regulated-subjects.test.ts`: bad `by`, ids, subjects, notes, extra keys are `invalid` before
  SQL; `REGULATED_SUBJECTS` equals `AgentConfigSchema.shape.regulatedSubject` options.
- `python3 .githooks/secret-scan.py --all` → exit 0.
- TDD note: the tests were written before the repository and migration code, but I ran them
  first only after the implementation existed, so I did not capture a separate red run.

## Decisions

### 22 Oct 2026 · 12.4a Staff-only, audited regulated-subject flag and approval on agents · decided by builder · risk: high
- Decided: `regulatedSubjects.setSubject` / `setApproval` require a current staff user (`lockRole`,
  FOR SHARE) inside the write transaction, then lock the agent FOR UPDATE; anyone else is `scope`
  and nothing is written. Every change writes one `agent.regulated_flag` / `agent.regulated_approval`
  audit row (actorRole `staff`, target `agent:<id>`, the agent's teacher, before/after subject and
  approval, note as reason) in the same transaction; no-ops write nothing. A subject change clears
  the approval; approving an unflagged agent is `invalid`; a repeat approval keeps the first
  approver. `listForStaff` returns ids, the public slug and flag columns only (no name, email or
  phone), newest first, capped at 200. Lock order (user role, then agent) is stated in the file
  header; publish never locks a user row, so there is no cycle. Reviewer: security-reviewer
  (staff-only flag and approve, audited, scoped), plus database-reviewer for the lock order.
- Why: plan Phase A and the lead answers (Q1, Q5); the 12.5a staff pattern; lessons on lock order.
- risk: high

### 22 Oct 2026 · 12.4a Migration 0023 adds the columns and backfills the subject from the newest version · decided by builder · risk: high
- Decided: migration `0023_agents_regulated_subject` adds three nullable columns, an FK to users
  and two check constraints, then one hand-added `UPDATE agents … FROM (SELECT DISTINCT ON
  (agent_id) … ORDER BY agent_id, version DESC)` that copies the newest version's
  `config->>'regulatedSubject'` when it is `investing`, `health` or `law`. Backfilled agents are
  unapproved. Nothing is dropped or deleted. The `ALTER TABLE`s take an ACCESS EXCLUSIVE lock on
  `agents` for the migration transaction and the `UPDATE` row-locks only flagged agents inside it;
  pilot data has none, so the window is negligible. Reviewer: database-reviewer (backfill UPDATE,
  check constraints, locks).
- Why: lead answer Q3 (backfill, start unapproved); an out-of-set value is filtered so the new
  check constraint can never fail the migration.
- risk: high

### 22 Oct 2026 · 12.4a Staff list row has no teacher id · decided by builder · risk: low
- Decided: the list row carries exactly the plan's fields (agent id, teacher slug, status,
  liveVersion, subject, approvedAt, approvedBy); no teacher id. The slug is null when a teacher
  has no profile.
- Why: follow the plan's field list; 12.4d can ask for more if the page needs it.
- risk: low

## Left to do
- 12.4b: publish refuses flagged-unapproved agents at `startRun` and `goLive`; the column becomes
  the only source of the version's `regulatedSubject`.
- 12.4c / 12.4d: staff API and page.

## Fix round 1

Fixed the DB HIGH from review (findings scratchpad, 22 Oct 2026): migration 0023's new FK and both
CHECK constraints were added without `NOT VALID` / a `POST_MIGRATE_STEPS` entry, so their full
validation scan of every existing `agents` row (plus the backfill UPDATE) ran under drizzle's
single-transaction ACCESS EXCLUSIVE lock on a hot table. The MEDIUM (`listForStaff`'s unindexed
sort) is deferred, untouched.

- `packages/db/migrations/0023_agents_regulated_subject.sql`: the FK and both CHECK constraints
  are now added `NOT VALID`; the backfill UPDATE is unchanged.
- `packages/db/src/migrate.ts`: appended three `validateConstraint` steps for
  `agents_regulated_approved_by_users_id_fk`, `agents_regulated_subject_check` and
  `agents_regulated_approval_check` to `POST_MIGRATE_STEPS` (same pattern as 0009 / task 3.16b);
  updated the doc comment.
- `packages/db/test/regulated-subject-migration.int.test.ts`: the final migrate call now uses
  `migrateDatabase()` (not bare `migrate()`), so the post-migrate step runs; added a test
  asserting `convalidated = true` on all three new constraints via `pg_constraint`.
- `packages/db/test/migrate.test.ts`: updated the `POST_MIGRATE_STEPS` shape assertion
  (3 `validateConstraint` entries → 6, with the new three for `agents`).
- No new migration number: 0023 had not yet shipped past review, so editing it in place follows
  the 0009 precedent (that migration's own `NOT VALID` + `POST_MIGRATE_STEPS` fix was made in the
  same migration file, not a later one, since forward-only applies to merged/applied migrations).
- No drizzle snapshot/journal change needed: the schema file (`src/schema/agents.ts`) already
  declares the FK and CHECKs as plain (non-`NOT VALID`) constraints, and `NOT VALID` is a DDL-time
  property drizzle's snapshot diff doesn't model — the 0009 precedent made the same hand-edit
  with no snapshot change, keeping `db:generate` a no-op (comment in migrate.ts).
- Merged `origin/main` first (additive conflicts only, in `packages/db/src/repositories/index.ts`
  and `map.ts`, from the 12.2a reports repository landing on main after this branch forked); kept
  both sides.

### 22 Oct 2026 · 12.4a Migration 0023's new constraints validate outside the migration transaction · decided by builder · risk: high
- Decided: the FK and both CHECK constraints in `0023_agents_regulated_subject.sql` are added
  `NOT VALID`, and validated by three new `POST_MIGRATE_STEPS` entries in
  `packages/db/src/migrate.ts` (`validateConstraint`), run as autocommit steps after
  `migrateDatabase()` commits — the same pattern 0009 (task 3.16b) used for the sessions
  package-pin constraints. The backfill UPDATE in 0023 is unchanged; it still runs inside the
  migration transaction, row-locking only the flagged agents it touches, not the whole table.
  Reviewer: database-reviewer.
- Why: fix brief and review findings (scratchpad `124a-findings.md`, DB [HIGH]); the project's own
  precedent (migration 0009 / `packages/db/src/migrate.ts` `validateConstraint`).
- risk: high

### Tests (fix round 1)
- `corepack pnpm vitest run test/migrate.test.ts` → 22 passed.
- Against a disposable Postgres container (pgvector 0.8.1-pg16, `edmate-124a-pg`,
  127.0.0.1:55499, removed after):
  `TEST_DATABASE_URL=… corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` →
  `Tasks: 26 successful, 26 total`, coverage `All files | 99.83 | 97.83 | 99.86 | 99.85`.
  `corepack pnpm vitest run test/regulated-subject-migration.int.test.ts test/migrate.int.test.ts`
  → `Test Files 2 passed (2)`, `Tests 16 passed (16)`, including the new
  `validates the three NOT VALID 0023 constraints outside the migration transaction` test.
- `python3 .githooks/secret-scan.py --all` → exit 0.

Tool calls used: 134 (harness count: 72 build + 62 fix; the builders reported 50 + 31)
