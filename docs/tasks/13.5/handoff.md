# 13.5 handoff — Phase A (packages/db: cost dashboard aggregate reads)

Status: PARTIAL (Phase A done; Phase B — apps/web staff cost page and API route — left to another
builder, per the brief: another builder is working in `apps/web` right now).

## What changed
- `packages/db/src/repositories/usage-ledger.ts`: added `costByPackageSince(scope: { since,
  until? })`, a **system read** (no teacher/student scope check — the caller, the future staff
  API route, is the access gate), grouping non-`eval` rows by `(teacherId, packageId)`: `calls`,
  `recorded`, `unknown`, `unpriced`, `costMicroUsd` (sum of priced rows), `distinctTurns` (`count
  (distinct turn_id)`, for cost-per-turn). Same `sum()`/`count()`/`exact()` helpers and zod
  `Row`-style check already in the file.
- `packages/db/src/repositories/subscriptions.ts`: added `activeCountByPackage()` (no args — see
  Decisions), a system read joining `subscriptions` → `package_versions` for `package_id`,
  counting distinct `studentId` where `status <> 'ended'`, grouped by `(teacherId, packageId)`.
- `packages/db/src/repositories/index.ts`: exported `CostByPackageRow`, `UsageSinceUntilScope`,
  `ActiveCountByPackageRow`.
- Tests first:
  - `packages/db/test/usage-ledger.int.test.ts`: new `describe('task 13.5: costByPackageSince')`
    — seeds rows across two teachers x two packages x `recorded`/`unknown`/`unpriced` with an
    explicit far-future `since`/`until` window (so the file's own default-`createdAt` seed rows
    never land inside it), asserts the grouped sums/counts/distinct-turn count against a hand
    count, that a row outside the window is excluded, that an `eval`-source row is excluded, an
    unbounded (`until` absent) window, and a malformed scope.
  - `packages/db/test/cost-alarm.int.test.ts`: new `describe('task 13.5:
    subscriptions.activeCountByPackage')` reusing that file's own EXTRA fixtures (paid/ended/
    trial/paused subscriptions) — asserts the ended subscription is excluded and the count matches
    a hand-written raw-SQL count.
  - `packages/db/test/repositories.int.test.ts`: added `CASES` entries for both new methods
    (`scope: 'public'`, like `usageLedger.teacherIdsWithUsageSince`) so the file's own
    exhaustiveness check (`has a case for exactly the methods createRepositories returns`) stays
    green; each `check` sanity-checks shape and (for `costByPackageSince`) malformed-scope
    rejection.
  - `packages/db/test/scope.test.ts`: added an exclusion for `subscriptions.activeCountByPackage`
    in the generic "every method rejects a bad scope" grid, since it takes no argument at all (no
    scope to validate) — same precedent as the file's existing `listLiveForStudent`/
    `safetyAlerts.*` exclusions.

## No migration
No index-only migration was added. The dev Postgres instance in this worktree has no `psql`
client available to run `EXPLAIN` directly, so this was reasoned from the existing index list and
pilot scale instead of measured: `usage_ledger_teacher_id_created_at_idx` and
`usage_ledger_created_at_source_idx` already exist; `costByPackageSince`'s group-by-package scan
has no teacher filter, so it is a sequential-ish scan at pilot scale (~500 students, a few thousand
rows), acceptable for a staff dashboard read (not a hot path). If a future reviewer or load test
shows this needs a `(teacher_id, package_id, created_at)` index, it is additive-only (no drop) —
no rollback risk. Flagged for the human/architect to revisit once real usage volume exists.

## Decisions

### 25 Oct 2026 · 13.5 `activeCountByPackage` takes no scope, named without "Since" · decided by builder · risk: high
- Decided: named the new subscriptions method `activeCountByPackage()` with **no arguments**
  (system-wide, like `usageLedger.teacherIdsWithUsageSince`), not `activeCountByPackageSince` as
  the plan's placeholder name suggested — the open question in the plan already settled that this
  count is "active now," independent of any cost-reporting period, so a `since`/`until` parameter
  would be misleading (it's never used to filter).
- Why: the plan itself names this the builder's call and flags it as not blocking. Going with "no
  args, no misleading name" keeps the method's contract honest; `risk: high` because this is an
  unscoped, cross-teacher read with no caller-side access check (same class of decision as the
  non-negotiable 6 risky-path rule for `packages/db/src/repositories/**` — the future staff API
  route is the only access gate).

### 25 Oct 2026 · 13.5 no index-only migration added in Phase A · decided by builder · risk: medium
- Decided: did not add the `(teacher_id, package_id, created_at)` index the plan floated, reasoning
  from the existing index list and pilot scale (~500 students) rather than a measured `EXPLAIN`
  (no `psql` client in this worktree).
- Why: the plan explicitly allows skipping the migration when existing indexes look sufficient at
  pilot scale; an index-only migration can be added later with no drop/rollback risk if a load test
  says otherwise. `risk: medium` (not `low`) because the reasoning is unmeasured, not a verified
  `EXPLAIN` result — the human/architect should revisit before this read runs at a much larger
  scale than pilot.

## Left to do (Phase B, another builder)
- `apps/web/app/api/staff/cost/route.ts`, `apps/web/app/staff/cost/{page,view,client}.tsx` — see
  `docs/tasks/13.5/plan.md`'s Phase B for the full spec (joins `usageLedger.costByPackageSince` and
  `subscriptions.activeCountByPackage` by `(teacherId, packageId)` in the route, reads each
  package's name and live-version price, renders a plain `<table>`).

## Gate
- `corepack pnpm turbo run build typecheck lint test --filter=...@edmate/db`: green except one
  unrelated, pre-existing flaky test (`test/retrieval-leak.int.test.ts`'s SLO timing assertion,
  `p95 <= 50ms` on a warm cache) that failed once under load from a concurrent full-suite run and
  passed cleanly (25/25) when re-run alone and when the targeted files
  (`usage-ledger.int.test.ts`, `cost-alarm.int.test.ts`, `scope.test.ts`) were run together
  (188/188 passed). Not touched by this task's files.
- `python3 .githooks/secret-scan.py --all`: clean.

## Budget
Tool calls used: 46
