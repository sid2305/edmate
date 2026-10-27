# 0.20d handoff

Status: DONE

## Summary
`packages/harness/src/pedagogy/modelRequest.test.ts`:
- Replaced the per-size `minOf3` helper and its two separate `minOf3` calls in `expectLinear`
  with one interleaved loop: one untimed warm-up of each size, then five pairs of timed calls
  (small, large, small, large, ...), taking `Math.min` of the five small times and of the five
  large times separately. Bounds unchanged: 16x input step, `ratio < 64`, 10 s cap on the large
  run, 0.5 ms floor on the small run.
- Added a new self-test, `'a load burst that would have tripped minOf3-per-size no longer flips
  the ratio'`: a first, untimed dry run (faked clock, `run` only counts calls) finds the total
  number of calls `run` makes inside one `expectLinear` call (12: 2 warm-ups + 10 timed, for the
  current five-pair scheme). A second pass fakes a 5x-slower burst on the last three calls
  overall (which, since warm-ups run first, are exactly the last three *timed* calls) and asserts
  `expectLinear` does not throw. Confirmed by temporarily reverting `expectLinear` to the old
  all-small-then-all-large `minOf3` form: with that order the last three timed calls are exactly
  the three large timed samples, so the burst hits every large sample, the large minimum is
  inflated, and this new test fails (`ratio` over 64) as expected. Restored the interleaved form
  and it passes.
- Kept the quadratic self-test (`'expectLinear still fails a deliberately quadratic function
  (self-test)'`) unchanged in logic -- it fakes `performance.now` with a per-call cost
  proportional to `input.length^2`, independent of call order or count, so it still throws under
  the new sampling. Fixed its comment's timeout wording per the 0.20c wontfix: it now says the
  earlier attempt (real CPU work instead of a faked clock) hit the 60 s test timeout, before the
  timeout widened to 120 s, rather than implying it hit 120 s.
- No changes to `modelRequest.ts` or any other source file.

Test run time locally: the whole file (86 tests, including the 120 s-timeout linear-time test)
finished in 1.5-1.8 s per run under `vitest run` directly (fake clocks for the self-tests; real
wall-clock timing only for the two `expectLinear` calls in `'runs in linear time on long hostile
input'`, which are fast on this machine). Well under the 120 s test timeout in all 5 runs.

## Decisions
### 26 Oct 2026 · 0.20d dry-run call count instead of hard-coded sample count · decided by builder · risk: low
- Decided: The load-burst self-test finds "the last three timed calls" by first running
  `expectLinear` once with a counting `run` (clock faked to a constant so no real bound logic
  misfires) to get the total call count, rather than hard-coding "12 calls" in the test.
- Why: The plan leaves "how the fake finds 'the last three'" to the builder but asks that the
  same test code fail on today's sampling and pass on the new one; deriving the count from a dry
  run (rather than hard-coding a number that depends on the five-pair/three-pair split) keeps the
  test correct if the pair count ever changes, and it's the exact mechanism the plan suggested
  (a first pass that records call count, then a second pass with the burst).

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness` -- all 4 tasks
  (typecheck, lint, test x2) passed; 86 tests passed in `modelRequest.test.ts`.
- Ran `vitest run src/pedagogy/modelRequest.test.ts` 4 additional times directly (plus the turbo
  run above = 5 total): all 5 runs, 86/86 tests passed each time (no ratios printed; pass/fail
  only, since `expectLinear` doesn't log the ratio).
- `corepack pnpm exec prettier --check packages/harness/src/pedagogy/modelRequest.test.ts` --
  "All matched files use Prettier code style!"
- `python3 .githooks/secret-scan.py --all` -- clean, no output.

## Budget
Tool calls used: 12
