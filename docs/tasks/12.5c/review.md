# 12.5c review — APPROVE

Reviewers: security-reviewer (sonnet), lead

The security-reviewer read the staff alert inbox API (GET list, POST acknowledge), the page, client polling, the /staff banner and the en.json keys, plus 12.5a's repository methods it reuses. Staff-only access is enforced by ROUTE_POLICY and again by the repository; the role is re-checked per request; the POST body is a strict zod object, so the acting staff id comes only from the session; acknowledge is transactional, idempotent and audited once; CSRF is covered by the shared same-origin guard. No student contact details reach the API or page, the excerpt and note render as React text, and errors log only the error name. The lead checked the diff touches only apps/web and the handoff.

## Findings
- [LOW] [wontfix] apps/web/app/api/staff/alerts/route.ts — no server-side rate limit on the staff alert routes (client polls every 30 s); same as the existing staff verification routes, staff-only and capped at 50 rows.
