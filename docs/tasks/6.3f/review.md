# Review: 6.3f — APPROVE

Reviewers: security-reviewer (sonnet), database-reviewer (sonnet), code-reviewer (sonnet), typescript-reviewer (sonnet)

All four reviewed the build. database-reviewer re-checked fix round 1 and reported the approve lost update fixed, with no deadlock path and no new CRITICAL or HIGH.

## Findings
- [HIGH] [fixed] packages/db/src/repositories/mistake-proposals.ts:196 — approve read the latest card and merged tags before taking the 8401 version lock, so two approves of different tags for one teacher lost one tag while marking both approved (from 6.3a; reachable by two quick clicks). Fix round 1 adds lockStyleCardVersions in style-cards.ts and approve takes it before the read (the lead raised this from LOW).
- [LOW] [fixed] packages/db/test/mistake-proposals.int.test.ts — the concurrent record test now also asserts at least one call is refused with limit.
- [LOW] [wontfix] packages/db/src/repositories/mistake-proposals.ts:38 — the local LastSeen copy of contracts' timestamp() could drift if formats.ts changes; exporting it needs an ADR, so the comment stays the guard (lead decision).
- [LOW] [wontfix] apps/web/src/studio/mistakeProposalRoutes.ts — no rate limit on approve and reject; teacher-only, signed in, same-origin and bounded by the 100-row cap (lead decision).

## Notes
- security-reviewer verified all five 6.3a carry-overs fixed: the tag cap on approve, the role check and 8402 lock on record, the lastSeen format and the shared tag max length in both routes. Advisory lock namespaces 8401, 8402, 8601, 8602 and 8701 are distinct.
- code-reviewer found nothing. Behaviour change: an approve refused at the tag cap returns limit_reached and the tag stays pending.
- typescript-reviewer confirmed LastSeen matches contracts' timestamp() and that approve's limit maps to 409 limit_reached through the existing route mapping.
- database-reviewer confirmed the lock order (role, proposal row, 8401) cannot cycle with create or record, and the second 8401 take inside insertNextVersion is a harmless re-acquire.
