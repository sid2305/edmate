# Handoff: 12.3d

Status: DONE

## Summary

B-63: a repeat-infringer flag. A teacher with 3+ upheld copyright takedowns in any rolling 12
months is flagged for staff review; nothing is automatic, and "suspend" reuses the existing
`setVerification` reject write path with no new write code, table or column.

- `apps/web/app/api/staff/repeat-infringers/handlers.ts` (new) — `REPEAT_INFRINGER_THRESHOLD` (3),
  `REPEAT_INFRINGER_WINDOW_DAYS` (365) and `REPEAT_INFRINGERS_MAX_LIMIT` (50) as code constants.
  `listRepeatInfringersForStaff(repos, by, now)` groups `takedowns.listActiveForStaff` rows by
  teacher, keeps only `category === 'copyright'` rows within the window, flags teachers with
  `>= 3` such rows, looks each up via `teacherProfiles.findBySlugForStaff`, drops any already
  `rejected`, enriches with `enrichQueueRows` (reused from `verifications/handlers.ts`) and
  returns `LookupItem[]` sorted by slug, capped at 50. `createStaffRepeatInfringersHandlers`
  exposes a `list` handler mapping `RepositoryError` scope/invalid to 403 and everything else to a
  500 `provider_error`, logging only the error's constructor name.
- `apps/web/app/api/staff/repeat-infringers/route.ts` (new) — `GET` only, guarded with
  `withRole(['staff'], ...)`; no `POST` (suspension goes through the existing
  `/api/staff/verifications` `decide` route).
- `apps/web/app/api/staff/repeat-infringers/route.test.ts` (new, written first — red/green) — 20
  tests: constants, `listRepeatInfringersForStaff` unit cases (flags 3-in-window; excludes 2-only,
  a >365-day-old 3rd takedown, non-copyright category, an already-rejected teacher, a null slug;
  caps at 50 sorted by slug), GET handler shape/empty/403/error-code-mapping/no-PII-on-throw, the
  real guard/`ROUTE_POLICY`, and the route's export shape (no `POST`).
- `apps/web/app/api/staff/repeat-infringers/route.int.test.ts` (new) — real-Postgres test gated on
  `TEST_DATABASE_URL` (skipped locally, confirmed via the "SKIPPED" log line). Stands in for the
  plan's manual check: seeds 4 teacher scenarios (3-in-window copyright → flagged; 2-only; 3 with
  one lifted; 3 but already rejected → all not flagged), using `agent`-kind takedowns (a trivial
  raw-SQL `agents` row) to avoid the document/course/module ownership chain. A second test calls
  `teacherProfiles.setVerification({status: 'rejected'})` directly (the existing reject path) on
  the flagged teacher and asserts they drop off the list — covering "flag → suspend → drop off".
  A third test checks non-staff 403 / signed-out 401.
- `apps/web/app/staff/repeat-infringers/client.ts` (new) — `loadFlagged`, reusing
  `LookupItemSchema`/`LookupItem` from `../client` (no new schema: the reply is shape-identical to
  a verification lookup item, including `verificationStatus`).
- `apps/web/app/staff/repeat-infringers/client.test.ts` (new) — 5 tests: success GET, network
  failure never rejects, non-2xx error code mapping, unreadable JSON, wrong-shape 200.
- `apps/web/app/staff/repeat-infringers/view.tsx` (new) — `StaffRepeatInfringersView`, a trimmed
  `StaffQueueView` (no lookup form) reusing `VerificationRow`/`decide`, with its own `en.json`
  namespace plus reused `staff.approved`/`rejected`/`rejectedSafety`/`errors.*` keys.
- `apps/web/app/staff/repeat-infringers/view.test.tsx` (new) — 10 tests incl. 3 jest-axe checks
  (list/empty/fallback), reject-removes-row, decide failure keeps the row, a pending decide
  disables the row, and a failed reload keeps the fallback.
- `apps/web/app/staff/repeat-infringers/page.tsx` (new) — `/staff/repeat-infringers`, guarded with
  `requireRole(['staff'])` before any read, reading through the same
  `listRepeatInfringersForStaff` helper the API route uses (so the page and API can never drift),
  with a console-only error-name fallback.
- `apps/web/app/staff/repeat-infringers/page.test.tsx` (new) — 3 tests: guard-first read, failed
  read falls back (logs only the error name), happy path.
