# 3.9b review — APPROVE
Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

No risky paths. Both reviewers confirmed the root cause against the harness code: runner.ts subtracts the scrub's measured `clock.now()` time from preGuard's 400 ms budget, and runWithTimeout races against `clock.sleep`. The cold first turn's preGuard runs past the budget on a loaded CI runner and fails closed. The fix is test-only. buildChatDeps takes an optional clock, which defaults to systemClock(), so `edmate chat` is unchanged. slackClock(10) slows `now()` and `sleep` together, and only test files import it. Failing assertions now print the error events and step outcomes. typescript-reviewer re-ran typecheck, lint and test on a clean clone: 26 of 26 passed.

The production side (a real student's cold first turn on a busy server) is a follow-up: 3.9c.

## Findings
- [LOW] [wontfix] apps/cli/src/commands/chat.test.ts:127 — 10x slack has a modest margin over the worst cold cost seen under extreme overload (~2 s); fine for CI today. 3.9c addresses the cold cost itself.
- [LOW] [wontfix] apps/cli/src/commands/chat/deps.test.ts:150 — the slackClock unit test's bounds are loose on purpose (timing tolerance on CI).
