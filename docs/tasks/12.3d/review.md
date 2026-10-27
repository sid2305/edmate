# Review: 12.3d — APPROVE

Reviewers: security-reviewer (sonnet), code-reviewer (sonnet)

Both reviewed the build; neither found a CRITICAL, HIGH or MEDIUM issue.

## Findings
- [LOW] [deferred 12.3g] apps/web/app/api/staff/repeat-infringers/handlers.ts:67 — `by` is typed unknown and coerced to '' before enrichQueueRows; type it as string (not reachable today: the route passes the session user id).
- [LOW] [deferred 12.3g] apps/web/app/api/staff/repeat-infringers/route.test.ts — the exact 365-day boundary is not pinned by a test (366 days is).
- [LOW] [deferred 12.3g] apps/web/app/api/staff/repeat-infringers/handlers.ts — listActiveForStaff is read twice per request (here and in the reused enrichQueueRows), the same pattern as /api/staff/verifications.

## Notes
- security-reviewer: GET only, wrapped in withRole(['staff']) and covered by ROUTE_POLICY /api/staff/**; the payload matches the existing verification queue and carries no complainant fields; the list is capped at 50 on top of the existing 200-row takedown cap; errors log only the error class; suspend posts to the unchanged /api/staff/verifications route with its same-origin check and audit write.
- code-reviewer: threshold and window logic match B-63 (epoch-ms, no time-zone issue); rejected teachers are left off; en.json changes are append-only; jest-axe covers the list, empty and fallback states; the int test seeds flagged, two-only, lifted-one and already-rejected teachers plus suspend-drops-off and 401/403.
