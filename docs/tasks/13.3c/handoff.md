# Handoff: 13.3c
Status: DONE

## Summary
Changed the database sign-in session max age from 30 days to 7 days, per the human's B-60
decision (docs/decisions/log.md, 27 Oct 2026): "Sign-in sessions last 7 days, renewed on use."
`SESSION_UPDATE_AGE_S` (daily renewal) already matched "renewed on use" and is unchanged.

- `apps/web/src/auth/config.ts:24` — `SESSION_MAX_AGE_S` changed from `30 * 24 * 60 * 60` to
  `7 * 24 * 60 * 60`, with a one-line comment naming B-60.
- `apps/web/src/auth/config.test.ts:191-198` — renamed the `createAuthConfig` case from "uses
  database sessions with 30-day expiry refreshed daily, and no debug output" to "uses database
  sessions with 7-day expiry refreshed daily, and no debug output"; changed the expected
  `SESSION_MAX_AGE_S` literal from `2_592_000` to `604_800`.

Red: ran `corepack pnpm turbo run test --filter=@edmate/web -- src/auth/config.test.ts` after only
the test change — `AssertionError: expected 2592000 to be 604800`, 1 failed / 52 passed.
Green: after the `config.ts` change, `corepack pnpm turbo run typecheck lint test
--filter=@edmate/web` passed in full (10/10 tasks successful).

Step 3 (grep for other doc lines stating the 30-day sign-in session): found only historical
records (docs/decisions/log.md past entries, docs/tasks/13.3b/plan.md, docs/tasks/13.3/review.md,
docs/board/tasks.yaml task descriptions) — these describe decisions and task state as of when they
were written and are out of this task's file scope; none is a live doc asserting the current
session length as 30 days. No doc changes were needed beyond the two files above.

## Decisions
### 27 Oct 2026 · 13.3c sign-in session length · decided by builder · risk: high
- Decided: `apps/web/src/auth/config.ts`'s `SESSION_MAX_AGE_S` is `7 * 24 * 60 * 60` (604,800
  seconds), replacing the prior 30-day value.
- Why: the human answered B-60 on 27 Oct 2026 (docs/decisions/log.md): "Sign-in sessions last 7
  days, renewed on use." This closes the open question left by 13.3b
  (docs/tasks/13.3b/plan.md's "Open question" section). `apps/web/src/auth/config.ts` is under
  `apps/web/src/auth/**`, a risk-paths.txt identity group, so this is `risk: high`.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` — all 10 tasks passed.
- `corepack pnpm exec prettier --check apps/web/src/auth/config.ts apps/web/src/auth/config.test.ts` — "All matched files use Prettier code style!"
- `python3 .githooks/secret-scan.py --all` — clean, no output.

## Budget
Tool calls used: 14
