# 0.20 review — APPROVE

Reviewers: code-reviewer (sonnet)

## Findings
None. code-reviewer checked:
- the change is timeout-only: `vitest.config.ts` `testTimeout: 20_000`, and the per-test timeouts raised to 20 s;
- every changed constant is used only as an `it()` / `it.each()` timeout;
- no guardrails source, assertion, `.github/**` or turbo change;
- the `piiPatterns.test.ts:555` latency assertion is untouched.
