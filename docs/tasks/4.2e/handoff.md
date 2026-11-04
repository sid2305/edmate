# Task 4.2e handoff: pin lockedLeaks at 0 in the distress-with-attachment gate test

Status: DONE

## Decisions

None.

## Red -> green evidence

Added `expect(s.effects.lockedLeaks).toBe(0);` (with a one-line comment) to the test
"distress still escalates with no error when the turn carries an attachment (task 4.2d)"
in `apps/worker/src/gate/agent.test.ts`.

Mutation: in `apps/worker/src/gate/agent.ts`, temporarily changed the lockedLeaks counter
from `(b) => b.error instanceof LockedLeakDetected` to
`(b) => b.error instanceof LockedLeakDetected || isGuardDetection(b.error)`, so the
attachment `ScrubFailedError` (a guard detection) was counted as a locked leak too.

Failing line with the mutation in place (`vitest run src/gate/agent.test.ts`):

```
FAIL  src/gate/agent.test.ts > createGateAgent > distress still escalates with no error when the turn carries an attachment (task 4.2d)
AssertionError: expected 1 to be +0 // Object.is equality
 ❯ src/gate/agent.test.ts:271:35
    269|     expect(s.effects.alerts).toBe(1);
    270|     // a guard detection (the attachment ScrubFailedError) must not co…
    271|     expect(s.effects.lockedLeaks).toBe(0);
       |                                   ^
```
19 passed, 1 failed (20 total).

Reverted the mutation with Edit (restoring the original `instanceof LockedLeakDetected`
filter only, no `git checkout --`/`git restore`). Gate run after revert:

`corepack pnpm turbo run typecheck lint test --filter=@edmate/worker` -> `Tasks: 11 successful, 11 total`.

## Budget

Tool calls used: 23
