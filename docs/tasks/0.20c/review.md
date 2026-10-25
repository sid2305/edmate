# 0.20c review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

The linear-time test now takes the minimum of 5 timed runs after one untimed warm-up, with a base input of 8,000 units, and keeps the 16x factor and the bound of 64. Both reviewers checked by hand that the faked-clock self-test still fails a quadratic function (ratio 256), and typescript-reviewer re-ran the suite under load (85/85). Only the test file changed.

## Findings
- [LOW] [wontfix] packages/harness/src/pedagogy/modelRequest.test.ts — the untimed warm-up of the large input is not checked against the 10 s cap (bounded by the 60 s test timeout).
