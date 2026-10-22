# 9.2c: public teacher page /teachers/[slug] with packages and the scorecard panel (9.2 Phase C)

Branch: `m9/9.2c-teacher-page` (built on local `work-92c`). Worktree: `.claude/worktrees/agent-ac35a3965025cc3cb`.

## Summary

- `apps/web/app/teachers/[slug]/page.tsx`: async server component (`dynamic = 'force-dynamic'`), anonymous
  access (`requireRole` never called), no client component and no client fetch. A malformed slug
  (same rule as `@edmate/db`'s `Slug`: lower-case hyphenated, 3-60 chars) 404s before any SQL; a `null`
  from `repos.discovery.teacherBySlug` 404s the same way (missing and private look identical). Renders
  name, subject, full bio and languages as plain text, then for each live agent id the live packages
  from `packageVersions.liveForAgent` (unchanged) with a "Choose a package" link to
  `/packages/<agentId>`; an agent whose packages are gone gets no section and no link. Then
  `<ScorecardPanel scorecard={null} />` (no stored scorecard until 8.7, lead Q1). A repository error
  propagates (no try/catch). Nav reuses 9.2b's `publicNav`.
- `generateMetadata`: title `"<name>, <subject> | Edmate"`, description = bio with whitespace
  collapsed, at most 160 characters (cut with an ellipsis); `"Teacher | Edmate"` for a malformed or
  non-public slug (never calls `notFound`). The `teacherBySlug` read is wrapped in React `cache()` so
  metadata and page share one read per request.
- `apps/web/src/discovery/format.ts`: `formatPrice(money, freeLabel, locale?)`: "Free" label at 0,
  otherwise the amount scaled by the currency's own fraction digits from `Intl.NumberFormat`
  (USD 2, JPY 0, KWD 3). Also exports the `Translate` type the components take.
- `apps/web/src/discovery/scorecard.ts`: `PublicScorecard` type, stored-shape schema and
  `toPublicScorecard(raw)`: keeps only `key`, `measured`, `percent` (floored), `pass` per category,
  in canonical order; returns `null` for anything that is not a complete card (missing, duplicate,
  unknown or extra category, percent outside 0-100 / NaN / string, an unmeasured category with a
  percent or a pass, wrong nesting).
- `PackageList.tsx` (public `PackageOffer` fields only; trial only when > 0; no ids in markup) and
  `ScorecardPanel.tsx` (`null` -> "No published scorecard yet."; "Not measured yet" when unmeasured or
  the percent is null; never 0% for missing data).
- `apps/web/messages/en.json`: new top-level `teacherPage` key only.

## Files

- New: `apps/web/app/teachers/[slug]/page.tsx`, `page.test.tsx`;
  `apps/web/src/discovery/{format.ts,format.test.ts,scorecard.ts,scorecard.test.ts,PackageList.tsx,ScorecardPanel.tsx,components.test.tsx}`.
- Modified: `apps/web/messages/en.json` (`teacherPage` only).
- Not touched: `packages/**` (incl. contracts), `apps/web/app/teacher/**`, `apps/web/src/studio/**`,
  `apps/web/src/auth/**`, `apps/web/app/packages/**`, e2e specs.

## Tests

- `corepack pnpm vitest run src/discovery app/teachers` -> `Test Files 7 passed (7)`, `Tests 96 passed (96)`
  (red first: all four new test files failed to resolve their modules before the code existed).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` -> `Tasks: 34 successful, 34 total`.
  `@edmate/web`: 92 files passed (1 pre-existing skip), 1298 tests passed (4 pre-existing skips);
  `src/discovery` coverage 91.1% statements / 90.7% branches / 85.7% functions / 90.9% lines.
  One earlier gate run failed in `@edmate/db#test` with `ECONNRESET` against the shared Postgres
  (int tests; no `packages/db` change here); the rerun was green.
- `python3 .githooks/secret-scan.py --all` -> clean.

## Acceptance (9.2, all phases)

| Item | Evidence |
|---|---|
| Search < 1 s on a 200-teacher seed (CI part) | Phase A `packages/db/test/discovery.int.test.ts` (index check, one statement, loose bound; timings in `docs/tasks/9.2a/handoff.md`). |
| Search < 1 s (end to end, manual) | Phase B steps in `docs/tasks/9.2b/handoff.md`; the timed run is still listed there as left to do. |
| Only public data is reachable | Phase A int tests; Phase B and C page tests: `notFound()` for malformed slugs and for `null` from `teacherBySlug`; `PackageList` and the page render offer fields only (tests assert no `packageVersionId`, package or teacher ids in markup). |
| Server-rendered | `/teachers` and `/teachers/[slug]` are async server components, `force-dynamic`, no client component or fetch; `generateMetadata` gives the title and description. |
| Packages on the teacher page | `app/teachers/[slug]/page.test.tsx`: packages of each live agent from `liveForAgent`, price ("Free" at 0), trial, daily messages, live classes, skills; "Choose a package" -> `/packages/<agentId>`. |
| Teaching scorecard | `scorecard.test.ts` (fail closed, floored percent) and `components.test.tsx` (`null` state, "not measured yet", 99.6 -> 99); page passes `scorecard={null}` (Q1). |
| No contracts change | `git diff origin/main -- packages/contracts docs/adr` is empty. |

## Decisions

### 22 Oct 2026 · 9.2c The teacher page has no rate limit · decided by builder · risk: low
- Decided: `/teachers/[slug]` does not use 9.2b's discovery rate limiter.
- Why: the plan's Phase C does not apply it; a teacher page is one indexed lookup by slug plus at most five package reads, and malformed slugs 404 before any SQL. Adding it later is one call, like `/teachers`.
- risk: low

### 22 Oct 2026 · 9.2c Agents with no live packages left get no section on the teacher page · decided by builder · risk: low
- Decided: when `liveForAgent` returns nothing for one of the teacher's agent ids (a package unpublished between the two reads), that agent gets no package list and no "Choose a package" link; if none have packages, the page says "No packages are available yet."
- Why: a link to an empty compare page is a dead end; the profile read and the package reads are separate statements, so this can happen briefly.
- risk: low

### 22 Oct 2026 · 9.2c An unmeasured scorecard category may not carry a percent or a pass · decided by builder · risk: low
- Decided: `toPublicScorecard` returns `null` for a stored category with `measured: false` and a non-null percent or `pass: true`; a measured category with a null percent (zero cases) shows "Not measured yet".
- Why: 7.8's `buildScorecard` never produces those shapes, so one is corrupt data; failing closed shows "no published scorecard yet" instead of an invented number.
- risk: low

## Left to do

- 8.7e: pass the stored scorecard through `toPublicScorecard` to `ScorecardPanel` (one line in the page).
- Phase B's manual timed run (still open in 9.2b's handoff).
- `PackageCompare`'s private `formatPrice` (fixed `/ 100`) can switch to `src/discovery/format.ts` (9.3b's to do).

Status: DONE

Tool calls used: 59 (harness)
