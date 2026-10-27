# 5.3a handoff

Status: DONE (both phases).

## Summary

Phase A fixed the two query rewrites named in the 5.3 review and added the Unicode regression
test, all inside `packages/db`:

- `packages/db/src/repositories/retrieval.ts` — `rank()`:
  - `vectorRows`: restructured into an inner query that orders by distance alone (no second sort
    key), `LIMIT PER_SIGNAL`, so the planner can take an HNSW order for it; the `asc(chunks.id)`
    tie-break is applied only in the outer query, over the already-limited rows (same final order
    as before: distance, then id). Drizzle requires an explicit `.as('distance')` alias on the raw
    SQL `distance` column before an outer query can reference it from the subquery; without it the
    query threw (`"distance" field from a subquery ... doesn't have an alias`), caught during
    Phase A's own test run.
  - `termStats`: combined the two queries (`dfRows`, `countRows`) into one `db.execute` call with a
    `with total as (...)` CTE cross-joined into the per-term `group by`, so one round trip returns
    each term's `df` and the shared `n`.
- `packages/db/test/retrieval-hnsw.int.test.ts` — updated the file header comment: this is now a
  real guard (the planner can use the HNSW index for the inner distance order), not a guard that
  "could not be made red." No assertion changes; the existing case still passes.
- `packages/db/test/retrieval.int.test.ts` — added
  `'CJK, Thai, Korean and a 60+ character term never raise (5.3a item 6)'`: search/probe with
  Japanese, Thai and Korean (Hangul) terms and one 65-character single term, asserting both calls
  return normally. This passed against the code before the rewrite too (queryTerms' restricted
  character class already made the finding closed in practice); it is evidence, not a red-to-green
  test, as the plan says to note honestly.
- `docs/tasks/5.3a/handoff.md` — this file.

Also recorded per the plan, no code change:
- Item 3 (`leakCache.ts`/`lockedIndexFor` intersecting `allowed` with owned module ids before the
  cache key) and item 8 (`CandidatesSchema`'s `.max()` caps) are already done, by task 5.4. Checked
  against `packages/db/src/repositories/retrieval.ts` on this branch: both are present as described
  in the plan.

## Decisions

### 26 Oct 2026 · 5.3a Phase A query rewrites, retrieval risk group · decided by builder · risk: high
- Decided: Phase A's two query rewrites (`vectorRows`'s inner-query distance order, `termStats`'s
  single round trip) and the new Unicode regression test are in scope and risk: high, per the
  plan's "Risky paths touched" section (`packages/db/src/repositories/**` touches the retrieval
  repository group; `database-reviewer` and `rag-pipeline-reviewer` are required alongside
  `security-reviewer`, `code-reviewer` and `typescript-reviewer`).
- Why: a query-shape change to the retrieval path that every teacher's search and probe calls
  through; the build plan requires logging `risk: high` for any change touching this group,
  reviewed by the named reviewers before merge.

### 26 Oct 2026 · 5.3a subquery alias fix · decided by builder · risk: low
- Decided: added `.as('distance')` to the raw SQL `distance` expression used inside the
  `vectorRows` inner query, beyond what the plan's wording spelled out.
- Why: Drizzle ORM (0.45.4) requires every raw-SQL (non-column) field selected from a subquery to
  carry an explicit alias before an outer query can reference it; without this the query threw at
  runtime (caught by the existing `probe` and `search` integration tests during this task's own
  test-first cycle, not by a reviewer). No behaviour change beyond fixing the throw — the returned
  shape and values are unchanged.

