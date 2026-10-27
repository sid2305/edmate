# Review: 0.20g

Reviewers: code-reviewer, typescript-reviewer

## Findings
- [MEDIUM] [deferred 0.20h] global-setup.ts (apps/web/e2e/) warm-up fetches have no timeout, so a route that accepts the connection but never answers would stall globalSetup (raised by both reviewers).
- [LOW] [deferred 0.20h] global-setup.ts (apps/web/e2e/) the two warm-up fetches run one after the other; Promise.all would be quicker.

## Verdict
Pass. The fix is one best-effort file, matches the plan and doesn't raise any timeout; chat.spec.ts passed on the first try in 10 of 10 fresh local runs. The lead will re-run CI e2e on the PR as extra proof.
