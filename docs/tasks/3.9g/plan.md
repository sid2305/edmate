# 3.9g plan (lead-written)

Status: READY

## Goal
The two 3.9a typescript-review LOWs in `apps/cli`.

## Steps
1. `apps/cli/src/commands/chat.test.ts`, the "edmate chat: Ctrl+C (SIGINT)" test (test first):
   record `process.listenerCount('SIGINT')` before `runChatCommand` and assert it is the same
   after the run returns. Also assert it in one normal-exit test (the `exit` command or EOF path).
2. `apps/cli/src/commands/chat.ts` (`runChatCommand`, around the `interrupted` flag): when a turn
   is cancelled by SIGINT, do not print the `'\n> '` prompt for that turn; go straight to the
   loop exit and print `bye`. Add a test first that the stdout of an interrupted run has no
   `> ` between the cancelled turn's output and `bye` (fails on main before the fix).
3. No other behaviour change; exit code stays 0.

## Risky paths
None (apps/cli only).

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/cli...`
- `corepack pnpm exec prettier --check apps/cli/src/commands/chat.ts apps/cli/src/commands/chat.test.ts`
- `python3 .githooks/secret-scan.py --all`

## Budget
About 20 tool calls.
