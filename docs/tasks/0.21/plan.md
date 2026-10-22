# 0.21 plan: SSE route test flake (lead-written)

READY

## Problem
`apps/web/src/turn/routes.test.ts` › "streams SSE with the right headers: tokens, then done" fails in CI now and then
with `expected '' to be 'Hello there.'`: the stream ends with no token events. It has failed on PRs #116, #118
and #121 and passed each time on a re-run. The test already has a 20 s timeout, so this is not a vitest timeout.
Locally it passes.

## Steps
1. Read the route (`apps/web/src/turn/`) and the test helpers (`routes(...)`, `says(...)`, `events(...)`). Find any
   wall-clock path that can drop tokens: a first-token or per-turn deadline, an abort or idle timer, a race between
   the stream and `done`, or a fallback reply path.
2. Reproduce under load, for example by running the file many times in parallel with CPU pressure
   (`corepack pnpm --filter @edmate/web exec vitest run src/turn/routes.test.ts --repeat`, or a loop with several
   processes at once). Record what you ran and what you saw.
3. Fix the cause. If it is a real product bug (tokens lost under a slow event loop), fix the route and add a test
   that pins it with a fake clock. If it's only the test (a real-time deadline in a unit test), inject the clock or
   deadline so the test is deterministic. Don't just raise a timeout unless that is genuinely the cause, and say why.
4. Show it holds: 20 runs in a row under load, all green.

## Files
`apps/web/src/turn/**` (the route and its tests) and `docs/tasks/0.21/handoff.md`. Nothing outside apps/web.

## Risky paths touched
None expected. If the fix reaches a path in `.claude/skills/merge-gate/risk-paths.txt`, stop and report.

## Budget
Budget: 30 tool calls (1 phase, apps/web)

## Exit conditions
The cause is named in the handoff, the fix is in, 20 runs under load are green, and
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` passes.
