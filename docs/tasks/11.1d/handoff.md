**Status:** DONE (Phase A only)

## Phase A

Adds a `status` column (`scheduled` | `cancelled`, check-constrained) to `live_classes`, plus
`update` and `cancel` repository methods, and fixes the 11.1a/11.1b/11.1c review items in
`packages/db/src/repositories/live-classes.ts`:

- Schema: `liveClasses.status` (`text().notNull().default('scheduled')`) with a
  `live_classes_status_check` constraint (same shape as `eval_runs_status_check`). Additive
  migration `0026_live_class_status.sql` (generated via `db:generate`, not hand-written).
- Link validation is https-only (`HTTPS_URL` regex + `z.url({protocol: /^https$/})`), capped at
  new `LIVE_CLASS_LINK_MAX_LENGTH = 2048`, enforced on both create and the new `update`. Title,
  link and startsAt field schemas are factored into shared `TitleSchema`/`LinkSchema`/
  `StartsAtSchema` used by both `CreateInputSchema` and the new `UpdateInputSchema`.
- New `LIVE_CLASS_LIST_MAX = 500` (precedent: `RECORDING_LIST_MAX`), applied to both
  `listForTeacher` and `listUpcomingForStudent`.
- `listUpcomingForStudent` now uses `.selectDistinct(...)` as defence in depth: the duplicate
  join row is unreachable today (`subscriptions_one_live_per_pair_key`), so this is not a bug
  fix (see Decisions: chose this over an `EXISTS` rewrite).
- `status` added to `TeacherLiveClassRow` and `UpcomingLiveClass`, with a shared exported
  `LiveClassStatus` type. `listUpcomingForStudent`'s WHERE clause is unchanged — a cancelled
  class with a future `startsAt` still appears in the "upcoming" list (status is informational,
  not a filter), per the plan.
