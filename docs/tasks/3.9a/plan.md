# 3.9a plan — CLI chat follow-ups (3.9 review MEDIUM/LOW)

## Acceptance (verbatim, from docs/board/tasks.yaml)

> Ctrl+C mid-stream exits cleanly with bye; a new TurnEvent variant fails typecheck; no raw
> console.error in apps/cli/src/commands/chat; cli tests pass

How it will be shown: the gate output pasted into the handoff (`turbo run typecheck lint test
--filter=@edmate/cli...`), plus, in the handoff text, (a) a short description of the manual SIGINT
check the builder ran locally (`edmate chat` piped a long-running stdin, Ctrl+C sent, "bye" seen,
no stack trace, process exits) since a real SIGINT is awkward to script byte-for-byte in CI, backed
by an automated test that fires `process.emit('SIGINT', 'SIGINT')` mid-turn, and (b) a one-line
note that adding a tenth `TurnEvent` variant to `packages/contracts` and running typecheck on
`apps/cli` fails on `renderEvent`'s new `assertNever` default case (checked locally, then reverted
— contracts is out of bounds for this task).

## Scope note on the task's full title

The board title lists six items; only four are this builder's job. One is already done, two need a
package this builder may not touch:

1. SIGINT closes readline and prints bye — **in scope**.
2. Never-exhaustive `TurnEvent` switch in `renderEvent` — **in scope**.
3. `recordUnmetered` logs through the injected `CliIo` instead of raw `console.error` — **in scope**.
4. Rename or document the no-op `memoryProfileStore` — **in scope** (small doc strengthening; see
   below — it is already mostly documented).
5. Zod-parse the chat flags — **in scope** for `--package`/`--source` (the two flags checked by
   plain string equality today); `--agent` stays a plain equality check against the demo's one
   agent id (3.9 Phase B decision, not a shape-validation gap) and is not touched.
6. Switch the CLI lexical index to the db retrieval index (3.9 Q3) — **deferred**, see below.
7. "`edmate chat` reloads the saved help state each turn so the ladder can climb" — **already
   done**, no action. `apps/cli/src/commands/chat/deps.ts`'s `worldSessionStateStore` (landed under
   task 5.8a, which merged after this board row was written) already writes a saved help state back
   onto the world's session, and `memoryTurnConfigStore(world)` reads it on the next turn.
   `apps/cli/src/commands/chat/sameTopic.test.ts`'s own comment confirms this: its
   `withHelpStateReload` wrapper "is now a no-op kept for this test's history." Leave that test file
   untouched — it is not broken, just historical.
8. Re-test the reported same-topic phrasing ("I still don't get it") on the db index — **deferred**,
   depends on item 6.

### Deferred (need a package this builder may not touch)

