# 3.11g handoff

Status: DONE

## Summary

`modelRequest.test.ts`'s "runs in linear time on long hostile input" test asserted an
absolute wall-clock bound (2000 ms) on `breakFenceRuns` and `neutraliseForgedLabel` run
once on a 60k-character hostile input. That flaked on a slower CI runner (2048 ms, #191).

Replaced the absolute bound with a ratio check: for each function, time input size
`n = 20_000` and `4n`, each as the best of 3 runs (to filter one-off scheduler noise),
and assert `t(4n) / t(n) < 10`. Linear work gives a ratio near 4; quadratic work gives a
ratio near 16, so a quadratic or worse regression still fails while a slow runner (which
scales both `t(n)` and `t(4n)` together) does not. A very loose gross bound of 15s on the
`4n` run is kept only as a hang guard.

## Regression proof (scratch run, not committed)

Temporarily changed the `breakFenceRuns` call inside `expectLinear` to loop
`Math.max(1, Math.floor(input.length / 20000))` times (so total work grows roughly with
`n^2`, simulating a quadratic regression), then ran:

```
corepack pnpm vitest run src/pedagogy/modelRequest.test.ts -t "runs in linear time"
```

Result: the test failed as expected:

```
AssertionError: expected 14.339285714285714 to be less than 10
 ❯ expectLinear src/pedagogy/modelRequest.test.ts:347:19
```

The change was then reverted (`git checkout -- src/pedagogy/modelRequest.test.ts`) before
re-applying the real fix, confirmed by re-reading the file and re-running the gate.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness`: green (4/4 tasks).
- Changed test run 5x in a row standalone: all green (~1.0-1.1s each).
- `python3 .githooks/secret-scan.py --all`: clean, no output.

Tool calls used: 16

## Decisions

### 22 Oct 2026 · 3.11g flaky timing bound → ratio check · decided by builder · risk: low

- Decided: replace the 2000 ms absolute bound with a ratio check comparing best-of-3 timings
  at `n` and `4n`, asserting the ratio stays under 10, plus a loose 15s gross bound on the
  `4n` run as a hang guard only.
- Why: the build plan's lessons say no tight timings; a ratio check still catches a true
  quadratic/exponential regression (ratio ~16+) without failing on a slower or loaded CI
  runner, which only scales both timings together and leaves the ratio near 4.
