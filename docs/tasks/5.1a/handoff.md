# Handoff: 5.1a

Status: DONE (already satisfied by 8.2d; no code change)

## Summary
The planner found that task 8.2d (merged 22 Oct 2026, ADR-0014) already pins web-link connections to the checked address:
- packages/ingest/src/fetch/webFetch.ts `checkTarget` resolves each hop once and keeps the first public address.
- apps/worker/src/webLink/pinnedTransport.ts `pinnedLookup` / `pinnedRequestOptions` make Node's request `lookup` answer only with that address (`autoSelectFamily: false`, `agent: false`, certificate checks still on).

Both acceptance clauses already have passing tests:
- packages/ingest/test/fetch/webFetch.test.ts, "a DNS-rebinding resolver (public, then loopback) never yields loopback to the transport": the resolver is called once, and the private second answer is never used.
- apps/worker/src/webLink/pinnedTransport.test.ts and index.test.ts: a local-server connection lands on the pinned address.

## Decisions

### 28 Oct 2026 · 5.1a closed as satisfied by 8.2d · decided by lead · risk: low
- Decided: close 5.1a with no build. The plan's optional extra end-to-end test is not built.
- Why: the board text was written before 8.2d landed. 8.2d's merged and security-reviewed code does exactly what 5.1a asks, and its tests cover both acceptance clauses. A second test of the same path adds cost and no new signal.
- Alternatives: build the planner's one additive test (about 35 tool calls); an independent design audit.
- Reversible: yes; reopen if a review of the web-link path finds a gap.

## Gate
No code change. The existing tests named above run in CI on main.

## Budget
Tool calls used: 0 (planner 28)
