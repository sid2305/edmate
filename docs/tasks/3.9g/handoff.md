# 3.9g handoff

Status: DONE

## Summary
Fixed the two 3.9a typescript-review LOWs in `apps/cli`:
- `apps/cli/src/commands/chat.test.ts`: the "ends cleanly when stdin closes" test and the
  "Ctrl+C (SIGINT)" test now capture `process.listenerCount('SIGINT')` before `runChatCommand`
  and assert it is unchanged after the run returns, on both the normal-exit and SIGINT paths.
- `apps/cli/src/commands/chat.ts` (`runChatCommand`): a turn cancelled by SIGINT no longer
  prints the `'\n> '` prompt for that turn; the loop now checks `interrupted` right after
  `await run.finished` and breaks straight to `bye` if set.
- Added an assertion in the SIGINT test that the output between the cancelled turn's own
  `[error: ...]` event and `bye` contains no `> ` prompt (fails on main before the fix).

## Decisions
None (plan fully specified the fix; no deviation).

### 25 Oct 2026 · 3.9g budget · decided by lead · risk: low
- Decided: accept 26 tool calls against a plan budget of 20.
- Why: a small overrun on setup and the gate runs; the diff is 13 lines in apps/cli and both reviewers approved with no findings.

### 25 Oct 2026 · 3.9g merge · decided by lead · risk: low
- Decided: merge 3.9g; code-reviewer and typescript-reviewer approved with no findings.
- Why: apps/cli only, no risky path; the gate passed.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/cli...` -> 26/26 tasks
  successful, `@edmate/cli:test` 157 passed (13 files), typecheck and lint clean.
- `corepack pnpm exec prettier --check apps/cli/src/commands/chat.ts apps/cli/src/commands/chat.test.ts`
  -> "All matched files use Prettier code style!"
- `python3 .githooks/secret-scan.py --all` -> clean (no output, exit 0).

## Budget
Tool calls used: 26 (harness count; the builder reported 14)
