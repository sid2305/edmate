# Handoff: 0.20i
Status: DONE

## Summary
Changed `packages/harness/src/pedagogy/modelRequest.test.ts`'s backtracking self-test
("expectUnderCeiling still fails on a deliberately backtracking regex (self-test)"): after the
loop finds the first `k` whose real regex run exceeds `CEILING_MS`, the asserted run now uses
`k + 1` instead of the same tripping `k`. Backtracking time roughly doubles per step, so the
asserted run takes about 2x the tripping run's time and lands clearly over the ceiling, giving
margin against the previous flake where a run that only just tripped the ceiling could, run a
second time inside `expectUnderCeiling`, land just under it. Updated the comment block to
describe the new behaviour and the recomputed worst-case total time (tripping run up to ~4 s,
`k + 1` run up to ~8 s, series before it up to ~4 s, about 16 s total), which fits the test's
existing 30 s timeout, so `CEILING_MS` (2000ms) did not need lowering for this self-test.
Kept the `MAX_K` guard and its error message unchanged; did not touch `expectUnderCeiling` or
any other test.

5 timed runs of the full file (`corepack pnpm --filter @edmate/harness exec vitest run
src/pedagogy/modelRequest.test.ts`), all 88 tests passing each time:
1. 17.40s
2. 16.69s
3. 11.14s
4. 14.64s
5. 14.64s

## Decisions

### 27 Oct 2026 · 0.20i approve the test-only change under packages/harness/src/pedagogy · decided by lead · risk: high
- Decided: Merge 0.20i. It changes only modelRequest.test.ts (packages/harness/src/pedagogy/): the backtracking self-test now asserts on k + 1, not on a repeat of the run that tripped the ceiling. No source file changes. code-reviewer (required for the group) approved.
- Why: The old self-test failed CI on two unrelated PRs (385, 387) on 27 Oct 2026 when the repeat run landed just under the 2 s ceiling. The new run is about twice as slow, so it has margin, and the worst case (about 16 s) fits the 30 s timeout.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness` — 4 successful, 4 total.
- `corepack pnpm exec prettier --check packages/harness/src/pedagogy/modelRequest.test.ts` — all matched files use Prettier code style.
- `python3 .githooks/secret-scan.py --all` — clean, no output.

## Budget
Tool calls used: 13
