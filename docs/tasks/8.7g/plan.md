# Plan: 8.7g — CLI live eval: fail a case on every non-blocked error

Status: READY (lead-written, 25 Oct 2026)

## Acceptance (from the board, narrowed)
Part of the board title is already done on main, so this task builds only the rest:
- **Done (5.8d, #261):** the CLI live eval now runs persona cases properly (turn 0 is a `skill_action` start; one `ChatSetup` per case), and it forwards `input.skill`. The board's "fail a persona case like the gate" no longer applies. The gate fails such a case only because it cannot carry help state between turns, and the CLI can.
- **Done:** the doc comment on `collectReply` in apps/worker/src/gate/agent.ts already says which error events throw.
- **To build:** `collectReply` in `apps/cli/src/commands/eval/liveAgent.ts` fails the case on every `error` event except a non-retryable `guard_blocked`, the same way the gate's `collectReply` does (`else failed = event.code`). Today any other error code is silently scored as an empty or partial reply. Update its doc comment to match.

## Files
- `apps/cli/src/commands/eval/liveAgent.ts`
- `apps/cli/src/commands/eval/liveAgent.test.ts`: a case whose turn emits a non-guard error (for example `model_error` or another `TurnEvent` error code the contracts define) now rejects with the code in the message. Keep the existing guard_blocked tests.
- `docs/tasks/8.7g/handoff.md`

Not a risk path.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/cli` and `python3 .githooks/secret-scan.py --all`.

## Reviewers
code-reviewer, typescript-reviewer.

## Budget
15 tool calls; stop at 20.
