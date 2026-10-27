# 5.3a plan: retrieval follow-ups from the 5.3 review

**Id collision check:** `docs/tasks/5.3a/` held no files before this plan (confirmed by glob); no
old handoff.md/review.md from another task to worry about.

## Acceptance (verbatim)
> each item in docs/tasks/5.3/review.md marked [deferred 5.3a] is fixed or explicitly declined in
> the decision log, with tests where behaviour changes; the db gate passes

Shown by: the gate below green, new/updated tests named per item, and the handoff's `## Decisions`
section covering every declined item (the merge's `risk: high` log entry is the record for the
whole task).

## The nine `[deferred 5.3a]` items, checked against main (26 Oct 2026)

1. **`retrieval.ts:214` vectorRows orders by (distance, id), so the planner can't use the HNSW
   index** — still open on main (`vectorRows` orders `asc(distance), asc(chunks.id)` in one
   `ORDER BY`). **Fix in Phase A.**
2. **`retrieval.ts:230` two extra IDF queries per search** — still open on main (`termStats` runs
   `dfRows` and `countRows` as two separate `Promise.all` queries). **Fix in Phase A.**
3. **`leakCache.ts` entry memory is unbounded** — **already done**, by task 5.4: `retrieval.ts`'s
   `lockedIndexFor` (lines ~508-523) now intersects `allowed` with the teacher's own module ids
   *before* building the leak-cache key (`const owned = allowed.filter((id) =>
   ownedSet.has(id))`), with a comment citing "(5.4)" and explaining foreign/unknown ids can't fill
   the cache with copies. This is the second of the finding's two suggested fixes. No new work;
   note it as closed in the handoff.
4. **`retrieval.ts:43` coverageThreshold calibrated on only 8 out-of-course items** — still open,
   and too big for this task (it needs a wider gold-item set and judgement calls about what counts
   as "out of course" per subject). **Decline and split**, bundled with item 11 below.
5. **`recall.int.test.ts:185` real-vector hybrid recall skipped until B-24** — explicitly
   `[deferred 5.3b]`, not 5.3a. **Out of scope**; no action here.
6. **`retrieval.ts:234` a term could make `to_tsquery` raise** — still open in spirit, but
   `queryTerms` (the only source of every term reaching `termQuery`/`tsTerm`) already restricts
   terms to `[\p{L}\p{N}]+` runs, so a term can never carry a quote, backslash or tsquery
   punctuation that would break the quoted-literal form. **Fix in Phase A is a regression test**,
   not a query rewrite: add an integration case with unusual-but-legal terms (CJK ideographs,
   Thai, Korean, a very long single term) and assert `retrieval.search`/`probe` return normally.
   Decline the `plainto_tsquery` switch in the decision log, citing the character-class guarantee
   and the new test as evidence.
7. **`retrieval.ts:219` `SET LOCAL hnsw.iterative_scan` lasts until the outer transaction ends if a
   caller passes a `Tx`** — still open, and the finding itself calls it "harmless today" and says
   to "revisit with the HNSW query rewrite." **Decline for 5.3a**, log the reason (no caller passes
   a `Tx` into `retrievalRepo` today; the comment in code already flags it for the future rewrite).
8. **`CandidatesSchema` has no `.max()` on count or length** — **already done**, by task 5.4:
   `CandidatesSchema = z.array(z.string().max(LEAK_CANDIDATE_MAX_LENGTH)).max(LEAK_CANDIDATES_MAX)`
   is on main with both caps and a comment citing the measured headroom. No new work.
9. **`retrieval.ts` imports the whole `@edmate/harness` barrel for `lockedIndex`** — still open
   (`import { ..., lockedIndex } from '@edmate/harness'`). **Fix in Phase B**, with a new top-level
   file so the change does not touch the risky `guardrails/**` folder itself (see Files below).
10. **`record-demo-embeddings.ts:1` header doesn't state the Node version/flag for running a
    `.ts` file directly** — still open. **Fix in Phase B**: a one-line comment.
