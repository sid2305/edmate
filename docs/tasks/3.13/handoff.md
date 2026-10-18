# 3.13 handoff — TurnConfigStore port + ADR-0004

Status: DONE
Branch: `m3/3.13-turn-config-store`
Worktree: `.claude/worktrees/agent-a7626364d813826d9` (under the repo root)

## Acceptance evidence

Node 22.22.3 from nvm, pnpm through corepack.

| Check | Command → output |
| --- | --- |
| Red first | added `expectTypeOf<C.TurnConfigStore>().toEqualTypeOf<Spec.TurnConfigStore>()`; `corepack pnpm typecheck` (contracts) → `TS2694 ... has no exported member 'TurnConfigStore'` (both namespaces) |
| Contracts typecheck | `corepack pnpm typecheck` → clean |
| Contracts tests | `corepack pnpm exec vitest run` → `Test Files 6 passed (6)`, `Tests 282 passed (282)`; coverage 100% statements/branches/functions/lines |
| Spec drift | `spec-drift.test.ts` passes against the updated Core contracts block (part of the 282) |
| Root gates | `corepack pnpm turbo run typecheck lint test` → `Tasks: 32 successful, 32 total`; `corepack pnpm turbo run build` → `Tasks: 10 successful, 10 total` |
| Prettier | `prettier --check` on the ADR and contracts src/test → all formatted |
| ADR headings | `python3 docs/adr/check-headings.py` → exit 0, no output; `python3 -m unittest discover -s docs/adr -p 'test_*.py'` → OK |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0, no output |

## Changes

- `packages/contracts/src/ports.ts`: new type-only port `TurnConfigStore { load(e: Entitlement, sessionId: string): Promise<{ agent; pkg; styleCard; locale } | null> }`. Already exported through `export type * from './ports.js'` in `index.ts`, so `index.ts` is unchanged.
- `packages/contracts/test/types.test.ts`: type-equality check for the new port, both directions.
- `packages/contracts/test/spec-types.ts`: the new port copied verbatim from the build plan block.
- `docs/edmate-harness-build-plan.md`: port added to the Core contracts block (after `EntitlementStore`); Ports-and-adapters list names it; Turn pipeline step 2 (`entitle`) now loads agent, package, style card and locale pack through `TurnConfigStore` with teacher checks (ADR-0004); step 6 notes the style card is already loaded by `entitle`.
- `docs/adr/0004-turn-config-store.md`: new ADR (Context, Decision, Alternatives, Consequences as the plan lists). Reviewers line has the required reviewers; the lead fills it in after review.

No other contract types changed. Nothing in `packages/evals` touched.

## Deviations

- ADR-0002's Decision lists the ports by name and does not list `TurnConfigStore`. I left ADR-0002 alone (accepted ADRs are not edited); ADR-0004 adds the port. The lead can decide whether ADR-0002 needs a "see ADR-0004" note.

## Decisions

### 18 Oct 2026 · 3.13 TurnConfigStore port loads a turn's config at entitle · decided by team lead · risk: high
Decided: Contracts gain one additive port, `TurnConfigStore.load(entitlement, sessionId)`, which returns the agent, package, style card and locale pack for the turn, or null. `entitle` calls it and fails closed with `no_access` unless every loaded object belongs to the entitlement's teacher, agent, package version and market. No other contract changes (ADR-0004).
Why: pre-guards, escalation and the fallback context need the locale pack and style card before `buildContext`, and no port loaded them.
Alternatives: widen `EntitlementStore.resolve`; a port defined inside the harness (against ADR-0002); four separate stores.
Reversible: only by ADR.
