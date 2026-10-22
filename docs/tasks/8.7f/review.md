# 8.7f review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), silent-failure-hunter (sonnet), lead

## Findings

- [MEDIUM] [deferred 8.7g] apps/cli/src/commands/eval/liveAgent.ts — the CLI live-agent eval still drops input.skill and input.persona and scores such a case as a plain message instead of failing it (a pre-existing gap the handoff lists; the gate agent itself fails persona cases loudly).
- [MEDIUM] [deferred 8.7g] apps/cli/src/commands/eval/liveAgent.ts — collectReply splits only guard_blocked; every other error code (rate_limited, provider_error, turn_cost_exceeded and others) falls through, so the case scores the partial text instead of failing, unlike the gate's collectReply.
- [LOW] [deferred 8.7g] apps/worker/src/gate/agent.ts — the collectReply doc comment says any other error event throws, but blocked and non-retryable guard_blocked do not (wording only; the behaviour is correct).
