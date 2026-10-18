# 3.13 plan — TurnConfigStore port + ADR-0004
Written by the team lead from architect's design (18 Oct 2026); no planner run. Board: `board.py show 3.13`.

## Why
No port loads the agent, package version, style card and locale pack for a turn, and `Entitlement` carries no agent version (3.1 plan Q4). Pre-guards, scrub (PII patterns) and escalate (helplines) need the locale, and the fallback context needs the style card, so these load at `entitle`, not `buildContext` — a deviation from the Turn pipeline spec that ADR-0004 records.

## Change (contracts — lead-approved, risk: high)
Add to `packages/contracts/src/ports.ts`:
```ts
import type { LocalePack } from './locale.js';
import type { AgentConfig, PackageConfig, StyleCard } from './teacher.js';
/** The config a turn runs on: pkg at e.packageVersion, agent at the session's pinned version. */
export interface TurnConfigStore {
  load(e: Entitlement, sessionId: string): Promise<{
    agent: AgentConfig; pkg: PackageConfig; styleCard: StyleCard; locale: LocalePack;
  } | null>;
}
```
(Adjust import paths/names to the actual module layout; no other contract changes.)

## Files
- `packages/contracts/src/ports.ts` (+ index export), a type-level test.
- `docs/edmate-harness-build-plan.md`: add the port to the Core contracts block, and note in the Turn pipeline spec that `entitle` loads agent, package, style card and locale (buildContext loads nothing new). The spec-types drift test must pass against the updated block.
- `docs/adr/0004-turn-config-store.md` (template headings; `check-headings.py` must pass): Context, Decision (one additive port built in the composition root from db repositories plus locale packs; `entitle` checks every loaded object belongs to the entitlement's teacher — agent.id/teacherId, pkg.teacherId/agentId/version, styleCard.id === agent.styleCardId with the same teacher, locale.market — and fails closed with `no_access`), Alternatives (widen EntitlementStore.resolve; a harness-defined dep, against ADR-0002; four separate stores), Consequences (one call within entitle's 50 ms budget; fail-closed teacher checks; the in-memory and db adapters come in 3.2; the real locale loader in 3.10, fixture pack until then). Reviewers line filled by the lead after review.
Out of bounds: adapters (3.2), harness pipeline changes (3.2), db repos.

## Reviewers
architect, security-reviewer, typescript-reviewer (opus) — required for packages/contracts and docs/adr. Handoff needs a risk: high entry.
