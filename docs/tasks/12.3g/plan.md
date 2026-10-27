# Plan: 12.3g — 12.3d review LOWs

Status: READY (written by the lead, 27 Oct 2026)

## Why
code-reviewer's three LOWs on 12.3d (docs/tasks/12.3d/review.md), deferred so 12.3d could merge. Small and in the same files, so it runs now.

## Changes (tests first)
1. `apps/web/app/api/staff/repeat-infringers/handlers.ts`: type `by` as `string` in `listRepeatInfringersForStaff` (the route passes `ctx.principal.userId`) and drop the `typeof by === 'string' ? by : ''` fallback. Update any caller (the page's first paint) that passes another type.
2. `apps/web/app/api/staff/repeat-infringers/route.test.ts`: pin the exact window boundary. A takedown created exactly `REPEAT_INFRINGER_WINDOW_DAYS` days before "now" counts; one a millisecond older does not. Use the test's fixed clock; don't change the boundary rule (12.3d chose inclusive).
3. Read `takedowns.listActiveForStaff` once per request: give `enrichQueueRows` in `apps/web/app/api/staff/verifications/handlers.ts` an optional pre-fetched active list (an extra optional parameter; existing callers unchanged), and have `listRepeatInfringersForStaff` pass the list it already read. Add a test that the repeat-infringers path calls `listActiveForStaff` once.

## Files
Modify: the three files above and their tests (`apps/web/app/api/staff/{repeat-infringers,verifications}/**`, plus `apps/web/app/staff/repeat-infringers/page.tsx` only if item 1 needs it). Plus `docs/tasks/12.3g/handoff.md`.
Out of bounds: packages/**, migrations, apps/web/src/auth/**, messages.

## Risky paths touched
`apps/web/app/api/staff/**` (and `apps/web/app/staff/**` if the page changes): security-reviewer, plus a lead `risk: high` decision.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web`
- `corepack pnpm exec prettier --check` on the changed files
- `python3 .githooks/secret-scan.py --all`

## Budget
Budget: 35 tool calls.