- **Switch the CLI lexical index to the db retrieval index (3.9 Q3).** The CLI's current
  `RetrievalIndex` (`apps/cli/src/commands/chat/retrieval.ts`) is a content-to-chunks adapter over
  `@edmate/harness/testing`'s `memoryRetrieval` test double, by design (3.9 lead answer Q3, logged
  decision). Moving it onto the real db-backed index means importing `packages/db`'s retrieval
  repository/embeddings path into `apps/cli` (and likely a `packages/harness` port/wiring change for
  how the CLI gets a db pool and embeddings), both out of bounds here: `packages/db` is reserved for
  a concurrent task and `packages/harness` is being edited by another builder right now. Needs its
  own board task once `packages/db` is free, scoped across `apps/cli` + `packages/db` (+ maybe an
  ADR if it changes the `RetrievalIndex` port's shape).
- **Re-test the "I still don't get it" same-topic phrasing on the db index.** Depends on the above;
  same reason. Once the db-backed index lands, add this phrasing as a case alongside the existing
  `sameTopic.test.ts` suite.

## Files to create/modify (apps/cli only)

- `apps/cli/src/commands/chat.ts` — SIGINT handling in `runChatCommand`'s REPL loop; `assertNever`
  default case in `renderEvent`; zod `safeParse` for `--package`/`--source` (replacing the plain
  equality checks); pass a `log` callback into `ChatDepsOptions` so `deps.ts` never calls
  `console.error` directly.
- `apps/cli/src/commands/chat/deps.ts` — `ChatDepsOptions` gains an optional `log?: (text: string)
  => void`; `recordUnmetered` calls `opts.log?.(...)` instead of `console.error(...)`; strengthen the
  `memoryProfileStore` doc (see below). No signature change that breaks `apps/cli/src/commands/eval/
  liveAgent.ts`'s existing calls (the new field is optional; that caller keeps relying on its own
  `onUnmetered` counter and gets no log line, same net behaviour as today's "console.error on every
  unmetered call" minus the console.error — acceptable since nothing asserts on it there).
- `apps/cli/src/commands/chat.test.ts` — new tests: SIGINT mid-stream, `renderEvent`'s exhaustiveness
  (documented, not necessarily machine-checked beyond the typecheck gate itself), zod flag rejection
  (can likely reuse the existing bad-`--package`/bad-`--source` tests unchanged if the error
  messages are kept the same).
- `apps/cli/src/commands/chat/deps.test.ts` — new test: `recordUnmetered` calls the injected `log`,
  never `console.error` (spy on `console.error` and assert it is not called).
- `apps/cli/package.json` — add `"zod": "4.6.7"` to `dependencies` (same version `packages/
  contracts` peer-depends on), so `chat.ts` can import `z` directly instead of adding a new schema
  to contracts (out of bounds: contracts changes need an ADR and architect/security/typescript
  review, badly oversized for two enum flags).
- `pnpm-lock.yaml` — regenerated by `corepack pnpm install` after the `package.json` edit.

## Files out of bounds

- `packages/harness/**`, `apps/web/**`, `apps/worker/**` — another builder is editing these
  concurrently (no-shared-files rule).
- `packages/db/**` — reserved for another task.
- `packages/contracts/**`, `docs/adr/**` — would need an ADR plus architect/security/typescript
  review; the two deferred items that would touch contracts are pushed to a follow-up task instead.
- `apps/cli/src/commands/chat/retrieval.ts`, `world.ts`, `gateway.ts` — no planned change; touch only
  if a test forces it, and say why in the handoff.
- `apps/cli/src/commands/chat/sameTopic.test.ts` — already correct for 5.8a's fix; leave alone.

## Tests first (TDD)

1. `chat.test.ts`: write a failing test that sends `process.emit('SIGINT', 'SIGINT')` partway through
   a multi-line scripted session (reuse `scriptedChatGateway`/`linesStream`/`slackBuildDeps`) and
   asserts the command resolves with exit code `0`, stdout contains `bye`, and no line after the
   interrupt produced a reply — before touching `chat.ts`'s SIGINT handling.
   - Mechanism: use `cancelSource()`/`RunTurnOptions.cancel` (`@edmate/harness`, already used the
     same way in `chat/deps.test.ts`'s `slackClock` test) so a `SIGINT` cancels the in-flight
     `runTurn` as well as closing the readline interface. Remove the `process.on('SIGINT', ...)`
     listener in a `finally` so it never leaks across tests in the same vitest worker.
2. `chat.test.ts`: a `renderEvent` test is already present (every variant renders); add or extend it
   to cover the `default`/`assertNever` path indirectly is not possible at the type level in a unit
   test — instead, document the compile-time guarantee in a comment above `assertNever` (matching
   `apps/web/src/subscriptions/start.ts`'s existing pattern) and verify by hand once (temporarily add
   an 11th literal to a local copy of the union, confirm `tsc` fails, then revert) — record that
   one-off check in the handoff, don't commit the temporary change.
3. `deps.test.ts`: write a failing test asserting `recordUnmetered`'s loud line goes through an
   injected `log` and `console.error` (spied) is never called; then wire `opts.log` into `deps.ts`.
4. `chat.test.ts`: existing bad-`--package`/bad-`--source` tests should keep passing unchanged after
   switching to zod `safeParse` (same error message text) — run them before and after the change to
   confirm.

## Risky paths touched

None (checked against `.claude/skills/merge-gate/risk-paths.txt`): every edit is under `apps/cli/`,
which is not on the risk-paths list, and no contracts, harness guardrail/pedagogy, access, payments,
auth, db repository, or `.claude`/`.github` path is touched. No `risk: high` decision entry is
needed for this PR on that basis; log one only if the builder's deviations turn out to need the
human's eyes (per the lead's own logging duty).

## Gate

From the repo root, after `source ~/.nvm/nvm.sh`:

```
corepack pnpm install   # only if apps/cli/package.json changed
corepack pnpm turbo run typecheck lint test --filter=@edmate/cli... --force --concurrency=1
python3 .githooks/secret-scan.py --all
```

(Package name confirmed from `apps/cli/package.json`: `@edmate/cli`.)

## No real model calls in tests

Every test in scope already uses (or will reuse) the scripted `ModelGateway` via
`ChatCommandDeps.gateway`/`buildChatDeps`'s `gateway` injection, exactly as the existing
`chat.test.ts`/`deps.test.ts`/`sameTopic.test.ts` do. `apps/cli/test/setup/no-network.ts` backstops
this. No new test calls a real provider.

## Open questions

- None blocking. One judgment call for the builder: whether to cancel the in-flight turn on SIGINT
  via `RunTurnOptions.cancel` (closer to "mid-stream") or let the current turn finish and only skip
  the next prompt (simpler, still meets "exits cleanly with bye," no stack trace). Plan recommends
  the cancel-token approach since the mechanism already exists and is already imported in this
  package's own tests; if it proves too fiddly within budget, the simpler fallback is an acceptable
  documented deviation, not a blocker.

## Budget

Budget: 40 tool calls (1 phase, apps/cli)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install, typecheck/lint/test, secret scan only)

## Exit conditions

Status: DONE when the four in-scope items are implemented with passing tests, the deferred items
are recorded in the handoff with their reasons (not attempted), the gate commands above are green,
and the secret scan is clean. Status: PARTIAL if the builder is past ~40 tool calls, or if a fix
turns out to need `packages/harness`, `packages/db` or `packages/contracts` (a file outside this
plan) — stop, record what's done and what's left, and hand back rather than reaching into another
builder's package.

READY
