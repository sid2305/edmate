# 13.5a handoff — 13.5 review LOWs (deferred fixes)

Status: DONE

## Summary

Fixed the five in-scope findings from `docs/tasks/13.5/review.md`, test first. Finding 6
(same-origin hardening) is wontfix-for-now, deferred to 13.3b, no files touched.

1. **`usageLedger.costByPackageSince` guard** (`packages/db/src/repositories/usage-ledger.ts`):
   after parsing the scope, `until <= since` (swapped or zero-width window) now throws
   `RepositoryError('invalid', method)` instead of silently running a query that returns `[]`.
   Boundary chosen: `<=` (per the lead amendment — a zero-width window is a caller error, not an
   empty result).
   Tests: `packages/db/test/usage-ledger.int.test.ts`, two new cases in
   `describe('task 13.5: costByPackageSince')` — a swapped window and an equal since/until, both
   rejecting with `{ kind: 'invalid' }`.

2. **Raw-SQL cross-check for teacher B / PKG_B** (`packages/db/test/usage-ledger.int.test.ts`):
   added a `raw.query` selecting the same aggregate (calls, recorded/unknown/unpriced counts,
   summed cost, distinct turns) directly off `usage_ledger`, scoped to teacher B / PKG_B / the
   window / `source <> 'eval'`, and compared with `toEqual` against the row `costByPackageSince`
   returned — the same pattern `cost-alarm.int.test.ts`'s `activeCountByPackage` test uses for
   teacher A. Kept alongside the existing hand-typed assertion.

3. **`/api/staff/cost` max span cap** (`apps/web/app/api/staff/cost/handlers.ts`): added
   `MAX_SPAN_MS = 366 * 24 * 60 * 60 * 1000` (per the lead amendment: 366 days, covering a leap
   year so a caller isn't punished for picking Feb 29 as an endpoint), checked right after
   `Query.safeParse` succeeds and before any repo call; a span over the cap returns `validation()`
   (400).
   Tests: `apps/web/app/api/staff/cost/route.test.ts`, `describe('max span cap')` — a span of 367
   days is 400, a span of exactly 366 days still succeeds (200).

4. **`Promise.all` for the per-teacher and per-package reads** (`loadCostRows` in
   `handlers.ts`): the per-teacher `packages.listForTeacher` loop and the per-package
   `packageVersions.get` lookups (previously inside the row-building loop, one await at a time)
   are now each built as a list of lookups, awaited together with `Promise.all`, and put into
   maps (`packagesByTeacher`, `liveByKey`); the row-building loop reads the maps synchronously,
   no `await` left inside it.
   Test: `route.test.ts`, a new case with two teachers x two packages-with-a-live-version,
   asserting the joined rows are still correct (behaviour-preserving; timing isn't asserted).

5. **`scope`-kind `RepositoryError` now maps to 500, not 400** (`handlers.ts`): the catch
   block's 400 branch keeps only `error.kind === 'invalid'`; a `scope` kind now falls through to
   `failed()` (500/`provider_error`), since the route's own `Query` schema already validates
   since/until before any repo call, so a `scope`-kind error here can only be this route's own
   bug.
   Test: `route.test.ts`, a fake repo whose `costByPackageSince` throws
   `RepositoryError('scope', ...)`, asserting 500 `provider_error`.

6. **Same-origin hardening (finding 6)**: wontfix-for-now, per the plan — deferred to 13.3b
   (`docs/board/tasks.yaml`, status `todo`). No files touched for this item.

## Decisions

### 26 Oct 2026 · 13.5a guard boundary and span cap · decided by builder · risk: high
- Decided: used the lead amendment's values verbatim — `until <= since` rejects (not strictly
  `<`), and `MAX_SPAN_MS` is 366 days as a named constant in `handlers.ts`.
- Why: the lead amendment at the end of the plan superseded the plan's own "builder's call" open
  questions; following it exactly avoids a second round of review on a value the lead already
  picked. Flagged `risk: high` per non-negotiable 6 (this task touches the money/cost-dashboard
  read path named in the plan's risky-paths section: `packages/db/src/repositories/**` and
  `apps/web/app/api/staff/**`); required reviewers per the lead amendment are
  `security-reviewer` (required), `code-reviewer` and `typescript-reviewer`; `database-reviewer`
  is skipped (no schema or query-shape change).

## Gate

- `export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH && corepack pnpm install --frozen-lockfile`: clean.
- `export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate && corepack pnpm --filter @edmate/db exec vitest run test/usage-ledger.int.test.ts`: 18 passed (18).
- `corepack pnpm --filter @edmate/web exec vitest run app/api/staff/cost/route.test.ts`: 12 passed (12).
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=@edmate/web`: green
  (one unrelated flake on first run, `test/retrieval-leak.int.test.ts`'s SLO timing assertion —
  not touched by this task; reran that file alone and it passed; a full rerun of the gate after
  the prettier fix below confirmed green end to end — db int tests ran against the live dev
  Postgres, not skipped).
- `corepack pnpm exec prettier --check` on the four changed files: clean (after one `--write`
  pass to fix formatting in the three new-code files).
- `python3 .githooks/secret-scan.py --all`: clean.

## Budget

Tool calls used: 34
