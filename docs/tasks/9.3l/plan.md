# 9.3l plan: two stale header comments in the student plan page

Written by the lead (comment-only change; no planner run).

## Acceptance (verbatim, board)
Both header comments match the behaviour; web typecheck, lint and test green.

### How it is shown (paste into handoff.md)
- The two header comments quoted before and after in the handoff.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force --concurrency=1` green.

## Design
1. `apps/web/app/learn/[agentId]/plan/page.tsx` header: it still says "a draft, suspended or missing one gives notFound". Read the page and 9.3i's change (docs/tasks/9.3i/handoff.md) and describe what happens now: the student's own unavailable-agent fallback renders the page (say exactly which cases still give notFound, if any).
2. `apps/web/src/subscriptions/PlanView.tsx` header: add the redirect to `/home` when `agentAvailable` is false (read the component for the exact condition).
Comments only: no code, test or copy change.

## Files to create/modify
- apps/web/app/learn/[agentId]/plan/page.tsx (header comment only)
- apps/web/src/subscriptions/PlanView.tsx (header comment only)
- docs/tasks/9.3l/handoff.md

## Files out of bounds
Everything else (9.3h is editing apps/web/app/staff and apps/web/src/staff in parallel).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
None expected; the lead checks at merge.

## Questions
None.

## Budget
15 tool calls; stop at 22.