11. **`qa-recall.yaml` scoring constants have no recalibration path per course** — still open,
    same underlying gap as item 4 (one course's numbers, no per-course path). **Decline and
    split**, bundled with item 4.

## Phase A: the two query rewrites + the Unicode regression test

### Files
- `packages/db/src/repositories/retrieval.ts` — in `rank()`:
  - `vectorRows`: restructure so the distance `ORDER BY ... LIMIT PER_SIGNAL` happens in an inner
    query (letting the planner use the HNSW index for that order), with the `asc(chunks.id)`
    tie-break applied only outside, over the already-limited rows. Keep the `SET LOCAL
    hnsw.iterative_scan = strict_order` transaction wrapper as is (item 7 above is declined, not
    touched).
  - `termStats`: combine `dfRows` and `countRows` into one `db.execute` call (a `WITH total AS
    (SELECT count(*) ... )` CTE cross-joined into the per-term `GROUP BY`), so one round trip
    returns both each term's `df` and the shared `n`.
- `packages/db/test/retrieval-hnsw.int.test.ts` — update the file comment: this is now a real
  guard (the planner can use the HNSW index for the inner distance order), not a guard that
  "could not be made red"; keep the existing assertions, no new cases required unless the rewrite
  changes the shape of what's returned (it should not — same `Ranked` row shape).
- A new or existing `packages/db/test/*.int.test.ts` case (add to `retrieval.int.test.ts` if one
  exists, otherwise a focused addition near the existing retrieval tests) — the Unicode regression
  for item 6: search/probe with CJK, Thai and Korean terms and one 60+ character term return
  normally (no throw), proving `to_tsquery` never raises on `queryTerms`' restricted character
  class.

### Tests first
1. Confirm the existing `retrieval-hnsw.int.test.ts` case still passes before touching
   `vectorRows` (it's a pre-existing guard, not expected to go red from this change alone).
2. Write the new Unicode case and watch it pass against current code too (it is evidence the
   finding is already closed in practice, not a red-to-green test) — note this honestly in the
   handoff rather than claiming a red run that never happened.
3. Rewrite `vectorRows` and `termStats`; re-run `retrieval-hnsw.int.test.ts`,
   `retrieval.test.ts` (pure-function unit tests: `pivotScale`, `termCoverage`, `queryTerms`,
   `stemTerm`, `tsTerm`, `ftsQuery` are unaffected) and any `recall.int.test.ts` cases that are not
   already skipped for 5.3b.

### Risky paths touched
- `packages/db/src/repositories/**` (risk-paths.txt) → reviewers: `security-reviewer` (required by
  the group).
- Query change (`vectorRows`, `termStats`) → `database-reviewer` (per this task's instructions).
- Retrieval behaviour change → `rag-pipeline-reviewer` (per this task's instructions).
- `code-reviewer` and `typescript-reviewer` (always required).
- Handoff logs a `risk: high` decision for Phase A.

### Gate
```
export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
corepack pnpm turbo run typecheck lint test --filter=...@edmate/db
```
Plus `corepack pnpm exec prettier --check` on changed files and
`python3 .githooks/secret-scan.py --all`.

### Budget
Phase A: ~50 tool calls.

## Phase B: small, low-risk cleanups + the declines

### Files
- `packages/harness/src/lockedIndex.ts` (new, top-level — **not** under `guardrails/**`, so this
  file alone matches no risk-paths.txt glob) — re-exports only `{ lockedIndex, type LockedIndex }`
  from `./guardrails/lockedMatch.js`. No behaviour change, no edit inside `guardrails/`.
- `packages/harness/package.json` — add one `exports` entry, e.g. `"./locked-index": { "types":
  "./dist/lockedIndex.d.ts", "default": "./dist/lockedIndex.js" }`, alongside the existing `"."`
  and `"./testing"` entries.
- `packages/db/src/repositories/retrieval.ts` — change the import line from
  `import { DEFAULT_COVERAGE_THRESHOLD, type LockedIndex, lockedIndex } from '@edmate/harness'` to
  import `lockedIndex`/`LockedIndex` from `@edmate/harness/locked-index` and keep
  `DEFAULT_COVERAGE_THRESHOLD` from the barrel (it isn't part of this finding). One-line-shaped
  change, no logic change.
- `packages/db/scripts/record-demo-embeddings.ts` — add one line to the header comment stating the
  Node version (or `--experimental-strip-types` flag) the bare `node ...ts --live` invocation
  needs, matching the Node version this repo's `.nvmrc`/engines field already pins (check it rather
  than guessing a number).
- `docs/board/tasks.yaml` — **not edited by this task**; the plan only names a free id (`5.3c`) for
  the lead to add at closeout (see Decisions below). Confirmed free: no `5.3c` id and no
  `docs/tasks/5.3c/` folder exist today.

### Tests first
- No behaviour changes in Phase B (a re-export, an import path, a comment), so no new test
  assertions are required; re-run `retrieval.test.ts` and the Phase A int tests unchanged to prove
  the import swap didn't break anything.

### Decisions to log in the handoff
- **Decline** item 7 (`SET LOCAL hnsw.iterative_scan` outlives a passed-in `Tx`): no caller passes
  a `Tx` into `retrievalRepo` today, so this is dormant; revisit only with the HNSW query rewrite
  the code comment already points to. No fix in 5.3a.
- **Decline and split** items 4 and 11 (widening the out-of-course calibration set in
  `retrieval.ts:43` and a per-course recalibration path for `qa-recall.yaml`'s constants): too big
  for this task — it needs a larger gold-item set across more than one course and a design for
  "recalibrate per course," which this demo-only codebase doesn't have a second course to validate
  against yet. Recommend the lead open a new task **`5.3c`** (free id, checked against
  `docs/board/tasks.yaml` and `docs/tasks/`) to widen the out-of-course set and design the
  recalibration path once a second course exists to test it against.
- Items 3 and 8 are recorded as **already done (by 5.4)**, with the file/line evidence above.

### Risky paths touched
- `packages/db/src/repositories/retrieval.ts` (the import-line change) → reviewers:
  `security-reviewer` (required by the group), plus `code-reviewer` and `typescript-reviewer`
  (always required). No `database-reviewer`/`rag-pipeline-reviewer` needed here — no query or
  retrieval-behaviour change in Phase B.
- `packages/harness/src/lockedIndex.ts` and `packages/harness/package.json` match no
  risk-paths.txt glob (outside `guardrails/**`, `pedagogy/**`, `access/**`).
- Handoff logs a `risk: high` decision for Phase B too (it still touches
  `packages/db/src/repositories/**`).

### Gate
Harness gains an additive export (exported surface change) and db changes its import of it, so
gate both with dependents, per the "gate dependents in briefs" lesson:
```
export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=...@edmate/db
```
Plus `corepack pnpm exec prettier --check` on changed files and
`python3 .githooks/secret-scan.py --all`.

### Budget
Phase B: ~25 tool calls.

## Not in scope / don't touch
- `packages/harness/src/pipeline/steps/buildContext.ts` (+ its test), `apps/cli/src/commands/chat/
  sameTopic.test.ts`, `apps/web/app/staff`, `apps/web/app/api/staff` — other builders own these.
- `packages/db/test/recall.int.test.ts`'s skipped "with embeddings" case and `VECTOR_ZERO`
  recalibration — tracked as 5.3b, not touched here.
- `content/demo-teacher/qa-recall.yaml`'s scoring constants and `retrieval.ts`'s
  `coverageThreshold`/`TEXT_PIVOT` values — not changed; the widening work is declined and split to
  the proposed `5.3c`.
- `packages/harness/src/guardrails/**` itself — Phase B's new file sits outside it on purpose, so
  this PR doesn't need the guardrails risk group's reviewers for that part of the change.
- No `packages/contracts` change anywhere in this task; no ADR needed.

## Open questions
- None blocking: every one of the nine items above is fixed, already done, or declined with a
  named reason. The only follow-on is the proposed id `5.3c`, which the lead adds to the board at
  closeout (not this task's job to edit `tasks.yaml`).

## Budget
Budget: 75 tool calls (2 phases, @edmate/db + @edmate/harness)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (tests, typecheck/lint, prettier --check, secret-scan only)

## Exit conditions
Phase A — Status: DONE when `retrieval-hnsw.int.test.ts` and the new Unicode case are green, the
rewritten `vectorRows`/`termStats` pass all existing retrieval tests, and the gate above is clean.
Status: PARTIAL past ~55 tool calls, or if a correct fix turns out to need touching
`packages/harness` (the HNSW/termStats rewrite should be `packages/db`-only).

Phase B — Status: DONE when the new `lockedIndex.ts` export, the `retrieval.ts` import swap, and
the `record-demo-embeddings.ts` header note are in, both gates (Phase A's and Phase B's, including
dependents) are green, and the handoff's `## Decisions` section names all three declines (item 7,
and items 4+11 bundled with the proposed `5.3c` id) plus the two already-done items (3, 8) with
their evidence. Status: PARTIAL past ~30 tool calls for this phase, or if a fix needs touching
`packages/harness/src/guardrails/**` itself.
