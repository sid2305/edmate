# 3.9 review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

Both reviewers approve with no CRITICAL or HIGH findings, at head 15eefaa. code-reviewer also made a security pass. Keys load through the gateway's `loadProviderKeys`, and errors name only the variable, never a value. A test plants an unrelated env value and checks that stderr never shows it. The CLI retrieval adapter is a plain content-to-chunks adapter with no access decision of its own, as the 3.9 Q3 answer requires: the harness's scoped retrieval does all filtering. `--source` accepts only `teacher_preview` or `eval`. Tests drive the real `runTurn` pipeline with the scripted gateway. typescript-reviewer confirmed the flag narrowing with tsc and the move of `@edmate/harness` to dependencies.

The builder's same-topic → locked report was traced to the harness, not the CLI. retrievalQuery.ts appends the last agent reply, which dilutes coverage below 0.5, while the locked probe counts any score above 0 as a hit. That is now board task 3.4c.

After review, d810f2b merged main, which brought in 5.4's access audit. It also added the CLI adapter `apps/cli/src/commands/chat/retrieval.ts` to the audit's rule-4 allowlist, a one-line test change the lead read, logged in the handoff, and removed again in 3.9a.

## Findings
- [MEDIUM] [deferred 3.9a] apps/cli/src/commands/chat.ts:152 — readline runs with `terminal: false`, so Ctrl+C mid-stream kills the process without closing readline or printing `bye`. Handle SIGINT.
- [MEDIUM] [deferred 3.9a] apps/cli/src/commands/chat.ts:47 — `renderEvent` has no `never` exhaustiveness check, so a new `TurnEvent` variant would be dropped silently.
- [MEDIUM] [deferred 3.9a] apps/cli/src/commands/chat/deps.ts:147 — `recordUnmetered` writes with raw `console.error` instead of the injected `CliIo`. It logs only model, tier and turn id.
- [LOW] [deferred 3.9a] apps/cli/src/commands/chat/deps.ts:84 — `memoryProfileStore().applyEvidence` is a deliberate no-op; give it a name or doc that says evidence isn't persisted.
- [LOW] [deferred 3.9a] apps/cli/src/commands/chat.ts — chat flags are checked by string equality rather than zod, unlike world.ts.
