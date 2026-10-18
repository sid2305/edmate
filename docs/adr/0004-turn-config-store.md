# ADR-0004: TurnConfigStore port

## Status

Accepted

## Date

2026-10-18

## Context

A turn needs the agent config, the package config, the teacher's style card and the market's locale pack. No port in `packages/contracts` loads them, and `Entitlement` carries no agent version (task 3.1 plan, open question 4). The Core contracts block already puts `agent` and `pkg` in `TurnContext`, but nothing says where they come from.

Several steps need this config before `buildContext` runs. `preGuard` scrubs PII with the locale pack's `piiPatterns`; `escalate` sends the locale pack's helplines; the fallback context needs the style card. The Turn pipeline spec listed the style card under step 6 (`buildContext`), which is too late for those steps. Task 3.2 (`admit` and `entitle`) depends on this port.

## Decision

Add one port to `packages/contracts/src/ports.ts` and to the build plan's Core contracts block:

```ts
interface TurnConfigStore {
  load(e: Entitlement, sessionId: string): Promise<{ agent: AgentConfig; pkg: PackageConfig; styleCard: StyleCard; locale: LocalePack } | null>;
}
```

It returns the package at `e.packageVersion`, the agent at the version the session is pinned to, the latest version of the style card `agent.styleCardId` (as task 8.4 expects: a teacher's style card edits apply on the next turn) and the locale pack for `e.market`. No other contract changes.

1. **Built in the composition root.** The adapter is assembled from the db repositories (agents, packages, style cards) plus the locale packs, in the app that wires the harness, as ADR-0002 requires for every port.
2. **Loaded at `entitle`, not `buildContext`.** Step 2 loads the agent, package, style card and locale pack once; `buildContext` loads nothing new. This is a deviation from the earlier Turn pipeline spec, which the build plan now records.
3. **The session is checked, never trusted.** `sessionId` comes from the client's `TurnInput`, so a session id is never trusted on its own. `load` returns `null` unless the session row's `studentId === e.studentId`, `teacherId === e.teacherId` and `agentId === e.agentId`, and the session is open (not ended). `entitle` then fails with `no_access`.
4. **The agent version comes from the session row.** It is the session's `agent_version`, set on the server when the session is created and never taken from the client. `load` returns the agent at exactly that version. `Entitlement` does not change.
5. **Fail closed on any mismatch.** `entitle` checks that every loaded object belongs to the entitlement: `agent.id === e.agentId` and `agent.teacherId === e.teacherId`; `pkg.id === e.packageId`, `pkg.teacherId === e.teacherId`, `pkg.agentId === e.agentId` and `pkg.version === e.packageVersion`; `styleCard.id === agent.styleCardId` and `styleCard.teacherId === e.teacherId`; `locale.market === e.market`. A `null` result or any failed check ends the turn with `no_access`.

## Alternatives

- **Widen `EntitlementStore.resolve`** to return the config too. Rejected: it mixes access (who may use what) with config loading, changes an existing contract instead of adding one, and makes every entitlement adapter know about style cards and locale packs.
- **A harness-defined dependency** (an interface declared inside `packages/harness`). Rejected: ADR-0002 puts every port in `packages/contracts` so adapters in db and the apps can implement them without importing the harness.
- **Four separate stores** (agent, package, style card, locale). Rejected: four calls inside `entitle`'s 50 ms budget, four adapters to wire, and the version pinning between agent and package would be spread across them.

## Consequences

- One call within `entitle`'s 50 ms budget gives every later step the config it needs.
- Cross-teacher config cannot reach a turn: the teacher checks fail closed, so a bad adapter or a corrupt row gives `no_access`, not another teacher's agent or material.
- The in-memory adapter (for `harness/testing`) and the db adapter come in task 3.2. The real locale loader comes in task 3.10; until then the adapter uses the fixture locale pack.
- Required tests for task 3.2: (a) a session that belongs to another student, teacher or agent, or that has ended, gives `null` from `load` and `no_access` from `entitle`; (b) the agent is loaded at the session row's `agent_version` exactly, and an agent whose `id` or `teacherId` differs from the entitlement gives `no_access`.
- Extends ADR-0002's port list; ADR-0002 is unchanged because accepted ADRs aren't rewritten.
- Changing the port's shape later needs another ADR, like any contract.

## Reviewers

architect (opus), security-reviewer (sonnet), typescript-reviewer (opus), 18 Oct 2026 (PR #16). Approved by the team lead (contracts decisions delegated by the human).