- `apps/web/app/staff/page.tsx` (modified) — a second banner reading `repeatInfringerCount` via
  the same `listRepeatInfringersForStaff` helper, linking to `/staff/repeat-infringers`; hidden on
  a failed read (logs `[staff] page repeat-infringer count read failed: <ErrorName>` only), same
  pattern as the existing safety-alert banner.
- `apps/web/app/staff/page.test.tsx` (modified) — 3 new cases: banner shown with correct text/href
  for 2 flagged teachers, banner absent at 0, banner hidden + error logged on a failed read.
- `apps/web/messages/en.json` (modified, English only, appended not reordered) — `staff.
  repeatInfringersBanner` (plain `{count}` token, not ICU plural — the test suite's
  `getTranslations` mock only does a simple key substitution) and a new top-level
  `staffRepeatInfringers` block (`title`, `intro`, `empty`, `reload`, `reloading`).

Red/green evidence: every new test file was run individually and failed first against a missing
module/export, then passed once the corresponding implementation was written (standard TDD; not
re-included verbatim here to save space). The final full-package run is in `## Gate` below.

## Decisions

### 27 Oct 2026 · 12.3d repeat-infringer flag approval · decided by lead · risk: high
- Decided: approve the new staff-only GET route under apps/web/app/api/staff/repeat-infringers/** and the page under apps/web/app/staff/repeat-infringers/** (risk groups apps/web/app/api/staff/** and apps/web/app/staff/**) for merge. security-reviewer approved with no findings: staff-only through withRole and ROUTE_POLICY, no new write path, the same data the verification queue already shows, bounded lists. code-reviewer approved with three LOWs, deferred to 12.3g.
- Why: it carries out the human's B-63 answer with no table, column or contracts change; "suspend" is the existing reject path (B-46), so current students keep access unless staff tick the existing safety-concern box.

### 27 Oct 2026 · 12.3d review LOWs deferred · decided by lead · risk: low
- Decided: the three code-reviewer LOWs (the `by` typing in handlers.ts, an exact 365-day boundary test, reading listActiveForStaff twice) go to board task 12.3g.
- Why: none changes behaviour today; the MVP rule fixes only CRITICAL and HIGH before merge.

### 27 Oct 2026 · 12.3d repeat-infringer flag design · decided by builder · risk: high

- Decided: threshold (3) and window (365 days) are plain code constants, not a table/config row;
  "upheld" = an active (not lifted) copyright-category takedown inside the rolling window,
  matching 12.3b's `countUpheld` precedent; a teacher already `rejected` is excluded from the
  flagged list; "suspend" is the existing `teacherProfiles.setVerification` reject path reached
  through `/api/staff/verifications`'s `decide` — no new write path, table or column, and no
  `packages/contracts` change. The new page/API GET-only read path lives under
  `apps/web/app/api/staff/**` and `apps/web/app/staff/**` (both risk-paths groups).
- Why: matches the plan's explicit acceptance criteria and open-question answers (pre-accepted by
  the lead), keeps the change read-only and additive, and reuses every existing security boundary
  (role guard, `RepositoryError` mapping, no-PII logging) instead of adding a new one.

### 27 Oct 2026 · 12.3d int-test seeding via agent-kind takedowns · decided by builder · risk: low

- Decided: the Postgres integration test seeds takedowns against `agent`-kind targets (a trivial
  raw-SQL `agents` row with just `id`/`teacher_id`) instead of `document`-kind targets.
- Why: `document` targets need an owned course and module first; `agents` needs nothing beyond a
  teacher id, which keeps the test-only seeding minimal while still exercising the same
  `takedowns` table and `category`/`teacherId` columns the feature reads.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web`
  → `Tasks: 10 successful, 10 total` (typecheck clean, lint "0 errors, 2 warnings" — both
  pre-existing and unrelated to this change, all test files green including the two new test files
  and the int test correctly SKIPPED with no `TEST_DATABASE_URL` set).
- `corepack pnpm exec prettier --check <changed files>` → after one `--write` pass on 6 files with
  trailing-format drift, re-run confirms `All matched files use Prettier code style!`; the
  reformatted test files were re-run directly (`vitest run`, 30/30 passed) to confirm the
  formatting pass didn't change behaviour.
- `python3 .githooks/secret-scan.py --all` → no output, clean.

## Budget

Tool calls used: 101 (harness count: build 101; plan 41 and reviews 43 not included)