- New `update(scope, id, {title, link, startsAt})`: locks the row `FOR UPDATE` by
  `(id, teacherId)`; `not_found` if no matching row (checked before any other validation);
  `invalid` if the row is already cancelled or its own `startsAt` (read from the row, not the
  caller's input) has passed; otherwise updates the row and writes one `live_class.update` audit
  entry (link excluded from the payload, matching `create`'s audit shape).
- New `cancel(scope, id)`: same lock and `not_found` shape; **idempotent no-op** — cancelling an
  already-cancelled class returns `{cancelled: false}` with no write and no second audit row (a
  double-click/retry never surfaces an error); `invalid` if still scheduled but `startsAt` has
  passed; otherwise sets `status = 'cancelled'` and writes one `live_class.cancel` audit entry.
- `README.md`'s "Live classes" section rewritten to document all of the above.

### Gate

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
```
Result: 26/26 turbo tasks successful (typecheck, lint, test across the dependency graph), 0
failures. `@edmate/db:test`: **75 test files passed (75), 0 skipped files**; 1465 tests passed,
4 skipped (pre-existing optional hnsw/recall/video-ingest suites, unrelated to this change — not
newly skipped by this PR). Postgres was reachable at 127.0.0.1:55432 the whole run; no int tests
were skipped for "no Postgres."

```
python3 .githooks/secret-scan.py --all
```
Result: clean, no findings.

### Files

- `packages/db/src/schema/operations.ts` — `liveClasses.status` column + check constraint.
- `packages/db/migrations/0026_live_class_status.sql`,
  `packages/db/migrations/meta/0026_snapshot.json`,
  `packages/db/migrations/meta/_journal.json` — generated via `db:generate`.
- `packages/db/src/repositories/live-classes.ts` — https-only link cap, shared field schemas,
  `LIVE_CLASS_LIST_MAX`, `.selectDistinct` defence in depth, `status` on both row shapes, `update`,
  `cancel`.
- `packages/db/src/repositories/index.ts` — new exports (`UpdateLiveClassInput`,
  `LIVE_CLASS_LINK_MAX_LENGTH`, `LIVE_CLASS_LIST_MAX`, `LiveClassStatus`).
- `packages/db/src/repositories/README.md` — prose update.
- `packages/db/test/live-classes.int.test.ts` (new) — create (http rejected, over-length
  rejected, boundary accepted), update (cross-teacher not_found, missing-id not_found, bad-link
  invalid, past-startsAt invalid, already-passed-class invalid, already-cancelled invalid,
  successful update visible in a fresh `listForTeacher`), cancel (cross-teacher not_found,
  missing-id not_found, already-passed invalid, double-cancel no-op with an audit-row-count
  check before/after), and `listUpcomingForStudent` dedup + cancelled-but-visible cases.
- `packages/db/test/repositories.int.test.ts` — minimal addition (see Decisions below).

## Left to do

- Phase B: apps/web teacher studio (edit/cancel UI for live classes).
- Phase C: apps/web student home (surface cancelled/updated class status).

## Decisions

### 22 Oct 2026 · 11.1d Phase A: live class status, update and cancel in packages/db/src/repositories · decided by builder · risk: high
- Decided: added a `status` column + check constraint to `live_classes`, and `update`/`cancel`
  repository methods with row-level locking, `not_found`-before-other-checks ordering, and an
  idempotent no-op for double-cancel, exactly as specified in the plan's Phase A.
- Why: this is the risky-paths group (`packages/db/src/repositories/live-classes.ts` +
  `README.md`) per the merge gate's risk-paths list; it changes write/audit behaviour on a
  teacher-facing repository method, so it needs security-reviewer (and recommended
  database-reviewer, code-reviewer, typescript-reviewer) before merge.
- risk: high

### 22 Oct 2026 · selectDistinct as defence in depth, not an EXISTS rewrite · decided by builder · risk: low
- Decided: `listUpcomingForStudent` uses `.selectDistinct(...)` rather than a correlated `EXISTS`
  subquery rewrite. This is defence in depth, not a bug fix: `subscriptions_one_live_per_pair_key`
  already makes the duplicate join row unreachable, and the int test passes with plain `.select`
  too (code-reviewer MEDIUM, fix round 1).
- Why: the four selected columns (`id`, `title`, `link`, `startsAt`, now also `status`) are
  identical across duplicate join rows produced by a class matching more than one of a student's
  package ids, so `DISTINCT` collapses them with a one-line change; an `EXISTS` rewrite would
  need to restructure the join and is not needed for correctness here. `ORDER BY` is valid under
  `SELECT DISTINCT` because both ordering columns (`startsAt`, `id`) are already in the select
  list.
- risk: low

### 22 Oct 2026 · Minimal addition to packages/db/test/repositories.int.test.ts despite "do not touch" instruction · decided by builder · risk: low
- Decided: added exactly two new `CASES` entries (`'liveClasses.update'` and
  `'liveClasses.cancel'`) to `packages/db/test/repositories.int.test.ts`, immediately before the
  existing `'liveClasses.listForTeacher'` entry. The cross-teacher (failing) path only reads the
  shared per-teacher fixture class and never writes to it; the positive-control path creates its
  own fresh class, so it does not touch any fixture another test depends on.
- Why: I was told another builder is editing `packages/db/src/repositories/subscriptions.ts` and
  this same file on another branch, and asked to put new int tests in a separate live-classes
  test file instead. I did that for all new regression coverage (see
  `packages/db/test/live-classes.int.test.ts`). But `RepositoryMethod` in
  `repositories.int.test.ts` is a TypeScript mapped type derived structurally from
  `createRepositories(db)`'s actual return shape, and `CASES` is typed as
  `Record<RepositoryMethod, IsolationCase>` — once `update`/`cancel` exist as real methods on
  `liveClassesRepo` (required by the plan), `tsc` fails without a case for each. There was no
  way to satisfy the plan's Phase A scope and the gate's typecheck requirement without this
  small addition; I kept it as minimal and isolated as possible. Flagging this prominently in
  case it collides with the concurrent builder's edits to the same file on its own branch — the
  lead may need to resolve a merge conflict between the two PRs (my addition is two small,
  self-contained map entries, not a structural change, so it should be a low-risk, easy
  resolution either way).
- risk: low

Tool calls used: 92

## Fix round 1

Review findings fixed (22 Oct 2026, builder on Fable):

- **HIGH (security-reviewer)** — the new required `status` on `TeacherLiveClassRow` /
  `UpcomingLiveClass` broke `@edmate/web` typecheck. Added `status: 'scheduled'` to the typed
  fixture literals in `apps/web/src/studio/liveClasses/routes.test.ts` (the `CLASS` row only —
  `VALID_BODY` is a request body and the create schema rejects extra keys),
  `apps/web/app/teacher/live-classes/LiveClassesView.test.tsx` (both literals),
  `apps/web/app/home/view.test.tsx` (7) and `apps/web/app/home/view.intl.test.tsx` (1).
  Deviation from the brief's "test files only": `apps/web/app/teacher/live-classes/LiveClassesView.tsx`
  line 241 also failed typecheck (the optimistic row appended after a successful schedule had no
  `status`). Added `status: 'scheduled' as const` to that one object literal — a newly scheduled
  class is `scheduled` by definition — because the web gate could not go green otherwise. No
  other web source touched.
- **MEDIUM (code-reviewer)** — `.selectDistinct` kept, but the int test title and comment, the
  repositories README line, the handoff summary and the handoff decision now say it is defence in
  depth (the duplicate join row is unreachable today because of
  `subscriptions_one_live_per_pair_key`; the test passes with plain `.select` too), not a bug fix.
- **LOW (database-reviewer)** — migration renamed `0026_military_power_man.sql` →
  `0026_live_class_status.sql`; tag updated in `meta/_journal.json`; `0026_snapshot.json`
  unchanged.

Gate (one package at a time, `--force`):

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force` → 10/10 tasks
  successful; Test Files 143 passed | 4 skipped (147).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --force` → 8/8 tasks
  successful; Test Files 75 passed (75), no file skipped; Tests 1465 passed | 4 skipped (1469)
  (the 4 are the pre-existing in-file skips in recall / retrieval-hnsw / video-ingest).
- Secret scan: the standalone `--all` run was refused by this worktree's command guard (it
  treats the `.githooks/` path as a git command), so the scan ran through the pre-commit hook on
  the fix commit instead (the hook hard-blocks any hit; the commit went through). The lead should
  re-run the `--all` scan from the main checkout before merge.

Fix round tool calls: 18
