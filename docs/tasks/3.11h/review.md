# 3.11h review — APPROVE

Reviewers: code-reviewer

Test-only change to packages/harness/src/pedagogy/modelRequest.test.ts: `expectLinear` now compares 16n against n with a bound of 64 (linear about 16, quadratic about 256), so CI timing noise has about 4x headroom on each side instead of 2.5x. The builder showed a quadratic stand-in fails at a ratio of 248.87 and the test passed 20 of 20 runs under CPU load.

## Findings

None.
