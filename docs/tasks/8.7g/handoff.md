# Handoff: 8.7g — CLI live eval: fail a case on every non-blocked error

**Status:** DONE

## What changed
- `apps/cli/src/commands/eval/liveAgent.ts`: `collectReply` now fails the case on every `error`
  event except a non-retryable `guard_blocked` (`else failed = event.code`), matching the gate's
  `collectReply` (`apps/worker/src/gate/agent.ts`). Previously any other error code (for example
  `provider_error`) was silently scored as an empty or partial reply. Updated the function's doc
  comment to describe the new branch.
- `apps/cli/src/commands/eval/liveAgent.test.ts`: added `providerErrorGateway()` (a
  `scriptedChatGateway` whose main `stream` ends with `{ type: 'error', code: 'provider_error' }`
  instead of a reply) and a new test asserting `agent.reply(...)` rejects with
  `/live eval turn failed: provider_error/`. Kept the existing `guard_blocked` tests unchanged.

## Evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/cli` → all 8 tasks successful;
  `src/commands/eval/liveAgent.test.ts (13 tests)` all passed, including the new
  "a non-guard error (provider_error) fails the case, with the code in the message" test.
- `python3 .githooks/secret-scan.py --all` → exit 0, no output.

## Decisions
None.

## Budget
Tool calls used: 14
