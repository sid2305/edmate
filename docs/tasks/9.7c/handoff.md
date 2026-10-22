# Handoff: 9.7c — e2e local-DB guard

## Summary
9.7a review follow-ups, both resolved:
1. `global-setup.ts` now refuses a non-local `TEST_DATABASE_URL` (host not `localhost` /
   `127.0.0.1` / `[::1]`) before `migrate`, `seed`, `grantRole staff` or `setVerification` run, via
   a new pure `assertLocalDatabaseUrl` helper (same allowlist shape as `stack/mail.ts`'s
   `localUrl`). No compose service name (e.g. `postgres`) is in the allowlist: the e2e Postgres is
   always reached from the host via `packages/db/test/compose.port.yaml`'s published port, never
   through the compose network, so a bare service-name host would be wrong, not local.
2. The second item (a failed local run's seeded question breaking the next run's `getByText`) was
   **already fixed on `main`** by 9.7b: `full-flow.spec.ts`'s `UNCOVERED_QUESTION_TEXT` already
   includes a `Date.now().toString(36)` suffix, with a comment citing 9.7a's clean-DB note. No
   spec change was needed; confirmed by reading the file and its git history (`688da5c`, 9.7b).

## Files
- `apps/web/e2e/localDatabaseGuard.ts` — new pure helper, `assertLocalDatabaseUrl`.
- `apps/web/e2e/localDatabaseGuard.test.ts` — new vitest unit test (local hosts allowed incl.
  bracketed IPv6; compose service name, a public hostname and a non-local IP refused; an
  unparseable URL throws).
- `apps/web/e2e/global-setup.ts` — calls the guard first thing in `globalSetup`, before any write;
  updated file-header comment.
- `apps/web/vitest.config.ts` — added `e2e/**/*.test.ts` to the `test.include` glob, so this new
  test (and any future e2e-helper unit test) runs under `@edmate/web`'s existing `pnpm test`/CI
  gate. No existing unit test lived under `apps/web/e2e` before this task (confirmed by search), so
  this file was not already wired for it.

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — all 34 tasks green,
  including the new `e2e/localDatabaseGuard.test.ts` (8 tests) inside `@edmate/web:test`'s vitest
  run (not Playwright; Playwright CI behaviour is unchanged — no `e2e` script or
  `playwright.config.ts` file was touched).
- `python3 .githooks/secret-scan.py --all` — clean.
- Playwright itself was not run locally (no disposable Postgres stack available in this
  environment); CI's `node` job runs it unchanged, per the brief.

## Decisions

### 22 Oct 2026 · 9.7c global-setup refuses a non-local TEST_DATABASE_URL · decided by builder · risk: low
- Decided: added `apps/web/e2e/localDatabaseGuard.ts` (`assertLocalDatabaseUrl`, allowlisting
  `localhost`/`127.0.0.1`/`[::1]`) and call it first in `globalSetup`, before `migrate.js`,
  `seed.js` or `verifyDemoTeacher`'s staff-role/verification writes. No compose service name is
  allowlisted: the e2e suite always talks to Postgres over its published host port
  (`packages/db/test/compose.port.yaml`), never the compose network, so a bare service name is
  never a legitimate `TEST_DATABASE_URL` here.
- Why: security-reviewer MEDIUM on 9.7a — `global-setup.ts` ran migrate/seed and wrote a staff
  role and teacher verification against whatever Postgres `TEST_DATABASE_URL` named, with no
  local-only check, unlike `stack/mail.ts`'s existing `localUrl` pattern for the same class of
  risk (a misconfigured env var pointing writes at a real database).
- risk: low (test-only code, no production path, mirrors an existing reviewed pattern).

### 22 Oct 2026 · 9.7c per-run unique question text needed no change · decided by builder · risk: low
- Decided: left `full-flow.spec.ts` untouched for this item; 9.7b already made
  `UNCOVERED_QUESTION_TEXT` per-run unique (a `Date.now().toString(36)` suffix), which is the
  "smaller change" the brief asked to prefer over a global-setup reset, and it already ships on
  `main`.
- Why: re-deriving or duplicating that fix would conflict with 9.7b's own code and comment citing
  9.7a's clean-DB note; nothing left to do.
- risk: low (no code change).

### 22 Oct 2026 · 9.7c vitest.config.ts gains an e2e test glob · decided by builder · risk: low
- Decided: added `'e2e/**/*.test.ts'` to `apps/web/vitest.config.ts`'s `test.include` array so the
  new unit test actually runs under the package's `test` script (the gate command), rather than
  only being runnable by hand.
- Why: the brief asked for a vitest unit test for the new helper "wherever apps/web unit tests for
  e2e helpers live; if none exist, next to mail.ts's test or the closest pattern" — none existed,
  and the closest pattern (`src/**/*.test.ts`, `app/**/*.test.ts`) needed its glob extended to
  cover `e2e/**` rather than moving the test out of `e2e/`, since the helper itself belongs with
  the e2e code it guards. This is the one file outside `apps/web/e2e/**` touched; it is config
  only, not feature code, and does not overlap with the other builder's `src/staff`/`app/staff`
  scope.
- risk: low (config addition, additive glob, covered by the gate run above).

## Left to do
None for this task's scope.

Status: DONE
Tool calls used: 20
