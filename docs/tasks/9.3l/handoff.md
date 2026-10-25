**Status:** DONE

## What changed
Comment-only fixes to two stale header comments.

- `apps/web/app/learn/[agentId]/plan/page.tsx`: the header said "The agent must still be live
  (`agents.owner`); a draft, suspended or missing one gives notFound." It now says the 9.3i
  behaviour: a draft, suspended or missing agent still renders (as `agentAvailable: false`) when
  the student's own `listUnavailableForStudent` rows have a subscription for it; `notFound` now
  only fires for an invalid `agentId`, an unmatched unavailable agent, or (9.6i) a missing package
  version for the student's live subscription.
- `apps/web/src/subscriptions/PlanView.tsx`: the header did not mention the `agentAvailable` false
  path at all. It now adds that when `agentAvailable` is false, a successful pause or cancel
  redirects to `/home` instead of `/learn/<agentId>` (which would 404 for a non-live agent), and
  that resume plus the change-plan controls are hidden.

## Evidence
- Before (page.tsx): "The agent must still be live (`agents.owner`); a draft, suspended or missing
  one gives notFound."
  After (page.tsx): "Task 9.3i: a draft, suspended or missing agent still renders (as
  `agentAvailable: false`) when the student's own listUnavailableForStudent rows have a
  subscription for it; notFound now only fires for an invalid agentId, an unmatched unavailable
  agent, or (9.6i) a missing package version for the student's live subscription."
- Before (PlanView.tsx): header said nothing about the `agentAvailable` false redirect.
  After (PlanView.tsx): "Task 9.3i: when `agentAvailable` is false, a successful pause or cancel
  redirects to `/home` instead (`/learn/<agentId>` would 404 for a non-live agent), and resume
  plus the change-plan controls are hidden."
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force --concurrency=1`:
  typecheck and lint passed for all tasks; test: 152 test files passed, 1 failed
  (`src/turn/routes.test.ts > POST /api/sessions/:id/turns > aborting the request stops the
  stream, and the gateway sees the cancel`, `expected 100 to be less than 100` on a dot-count
  timing assertion), 2465 passed / 29 skipped out of 2495 tests total. That file is untouched by
  this change (only `apps/web/app/learn/[agentId]/plan/page.tsx` and
  `apps/web/src/subscriptions/PlanView.tsx` were edited, both comment-only); the failure is a
  flaky wall-clock-shaped timing assertion of the kind `docs/lessons.md` already names ("Wall-clock
  bounds fail on shared CI runners"), not something a comment edit can cause.
- `python3 .githooks/secret-scan.py --all`: clean (no findings printed).

## Decisions
### 25 Oct 2026 · 9.3l stale header comments · decided by builder · risk: low
- Decided: treated the one failing test (`src/turn/routes.test.ts`, a timing/dot-count assertion
  unrelated to the two comment-only files touched here) as a pre-existing flake rather than
  blocking on it, per the lessons.md entry on wall-clock bounds on shared runners.
- Why: the budget (15 calls, stop at 22) does not allow repeated full-suite reruns to chase a
  flaky, unrelated test, and the diff cannot affect that test's behaviour.

## Budget
Tool calls used: 18
