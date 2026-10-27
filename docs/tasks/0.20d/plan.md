# 0.20d plan: make the modelRequest linear-time check hold up under CI load

Written by the lead, 26 Oct 2026. Status: READY.

## Problem
`packages/harness/src/pedagogy/modelRequest.test.ts`, "runs in linear time on long hostile input",
still flakes in CI after 0.20c. It failed on PR #325 with a ratio of 72.7 against the bound of 64, and
the PR only added a db index. `expectLinear` (line ~363) times the whole small input with
`minOf3`, then the whole large input with `minOf3`. A load spike that lands only while the large runs
are timed raises the ratio. Linear code should come out near 16 for a 16x input. Quadratic code comes
out near 256. The bound of 64 sits between the two.

## Change (test file only)
1. **Interleave the samples.** Replace the two separate `minOf3` calls with one loop that alternates
   small and large runs (after one untimed warm-up of each), five pairs in all. Take the minimum
   small time and the minimum large time across the pairs. Load then hits both sizes alike, and the
   minimum drops a spike that lands on any single run.
2. **Keep the bounds.** Keep the 16x factor, the bound `ratio < 64`, the 10 s cap on the large run,
   and the 0.5 ms floor on the small run. Don't loosen any of them.
3. **Keep the self-test.** The existing quadratic self-test (faked `performance.now`) must still throw
   with the new sampling. Adjust it only if the sample count changes how the fake clock is read, and
   keep it deterministic.
4. Fix the self-test comment's "120s test timeout" wording to say what actually timed out (the earlier
   attempt hit the 60 s timeout). This was the 0.20c wontfix.
5. If the test's own timeout needs to change for five pairs, keep the total under the existing 120 s.
   Say in the handoff how long the test takes locally.

Don't change `modelRequest.ts` or any other file under `packages/harness/src`; only the test changes.

## Tests first
- Before changing `expectLinear`, add a self-test with a faked `performance.now`. `run` costs time
  proportional to `input.length` (linear), but a "load burst" makes about 3 consecutive timed runs
  5x slower: the **last three timed runs** of an `expectLinear` call (count timed calls; warm-ups
  are not slowed). With today's order (all small runs, then all large runs) those are exactly the
  three timed large runs, so the ratio is about 80 and the test fails even though the code is linear.
  With five interleaved pairs, the last three timed runs can't cover every large run, so the minimum
  drops the burst and the test passes. How the fake finds "the last three" is the builder's call (for
  example a first pass that records how many times `run` is called, then a second pass with the
  burst). It must be deterministic, and the same test code must fail on today's sampling and pass on
  the new one. Say in the
  handoff that it failed before the change and passes after.
- Then make the change and re-run: linear passes, the load-burst test passes, and the quadratic
  self-test still throws.

## Files
- packages/harness/src/pedagogy/modelRequest.test.ts
- docs/tasks/0.20d/handoff.md

## Risky paths
`packages/harness/src/pedagogy/**`. As with 0.20c, the lead runs code-reviewer and
typescript-reviewer, and logs a `risk: high` merge decision saying only the test changes.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness`
- Run the one test file 5 times in a row with the full harness suite load (the turbo gate run counts
  as one); report the ratios if the test prints them, or at least pass/fail each time.
- `corepack pnpm exec prettier --check` on the changed file; `python3 .githooks/secret-scan.py --all`.

## Budget
About 20 tool calls. Stop with `Status: PARTIAL` past 30.