### 26 Oct 2026 · 5.3a items 4, 7, 11 declined; items 3, 8 already done · decided by builder · risk: low
(Carrying forward the plan's own decisions into this handoff, as instructed, for the record.)
- Decided: item 7 (`SET LOCAL hnsw.iterative_scan` outliving a passed-in `Tx`) is declined for
  5.3a; items 4 and 11 (widening the out-of-course calibration set and a per-course recalibration
  path) are declined and bundled, recommending a new task id `5.3c` for the lead to open at
  closeout; items 3 and 8 are already done, landed by task 5.4.
- Why: item 7 is dormant (no caller passes a `Tx` into `retrievalRepo` today) and is explicitly
  flagged in the code for the future HNSW rewrite; items 4/11 need a second course to validate a
  recalibration design against, which this demo-only codebase doesn't have yet; items 3/8 are
  already landed with evidence in the plan (see plan.md items 3, 8 for the file/line citations).

## Gate

```
export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
corepack pnpm --filter @edmate/db test
```
Result: `Test Files 83 passed (83)`, `Tests 1780 passed | 4 skipped (1784)`, `retrieval.ts`
coverage 100% lines/statements/functions, 97.77% branches. Confirms the retrieval int tests ran
(not skipped) against the real dev Postgres.

```
export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
corepack pnpm turbo run typecheck lint test --filter=...@edmate/db
```
Result: `@edmate/db:typecheck`, `@edmate/db:lint` and `@edmate/db:test` all clean. The dependent
packages (`@edmate/cli`, `@edmate/web`) also ran per this filter; one `@edmate/cli` int test
(`test/chatDbRetrieval.int.test.ts`) and some `@edmate/db` leak-cache SLO/timing tests
(`retrieval-leak.int.test.ts`, untouched by this task) failed intermittently with
`terminating connection due to administrator command` / timing misses under the load of several
builders' test suites running against the same shared dev Postgres concurrently. Re-running
`@edmate/db`'s own tests alone (no concurrent load) passed 83/83 files, confirming this is
environmental contention, not caused by Phase A's changes — `retrieval.ts`, `retrieval.int.test.ts`
and `retrieval-hnsw.int.test.ts` passed cleanly both times.

```
corepack pnpm exec prettier --check packages/db/src/repositories/retrieval.ts \
  packages/db/test/retrieval-hnsw.int.test.ts packages/db/test/retrieval.int.test.ts
```
Result: clean (ran `--write` once first to normalize the two test files' comment edits, then
`--check` passed).

```
python3 .githooks/secret-scan.py --all
```
Result: clean, no output.

## Budget

Tool calls used: 33

## Phase B

### Summary

Phase B did the small, low-risk cleanups named in the plan, no behaviour change:

- `packages/harness/src/lockedIndex.ts` (new) — re-exports only `{ lockedIndex, type LockedIndex
  }` from `./guardrails/lockedMatch.js`, outside `guardrails/**` on purpose so this file matches
  no risk-paths.txt glob.
- `packages/harness/package.json` — added a `"./locked-index"` entry to `exports`, alongside the
  existing `"."` and `"./testing"` entries, pointing at `dist/lockedIndex.{d.ts,js}`.
- `packages/db/src/repositories/retrieval.ts` — split the single `@edmate/harness` barrel import
  into two lines: `DEFAULT_COVERAGE_THRESHOLD` still from the barrel, `lockedIndex`/`LockedIndex`
  now from `@edmate/harness/locked-index`. No logic change.
- `packages/db/scripts/record-demo-embeddings.ts` — added a line to the header comment stating
  the Node version this repo's `engines` field pins (22.x) and that Node 22.18+ strips `.ts`
  types natively (no flag), with `--experimental-strip-types` named as the fallback for an older
  22.x build.

No new test assertions (no behaviour change); re-ran `retrieval.test.ts` and the Phase A int
tests unchanged via the gate below, confirming the import swap didn't break anything.

### Decisions

### 26 Oct 2026 · 5.3a Phase B import-swap re-export location · decided by builder · risk: high
- Decided: touched `packages/db/src/repositories/retrieval.ts` (a risk-paths.txt path) again in
  Phase B, for the one-line import-path change only (no query or retrieval-behaviour change), and
  added the new `packages/harness/src/lockedIndex.ts` outside `guardrails/**` so the risky-path
  reviewer group for this change is `security-reviewer` + `code-reviewer` + `typescript-reviewer`
  only — no `database-reviewer`/`rag-pipeline-reviewer` needed here, per the plan.
- Why: the plan calls for this risk level and reviewer set explicitly (Phase B "Risky paths
  touched"), since `retrieval.ts` is still a risk-paths.txt file even though this edit carries no
  behaviour change.

(Carrying forward, for the record: item 7 is declined — no caller passes a `Tx` into
`retrievalRepo` today, dormant until the HNSW rewrite the code comment already flags; items 4 and
11 are declined and bundled, recommending the lead open a new task `5.3c` to widen the
out-of-course calibration set and design a per-course recalibration path once a second course
exists to validate against; items 3 and 8 are already done, landed by task 5.4 — see plan.md for
the file/line evidence for all five.)

### Gate

```
export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=...@edmate/db
```
Result: `Tasks: 38 successful, 38 total`, clean — ran once, no flakes this time.

```
corepack pnpm exec prettier --check packages/harness/src/lockedIndex.ts \
  packages/harness/package.json packages/db/src/repositories/retrieval.ts \
  packages/db/scripts/record-demo-embeddings.ts
```
Result: clean.

```
python3 .githooks/secret-scan.py --all
```
Result: clean, no output.

### Budget

Phase B tool calls used: 15

## Fix round

### Summary

Review finding (HIGH from `database-reviewer`/`typescript-reviewer`, MEDIUM from
`rag-pipeline-reviewer`/`security-reviewer`/`code-reviewer`): `vectorRows`' inner query ordered by
`distance` alone with `LIMIT PER_SIGNAL`, then the outer query added the `(distance, id)`
tie-break only over those already-truncated rows. When more than `PER_SIGNAL` chunks tie exactly
on distance across the cut-off (the scripted test/demo embedder gives identical vectors to texts
with the same keyword set, `retrieval-seed.ts`'s `scriptedVector`), which of the tied rows the
inner `LIMIT` kept depended on scan order, not on id — the comment's claim that "ties still break
deterministically" was wrong about *which* rows got selected (only their final order was
deterministic).

Fix, in `packages/db/src/repositories/retrieval.ts`:
- Added `export const VECTOR_OVERFETCH = PER_SIGNAL * 2` (also exported `PER_SIGNAL`, needed by
  the new test).
- `vectorRows`' inner query now orders by `distance` alone still (keeping the HNSW benefit — no
  `id` added to that `ORDER BY`), but with `LIMIT VECTOR_OVERFETCH` instead of `LIMIT PER_SIGNAL`.
  The outer query keeps `ORDER BY distance, id` and now carries the real cut-off,
  `LIMIT PER_SIGNAL`. A tie group up to `VECTOR_OVERFETCH` rows wide is now fully visible to the
  outer tie-break, so the selected `PER_SIGNAL` rows are the lowest-id rows within it.
- Rewrote the comment to state the guarantee precisely: the output is always in `(distance, id)`
  order; the selected rows are the lowest-id rows among any tied group, *unless* that group is
  wider than `VECTOR_OVERFETCH`, in which case the inner query may already have dropped some
  lower-id tied rows before the outer tie-break can see them. Also notes HNSW search is
  approximate regardless, so this only ever matters for exact distance ties.

Test, in `packages/db/test/retrieval.int.test.ts` (`describe('search', ...)`): a new teacher
(`tch_vectie`), module and document, isolated from every other test in the file (search scopes by
module ownership under `teacherId`, so this cannot change what any other test's query sees).
Seeded `PER_SIGNAL + 10` = 30 chunks with an identical embedding (so they tie exactly on distance
to the query vector), plus 5 "far" decoys on an orthogonal axis (clearly farther, interspersed
with lower ids via `ord`, so the test also shows id alone never wins over a real distance
difference). Calls `repos.retrieval.search` directly (not through the `RetrievalIndex` port, which
only re-embeds the text query and doesn't accept an explicit vector) with a stop-words-only query
(`'the and of'`) so `queryTerms` is empty and the search is vector-only — `byText = []`, so the
fused order is exactly the vector signal's order (RRF is strictly decreasing in rank, so there is
no cross-signal tie to break). Asserts the returned ids equal the 30 tied ids' first 20 (lowest
id), and that none of the 5 far decoys appear.

Red-to-green: ran the new test with only the inner `LIMIT` reverted to `PER_SIGNAL` (simulating the
pre-fix code, leaving the comment and the exported constants as-is) against the real dev
Postgres used by these tests. **It still passed** — this dev Postgres has no HNSW-forcing settings
on this connection (unlike `retrieval-hnsw.int.test.ts`'s dedicated pool with
`enable_seqscan=off`), so the planner takes a sequential scan for this small table, and a seq scan
happens to return rows in a stable physical/insertion order that correlates with ascending id
here. So this is evidence the fix is correct, not a red-to-green demonstration — the same honest
caveat the plan asked for if this happened, matching the fix brief's explicit allowance. The
finding itself is about a correctness guarantee against the *planner's* freedom under an
unspecified inner order (documented in the original comment's wrong claim and confirmed by the
reviewers), not about reproducing a scan order on this machine's default planner settings; the fix
closes that gap regardless of whether this particular dev instance's default plan exposes it.

Touched only `packages/db/src/repositories/retrieval.ts`, `packages/db/test/retrieval.int.test.ts`,
and this handoff, per the fix brief.

### Gate

```
export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
corepack pnpm turbo run typecheck lint test --filter=...@edmate/db
```
Result: `Tasks: 20 successful, 20 total`. `@edmate/db:test` shows `test/retrieval.int.test.ts (32
tests)` with 0 skipped (confirms the int tests ran against the real Postgres, not skipped) and the
whole `@edmate/db` suite `83 passed (83)` / `1781 passed | 4 skipped (1785)`; coverage for
`retrieval.ts` 100% lines/statements/functions, 97.77% branches (unchanged by this fix round's new
test — `PER_SIGNAL`/`VECTOR_OVERFETCH` were already exercised).

```
corepack pnpm exec prettier --check packages/db/src/repositories/retrieval.ts \
  packages/db/test/retrieval.int.test.ts
```
Result: clean.

```
python3 .githooks/secret-scan.py --all
```
Result: clean, no output.

### Decisions

### 26 Oct 2026 · 5.3a vector tie-break over-fetch · decided by builder · risk: high
- Decided: fixed the inner/outer vector query split in `vectorRows` so the inner query
  over-fetches `VECTOR_OVERFETCH = PER_SIGNAL * 2` rows (ordered by distance alone, keeping the
  HNSW plan benefit) instead of `PER_SIGNAL`, and the outer query applies the real `(distance,
  id)` order and the `PER_SIGNAL` cut-off; exported `PER_SIGNAL` and `VECTOR_OVERFETCH` from
  `retrieval.ts` for the new regression test. `2x` is a round, conservative slack chosen because no
  caller passes more than a handful of exact ties in practice (the scripted test/demo embedder is
  the only source of exact ties today) — not measured against a specific production tie-group
  size, since none exists yet.
- Why: `retrieval.ts` is a risk-paths.txt file (the retrieval query group), so any change here is
  `risk: high` per the build plan regardless of the change's size; this one changes which rows a
  tied vector search returns.

Fix round tool calls used: 28
