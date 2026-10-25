# 13.5 plan — Cost dashboard: AI cost per turn and per active student per package against price

## Acceptance (verbatim, board + build plan)
"numbers match the usage rows." (board `docs/board/tasks.yaml` id `13.5`; title: "Cost dashboard: AI
cost per turn and per active student per package against price"; deps M11, M12, M8, M9, all
merged already.)

## How it will be shown
- `packages/db` test run (`corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`)
  plus the disposable-container int test (`packages/db/test/usage-ledger.int.test.ts`, extended)
  proving the new aggregate read's numbers equal a hand-summed set of seeded `usage_ledger` and
  `subscriptions` rows for a chosen period — this *is* the acceptance line.
- `apps/web` test run showing `GET /api/staff/cost` (fake repo, staff-only) and the new
  `/staff/cost` page/view/client tests (fake backend, no real model or payment calls per rule 4).
- `python3 .githooks/secret-scan.py --all` clean on every phase.

## What already exists (checked before planning; reuse, do not invent a second ledger)
- **The ledger already exists**: `packages/db/src/schema/learning.ts`'s `usageLedger` table (one row
  per provider attempt: `teacherId`, `packageId`, `studentId`, `turnId`, `model`, `tier`,
  `inputTokens`, `outputTokens`, `costMicroUsd`, `status: recorded|unknown|unpriced`, `source`,
  `createdAt`). Written by `packages/queue/src/usageMeter.ts` (the harness `meter` step's queue
  port, task 3.8) and the worker consumer; this task adds **no new table and no new write path**.
- **Per-turn and per-student reads already exist**: `packages/db/src/repositories/usage-ledger.ts`
  (`usageLedgerRepo`) has `listForTurn` (a scope's rows for one turn — cost per turn, today scoped
  to one student x teacher), `sumForStudent` (totals for one student x teacher), and
  `sumForTeacherSince` (one teacher's totals since a date, over every student, excluding `eval`
  rows — the 2.5 monthly cost-alarm read). It also has a precedent for an **unscoped system read**:
  `teacherIdsWithUsageSince(scope: { since })` takes no teacher/student id, like
  `agents.owner` elsewhere — the pattern this task's new staff-wide read follows.
  `costMicroUsd` is already USD-denominated (the cost-alarm and PRD's "$15-30/month" both assume
  USD); the pilot is US-only (decision log, 21 Oct 2026), so no currency conversion is in scope.
- **Price lives in `PackageConfig.pricePerMonth`** (`packages/contracts/src/teacher.ts`, a `Money`:
  `amountMinor` + `currency`), stored in `package_versions.config` jsonb, not a `packages` column.
  `packages.liveVersion` names the version new subscribers get; that version's config is the price
  to show. This task reads it; it does not add a price column (would need a migration and touches
  `package_versions`, read-only here).
- **Active student per package**: `subscriptions` (`packages/db/src/schema/billing.ts`) has one row
  per student x teacher, `status: trial|active|past_due|paused|ended`, `packageVersionId` (not
  `packageId` directly — joins through `package_versions.package_id`). No existing repo method
  counts active subscriptions grouped by package; this task adds one.
