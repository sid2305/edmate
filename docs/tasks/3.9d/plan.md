# 3.9d plan: apps/worker real-clock turn test flake

READY (lead plan; a small follow-up to 3.9b on the same pattern).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
- The worker tests run full turns on a slack clock.
- A forced 10x-slow runner (e.g. a slow-clock test) stays green.
- Production budgets are unchanged.

## What happened
On PR #90's CI, `apps/worker/test/safetyEvent.int.test.ts:186` ("a jailbreak turn → its reply to the student, and one strike row via the worker") received `{ type: 'error', code: 'guard_blocked', retryable: true }` instead of the jailbreak block reply. The cold first turn ran past preGuard's budget on the real clock and failed closed. 3.9b found and fixed the same cause in apps/cli (`buildChatDeps` takes an optional clock; tests pass `slackClock(10)`, which slows `sleep` and `now()` together). Read that fix with `git show 3455c35`.

## Steps
1. Find how the worker test builds its turn dependencies, and every other test in apps/worker (and any other app outside apps/cli) that runs full turns on the real clock: `grep -rn "runTurn\|buildChatDeps\|systemClock\|realClock" apps/*/test apps/*/src`.
2. Reuse 3.9b's approach. Thread an optional clock through the worker's turn-deps builder (default: the production clock) and pass `slackClock(10)` in tests. If `slackClock` lives in apps/cli, move it or copy it to a shared test helper only if a shared place already exists; otherwise a small local helper is fine.
3. Make the failing no-error assertions print the error event and the trace step outcomes, as 3.9b did.
4. Add a test that runs the jailbreak turn with an artificially slow model/classifier (still inside the slacked budget) and stays green.
5. Production budgets and default clocks are unchanged. Don't touch packages/harness guard budgets.

## Budget
About 50 tool calls, one phase. Packages: apps/worker only (plus apps/cli only if a helper must move).

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm/turbo for apps/worker, the secret scan, git).

## Exit conditions
- Done: `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...` is green twice in a row, the handoff is written, and the branch is pushed.
- Stop with `Status: PARTIAL`: past about 70 calls, or the fix needs packages/harness changes.

## Files out of bounds
packages/** (except reading), apps/web/**, .claude/**, .github/**.

## Risky paths touched
None expected (apps/worker/test/** isn't in `risk-paths.txt`). If the fix touches a risky path, say so in the handoff.

## Decisions (draft)
- A slack test clock, not a longer production budget (same as 3.9b) · risk: low.
