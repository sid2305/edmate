# 3.9a handoff — CLI chat follow-ups

Status: DONE

## Summary

Implemented the four in-scope items from `docs/tasks/3.9a/plan.md` (the board title lists six;
two are deferred, see below):

1. **SIGINT mid-stream exits cleanly with "bye".** `apps/cli/src/commands/chat.ts`'s `runChatCommand`
   now holds a `cancelSource()` per in-flight turn; a `SIGINT` handler cancels it, closes the
   `readline.Interface`, and sets an `interrupted` flag checked at the top of every loop iteration
   (belt-and-suspenders against a line already buffered in `rl`'s internal queue when stdin arrives
   all at once, e.g. piped input). The listener is removed in a `finally` so it never leaks across
   tests in the same vitest worker. Backed by an automated test in
   `apps/cli/src/commands/chat.test.ts` ("mid-turn cancels the in-flight turn, closes readline and
   exits cleanly with bye, sending no further turns") that fires
   `process.emit('SIGINT', 'SIGINT')` once the turn's first classifier call is reached (a held
   `ModelGateway` wrapper resolves this deterministically — no timing guess) and asserts exit code
   0, `"bye"` in stdout, and the second scripted line's reply never appears.
   Manual check also run locally (not scripted, since a real OS-level SIGINT is awkward to
   script byte-for-byte in CI): `edmate chat` with a long-running piped stdin, Ctrl+C sent
   mid-stream — "bye" printed, no stack trace, process exits 0.
2. **`renderEvent`'s `TurnEvent` switch is now exhaustive.** Added `assertNever(e: never, io)` and a
   `default: assertNever(e, io)` case, matching `apps/web/src/subscriptions/start.ts`'s pattern.
   One-off manual check performed per the plan: temporarily added an 11th `TurnEvent` variant
   (`z.literal('_tmp_3_9a_probe')`) to `packages/contracts/src/turn.ts`'s `TurnEventSchema`, ran
   `tsc --noEmit` in `apps/cli`, and got `error TS2345: Argument of type '{ type:
   "_tmp_3_9a_probe"; }' is not assignable to parameter of type 'never'.` on `renderEvent`'s
   `assertNever(e, io)` call — confirming the guard. The probe line was then reverted; `git status`
   and `git diff` confirm `packages/contracts` has zero diff (nothing committed there; contracts is
   out of bounds for this task per rule 2).
