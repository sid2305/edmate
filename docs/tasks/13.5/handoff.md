# 13.5 handoff — Cost dashboard: AI cost per turn and per active student per package against price

Status: DONE (Phase A and Phase B both complete).

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

## Phase B

### What changed
- `apps/web/app/api/staff/cost/handlers.ts` (new) — `createStaffCostHandlers`, a GET-only handler
  factory following the `staff/alerts` pattern (simpler than `staff/reports`: no scope check
  needed, since `costByPackageSince`/`activeCountByPackage` are unscoped reads and `withRole`
  is the only access gate). `loadCostRows(repos, { since, until })` and `defaultWindow(nowMs)` are
  exported so the server page can reuse the exact same join logic instead of duplicating it.
  `loadCostRows` joins `usageLedger.costByPackageSince` and `subscriptions.activeCountByPackage`
  by `(teacherId, packageId)` (a union of both result sets — a package with active students but
  no usage yet, or usage but zero currently-active students, still gets a row), then for each
  distinct teacherId calls `packages.listForTeacher({ teacherId })` once (not once per package) to
  get each package's name and `liveVersion`; when a live version exists, `packageVersions.get`
  reads that specific version's name and `pricePerMonth` (overriding the newest-draft name/price
  `listForTeacher` returns — see Decisions, Open question 3). Every derived field
  (`costPerTurnMicroUsd`, `costPerActiveStudentMicroUsd`, `costAsPctOfPrice`) is `null` on a
  zero/missing denominator, never `NaN`/`Infinity`.
- `apps/web/app/api/staff/cost/route.ts` (new) — `GET = withRole(['staff'], handlers.list)`,
  no `policy.ts` edit needed (the existing `/api/staff/**` row already covers it).
- `apps/web/app/staff/cost/page.tsx` (new) — `requireRole(['staff'])` first, then
  `loadCostRows(serverDatabase().repos, defaultWindow(Date.now()))` for the default 30-day window;
  a failed read logs only the error's name and passes `initialRows: null` (the view's fallback).
- `apps/web/app/staff/cost/view.tsx` (new) — `safeParse`s `initialRows` against a web-local zod
  row schema (`client.ts`'s `CostRowListSchema`; not a `packages/contracts` export, per plan Open
  question 2 — nothing else needs this shape yet). Renders a plain `<table>`: teacher, package,
  active students, cost (USD), cost/turn, cost/active student, price/month, cost as % of price —
  any row `>= 25%` (PRD's cost north-star) gets a visible text marker (`(Over 25% of price)`), not
  colour-only. A period picker (two `<input type="date">` plus Apply) and a manual Reload button;
  **no polling** (builder's call, per the plan: cost figures change slowly, and the plan explicitly
  leaves this choice to the builder). Busy flag (`'reload' | 'apply' | null`) resets in `finally`
  on every path — success, a repo-mapped error reply, or a thrown call; a failed Apply keeps the
  user's typed dates and the last good rows (never clears the form or the table on failure).
- `apps/web/app/staff/cost/client.ts` (new) — `loadCost({ since?, until? })`, same
  never-rejects/fixed-error-code shape as `staff/reports/client.ts`.
- `apps/web/messages/en.json` — added a `staffCost` namespace (only locale file in the repo;
  English-only pilot, no completeness check to satisfy for other locales).
- Tests first: `apps/web/app/api/staff/cost/route.test.ts` (fake repos: the join, live-version
  name/price overriding the newest draft, a package with no live version yet, a package with
  active students but no usage, a zero price making `costAsPctOfPrice` null rather than dividing
  by zero, the default-window calculation, a malformed query, a repo throw, an unexpected throw
  logging only the error name), `apps/web/app/staff/cost/{page,view,client}.test.ts` (fake
  backends only, per rule 4 — no real model or payment calls; a malformed `initialRows` is the
  fallback view; Reload/Apply success, repo-error and thrown-call paths each reset the busy flag).

### Decisions

### 25 Oct 2026 · 13.5 the join is a union of cost rows and active-count rows, not cost-rows-only · decided by builder · risk: low
- Decided: `loadCostRows` returns one row for every `(teacherId, packageId)` that appears in
  *either* `costByPackageSince` or `activeCountByPackage`'s results, not only the ones with usage
  in the chosen window.
- Why: a package can have active subscribers with no usage yet in a short window (e.g. a brand-new
  package), or usage from students who have since churned (ended their subscription) — both are
  real states a staff member should see (cost = 0 in the first case, active = 0 in the second),
  not a silently dropped row. The plan's Phase B spec says "joins the results ... in the route" but
  does not say cost-rows-only vs. a union; this is the builder's call it leaves open.

### 25 Oct 2026 · 13.5 the live version's own name/price override the newest draft's · decided by builder · risk: medium
- Decided: `packageName` and `pricePerMonth` on each row come from the package's **live** version
  (`packageVersions.get` at `liveVersion`) when one exists, not from `packages.listForTeacher`'s
  newest-draft config — `listForTeacher` is used only to discover each package's name/liveVersion
  cheaply (one call per teacher) and as the fallback when there is no live version yet.
- Why: the plan's Open question 3 recommends "the package's current live-version price only" —
  the live version is what students are actually paying, so cost-as-% is compared against the
  real price, not a draft that might differ. `risk: medium` (not `low`) because this adds one
  extra `packageVersions.get` call per package-with-a-live-version in the response (bounded by the
  number of distinct packages in the result, not students or usage rows — fine at pilot scale, but
  worth a reviewer's eye since it's an N+1-shaped read inside a staff-only, infrequent-traffic
  route).

### 25 Oct 2026 · 13.5 no polling on `/staff/cost` · decided by builder · risk: low
- Decided: the view has a manual Reload and a period-change Apply, no automatic poll interval.
- Why: the plan explicitly leaves this to the builder ("this page can use a longer interval or
  none -- cost numbers change slowly"); automatic polling would add staleness-race complexity
  (generation refs, pause-while-busy, as `staff/reports`'s view needs) for a dashboard whose
  underlying numbers (usage totals, active counts) change on the order of minutes to hours, not
  seconds — a staff member reloading manually is the simpler, equally correct choice for MVP.

## Gate
- Phase A: `corepack pnpm turbo run build typecheck lint test --filter=...@edmate/db`: green
  except one unrelated, pre-existing flaky test (`test/retrieval-leak.int.test.ts`'s SLO timing
  assertion, `p95 <= 50ms` on a warm cache) that failed once under load from a concurrent
  full-suite run and passed cleanly (25/25) when re-run alone and when the targeted files
  (`usage-ledger.int.test.ts`, `cost-alarm.int.test.ts`, `scope.test.ts`) were run together
  (188/188 passed). Not touched by this task's files.
- Phase B: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web`: green —
  159 test files passed (4 skipped), 2566 tests passed (30 skipped), typecheck and lint both clean.
- `python3 .githooks/secret-scan.py --all`: clean (both phases).

## Left to do
None.

## Budget
Tool calls used (Phase A): 46
Phase B tool calls used: 34
