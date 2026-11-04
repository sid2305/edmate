# Task 4.2e: Pin lockedLeaks at 0 in the distress-with-attachment gate test

Plan written by the lead (one-line test change; no planner needed).

## Acceptance (verbatim)
"the assertion is added, and fails if isGuardDetection is put back into the lockedLeaks counter; the gate passes with --filter=@edmate/worker"

## Change
- `apps/worker/src/gate/agent.test.ts`: in the test "distress still escalates with no error when the turn carries an attachment (task 4.2d)", add `expect(s.effects.lockedLeaks).toBe(0);` after the alerts check, with a one-line comment: a guard detection (the attachment `ScrubFailedError`) must not count as a locked leak.
- No other file changes besides `docs/tasks/4.2e/handoff.md`.

## Evidence (mutation run)
1. Add the assertion; the worker tests pass.
2. Temporarily change the lockedLeaks counting in `apps/worker/src/gate/agent.ts` back to also count guard detections (e.g. `instanceof LockedLeakDetected || isGuardDetection(err)`). Run the test and confirm it fails on the new assertion. Paste the failing line into the handoff.
3. Revert the mutation with an Edit (never `git checkout --`/`git restore`), and confirm the worker tests are green again.

## Risky paths
None. `apps/worker/src/gate/**` is not in risk-paths.txt. The review is code-reviewer only, and there's no risk: high decision.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/worker`

## Budget
15 tool calls, with a hard stop at 20.
