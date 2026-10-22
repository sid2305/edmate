# 9.0c review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, silent-failure-hunter

All three approved. `register()` warms the pool only on the Node.js runtime and reaches the database through a dynamic import, so the Edge bundle stays free of pg. It fires the warm-up and returns without waiting. One try/catch covers the import, `serverDatabase()` and the public discovery read, and it logs the error name only. The read's result is discarded. The new root `*.test.ts` include picks up only instrumentation.test.ts.

## Findings
- [LOW] [deferred 9.4a] apps/web/instrumentation.test.ts:81 — the "does not await" test doesn't pin that `register()` itself is non-async; also assert `expect(register()).toBeUndefined()`.
- [LOW] [wontfix] apps/web/instrumentation.ts:41 — one log line for both an import failure and a DB outage; the plan asks for the error name only on a one-shot startup ping, and the error name already differs between the two cases.
