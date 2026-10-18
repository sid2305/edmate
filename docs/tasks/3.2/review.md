# 3.2 review — APPROVE
Reviewers: security-reviewer (opus), database-reviewer (sonnet), typescript-reviewer (sonnet)

security-reviewer confirmed the entitlement source is server-side, only studentId/agentId are read from input and validated first, the session is read scoped to student × teacher with agent and ended state checked, the agent loads at the session's version, package/style card/locale match the entitlement, `agents.owner` returns only teacherId for live agents, every refusal is `no_access`, and switching session doesn't reset the daily limit. database-reviewer confirmed every query is single-row and index-backed. typescript-reviewer confirmed the 3.1 step interface is unchanged, exhaustive error mapping, a swappable limiter for 3.14, in-memory stores matching the contracts ports, and ADR-0004's required tests in both harness and db (308 harness tests incl. a 2,000-run property test). The style card loads as the exact row `agent.styleCardId` names, which is immutable — the case the lead's plan answer allowed; ADR-0004's "latest version" wording is for 8.4 to settle.

## Findings
- [MEDIUM] [deferred 3.14] packages/db/src/repositories/ports.ts:95 — entitle's subscription path makes about 7 sequential round trips; `modules.ids` and the package fetch can run concurrently. Fix alongside the durable counters.
- [LOW] [deferred 10.3] packages/db/src/repositories/ports.ts:94 — `periodEnd` isn't compared to the turn time, so a subscription left active by a missed webhook keeps access; the subscription state machine owns expiry and grace.
- [LOW] [wontfix] packages/harness/src/pipeline/steps/entitle.ts:32 — `sessionId as string` after a successful parse. See decision log 18 Oct 2026.
