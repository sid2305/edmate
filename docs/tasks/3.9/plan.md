# 3.9 plan: CLI `edmate chat --agent --package` (teacher-preview or eval entitlement)

## Acceptance (verbatim)
"a full session with the demo teacher runs in a terminal with a real key."

**How it will be shown:** an automated test proves the CLI drives a full multi-turn
session through the real pipeline steps (`defaultSteps`) using the scripted gateway and
demo-teacher content fixtures — no network, no real key, CI-safe. The "real key" half of
the acceptance is a **manual step only the human runs** (see Phase B), because real model
calls are out of bounds for automated tests (rule 4). The human (or the lead, after the
human) records the transcript summary and `secret-scan` result in the task handoff; the
builder cannot self-certify this half.

## Context found while planning

- **`route` (3.3) is not yet built** (board: `status: todo`). `defaultSteps.route` always
  throws `StepNotImplementedError`; the runner's documented failure policy then falls back
  to `ROUTE_DEFAULT` (`intent: 'on_task', attempt: 'none'`) and the turn proceeds normally
  (`spec.ts`: "Default `on_task`/`none`; distress keywords still escalate"). So a full
  session works today without 3.3 — every turn is just routed generically. This is not a
  blocker; it's a known limitation to note in the handoff, not fixed by this task.
- 4.3/4.4/4.5/4.6/4.7/4.8 are all `done`, so `preGuard`/`postGuard` run for real, including
  the grounding and advice judges — both of which make model calls through a gateway. Only
  4.9 (persona boundary) is deferred to M13 and absent from `defaultSteps` today.
  Consequence: a single real key, mapped to both the `small` and `main` tiers, powers
  every model call in the turn (generate, classifiers, judges) — matching the acceptance's
  singular "a real key."
