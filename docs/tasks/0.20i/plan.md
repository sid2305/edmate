# Plan: 0.20i — give the backtracking self-test margin

Status: READY (lead plan)

## Cause
`packages/harness/src/pedagogy/modelRequest.test.ts` (~line 456), test "expectUnderCeiling still fails on a
deliberately backtracking regex (self-test)": the loop grows `k` until one real run of `/^(\s*)*$/.test(hostile)`
takes more than `CEILING_MS` (2 s). It then runs the same `hostile` again inside `expectUnderCeiling` and expects
a throw. The second run takes about the same time, so when the first run only just passed 2 s, the second can
land just under it and the test fails ("expected [Function] to throw an error"). This failed CI twice on
27 Oct 2026 on PRs that didn't touch the harness.

## Change (test only)
After the loop finds the first `k` over the ceiling, build the asserted input from `k + 1`. Backtracking time
roughly doubles per step, so that run takes about 2x the tripping run and is clearly over the ceiling.
- Update the comment block: the asserted run is one step past the tripping run, for margin. Recompute the
  worst-case total time: tripping run up to ~4 s, plus the k + 1 run up to ~8 s, plus the series before it
  (~4 s), so about 16 s. Check it still fits the test's 30 s timeout. If it might not, lower `CEILING_MS` for
  this self-test only by passing a smaller `ceilingMs` (e.g. 1000) to both the loop check and
  `expectUnderCeiling`, and say which in the handoff.
- Keep the MAX_K guard and its clear error message.
- Don't change `expectUnderCeiling` or any other test.

## Proof
Run the harness test file 5 times (`corepack pnpm --filter @edmate/harness exec vitest run src/pedagogy/modelRequest.test.ts`)
and record the self-test's time from each run in the handoff.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/harness`; `prettier --check` on the file;
`python3 .githooks/secret-scan.py --all`.

## Risk
Not a risky path. Reviewers: code-reviewer.

## Budget
About 15 tool calls.
