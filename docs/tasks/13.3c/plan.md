# Plan: 13.3c — 7-day sign-in sessions (B-60)

Status: READY (written by the lead; a one-value change)

## Accept (verbatim, docs/board/tasks.yaml)
> a test pins the 7-day max age and the daily renewal; @edmate/web typecheck, lint and test green.

## Background
The human decided B-60 on 27 Oct 2026 (docs/decisions/log.md, "Sign-in sessions last 7 days, renewed on use"): a database sign-in session lasts 7 days and is renewed while the person keeps using Edmate. Today `SESSION_MAX_AGE_S` in `apps/web/src/auth/config.ts:24` is 30 days, and `SESSION_UPDATE_AGE_S` (line 25) renews the session once a day of use, which already gives "renewed on use".

## Change (test first)
1. `apps/web/src/auth/config.test.ts:191-198`: rename the case to "7-day expiry refreshed daily" and expect `SESSION_MAX_AGE_S` to be `604_800` and `SESSION_UPDATE_AGE_S` to be `86_400`. Run it: red.
2. `apps/web/src/auth/config.ts:24`: `SESSION_MAX_AGE_S = 7 * 24 * 60 * 60`, with a one-line comment naming B-60. Keep `SESSION_UPDATE_AGE_S` as it is. Green.
3. Grep apps/web and docs for any other place that states the 30-day sign-in session (not the 30-day subscription or cost windows, which are different things) and update it.

## Files
- `apps/web/src/auth/config.ts`, `apps/web/src/auth/config.test.ts`, plus any doc line found in step 3; `docs/tasks/13.3c/handoff.md`.

## Risky paths
`apps/web/src/auth/**` → security-reviewer (plus code-reviewer and typescript-reviewer). The handoff carries a `risk: high` decision naming apps/web/src/auth/config.ts.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web`, `corepack pnpm exec prettier --check` on changed files, `python3 .githooks/secret-scan.py --all`.

## Budget
15 tool calls, 1 phase.
