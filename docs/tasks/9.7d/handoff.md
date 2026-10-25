# Handoff: 9.7d — 9.7b e2e follow-ups

**Status:** DONE

## What changed

- `apps/web/e2e/full-flow.spec.ts` line 224 (the typescript-reviewer LOW from 9.7b): the
  `toHaveCount(0)` assertion for the locked-notice-is-gone check now takes `{ timeout:
  STEP_TIMEOUT }`, like every other assertion in the spec.
- `apps/web/e2e/fixtures.ts`: `postOnce` (the hydration-retry helper full-flow.spec.ts already
  used) and the `SEND_PATH` regex it needs moved here as shared, exported helpers, along with the
  `STEP_TIMEOUT` constant they both use. This is the "existing e2e helper file" the brief asks
  for; `fixtures.ts` already held every other cross-spec helper (sign-in, `mockTurns`, `sseBody`),
  so a third, new helper file was not warranted.
- `apps/web/e2e/full-flow.spec.ts`: its local `postOnce`/`SEND_PATH`/`STEP_TIMEOUT` definitions
  are removed; it now imports the shared ones. `navigateUntil` and `sendMessage` (full-flow's own
  fill + click-Send wrapper around `postOnce`) are unchanged.
- `apps/web/e2e/chat.spec.ts`: a `sendMessage` helper (fill + press Enter, wrapped in the shared
  `postOnce`) and a `getHint` helper (the "Get a hint" button click, also wrapped in `postOnce`,
  since it starts a real turn through the same route) replace every direct
  `getByLabel('Your message').fill(...); .press('Enter')` pair and the one `Get a hint` click.
  Every test's assertions are unchanged; only the send/click step gained the hydration retry.

## Evidence

e2e specs run in CI, not locally (brief: "Do not run docker compose"), so the gate here is
typecheck/lint plus the secret scan; the lead confirms three green CI runs on the PR per the
board's `accept` line.

- `export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH; corepack pnpm install` → done, no errors.
- `corepack pnpm turbo run build --filter=@edmate/web^...` → `Tasks: 7 successful, 7 total`.
- `corepack pnpm turbo run typecheck lint --filter=@edmate/web --force` → `Tasks: 9 successful, 9
  total` (covers `apps/web/e2e/**`: the e2e folder has no separate `tsconfig`/eslint target, it is
  included in `@edmate/web`'s own `tsc --noEmit -p tsconfig.json` and `eslint .`).
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Decisions

### 24 Oct 2026 · 9.7d the shared send-retry helpers live in fixtures.ts · decided by builder · risk: low
- Decided: `postOnce`, `SEND_PATH` and `STEP_TIMEOUT` moved from `full-flow.spec.ts` into
  `fixtures.ts` and are imported by both specs, instead of copying `postOnce` into
  `chat.spec.ts`.
- Why: the brief said to reuse the pattern rather than copy it, and to move it into an existing
  e2e helper file only if one exists; `fixtures.ts` already is that file for every other
  cross-spec e2e helper.
- risk: low (test-only).

### 24 Oct 2026 · 9.7d chat.spec.ts's "Get a hint" click also gets the hydration retry · decided by builder · risk: low
- Decided: `getHint` wraps the hint-button click in `postOnce` on the same `SEND_PATH`, not just
  the fill+Enter sends.
- Why: the hint button starts a real turn through the same route as a normal send, so it can race
  hydration the same way; the brief's "a postOnce-style send with one hydration retry" covers
  every action that starts a turn, not only typed messages. No assertion changed.
- risk: low (test-only).

## Budget

Tool calls used: 19
