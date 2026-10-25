# Handoff: 11.1e — live-class review follow-ups

**Status:** PARTIAL (Phase B is still to do)

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

- `apps/web/app/teacher/live-classes/LiveClassesView.tsx` (`saveEdit`'s stale-guard split,
  `aria-label`s on Edit/Cancel-class buttons), its test, and `apps/web/messages/en.json` — per the
  brief, a fresh builder does Phase B. Not touched here.
- The 500-cap fix (item 3) has no dedicated integration test inserting 501+ rows, per the lead's
  Q2 answer. Reasoning instead: the query shape (`orderBy(desc(startsAt), desc(id)).limit(500)`,
  then an ascending JS re-sort of the kept rows) is a small, reversible change whose correctness
  follows directly from the `ORDER BY ... DESC ... LIMIT N` + re-sort pattern already used
  elsewhere in this file (e.g. `listRecordingsForTeacher`'s own `desc(createdAt)` + limit); no
  teacher is near 500 scheduled classes in the pilot.

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

## Budget
Phase A tool calls used: 19
