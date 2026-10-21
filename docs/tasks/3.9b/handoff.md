# 3.9b handoff: apps/cli chat-test CI flake

- **Status:** DONE
- **Branch:** `m3/3.9b-cli-chat-flake`
- **Worktree:** `.claude/worktrees/agent-a06b39fa00b3e61e5`

## Root cause
The CLI chat tests run full turns through the real `defaultSteps` pipeline on the **real system
clock** (`buildChatDeps` always used `systemClock()`). Step 3's budget is 400 ms (scrub plus
preGuard's three classifier guards, with a 300 ms slice per guard). On a **cold first turn** the
preGuard step costs about 150 ms on an idle laptop (warm turns cost 1–8 ms). On a loaded CI runner
that cold cost goes past 400 ms. The step times out, preGuard fails closed (`PRE_GUARD_FAILED`), and
the turn ends in an `error` event. A re-run lands on a quieter runner and passes. Production is
right to fail closed here: the bug was that the tests timed real wall-clock work against
production budgets.

Two parts of the harness read the clock: `runWithTimeout` races `clock.sleep`, and the runner also
subtracts `clock.now()` deltas from budgets (`budget - sc.ms` for preGuard, and the
postGuard slices). So stretching only `sleep` is not enough. Under heavy load the scrub alone can
use the whole 400 ms of real time, and preGuard then gets a budget of 0 or less. I saw that in a
first attempt that scaled only `sleep`.

## Fix (tests only; production timeouts and harness unchanged)
- `apps/cli/src/commands/chat/deps.ts`: new optional `ChatDepsOptions.clock` (defaults to
  `systemClock()`, so `edmate chat` behaves the same). New `slackClock(factor)`: a real clock that runs
  `factor` times slower, with `sleep(ms)` waiting `ms*factor` and `now()` advancing at `1/factor`
  speed. Budget math and timeouts stay consistent with each other.
- `deps.test.ts`, `sameTopic.test.ts`, `chat.test.ts`: every scripted full-turn test now uses
  `slackClock(10)`, so step budgets are 10x wider. `chat.test.ts` gets it through the existing
  `ChatCommandDeps.buildDeps` injection, so `chat.ts` is unchanged.
- Diagnostics: the no-error assertions now print the error events and the trace's step outcomes on
  failure: `expect(events.filter(e => e.type === 'error'), JSON.stringify(result.trace?.steps)).toEqual([])`.
  `sameTopic.test.ts` gained the same check before each turn's other assertions.
- New unit test for `slackClock`: sleep and `now()` slow together, and cancel still ends a sleep early.

## Evidence
- Repro before the fix: 16 runs of the two chat files (8 in parallel, 16 `yes` CPU hogs, 8 cores)
  gave **1 failure**. Message: `AssertionError: [..{"name":"preGuard","ms":468,"outcome":"failed"}..]:
  expected [ { type: 'error', …(2) } ] to deeply equal []`.
- First-turn timings on an idle laptop (debug log, since removed): `preGuard 149-151ms`, `route 45`,
  `buildContext 45`; later turns: `preGuard 1-8ms`.
- After the fix, the same chat-turn files (deps, sameTopic, chat), 32 runs (4 rounds × 8 in parallel,
  16 hogs): `pass=32 fail=0`. With sleep-only slack under an even heavier load (8 full suites in
  parallel), turns still failed with `preGuard ms 542..1216 failed`, which led to slowing `now()` too.
- Acceptance: the full `apps/cli` suite run **20 times in a row** under 16 CPU hogs:
  `pass=20 fail=0` (`Tests 83 passed (83)` × 20).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/cli...` gave `Tasks: 26 successful, 26 total`.
- CI evidence comes from this PR's own runs; GitHub Actions run 39615331260 was still in progress
  when I read it, so its log was not available.

## Deviations
- `chat.test.ts`'s scripted session tests also get the slack clock. They run the same cold full
  turn and carry the same latent flake, though they were not in the report.
- Out of scope, seen only under extreme overload (8 full suites in parallel): unrelated `world.test.ts`
  and `content.test.ts` cases hit vitest's default 5000 ms test timeout. Not seen at the acceptance
  load. Not changed.

## Decisions
- Fixed in the tests, not in production: the CLI composition root takes an optional clock, and the
  tests pass a 10x slower real clock. Production step budgets (`STEP_SPEC`, `PRE_GUARD_SLICE_MS`)
  and harness behaviour are untouched.
- `slackClock` slows `now()` as well as `sleep()`, because harness budgets subtract `now()` deltas.
  Scaling only `sleep` was tried and still failed under load.
- Factor 10: it gives preGuard 4 s against a worst-case cold cost of about 2 s seen under extreme
  overload, while a genuinely hung step still fails inside the tests' 20 s timeout.
