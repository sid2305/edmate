# 2.3 review — APPROVE
Reviewers: typescript-reviewer (sonnet), silent-failure-hunter (sonnet)

typescript-reviewer confirmed the router implements ModelGateway exactly, tier/override resolution and capability checks match the plan, no hard-coded model ids outside the provisional default policy, 100% router coverage. silent-failure-hunter confirmed fallback fires only on retryable GatewayErrors, never on truncated/content_filter (non-retryable by construction), never after a chunk reached the caller, misconfiguration fails at construction, and abort propagates to the fallback. Fix round 1 (9087989): 222 gateway tests.

## Findings
- [MEDIUM] [fixed] packages/gateway/src/router/router.ts:184 — `stream()` threw capability errors at call time, unlike the adapters. Now throws only during iteration.
- [MEDIUM] [fixed] packages/gateway/src/router/router.ts:118 — when the fallback also failed, the primary's error was lost. Now attached as `cause`.
