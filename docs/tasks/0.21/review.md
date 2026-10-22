# 0.21 review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

## Findings
- [MEDIUM] [deferred 9.4a] apps/web/test/turn-backend.ts — deadlineSafeClock's cancellable sleep never resolves on its own, so a truly hung step now fails at vitest's test timeout rather than with a timeout status; add a long real fallback timer.
- [LOW] [deferred 9.4a] apps/web/test/turn-backend.ts — the doc comment should say a test that needs a deadline to fire must use its own clock.
- [LOW] [deferred 9.4a] apps/web/test/turn-backend.ts — no direct unit test for the cancel and no-cancel sleep branches.
