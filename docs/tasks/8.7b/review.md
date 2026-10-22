# 8.7b review — APPROVE

Reviewers: code-reviewer (opus), typescript-reviewer (sonnet), lead

## Findings
- [HIGH] [fixed] apps/worker/src/gate/agent.ts — collectReply scored a retryable guard_blocked (failed pre-guard chain) as a real block, so a must_block case could pass with no guard verdict; now it fails the case (fix bd35f35, verified by code-reviewer).
- [MEDIUM] [deferred 8.7f] apps/worker/src/gate/agent.ts — input.skill and input.persona are ignored, so persona and feedback cases run as plain message turns.
- [MEDIUM] [deferred 8.7f] apps/worker/src/gate/agent.test.ts — the LockedLeakDetected exception has no pipeline test with a leaking scripted stream.
- [MEDIUM] [deferred 8.7f] apps/worker/src/gate/agent.ts — collectReply's default: break has no exhaustiveness guard over TurnEvent.
- [MEDIUM] [deferred 8.7f] apps/cli/src/commands/eval/liveAgent.ts — the CLI live eval still scores any guard_blocked as a block (same bug, outside this diff).
- [LOW] [deferred 8.7f] apps/worker/src/gate/agent.ts — await run.finished in a finally when collectReply throws.
- [LOW] [deferred 8.7f] apps/worker/src/gate/agent.ts — LockedLeakDetected is matched by error.name; export the class or a code.
- [LOW] [deferred 8.7f] apps/worker/src/gate/ports.ts — a separate lockedLeaks counter; comment on GateUsageMeter.record widening ctx.
- [LOW] [deferred 8.7f] apps/worker/src/gate/testkit.ts — test-only module under src/; unused @edmate/content dependency.