- The **production `RetrievalIndex`** (task 5.3) lives in `packages/db/src/repositories/retrieval.ts`
  and needs Postgres+pgvector plus an ingestion/embedding pipeline over
  `content/demo-teacher/`. That is out of scope and out of budget for this task (no DB in
  3.9's deps, and 5.3/5.4 aren't in 3.9's dep list). **Decision:** this CLI ships its own
  tiny in-process, access-filtered lexical `RetrievalIndex` over `content/demo-teacher`'s
  module notes (substring/keyword match, no embeddings, no DB). `buildContext`'s documented
  failure path ("proceed without retrieval → `ask_teacher`") already makes a weaker
  retrieval safe, never silently wrong. A follow-up task should swap in 5.3's real index.
- `@edmate/harness` already publishes a `./testing` subpath (package.json `exports`), and
  `apps/cli` already depends on `@edmate/gateway`'s `loadProviderKeys`/`envKeySource`/
  `createAnthropicAdapter` pattern (see `apps/cli/src/commands/judgeGateway.ts`, built for
  `edmate eval --record`). This task reuses both rather than reinventing: `memoryAccess.ts`'s
  `memoryEntitlementStore`/`memoryTurnConfigStore` (generic over any `AccessWorld`) for
  entitlement/session resolution, and the rest of `testing`'s memory ports
  (`memoryTeacherQuestionStore`, `memorySessionStateStore`, `memoryTranscriptStore`,
  `memoryTraceSink`, `memoryAlertSink`, `memorySafetyEventSink`, `memoryUsageMeter`) for
  everything that would otherwise need a database. `@edmate/gateway` already has
  `createRouter`, `meterRouter`, `shippedPrices()`, `computeCostMicroUsd`,
  `DEFAULT_MODEL_POLICY` (2.3/2.4), and `@edmate/harness`'s `turnPolicies`/`billingFor`
  (3.7) compose these into `gatewayFor`. This is wiring, not new engineering — keeps the
  build small.
- `apps/cli`'s `unwiredAgent`/`edmate eval --record` wiring is explicitly untouched; `edmate
  chat` is a separate command and composition root. No change to `eval.ts`/`judgeGateway.ts`.
- **5.4 Phase A is editing `packages/harness/src/pipeline/tools.ts` → `access/tools.ts`
  right now.** This plan touches no file under `packages/harness/**`. If the builder hits a
  real gap that only a harness change can fix, it stops and flags the lead instead of
  editing harness (merge-conflict risk with 5.4, and a harness change needs its own task).

## Packages touched
`apps/cli` only (no `packages/harness`, no `packages/db`, no contracts).

## Scope and constraints followed
- No `packages/harness` edits (checked above).
- No real model calls in automated tests; `apps/cli/test/setup/no-network.ts` already
  replaces `globalThis.fetch`, so any accidental live call fails loudly in CI.
- The real key lives only in `ANTHROPIC_API_KEY` (environment), loaded the same way
  `judgeGateway.ts` already does (`loadProviderKeys`/`envKeySource`); never logged, never
  printed, never written to a file. A test asserts the CLI's error path (missing key) never
  echoes the env value.
- Two phases, each small enough for one Sonnet builder; Phase B depends on Phase A's
  green commit.

## Files to create / modify

### Phase A — composition root (no CLI surface yet)
Create, all under `apps/cli/src/commands/chat/`:
- `world.ts` — loads `content/demo-teacher` via `@edmate/content`'s `loadDemoTeacherContent`;
  builds one `AgentConfig` (using `@edmate/gateway`'s `DEFAULT_MODEL_POLICY` for both tiers,
  `promptPackVersion` from the fixture pack below), two `PackageConfig`s (free/paid, from
  the content's package drafts), one `StyleCard`, the module list, and a locale pack
  (reuse the real 3.10 default pack if trivially importable; else `@edmate/contracts/fixtures`'
  minimal pack — record whichever is used as a decision). Assembles one `AccessWorld`
  (`@edmate/harness/testing`'s shape) with a single open `MemorySession`, and exposes a
  helper that builds the `Entitlement` request for `--source teacher_preview` (student id =
  teacher id) or `--source eval` (`opts.eval`).
- `retrieval.ts` — the in-process lexical `RetrievalIndex` described above, filtered by
  `allowedModuleIds`; never logs candidate text.
- `gateway.ts` — `createChatGateway(env)` → one real `ModelGateway` (Anthropic only, same
  pattern as `judgeGateway.ts`); `gatewayFor(spec)` built from `turnPolicies`/`billingFor`
  (`@edmate/harness`) plus `createRouter`/`meterRouter`/`shippedPrices` (`@edmate/gateway`),
  returning `{ gateway, metered: true }`. Accepts an injected gateway for tests.
- `deps.ts` — assembles the full `PipelineDeps`: a tiny real `Clock`/`IdSource` (new, a few
  lines each, not test doubles — real `setTimeout`/`crypto.randomUUID`), `createTurnLimits`
  (`@edmate/harness`, real), the memory ports listed above from `@edmate/harness/testing`,
  `priceUsage` from `@edmate/gateway`'s `computeCostMicroUsd`/`shippedPrices`, short literal
  English `fallbackReplies.safeReply`/`.distress`, and `promptPacks` (the fixture library
  from `@edmate/harness/testing` unless a real 3.11 pack loader is trivially available —
  record whichever is used as a decision).

Tests (same directory, `*.test.ts`): `world.test.ts`, `retrieval.test.ts`, `gateway.test.ts`
(key-loading success/error paths only; asserts no key in thrown messages), `deps.test.ts`
(assembles full deps, runs one `runTurn` through `defaultSteps` and the **scripted**
gateway end to end — the acceptance's offline half, proven here before any CLI exists).

**Green commit (end of Phase A):** `corepack pnpm turbo run typecheck lint test --filter=@edmate/cli...`
passes; `deps.test.ts` shows one full scripted turn (admit → commit) succeeding with a
teacher_preview entitlement over real demo-teacher content. State for Phase B: `chat/deps.ts`
exports a ready-to-use `PipelineDeps` factory; nothing renders to a terminal yet.

### Phase B — the CLI command
Create:
- `apps/cli/src/commands/chat.ts` — `edmate chat [--agent <id>] [--package <id>]
  [--source teacher_preview|eval] [--student <id>] [--help]` (defaults: the demo agent and
  free package, `--source teacher_preview`, student = the demo teacher's own id, so a bare
  `edmate chat` just works). Builds `PipelineDeps` via Phase A's `deps.ts` (real gateway by
  default; injectable for tests), then a line-at-a-time REPL (`node:readline`): each line
  becomes a `TurnInput` (fixed `sessionId`/`studentId`/`agentId` for the run), calls
  `runTurn` from `@edmate/harness`, and renders the turn's events to stdout as they stream
  (`token` text appended live, `sources`, `locked`, `teacher_question`, `skill`, `error`,
  `done`). Help-state/session persist in the one in-memory `AccessWorld` built at startup, so
  the help ladder and history work across turns in the same run. `Ctrl+D`/`exit` ends the
  session cleanly.

Modify:
- `apps/cli/src/cli.ts` — wire the `chat` command, extend `USAGE`.
- `apps/cli/package.json` — move `@edmate/harness` from `devDependencies` to `dependencies`
  (chat.ts is production code, not test-only).

Tests:
- `apps/cli/src/commands/chat.test.ts` — drives the REPL with scripted stdin lines and the
  **scripted** gateway (via Phase A's injectable `deps.ts`), asserting terminal output for a
  short multi-turn demo conversation (including at least one `sources` and one `locked` or
  `ask_teacher` turn, to show the pipeline — not just echo — is driving the reply), `--help`,
  a bad flag, and the missing-`ANTHROPIC_API_KEY` error path (asserts the message names the
  missing variable and never echoes any environment value).

**Green commit (end of Phase B):** `corepack pnpm turbo run typecheck lint test --filter=@edmate/cli...`
and root `typecheck lint test` pass; `python3 .githooks/secret-scan.py --all` clean.

### Manual step (human only, after Phase B merges)
With a real `ANTHROPIC_API_KEY` exported in the shell (never in a file the repo tracks):
`corepack pnpm --filter=@edmate/cli exec node bin/edmate chat`
Have a short real conversation about the demo Python course (content/demo-teacher), confirm
a locked or ask_teacher turn behaves sensibly on the free package, exit, then re-run
`python3 .githooks/secret-scan.py --all` to confirm nothing leaked. The human (or the lead)
adds this transcript summary and scan result to the task handoff; it is the acceptance
evidence the builder cannot produce itself.

## Files out of bounds
`packages/harness/**` (5.4 is live there), `packages/db/**`, `packages/contracts/**`,
`content/demo-teacher/**` (read-only), `apps/cli/src/commands/eval.ts`,
`apps/cli/src/commands/judgeGateway.ts` (read as reference only).

## Tests first
tdd-guide writes `deps.test.ts`'s "one scripted turn end to end" and `chat.test.ts`'s
scripted REPL conversation before the corresponding source files, per the project's
TDD workflow; both are the acceptance's offline evidence.

## Risky paths touched
None. Checked against `.claude/skills/merge-gate/risk-paths.txt`: every planned path is
under `apps/cli/**`, which matches no glob in that file (not `packages/harness/src/access|guardrails|pedagogy/**`,
not `packages/contracts/**`, not `.claude|.github|.githooks/**`). No ADR needed (no
contracts change). No `risk: high` decision required for the PR itself; the human's manual
real-key step is recorded as a normal decision/evidence entry, not a risk flag.

## Open questions (recommendations)
1. **Flag defaults and `--source` naming** — not in the build plan or PRD. Recommendation:
   proceed with the defaults above (bare `edmate chat` previews the demo teacher's free
   package); reversible, no spec conflict, so not a blocker.
2. **Which locale pack and prompt-pack set to use** (real 3.10/3.11 artifacts vs. test
   fixtures) — depends on how easily those are loadable outside a DB-backed composition
   root. Recommendation: try the real ones first; fall back to fixtures and record it as a
   decision in the handoff. Not a blocker either way.
3. **Lexical-only retrieval now, real 5.3 index later** — recommendation above; flagged as a
   explicit deviation, not a blocker, since `buildContext`'s own failure policy makes this
   safe.

## Status
READY.

## Lead answers (20 Oct 2026)
- **Q1, flags:** accepted. Pick reversible defaults and log them as decisions.
- **Q2, packs:** use the real locale pack and prompt-pack set first. Fall back to the test fixtures only if loading them fails, and record which you used.
- **Q3, retrieval:** accepted, with one rule. The CLI's in-process lexical index implements the harness's existing retrieval port and contains no access logic of its own. Filtering stays in the harness (`buildContext`, and 5.4's scoped search once it merges), so there is never a second, unfiltered search path. A follow-up task switches the CLI to the packages/db index.
