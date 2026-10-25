# 8.7g review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

Both approve. The CLI live eval's `collectReply` now fails a case on every error event except a non-retryable `guard_blocked`, matching the gate. A new `provider_error` test covers this; typescript-reviewer re-ran typecheck, lint and tests in a clean worktree.

## Findings
- [LOW] [wontfix] apps/cli/src/commands/eval/liveAgent.ts — the doc comment's example code `model_error` does not exist in the contracts (`provider_error` does).
