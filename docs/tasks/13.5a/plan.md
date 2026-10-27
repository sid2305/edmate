# 13.5a plan — 13.5 review LOWs (deferred fixes)

## Acceptance (verbatim, board)
"per docs/tasks/13.5/review.md deferred 13.5a findings; db and web typecheck, lint and test green."

Board title (verbatim): "13.5 review LOWs: usageLedger.costByPackageSince refuses until < since; a
raw-SQL cross-check of teacher B totals in usage-ledger.int.test.ts; /api/staff/cost caps the
since/until span; Promise.all for the per-teacher and per-package reads in
apps/web/app/api/staff/cost/handlers.ts; a scope RepositoryError there maps to 500, not 400;
same-origin hardening for GETs (app-wide, decide with 13.3b)."

## How it will be shown
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=@edmate/web`: green.
- `python3 .githooks/secret-scan.py --all`: clean.
- Each of the five in-scope findings (below) has a new or extended test proving the fix; the sixth
  (same-origin) is wontfix-for-now, not built.

## Findings and what each fix is (all in `docs/tasks/13.5/review.md`, deferred 13.5a)

1. **`usageLedger.costByPackageSince` accepts `until < since`; returns empty, no guard**
   (`packages/db/src/repositories/usage-ledger.ts`). Fix: after parsing the scope, when `until` is
   given and `until <= since` (covers the swap and a zero-width window, not just strictly `<`),
   throw `RepositoryError('invalid', method)` — same kind the route already maps to 400 — instead
   of silently running a query that returns `[]`. Builder's call whether the boundary is `<` or
   `<=`; either closes the finding, state the choice in the handoff. Test first in
   `packages/db/test/usage-ledger.int.test.ts`'s existing `describe('task 13.5: costByPackageSince')`:
   a new case asserting a swapped window and an equal `since`/`until` both reject with
   `{ kind: 'invalid' }`.

2. **Teacher B's totals in `usage-ledger.int.test.ts` are checked only against hand-typed numbers
   in the test, not a raw-SQL cross-check** (`packages/db/test/usage-ledger.int.test.ts`). Fix:
   add a raw-SQL cross-check for teacher B / `PKG_B`'s row in the same window, following the exact
   pattern `packages/db/test/cost-alarm.int.test.ts`'s `task 13.5: subscriptions.activeCountByPackage`
   test already uses for teacher A (a `raw.query` selecting the same aggregate directly off
   `usage_ledger`, compared with `toBe`/`toEqual` against the row `costByPackageSince` returned) —
   sum of `cost_micro_usd` where `status = 'recorded'`, `count(*)`, `count(distinct turn_id)`,
   scoped to `teacher_id`, `package_id`, the window and `source <> 'eval'`.

3. **`/api/staff/cost` has no maximum `since`/`until` span** (`apps/web/app/api/staff/cost/handlers.ts`).
   Fix: a `MAX_SPAN_MS` constant (builder's call on the exact value — a staff dashboard reasonably
   needs up to about a year; state the chosen value and why in the handoff), checked right after
   `Query.safeParse` succeeds and before any repo call; a span over the cap returns `validation()`
   (400), same as any other malformed query. Test first in
   `apps/web/app/api/staff/cost/route.test.ts`: a `since`/`until` pair whose span exceeds the cap
   is 400; a pair just under the cap still succeeds.

4. **Sequential per-teacher and per-package reads in `loadCostRows`**
   (`apps/web/app/api/staff/cost/handlers.ts`). Two loops are sequential today: the per-teacher
   `packages.listForTeacher` loop and the per-package `packageVersions.get` loop (the latter is
   inside the row-building loop, awaited one ref at a time). Fix: run each loop's reads with
   `Promise.all` — build the list of `(teacherId)` or `(teacherId, packageId)` lookups first, await
   them all together, put the results in a `Map`, then build the rows synchronously from the two
   maps (no `await` left inside the row-building loop). The top-level
   `costByPackageSince`/`activeCountByPackage` pair is already parallel (`Promise.all`, line 56 of
   the current file) — this finding is only about the two per-teacher/per-package loops below it.
   Test first: extend `route.test.ts` with a fake-repo case covering two teachers x two
   packages-with-a-live-version, asserting the joined rows are still correct (same values as
   today) after the refactor — a behaviour-preserving change, not a new feature, so the test proves
   "still right," not "now parallel" (timing isn't asserted, per the lessons file's wall-clock
   lesson).

5. **A `scope`-kind `RepositoryError` from `loadCostRows` maps to 400, though the scoped value is
   internal** (`apps/web/app/api/staff/cost/handlers.ts`). The route's own `Query` schema already
   validates `since`/`until` before calling the repo, so a `scope`-kind error here can only mean an
   internal bug (an ill-formed value this route built itself), not bad user input. Fix: the
   `catch` block's 400 branch keeps only `error.kind === 'invalid'`; drop the `|| error.kind ===
   'scope'` so a `scope` kind falls through to `failed()` (500), same as any other unexpected
   repository failure. Test first: extend `route.test.ts` with a fake repo whose
   `costByPackageSince` throws `RepositoryError('scope', ...)`, asserting the route now returns 500
   (`provider_error`), not 400.

6. **Same-origin hardening for GETs (app-wide, deferred to 13.3b)**: wontfix-for-now. 13.3b
   (`docs/board/tasks.yaml`, status `todo`) is the task that decides this app-wide, and it has not
   landed, so this task does not add a same-origin check to `apps/web/app/staff/cost/client.ts` or
   anywhere else. No file changes for this item.

## Files touched
- `packages/db/src/repositories/usage-ledger.ts` — `costByPackageSince`'s `until <= since` guard
  (finding 1).
- `packages/db/test/usage-ledger.int.test.ts` — the new rejection test (finding 1) and the raw-SQL
  cross-check for teacher B (finding 2).
- `apps/web/app/api/staff/cost/handlers.ts` — the max-span cap (finding 3), the `Promise.all`
  refactor of the two sequential loops (finding 4), the `scope`→500 fix (finding 5).
- `apps/web/app/api/staff/cost/route.test.ts` — tests for findings 3, 4 and 5.

No new files. No contracts change, no migration, no edit to `policy.ts`.

## Files out of bounds
- `packages/db/src/index.ts`, `packages/db/src/repositories/{index,audit,redact-json,teacher-profiles,
  messages,sessions,subscriptions}.ts`, `packages/db/src/migrate.ts`, `packages/db/migrations/**`,
  `packages/db/test/repositories.int.test.ts`, `apps/web/src/discovery/**` — other builders' files
  right now; none of the five in-scope findings touches `subscriptions.ts` or any of these.
- `apps/web/app/staff/cost/client.ts`, `apps/web/app/staff/cost/{page,view}.tsx` — the same-origin
  finding is the only one that would touch `client.ts`, and it is wontfix-for-now (see finding 6).
- `apps/web/src/auth/policy.ts` — not edited; the existing `/api/staff/**` row already covers this
  route.
- `packages/contracts/**` — no contracts change; nothing here is a shared type.
- If, mid-build, a fix turns out to need a file outside this list (for example the per-teacher
  `Promise.all` refactor turning out to need a `subscriptions.ts` change), stop and hand back
  `Status: PARTIAL` rather than touching an out-of-bounds file.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (`usage-ledger.ts`) — **reviewers: security-reviewer** (the
  money/usage-metering group). Recommend `database-reviewer` too, as the original 13.5 Phase A
  review used, since this is an aggregate-query correctness fix; not required by risk-paths.txt.
- `apps/web/app/api/staff/**` (`handlers.ts`) — **reviewers: security-reviewer** (the same group as
  `apps/web/src/auth/**`; this route is an unscoped, cross-teacher read, so the reviewer should
  recheck that `withRole(['staff'])` still gates it, and that the kind-mapping fix doesn't leak
  anything new in a 500/400 body). Usual complement: `code-reviewer`, `typescript-reviewer`.
- `apps/web/app/staff/cost/**` (page/view/client) is not on the risk list and is not touched here.
- The handoff logs a `risk: high` decision naming the money/cost-dashboard read this task edits,
  per non-negotiable 6.

## Open questions (none block the build)
1. Exact boundary for the new guard: `until <= since` vs. strictly `until < since`. Recommendation
   above is `<=` (a zero-width window is as useless as a reversed one); builder's call, state it.
2. Exact `MAX_SPAN_MS` value for the new cap. Recommendation: about a year (helps a human; blocks
   nothing in the pilot's data volume); builder's call, state the number and why.

## Budget
Budget: 40 tool calls (1 phase, packages/db + apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (tests and secret scan only)

## Exit conditions
- `Status: DONE` when all five in-scope findings (1–5) have a green test proving the fix, the full
  gate (`turbo run typecheck lint test --filter=...@edmate/db --filter=@edmate/web`) is green, the
  secret scan is clean, finding 6 is recorded as wontfix-for-now pointing at 13.3b, and the handoff
  names its `risk: high` decision.
- `Status: PARTIAL` past about 40 tool calls with findings still open, or if any fix needs a file
  outside this plan's list (hand back to the lead rather than expanding scope).

## Lead amendment (26 Oct 2026)
- Guard boundary: reject `until <= since` (an empty window is a caller error, not an empty result).
- Span cap: 366 days, as a named constant in handlers.ts.
- Reviewers: security-reviewer (required), code-reviewer and typescript-reviewer. database-reviewer
  is skipped: there is no schema or query-shape change, only an argument guard and a test.