- **Staff-only page pattern**: `apps/web/app/staff/reports/{page,view,client}.tsx` (task 12.2e) is
  the template to follow — `requireRole(['staff'])` server page reads once, passes `initialX` as
  `unknown` to a client view that `safeParse`s it, a `client.ts` with a fetch helper the tests can
  inject, a 60 s poll (this page can use a longer interval or none — cost numbers change slowly;
  builder's call, state it in the handoff).
- **Policy already covers it**: `apps/web/src/auth/policy.ts:54`'s
  `{ pattern: '/api/staff/**', methods: ['GET', 'POST'], access: ['staff'] }` already covers a new
  `GET /api/staff/cost` route. **No `policy.ts` edit.**
- **No charts library is a dependency anywhere in `apps/web`** (checked `package.json`) — a plain
  HTML `<table>`, as the brief asks.

## Phase A — packages/db: the two new aggregate reads (no new table, additive-only if a migration lands)
Files:
- `packages/db/src/repositories/usage-ledger.ts` — add `costByPackageSince(scope: { since, until?
  }): Promise<CostByPackageRow[]>`, a **system read like `teacherIdsWithUsageSince`** (staff-wide,
  no teacher/student scope check — the caller, the staff API route, is the access gate), grouped by
  `(teacherId, packageId)`: `calls`, `recorded`, `unknown`, `unpriced`, `costMicroUsd` (sum,
  `recorded` rows only — same `sum()`/`count()` helpers already in the file), `distinctTurns`
  (`count(distinct turn_id)`, for cost-per-turn), excluding `source = 'eval'` (same exclusion as
  `sumForTeacherSince` — eval calls are billed to Edmate, not a teacher's students). Builder confirms
  the exact return shape against `UsageTotals`/`TeacherUsageTotals`'s existing style (same
  `exact()`/bigint-as-text pattern, same zod `Row` schema check).
- `packages/db/src/repositories/subscriptions.ts` — add `activeCountByPackageSince` (name is the
  builder's call) joining `subscriptions` → `package_versions` (on `package_version_id`) to get
  `package_id`, grouped by `(teacherId, packageId)`, counting distinct `studentId` where
  `status <> 'ended'` **at query time** (not scoped to the cost period — see Open question 1).
  Builder checks `subscriptions.ts`'s existing joins/locking helpers first; this is a read, no lock
  needed.
- Builder confirms whether the existing indexes serve the two new group-by queries at pilot scale
  (~500 students): `usage_ledger` has `(teacher_id, created_at)` and `(created_at, source)` already;
  a `(teacher_id, package_id, created_at)` index may help `costByPackageSince`'s group-by-package
  scan. **If added, the migration only adds an index — no drop, no data change** (state this
  explicitly in the handoff, per the brief). Builder skips the migration if `EXPLAIN` against a
  seeded table shows the existing indexes are enough for pilot scale.
- Tests first: `packages/db/test/usage-ledger.int.test.ts` (existing file, extended) — a new
  `describe('task 13.5: costByPackageSince')` seeding rows across two teachers x two packages x a
  mixed `recorded`/`unknown`/`unpriced`/`eval` set, asserting the grouped sums, counts and
  distinct-turn count match a hand count for a chosen `since`/`until` window; a row outside the
  window is excluded; an `eval`-source row is excluded. A matching `describe` in
  `packages/db/test/subscriptions.int.test.ts` (or wherever that repo's existing tests live —
  builder checks first) for `activeCountByPackageSince`: an `ended` subscription is excluded, a
  `trial`/`active`/`past_due`/`paused` one counts once per student even with more than one
  historical row for that pair.

## Phase B — apps/web: the staff cost page and its API route
Files:
- `apps/web/app/api/staff/cost/route.ts` (new) — `GET`, `withRole(['staff'], ...)` (or whatever
  helper the existing `/api/staff/**` routes use — builder checks one, e.g. the reports API route,
  before writing a new pattern), query params `since`/`until` (ISO dates; a small set of presets
  like "last 30 days" is the client's job, not the route's). Calls
  `usageLedger.costByPackageSince` and `subscriptions.activeCountByPackageSince`, joins the results
  by `(teacherId, packageId)` in the route (not a third repo method), reads each package's name
  (`packages.listForTeacher` or equivalent — builder checks what already exists) and its live
  version's `pricePerMonth` (`packageVersions` read), and returns one row per package: `teacherId`,
  `packageId`, `packageName`, `activeStudents`, `costMicroUsd`, `calls`, `unknown`, `unpriced`,
  `costPerTurnMicroUsd` (derived: `costMicroUsd / distinctTurns`, `null` when `distinctTurns` is 0),
  `costPerActiveStudentMicroUsd` (derived: `costMicroUsd / activeStudents`, `null` when 0),
  `pricePerMonth` (the `Money`), `costAsPctOfPrice` (derived, `null` when either side is
  missing/zero — never a divide-by-zero NaN reaching the client).
- `apps/web/app/staff/cost/page.tsx` (new) — `requireRole(['staff'])`, reads a default period
  (e.g. last 30 days) server-side via `serverDatabase().repos...` the same two calls, same
  try/catch-and-log-only-the-name pattern as `staff/reports/page.tsx`, passes `initialRows:
  unknown` to the view.
- `apps/web/app/staff/cost/view.tsx` (new) — `safeParse`s `initialRows` against a new zod row
  schema (client-only, not a contracts change — see Open question 2), renders a plain `<table>`:
  one row per package, columns package/teacher, active students, cost (USD, `costMicroUsd / 1e6`),
  cost per turn, cost per active student, price per month, cost as % of price (flag visibly, e.g.
  bold or a marker, any row over 25% — the PRD's north-star cost target, PRD line 308 — MVP: a
  plain text/class marker, no colour-only signal). A period picker (two date inputs or a small
  preset list) that re-fetches via `client.ts`; the same try/catch/finally-with-busy-flag and
  zod-checked-poll-reply pattern the lessons file calls out (lessons.md: "UI state and server
  replies: trust neither, reset everything") — builder states the reset point for the busy flag and
  for a failed period change explicitly in the handoff.
- `apps/web/app/staff/cost/client.ts` (new) — fetch helper (`loadCost({ since, until })`), same
  shape as `staff/reports/client.ts`, injectable in tests.
- Tests first: `apps/web/app/api/staff/cost/route.test.ts` (fake repo, a non-staff principal is
  `forbidden`, a good staff read returns the joined rows, a repo throw is the fallback — never an
  unhandled rejection), `apps/web/app/staff/cost/{page,view,client}.test.ts` (fake backend only,
  per rule 4 — no real model or payment calls; a malformed `initialRows` is the fallback view, not
  a crash; a divide-by-zero case (0 active students, or a package with no live version/price yet)
  renders `—`/`n/a`, never `NaN`/`Infinity`).

## Files out of bounds
- `packages/contracts/**` — no contracts change (see Open question 2); if the row shape should be
  a shared contract after all, that is an ADR with `architect`, `security-reviewer` and
  `typescript-reviewer`, not this task.
- `packages/queue/src/usageMeter.ts`, `packages/harness/src/pipeline/steps/meter.ts` — the write
  path is untouched; this task only reads the existing ledger.
- 13.4's files (checked against `docs/tasks/13.4/plan.md`, no overlap): `packages/db/src/
  repositories/users.ts`, `packages/db/src/repositories/retention.ts`, any `packages/db/migrations/
  00NN_users_anonymised_at.sql`, `apps/worker/src/retention/**`, `apps/web/src/export/
  accountExport.ts`, `apps/web/src/account/delete.ts`, `apps/web/app/api/me/**`. This task's
  `packages/db` phase touches only `usage-ledger.ts`, `subscriptions.ts` and (maybe) one new
  index-only migration — a different file set.
- `apps/web/src/auth/policy.ts` — not edited (the `/api/staff/**` row already covers the new route).
- `content/locales/**`, `packages/harness/src/guardrails/**` — not touched.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (Phase A: `usage-ledger.ts`, `subscriptions.ts`) —
  **reviewers: security-reviewer** (money/usage-metering group; also catches the subscriptions
  read, already in that same reviewers group).
- `apps/web/app/api/staff/**` (Phase B: `app/api/staff/cost/route.ts`) —
  **reviewers: security-reviewer** (same glob group as `apps/web/src/auth/**` — staff-only access
  must actually be enforced; the new route is an unscoped, cross-teacher read, so a reviewer should
  confirm `withRole(['staff'])`/`requireRole(['staff'])` runs before any repository call).
- If Phase A adds an index-only migration: **database-reviewer**, per risk-paths.txt's note that
  migrations are checked by `merge_gate.py` for drops/deletes, not by path glob — this one only
  adds, so the handoff states that explicitly and names no rollback risk.
- `apps/web/app/staff/cost/**` (page/view/client, not under `app/api/`) is **not** on the risk
  list — a plain staff-facing page, no new write, no money movement (it only reads totals already
  computed from `usage_ledger`/`subscriptions`).
- Every phase's handoff logs a `risk: high` decision per CLAUDE.md non-negotiable 6, naming the
  cross-teacher/money-adjacent read this task adds.

## Open questions (none block Phase A or B from starting)
1. **"Active student" window**: recommendation is "currently active" (`status <> 'ended'` right
   now), independent of the cost period chosen — so a student who churned mid-period still counts
   toward that period's cost total (their calls are real) but not toward "active now." An
   alternative (active *during* the period) is defensible too. Flag to the human; does not block
   either phase — the repo method takes `since`/`until` for cost and a separate, period-independent
   count for "active," and the two are joined by package in the API route either way.
2. **Row shape as a shared type**: this plan keeps the dashboard's row shape as a web-local zod
   schema (`apps/web/app/staff/cost/`), not a `packages/contracts` export, since nothing else in the
   system needs it and a contracts change needs an ADR (non-negotiable 2) this task's brief doesn't
   ask for. Flag to the architect as a candidate for promotion if a second consumer (e.g. a teacher-
   facing cost view) appears later. Does not block.
3. **Price basis when a package has no live version yet, or students sit on more than one historical
   version's price**: recommendation is to show the package's *current* live-version price only
   (MVP; PRD line 286 only asks for "an estimated AI cost per subscriber" shown to the teacher, not a
   per-student weighted price) and render `—` for "cost as % of price" when there is no live version.
   Does not block.
4. **Multi-currency**: out of scope — the pilot is US-only (decision log, 21 Oct 2026), so every
   live package's `pricePerMonth.currency` is expected to be `USD`; the view does not convert. If a
   non-USD package exists in fixtures/seed data, the row still renders (price shown in its own
   currency) but `costAsPctOfPrice` is `null` rather than silently mixing currencies. Does not block.

## Budget
Budget: 75 tool calls (2 phases: A ~35, B ~40; packages/db, apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (migrations, tests, secret scan only)

## Exit conditions
- `Status: DONE` when both phases' tests are green (including the int test proving the dashboard's
  numbers equal a hand-summed set of seeded rows — the acceptance line), the secret scan is clean,
  no real student/teacher/payment data appears in any fixture, and each phase's handoff names its
  `risk: high` decision.
- A phase stops at `Status: PARTIAL` past ~35 (Phase A) / ~40 (Phase B) tool calls with no green
  test run, or if a file outside its own phase's list needs changing (e.g. Phase B discovering
  `policy.ts` actually needs an edit, or Phase A discovering `packages/contracts` needs a new
  field) — hand back to the lead rather than expanding scope.
