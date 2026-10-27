# 1.7d plan: build-smoke hardening and the age.ts log strip (1.7b review MEDIUM/LOWs)

Written by the lead (26 Oct 2026): every item is spelled out in docs/tasks/1.7b/review.md, so no planner run.

## Acceptance (board)
The 1.7b review MEDIUM and LOWs listed below are fixed.

## Files
1. `apps/web/test/build-smoke.test.ts`
   - **MEDIUM:** `afterAll` restores `HIDDEN_CONTENT_DIST` → `BUILD_TREE_CONTENT_DIST` in a `try/finally`, so a failure stopping the server or closing the db still restores it. Before waiting for `exit`, check `child.exitCode !== null || child.signalCode !== null` (a server that already exited never fires `exit` again, which is what made `afterAll` time out). In `beforeAll`, if a stale `.build-smoke-hidden` dir is left from an earlier crashed run, restore it first (or remove it when `dist` also exists), so one crash doesn't break every later run.
   - `cpSync(BUILD_STANDALONE, tmpRoot, { recursive: true, verbatimSymlinks: true })`, so the copy's pnpm links stay relative.
   - Fix the comment near line 166 that cites `byCwd`, which no longer exists in `packages/content/src/safeRegexGuard.ts`: describe what the code does now.
   - Assert the fail-closed log message in the relocation run (the unit test covers it; the integration test should too). Use the exact message the code logs today; don't change the message.
   - Delete the student and session rows the test creates, in `afterAll` before the db closes (through the same identity/db API the test used to create them; no raw SQL string building).
2. `turbo.json`: the `build-smoke` task gets `"cache": false` (a smoke test must really run). Leave the other tasks alone. ("Its own turbo invocation" from the board text is already true: it runs only through `pnpm build-smoke`; no change.)
3. `apps/web/src/auth/age.ts` (line ~75): the log strip also replaces C1 controls (U+0080–U+009F, which includes U+0085) and U+2028/U+2029, and `r.file` gets the same strip as the reasons. Add a unit test in the existing age test file (find it with `grep -rl loadAgeContent apps/web`) with a refused pack whose file name and reason contain those characters, asserting the logged line is one line with no such character.
4. `docs/tasks/1.7d/handoff.md`.

## Risky paths
- `apps/web/src/auth/**` (age.ts) → reviewers: security-reviewer, plus code-reviewer and typescript-reviewer. The handoff logs a `risk: high` decision for the merge.

## Gate
```
export TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
corepack pnpm turbo run typecheck lint test --filter=@edmate/web
corepack pnpm --filter @edmate/web build && corepack pnpm --filter @edmate/web build-smoke
```
Run build-smoke **once** at the end (it does a full Next build). If dev Postgres is unreachable, say so in the handoff; don't count a skipped smoke test as passed. Plus `corepack pnpm exec prettier --check` on the changed files and `python3 .githooks/secret-scan.py --all`.

## Budget
Budget: 40 tool calls (1 phase, @edmate/web). Past 55, commit and push, then stop with PARTIAL.
