**Status:** DONE

## What changed

`apps/web/e2e/fixtures.ts`'s `mockTurns` used to clamp an overflow turn request onto the last
scripted fixture body (`Math.min(at, bodies.length - 1)`), so a double-send (`postOnce` re-running
its `act` when a real post-hydration request outlasts the inner 2s poll) would silently reuse the
last fixture and pass (9.7d review MEDIUM). `mockTurns` now tracks `at` against `bodies.length`:
a request within range still gets its single-use fixture as before; a request past the end gets a
`500` (so the chat's own stream-error UI shows rather than a hang) and the route handler then
throws a clear `Error` naming the request number and the scripted count, which Playwright Test
surfaces as a failed test via its unhandled-rejection reporting.

Checked every caller of `mockTurns` in `apps/web/e2e/*.spec.ts` (`chat.spec.ts`, `full-flow.
spec.ts`, `skills.spec.ts`): each test's fixture-array length already equals the number of real
sends it makes (one fixture per `sendMessage`/`getHint`/button-click turn, including the two
multi-fixture cases -- `chat.spec.ts`'s error-then-retry test and `skills.spec.ts`'s practice and
mock-interview tests), so no call site relies on the old clamp and none needed a "repeat" option
or any assertion change.

## Evidence

e2e specs run in CI (Postgres + `next dev`), not locally here (no docker compose per brief). Ran
locally instead:
- `corepack pnpm turbo run build --filter=@edmate/web^...` -- 7/7 tasks successful (cached).
- `corepack pnpm turbo run typecheck lint --filter=@edmate/web --force` -- 9/9 tasks successful:
  `@edmate/web:typecheck` (`tsc --noEmit -p tsconfig.json`) and `@edmate/web:lint` (`eslint .`)
  both clean.
- `corepack pnpm --filter @edmate/web exec playwright test --list` -- all 16 tests across the 4
  spec files still load and list correctly (chat.spec.ts x10, full-flow.spec.ts x1, skills.
  spec.ts x4, teacher-packages-walkthrough.spec.ts x1), confirming the fixtures.ts change didn't
  break compilation or discovery of any existing spec.
- `python3 .githooks/secret-scan.py --all` -- exit 0, no output.

## Decisions

None.

## Budget

Tool calls used: 17
