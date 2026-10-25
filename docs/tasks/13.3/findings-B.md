# 13.3 findings — Phase B (web auth, guards, route policy, entitlement)

Reviewer: security-reviewer (sonnet), read-only, 25 Oct 2026.

**Verdict: PASS (no HIGH).** No CRITICAL or HIGH findings in scope.

## Findings
- [LOW] apps/web/src/turn/routes.ts:86 — readability. `ParamsSchema` validates the session `id` path param with `StartSessionSchema.shape.agentId`, reused only as a string-format check. The session's agent is cross-checked at line 303, so access control is unaffected. Fix: add a dedicated `SessionIdSchema`.
- [LOW] apps/web/src/auth/config.ts:24-25 — defence in depth. The database session maxAge and updateAge are long (30 days). This is acceptable because `strategy: 'database'` lets the server revoke any session. Revisit before a wider launch.

## Checked clean
**Auth layer.** apps/web/src/auth/{guard,policy,config,rate-limit}.ts:
- deny-by-default `ruleFor` and `withRole`;
- a same-origin CSRF check on unsafe methods;
- the database session strategy with a `__Host-` cookie;
- the Google account-linking guard;
- sign-in rate limiting with HMAC'd buckets;
- route-coverage.test.ts enforcing that every route is guarded.

**Student routes (IDOR).** export, memory, turn, session reports, subscription change and live-class questions all derive the student from `principal.userId`, never from the body, query or path.

**Teacher routes (IDOR).** studio documents and test chat take their scope from the principal.

**Staff routes.** agents, takedowns, alerts and verifications:
- staff act across tenants by design;
- the actor is always the principal;
- bodies are strict schemas;
- a scope or invalid error returns 403 without revealing whether a row exists.
