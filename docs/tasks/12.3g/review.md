# Review: 12.3g — APPROVE

Reviewers: security-reviewer (sonnet)

security-reviewer reviewed the build and found nothing.

## Findings
None.

## Notes
- `by` is now typed string; every caller (the route and two page first-paints) already passed the session user id.
- enrichQueueRows' new optional list is supplied only by listRepeatInfringersForStaff from its own staff-scoped read; the verifications list and lookup callers still read fresh.
- The two boundary tests pin the inclusive 365-day window; a third test checks listActiveForStaff runs once per repeat-infringers request.