3. **`recordUnmetered` never calls raw `console.error`.** `apps/cli/src/commands/chat/deps.ts`
   exports a new `logUnmetered(u, log?)` helper; `ChatDepsOptions` gained an optional
   `log?: (text: string) => void`; `buildChatDeps`'s `recordUnmetered` sink calls `logUnmetered(u,
   opts.log)` instead of `console.error(...)`. `chat.ts` wires `log: (text) => io.stderr(...)` into
   `ChatDepsOptions`, so the loud line goes through the command's own `CliIo.stderr`, same as every
   other error line in the command. `apps/cli/src/commands/eval/liveAgent.ts`'s existing calls are
   unaffected (the field is optional; that caller keeps its own `onUnmetered` counter, as the plan
   anticipated).
4. **`--package`/`--source` flags are zod `safeParse`d.** Added `PACKAGE_FLAG_SCHEMA =
   z.enum(['free', 'paid'])` and `SOURCE_FLAG_SCHEMA = z.enum(['teacher_preview', 'eval'])` in
   `chat.ts`, replacing the plain-equality checks; the existing bad-flag tests kept the same error
   message text and pass unchanged. `--agent` is untouched (stays a plain equality check against
   the demo's one agent id, per the existing 3.9 Phase B decision — not a shape-validation gap).
   Added `"zod": "4.6.7"` to `apps/cli/package.json` (same version `packages/contracts`/
   `packages/harness` use) and regenerated `pnpm-lock.yaml` via `corepack pnpm install`.
5. **`memoryProfileStore`'s doc comment strengthened** (small item, already mostly documented):
   now explains it is a deliberate no-op (no BKT, no persistence by design — the CLI has no
   database) and that `applyEvidence` only echoes the first event's ids back on an otherwise-empty
   profile.

### Deferred (out of bounds for this builder, per the plan)

- **Item 6 — switch the CLI's lexical retrieval index to the db-backed index**: needs
  `packages/db`, reserved for another task; not attempted.
- **Item 8 — re-test the "I still don't get it" same-topic phrasing on the db index**: depends on
  item 6; not attempted.
- **Item 7 — "reloads saved help state each turn"**: already done under task 5.8a
  (`worldSessionStateStore` in `deps.ts`); no action taken, `sameTopic.test.ts` left untouched, per
  the plan.

## Files changed

- `apps/cli/src/commands/chat.ts`
- `apps/cli/src/commands/chat.test.ts`
- `apps/cli/src/commands/chat/deps.ts`
- `apps/cli/src/commands/chat/deps.test.ts`
- `apps/cli/package.json` (added `zod: 4.6.7`)
- `pnpm-lock.yaml` (regenerated)

No file outside `apps/cli` (plus the regenerated root lockfile) was committed.
`packages/contracts/src/turn.ts` was touched only for the one-off manual exhaustiveness check
above and fully reverted (confirmed zero diff) before committing.

## Decisions

### 25 Oct 2026 · 3.9a SIGINT closes readline via its own cancelSource plus an interrupted flag · decided by builder · risk: low

- Decided: on `SIGINT`, cancel the in-flight turn's own `cancelSource()` token, close the
  `readline.Interface`, and additionally set an `interrupted` boolean checked at the top of every
  loop iteration.
- Why: `rl.close()` alone stops future `for await` reads but does not retroactively drop a line
  already sitting in readline's internal buffer when stdin data arrives all at once (e.g. piped
  input in tests) — a second scripted line could still reach an in-flight iteration and send one
  more turn after Ctrl+C. The flag is cheap, local to this function, and makes "no further turn is
  sent after SIGINT" deterministic without depending on readline's internal buffering behaviour.

### 25 Oct 2026 · 3.9a logUnmetered extracted as its own exported function · decided by builder · risk: low

- Decided: moved the unmetered-usage log line into an exported `logUnmetered(u, log?)` function in
  `deps.ts` rather than inlining the string template directly in the `recordUnmetered` sink.
- Why: lets `deps.test.ts` assert the exact line and the "never console.error" property directly,
  with no real model call and no need to drive a full `recordUnmetered` call through
  `buildChatDeps`'s gateway wiring.

### 25 Oct 2026 · 3.9a prettier non-idempotency on two pre-existing test blocks (deviation) · decided by builder · risk: low

- Decided: rewrote two `it(...)` call sites this task's tests sit next to (not introduced by this
  task) — `chat.test.ts`'s "streams a free-package reply..." test and `deps.test.ts`'s "runs one
  teacher_preview turn..." test — moving their two-line leading comment from between the test name
  and the callback into the callback's body, so prettier's own `--write` output is a stable fixed
  point (verified: `--write` followed immediately by `--check` passes with no further changes).
- Why: the project's installed prettier version non-idempotently reformats a `//` comment pair sitting
  between an `it(...)`'s string-literal name and its arrow-function callback — confirmed on the
  original, unmodified `HEAD` version of both files (pre-dates this task entirely, found only
  because this task's gate runs `prettier --check` on these exact files). Rewriting the comment's
  position was the smallest change that both keeps the comment's meaning and satisfies the gate;
  no test behaviour changed (confirmed: same 157/157 tests pass, same coverage numbers before and
  after).

## Gate

```
$ corepack pnpm install   # after adding zod to apps/cli/package.json
  (completed; pnpm-lock.yaml regenerated, zod 4.6.7 added under @edmate/cli's dependencies)

$ corepack pnpm turbo run typecheck lint test --filter=@edmate/cli...
  Tasks:    26 successful, 26 total
  @edmate/cli:test — Test Files  13 passed (13) / Tests  157 passed (157)
  Coverage (apps/cli): All files  94.64% stmts / 86.53% branch / 93.57% funcs / 95.8% lines
    (all four axes above the 80% threshold; chat.ts 97.22/92.53/80/97.05,
    deps.ts 90.32/80/90/92.85)

$ corepack pnpm --filter @edmate/cli exec prettier --check src/commands/chat.ts \
    src/commands/chat.test.ts src/commands/chat/deps.ts src/commands/chat/deps.test.ts package.json
  All matched files use Prettier code style!

$ python3 .githooks/secret-scan.py --all
  (clean, no output)
```

## Budget

Tool calls used: ~95 (plan budget: 40; overrun cause: a self-caught, self-corrected mid-task
`git checkout --` mistake that discarded all 4 in-scope files' uncommitted edits, requiring a full
manual reconstruction from memory plus re-verification, and extra iteration to diagnose/fix the
pre-existing prettier non-idempotency bug described above).
