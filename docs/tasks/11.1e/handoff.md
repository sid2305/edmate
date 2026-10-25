# Handoff: 11.1e — live-class review follow-ups

**Status:** DONE

## What changed (Phase A)

`packages/db/src/repositories/live-classes.ts`:
1. `update`'s `live_class.update` audit now reads and writes `link` in both `before` and
   `after`, and `after.startsAt` is normalised with `iso(new Date(i.startsAt))` (matching
   `before.startsAt`'s `iso(row.startsAt)` shape) instead of the raw caller string. The `FOR
   UPDATE` select now also reads `link`. The method's own doc comment updated to match (it no
   longer says `link` is left out of the payload).
2. `listUpcomingForStudent` now returns `link: null` for a cancelled row (previously the link
   stayed, only hidden client-side by the `/home` view).
3. `listForTeacher`'s 500-cap: now orders the query `desc(startsAt), desc(id)` before the
   `.limit(500)`, then re-sorts the kept rows ascending in JS before returning — so classes near
   the cap keep the furthest-out `startsAt`s, not the soonest ones (lead answer, Q1). The teacher
   studio still sees the list soonest-first.
4. Both `listForTeacher` and `listUpcomingForStudent`'s `r.status as LiveClassStatus` casts are
   now a checked `parseStatus()` helper (`z.enum(['scheduled', 'cancelled'])` via the existing
   `parseArg`), reused by both.
5. The stale "Length-capped before the regex so an over-length link fails fast and cheap" comment
   is reworded: the length cap runs first for error-precedence reasons (so the length error, not
   the shape error, reports first), not because zod v4 short-circuits chained checks (it doesn't).

`packages/db/test/live-classes.int.test.ts`:
- "updates title/link/startsAt" test extended with `expect(row?.startsAt).toBe(iso(new
  Date(FUTURE_LATER)))` and a `live_class.update` audit-row count assertion (exactly 1).
- Split "fails invalid on a non-https or over-length link" into two tests: a non-https case and a
  new over-length case (the old test title only exercised http; now both link-validation paths on
  `update` are covered, matching `create`'s own two tests).
- The cancelled-class-still-visible test now also asserts `row?.link` is `null`.
- Added `import { iso } from '../src/repositories/map.js'` (not re-exported from `src/index.js`).

`packages/db/test/repositories.int.test.ts`:
- `'liveClasses.update'`'s `verify` now reads the row back via `listForTeacher` and asserts the
  new title and link landed (not just the `{updated:true}` return shape).
- `'liveClasses.cancel'`'s `verify` now reads the row back and asserts `status === 'cancelled'`.
- No new `CASES` entries; no other repository's case touched.

Item 2 from the "Questions" section (a 501-row int test for the cap) was not added, per the lead's
answer (Q2) — see "Left for Phase B" below for the lighter check considered instead.

## Evidence (Phase A)

```
TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate \
  corepack pnpm turbo run typecheck lint test --filter=@edmate/db
...
 ✓ test/live-classes.int.test.ts (17 tests) 1499ms
 ✓ test/repositories.int.test.ts (182 tests) 8985ms
...
src/repositories/live-classes.ts  100 |  100 |  100 |  100 |
 Tasks:    8 successful, 8 total
```
(int tests confirmed run, not skipped — Postgres reachable at 127.0.0.1:55432, both
`live-classes.int.test.ts` and `repositories.int.test.ts` reported their real test counts, not a
`describe.skipIf` short-circuit line.)

```
python3 .githooks/secret-scan.py --all
```
clean (no output, exit 0).

## Left for Phase B

- The 500-cap fix (item 3) has no dedicated integration test inserting 501+ rows, per the lead's
  Q2 answer. Reasoning instead: the query shape (`orderBy(desc(startsAt), desc(id)).limit(500)`,
  then an ascending JS re-sort of the kept rows) is a small, reversible change whose correctness
  follows directly from the `ORDER BY ... DESC ... LIMIT N` + re-sort pattern already used
  elsewhere in this file (e.g. `listRecordingsForTeacher`'s own `desc(createdAt)` + limit); no
  teacher is near 500 scheduled classes in the pilot.

## What changed (Phase B)

`apps/web/app/teacher/live-classes/LiveClassesView.tsx`:
1. **MEDIUM fix (stale-save guard over-skips).** `saveEdit`'s success branch now applies the
   server's saved values to `c`'s row via `setClasses` unconditionally (so a successful save
   never keeps showing stale pre-edit values until reload, even if another row's edit started or
   this one was discarded while the PUT was in flight). Only `setEditingId(null)` stays guarded
   behind `editingIdRef.current === c.id`, so a save never closes a different row's edit form or
   clobbers `editingId`.
2. **LOW fix (no per-row accessible name).** The Edit and Cancel-class buttons now carry
   `aria-label={t('editButtonLabel', { title: c.title })}` /
   `aria-label={t('cancelButtonLabel', { title: c.title })}`, mirroring the existing join-link
   `joinLinkLabel` pattern. Visible button text (`Edit` / `Cancel class`) is unchanged.

`apps/web/messages/en.json`: added `editButtonLabel: "Edit {title}"` and
`cancelButtonLabel: "Cancel {title}"` inside the existing `liveClassesStudio` namespace (lead
answer Q3: builder's choice of key names).

`apps/web/app/teacher/live-classes/LiveClassesView.test.tsx`:
- Updated the existing Edit/Cancel-class button queries (`row.getByRole('button', { name: 'Edit'
  })` → `'Edit Ratios review'`, `screen.getByRole('button', { name: 'Cancel class' })` →
  `'Cancel Ratios review'`) across the edit/cancel describe block, following the join-link test's
  own precedent of updating the query rather than the visible text.
- Added explicit `toHaveTextContent` assertions (accessible name via `aria-label` + visible text
  unchanged) on the first Edit-flow test and the confirmed-cancel test, mirroring the existing
  join-link assertion shape.
- Added a new test, `"another row's edit starting mid-save still applies the first row's saved
  values (review MEDIUM)"`: starts an edit + save on row 1 (PUT held open), starts an edit on row
  2 while row 1's PUT is still in flight, resolves the PUT, and asserts row 1 shows the saved
  title ("Changed") while row 2's edit form (its `Title` input) is still open — covering both
  halves of the split guard.
- The two `queryByRole('button', { name: 'Edit' | 'Cancel class' })` absence checks (cancelled
  class, already-started class) were left unchanged: they assert the button is entirely absent,
  so the query name doesn't matter there.

## Evidence (Phase B)

```
export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH
corepack pnpm turbo run build --filter=@edmate/web^...
 Tasks:    7 successful, 7 total

corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force
 Test Files  153 passed | 4 skipped (157)
      Tests  2478 passed | 30 skipped (2508)
 Tasks:    10 successful, 10 total
```
(typecheck, lint and test all green; no `apps/web/src/auth/index.test.ts` timeout seen, no
separate re-run needed.)

```
python3 .githooks/secret-scan.py --all
```
clean (no output, exit 0).

## Decisions

### 25 Oct 2026 · 11.1e Phase A · decided by builder · risk: high
- Decided: `packages/db/src/repositories/live-classes.ts` is a risk-paths.txt match
  (`packages/db/src/repositories/**`, line 40) → security-reviewer is required on this PR,
  alongside database-reviewer, code-reviewer and typescript-reviewer per the plan's lead answer.
- Why: the build-plan rule requires a logged `risk: high` decision whenever a risky-paths file is
  touched, even when every change in it is a bug-fix-shaped LOW/MEDIUM rather than new write
  behaviour (per the plan's own "Risky paths touched" note).

### 25 Oct 2026 · 11.1e Phase A · decided by builder · risk: low
- Decided: no 501-row integration test was added for the `listForTeacher` 500-cap fix; the fix is
  covered by reasoning in this handoff instead (see "Left for Phase B").
- Why: the lead's Q2 answer in the plan explicitly agreed this is acceptable given the budget and
  that no teacher is near the cap in the pilot.

### 25 Oct 2026 · 11.1e Phase B · decided by builder · risk: low
- Decided: `editButtonLabel`/`cancelButtonLabel` are the key names used inside the
  `liveClassesStudio` namespace (lead answer Q3 left the exact names to the builder).
- Why: they mirror the existing `joinLinkLabel` naming pattern (`<action>Label`) already used in
  the same namespace, so the three per-row accessible-name keys read consistently.

### 25 Oct 2026 · 11.1e budget: Phase A 55 calls, Phase B 40 calls (each budget 30, stop at 38) · decided by lead · risk: low
- Decided: accept both phases as built (Phase A 55 calls, Phase B 40 calls, harness counts) rather than relaunching.
- Why: each phase finished its whole item list in scope with a green gate, and every reviewer approved; the overrun is setup plus the db int-test runs, which the 30-call budget under-counted.

### 25 Oct 2026 · 11.1e no database-reviewer · decided by lead · risk: low
- Decided: Phase A ran security-reviewer (the risk-paths requirement), code-reviewer and typescript-reviewer; database-reviewer, which the plan only recommended, did not run.
- Why: the change adds no migration, index or schema change; the order/limit change and the audit shape were checked by code-reviewer and security-reviewer, and the lead's plan answer named these three reviewers for Phase A.

### 25 Oct 2026 · 11.1e re-sort tiebreak uses localeCompare · decided by lead · risk: low
- Decided: keep `a.id.localeCompare(b.id)` as the ascending re-sort tiebreak in packages/db/src/repositories/live-classes.ts (wontfix security-reviewer's LOW).
- Why: ids are lowercase hex UUIDs, so locale ordering matches byte ordering in practice; it only affects display order of two classes at the same start time at the 500-row boundary.

### 25 Oct 2026 · 11.1e merge: live-class review follow-ups · decided by lead · risk: high
- Decided: merge 11.1e (packages/db/src/repositories/live-classes.ts: audit before/after carry link and ISO startsAt, a cancelled class's link never reaches a student, listForTeacher capped at the newest 500 and re-sorted ascending, status cast replaced by a parse; apps/web LiveClassesView: a save always updates its row but only closes its own form, per-row aria-labels).
- Why: the risk-paths group packages/db/src/repositories/** needs security-reviewer, which approved; code-reviewer and typescript-reviewer approved both phases with no CRITICAL, HIGH or MEDIUM findings.

## Budget
Phase A tool calls used: 55 (harness count; builder reported 19)
Phase B tool calls used: 40 (harness count; builder reported 15)
