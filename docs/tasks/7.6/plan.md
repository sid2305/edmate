# 7.6 · Live model runs, per-model pass rates and cost per turn by tier

Board: `python3 .claude/skills/board/board.py show 7.6` · Milestone M7 · deps: 5.4, 7.1, M3, M4 (all
done) · branch `m7/7.6-live-model-runs` · risk: not flagged on the board; checked against
risk-paths.txt below (none matched).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Live model runs, per-model pass rates and cost per turn by tier"
Accept: "a report per configured model and suite, with cost per turn."

### How it will be shown
Same precedent as 5.7's 70% bar and 4.7's 95% bar: the **mechanism** — wiring a real agent to
real suites, computing cost from token usage x the price table, writing a report per (model,
suite) pair — is proved in CI on the scripted gateway and fixtures (rule 4, no real model calls in
tests). The **live numbers themselves** (real pass rates, real cost per turn, for the real
configured models) need live provider keys and are recorded as evidence: the human runs the
sweep after merge (keys in env vars only, per the lead's hard constraint) and pastes the per-model,
per-suite results into `docs/tasks/7.6/live-report.md` (or links the JSON reports written under
`docs/tasks/7.6/live-reports/`). This closes two still-open board decisions ("Revenue share and
floor price" and "Default model mix", both "decide after 7.6") and un-blocks the live-evidence
notes left pending in 4.7's and 5.7's handoffs — this task's wiring is what those were waiting on.

## What exists already (reused, not rebuilt)

- **A real, no-database turn pipeline composition root** (`apps/cli/src/commands/chat/{world,deps,gateway,retrieval}.ts`,
  task 3.9): `buildChatDeps` assembles full `PipelineDeps` over the real demo-teacher content, a
  real Anthropic adapter (metered, priced), in-memory ports, and `source: 'eval'` is already a
  supported entitlement source with no subscription needed (3.2's own accept line). `runTurn(input,
  { deps, steps: defaultSteps })` (`@edmate/harness`) runs one real turn end to end.
- **The price table** (`packages/gateway/src/pricing/{prices.yaml,schema.ts,load.ts,cost.ts}`,
  task 2.4): `inputUsdPerMillion`/`outputUsdPerMillion` per model, `loadBundledPrices()`,
  `computeCostMicroUsd(table, model, inputTokens, outputTokens)`. Its own header comment says
  "check [prices] against the provider's price page when a model is added or the default model mix
  changes (task 7.6)" — i.e. 2.4 already expected this task to use, not replace, this file.
  `DEFAULT_MODEL_POLICY`'s comment (`packages/gateway/src/router/default-policy.ts`) says the same:
  "7.6 is expected to replace these values."
- **An in-memory usage ledger for a CLI run**: `memoryUsageMeter()` (`@edmate/harness/testing`)
  exposes `.rows: { usage, ctx }[]` — every metered call in a run, with `usage.tier`,
  `usage.inputTokens`/`outputTokens`, and `costMicroUsd` (computed via the same price table).
  `buildChatDeps` already wires this as `deps.usage` and as the gateway's meter sink.
- **Seedable conversation state for multi-turn replay**: `memoryTranscriptStore()`'s `.appended`
  array is a plain `{ sessionId, message }[]` the caller can push onto directly before calling
  `runTurn` — no need to re-run a case's earlier turns live to give the final turn its history.
- **The eval runner and report format** (`packages/evals`, tasks 3.12/7.1/7.1a): `loadCasesFromDir`,
  `runSuite`, `toJsonReport`/`toHtmlReport` (already carry optional `judgeModel`/`calibration` meta,
  additive and backward compatible — the precedent this task's new `model`/cost fields follow),
  `resolveJudgeModel`/`createJudgeGateway` (judge model from env, task 3.12/eval.ts).
- **`edmate eval <dir> --record --report <file>`** (`apps/cli/src/commands/eval.ts`): today its
  `agent` is `unwiredAgent`, a stub that throws on every call — "no agent under test is wired yet
  (it arrives with the harness pipeline)". **This is the actual gap this task closes**: nobody has
  adapted the real pipeline (world/deps/runTurn) to the `EvalAgent` interface `packages/evals`
  expects. 4.7's and 5.7's handoffs both say their live `--record` evidence "needs a key" and is
  left for the lead — in fact it needed this wiring too, which didn't exist yet.
- **304+ suite cases already written** under `evals/suites/{advice,grounding,leak,...}` (tasks
  4.0/4.2–4.8/5.7/7.2's predecessors) — real content to run the live sweep against once wired.
  `evals/suites/pedagogy` and a few others are still empty (`.gitkeep` only, 7.2 not done); the
  sweep must handle an empty suite directory as zero cases, not an error.

## Design

### Phase A — the pipeline-backed `EvalAgent`

A new `apps/cli/src/commands/eval/liveAgent.ts` (or `apps/cli/src/commands/evalLive/agent.ts` —
builder's call on the exact path) builds an `EvalAgent` (`packages/evals`' interface) over
`buildChatDeps`/`runTurn`:

- **Model policy is now a parameter, not hard-coded.** `ChatWorldOptions`/`buildAgentConfig`
  (`chat/world.ts`) currently hard-code `modelPolicy: DEFAULT_MODEL_POLICY`. Thread an optional
  `modelPolicy?: ModelPolicy` through `ChatWorldOptions` → `ChatDepsOptions` → `buildAgentConfig`,
  defaulting to `DEFAULT_MODEL_POLICY` when absent (so `edmate chat`'s existing behaviour and its
  tests are unchanged — purely additive).
- **One case = one fresh in-memory session.** For each `EvalAgent.reply(input)` call: build fresh
  `ChatSetup` via `buildChatDeps` (or reuse one built per (model, suite) run, reset per case — the
  builder confirms which is cheaper/simpler); seed `input.priorTurns` directly into the
  transcript store's `.appended` (student message, then agent reply, per prior turn, in order) —
  **no live call for prior turns**, matching how a recorded multi-turn case is meant to be replayed
  (keeps live cost down and keeps the sweep deterministic given the same `priorTurns`). Then call
  `runTurn` once, live, for `input.student` (today's harness has no notion of `input.skill`/
  `input.persona` as a `TurnInput` field directly — check `3.11e`'s `TurnInput` shape; if a field is
  missing, flag it as an open point below rather than guessing).
- **Collect the reply from the event stream.** Concatenate `token` chunks; a `replace` event resets
  the accumulated text (matches `renderEvent`'s own handling in `chat.ts`). `sources` events →
  `reply.sources`. `blocked: true` iff an `error` event with `code: 'guard_blocked'` is seen (confirm
  against `packages/contracts/src/turn.ts`'s `TurnEventSchema` and an existing guard integration
  test, e.g. `packages/harness/src/pipeline/runner.answerLeak.test.ts`, for the exact event shape on
  a blocked turn — don't guess). `escalated: true` iff a `safety` event with `level: 'alert'` is
  seen. `locked`/`teacher_question`/`skill`/`hint_rung` events are read but not required by
  `EvalAgentReply` today; don't invent new reply fields (`EvalAgentReplySchema` is `strictObject`).
- **Tests (scripted/injected gateway only, rule 4):** inject a scripted `ModelGateway` (as
  `chat/deps.test.ts`/`chat.test.ts` already do) that yields a known event sequence for a few
  representative cases: a plain reply, a reply with sources, a guard-blocked turn, an escalated
  turn, and a 2-turn case whose prior turn is seeded (assert the seeded message reaches
  `buildContext`/the composed prompt, e.g. via a spy gateway capturing what it was sent — reuse
  `@edmate/harness/testing`'s `spyGateway.ts` if it fits). No change to `edmate chat`'s own tests'
  expected behaviour (model-policy default unchanged).

### Phase B — the multi-model sweep and the report

- **"Configured models" config.** A new file, `evals/live-models.yaml`: a list of entries, each
  `{ label: string, provider: 'anthropic' | 'openai-compatible', model: string }` (plus an optional
  `baseURL` for `openai-compatible`, matching `judgeGateway.ts`'s own `EDMATE_JUDGE_BASE_URL`
  pattern). Each entry stands in for **both** tiers at once (the sweep forces
  `modelPolicy.tiers.small` and `.main` to the same `{ provider, model }` for that entry) — the
  simplest, most literal reading of "per-model pass rates"; see Open question 3 for the
  mixed-tier case. Validated with a small Zod schema (new `packages/evals/src/liveModels.ts` or
  similar — same package as the other schema-validated config loaders, e.g. `loader.ts`,
  `calibration.ts`), loaded the same fail-fast-naming-the-bad-entry way as `prices.yaml`/
  `loadDoubleCheck`.
- **One command (or flag) runs N models x M suites.** Recommendation: extend `edmate eval` with
  `--models <file>` (instead of a brand-new subcommand) — when present, `<dir>` may be a suite
  directory *or* a directory of suite directories (the builder confirms which against
  `loadCasesFromDir`'s existing contract), and the command loops over every configured model,
  builds that model's pipeline `EvalAgent` (Phase A, live key required — `--models` implies
  `--record`, an error if given without it), runs every suite, and writes one JSON report per
  (model, suite) under `--report-dir <dir>` (default `evals/reports/live/<label>/<suite>.json`,
  gitignored like 7.1's `packages/evals/reports/`). See Open question 4 for the
  flag-vs-subcommand choice.
- **Cost per turn, by tier.** After each (model, suite) run, read the run's `memoryUsageMeter().rows`:
  `costPerTurnMicroUsd = sum(rows[].usage.costMicroUsd ?? 0) / totalTurnsInSuite`, and the same sum
  split by `rows[].usage.tier` (`small`/`main`) for the by-tier breakdown — a row with no price
  (`costMicroUsd: null`/unpriced) contributes 0 to the sum and the report also surfaces an
  `unpriced` count so a null-cost model mix is never silently reported as free (same discipline as
  2.4's `sumForStudent`). Extend `toJsonReport`'s optional `meta` (additive, like 7.1's
  `judgeModel`/`calibration`) with `model?: string` (the label) and
  `cost?: { perTurnMicroUsd: number; byTier: Record<string, number>; unpricedCalls: number }`.
- **A combined summary across models/suites** (markdown or a small `summary.json` next to the
  per-(model,suite) reports): one row per model x suite with pass rate and cost per turn, so the
  lead can read off "Default model mix" and "Revenue share and floor price" without opening every
  JSON file by hand.
- **Tests (scripted gateway, fixture-sized suites, rule 4):** a 2-model x 2-suite fixture sweep
  (tiny synthetic suites, like `reportDemo.test.ts`'s 4-case fixture) proving: one report file per
  (model, suite); `model`/`cost` fields present and additive (old JSON report consumers still
  parse); cost-per-turn arithmetic is exact (hand-computed, not `toBeCloseTo`, same style as
  `pricing.test.ts`); an unpriced model in the sweep reports `unpricedCalls > 0` and a non-null
  (lower) `perTurnMicroUsd` from the priced calls only, never a false "free" turn.

## Price table: where it lives, and who fills in real prices (answering the lead's question)

**It already exists** — `packages/gateway/src/pricing/prices.yaml` (built in task 2.4), loaded by
`loadBundledPrices()`, scored by `computeCostMicroUsd`. This task does **not** build a new price
table; it reads this one. Today it has exactly two entries (`claude-haiku-4-5`,
`claude-sonnet-4-5`), each file-commented "list prices at the time of writing; check them against
the provider's price page when ... the default model mix changes (task 7.6)".

**Who fills in real prices:** not the builder, not the planner — this is business-sensitive data
entry, not something to invent (the lead's hard constraint). Recommendation: before the human runs
the live sweep, the lead (or a named human) re-checks each configured model's price against its
provider's current published price page and updates `prices.yaml` directly (a 2-line YAML edit, no
code change) if it has moved since 18 Oct 2026, and adds an entry (never guessed) for any new
model added to `evals/live-models.yaml` that isn't priced yet. If the sweep is run against a model
missing from `prices.yaml`, the existing "unpriced" path (2.4) already handles it correctly: real
tokens, `costMicroUsd: null`, a loud log line, no fabricated price, and (per Phase B's report)
counted in `unpricedCalls` rather than reported as free.

## Files to create/modify

### Phase A
- `apps/cli/src/commands/chat/world.ts` — thread an optional `modelPolicy` through
  `ChatWorldOptions`/`buildAgentConfig` (default `DEFAULT_MODEL_POLICY`, additive).
- `apps/cli/src/commands/chat/deps.ts` — pass the option through to `buildChatWorld`.
- `apps/cli/src/commands/eval/liveAgent.ts` (new) + `liveAgent.test.ts` — the pipeline-backed
  `EvalAgent`, as designed above.
- `apps/cli/src/commands/eval.ts` — replace `unwiredAgent` with a lazy real-pipeline agent built
  only when `--record` is set (replay stays fully offline, unchanged); update `EVAL_USAGE`'s
  "No agent under test is wired yet" line (it now is).
- `apps/cli/src/cli.ts` — wire the new default agent into the `eval` case; `eval.test.ts`/
  `cli.test.ts` updated for the new default (still never a real call in tests — inject a scripted
  gateway, following `chat.test.ts`'s existing pattern).

### Phase B
- `evals/live-models.yaml` (new, content) — the configured-models list, seeded with the two models
  already in `prices.yaml`/`DEFAULT_MODEL_POLICY` only (no new, unpriced model invented here).
- `packages/evals/src/liveModels.ts` (new) + test — schema and loader for the above, same
  fail-fast-naming-the-bad-entry style as `loader.ts`/`calibration.ts`.
- `packages/evals/src/report.ts` — additive `model`/`cost` meta fields on `JsonReport` + test
  (mirrors 7.1's `judgeModel`/`calibration` addition exactly).
- `apps/cli/src/commands/eval.ts` (or a new `evalLive.ts` — see Open question 4) — the `--models`
  sweep: per-model agent construction (Phase A), per-(model,suite) run and report, the combined
  summary.
- `apps/cli/src/commands/eval.test.ts` (or new file) — the 2x2 fixture-sweep test described above.
- `.gitignore` — `evals/reports/live/` (gitignored, same pattern as 7.1's `packages/evals/reports/`).
- `docs/tasks/7.6/handoff.md` (builder) — the mechanism evidence, plus the live-run recipe (exact
  command) the human runs afterward with real keys.
- `docs/tasks/7.6/live-report.md` (builder, placeholder; filled in by the human after the live run,
  or left as "not yet run, needs keys" per 5.7's precedent — never fabricated numbers).

### Out of bounds (both phases)
- `packages/gateway/src/pricing/prices.yaml`'s actual USD values — read-only to this task except to
  add an entry for an already-agreed model at an already-confirmed price; never guessed (see above).
- `packages/harness/src/**` internals (guards, pedagogy, pipeline steps) — unchanged; this task only
  calls the existing `runTurn`/`defaultSteps`, same contract `edmate chat` already uses.
- `content/demo-teacher/**`, `content/prompt-packs/**`, `content/locales/**` — read-only fixture
  content, unchanged.
- `evals/suites/**` case files themselves — not edited; 7.2 grows them, this task only runs them.
- `packages/db/**`, `apps/web/**`, `packages/payments/**` — untouched; this is a CLI/package-only
  tool, no database, matching 3.9's own "no database" scope.
- `packages/contracts/**` — unchanged; `EvalAgentReplySchema` stays `strictObject` with its current
  fields (see Open question 2 if a turn needs something it doesn't have yet).

## Tests first
1. Phase A: write the scripted-gateway fixtures for the five representative event sequences
   (plain reply, sourced reply, guard-blocked, escalated, seeded-prior-turn) before `liveAgent.ts`;
   confirm red (no adapter yet), then green.
2. Phase A: `edmate eval`'s existing `eval.test.ts` cases (replay mode) must stay green unchanged —
   replacing `unwiredAgent` must not touch replay's offline guarantee.
3. Phase B: write the 2-model x 2-suite tiny fixture sweep and its assertions (one report file per
   pair, additive fields, exact cost arithmetic, unpriced-model handling) before the sweep code;
   confirm red, then green.
4. Both phases: `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...
   --filter=@edmate/cli... --filter=@edmate/gateway...`; `python3 .githooks/secret-scan.py --all`.

## Phase A

### Budget
Budget: 60 tool calls (phase 1 of 2, packages: apps/cli, packages/harness/testing (read-only))

### Allowed tools
Read, Grep, Glob, Edit, Write, Bash (`corepack pnpm turbo run typecheck lint test
--filter=@edmate/cli... --filter=@edmate/harness...`, `python3 .githooks/secret-scan.py --all`).

### Exit conditions
- Done: `liveAgent.ts` passes the five-case fixture test; `edmate chat`'s own tests still green
  unchanged; `edmate eval` (replay mode) tests still green unchanged; typecheck/lint/test green;
  secret scan clean; handoff states "state after Phase A: the pipeline-backed EvalAgent exists and
  is wired into `edmate eval --record`'s default agent; no multi-model sweep yet (Phase B)."
- Stop and write `Status: PARTIAL`: past ~60 calls, or if the `TurnInput`/`EvalTurnInput` shapes
  don't line up cleanly (e.g. no way to pass `skill`/`persona` into a real turn) — flag as an open
  point rather than inventing a contracts change.

## Phase B

### Budget
Budget: 60 tool calls (phase 2 of 2, packages: packages/evals, apps/cli, evals/ content)

### Allowed tools
Read, Grep, Glob, Edit, Write, Bash (`corepack pnpm turbo run typecheck lint test
--filter=@edmate/evals... --filter=@edmate/cli...`, `python3 .githooks/secret-scan.py --all`; the
live sweep itself, e.g. `edmate eval --models evals/live-models.yaml evals/suites --report-dir
evals/reports/live`, is run only by the human after merge, never by the builder in CI).

### Exit conditions
- Done: the 2x2 fixture sweep test passes; `JsonReport`'s new fields are additive and documented;
  `evals/live-models.yaml` exists with only the two already-priced models; typecheck/lint/test
  green; secret scan clean; handoff reads Phase A's "state after" note and adds the live-run recipe
  for the human.
- Stop and write `Status: PARTIAL`: past ~60 calls, or if more than the files listed above need
  changes (e.g. `loadCasesFromDir` needs a real contract change to accept a directory of suite
  directories — flag it, don't widen scope silently).

## Risky paths touched

Checked every planned path (both phases, including the new `evals/live-models.yaml` and
`evals/reports/live/`) against `.claude/skills/merge-gate/risk-paths.txt`:
**None.** `apps/cli/**`, `packages/evals/**`, `packages/gateway/src/pricing/**` (read, not written to
with new values), and `evals/live-models.yaml`/`evals/reports/**` match no glob in risk-paths.txt
(only `evals/suites/safety/**` and `evals/suites/locked/**` are listed, and this task edits neither).
`packages/harness/src/pedagogy/**`, `guardrails/**`, `access/**`, `packages/contracts/**`,
`packages/db/**`, `packages/payments/**`, `.claude/**`, `.github/**`, `.githooks/**` are all
untouched by this task. No `risk: high` decision entry is required at merge for this reason; the
board's "Default model mix"/"Revenue share" open decisions still get a plain decision-log entry once
the live run is in, same as any other open decision this task's data answers.

## Open questions (lead can decide; recommendations below so neither phase blocks the build)

1. **Where the price table lives and who fills it in.** Answered above in its own section:
   `packages/gateway/src/pricing/prices.yaml` (already built, 2.4); the lead/a named human checks
   real prices against provider price pages before the live run; the builder never invents a price.
2. **`TurnInput` has no `skill`/`persona` field today** (those are `EvalTurnInput`-only, used by
   mechanism-test stubs so far, task 3.11e). If a live case names a `skill` or `persona` the real
   pipeline has no way to receive directly on `TurnInput`, Phase A's agent can't honour it exactly.
   Recommendation: Phase A ships what it can (plain turns, and whatever route/skill selection the
   real pipeline infers on its own from the message text and session state); if a case genuinely
   needs a forced skill/persona the pipeline can't take as input, flag it in the handoff as a gap
   for a follow-up rather than changing `TurnInput` here (that would be a contracts change needing
   an ADR, out of this task's scope).
3. **Cost per turn "by tier" when one candidate model fills both tiers.** Recommendation in Design
   above: report the split by whichever tier the pipeline actually used per call (small vs main),
   even though both tiers price identically within one model's run — this still shows the real
   shape of where cost falls in a turn (e.g. `route` vs `generate`), and the config schema already
   allows a future entry to mix tiers across two different models if the lead wants that comparison
   later. Not solved further here.
4. **New `--models` flag on `edmate eval` vs. a new `edmate eval-live` subcommand.**
   Recommendation: a flag on the existing command (listed under Files above) — smaller surface,
   reuses all of `edmate eval`'s existing suite-loading/report-writing code, and `--models` implies
   `--record` the same way `--record` already implies "need keys". A separate subcommand is also
   reasonable if the builder finds the flag's interaction with `<dir>` (one suite vs. many) awkward
   — flagged so the lead can confirm either way, not a blocker either direction.
5. **Default `evals/live-models.yaml` contents.** Recommendation: exactly the two models already in
   `prices.yaml`/`DEFAULT_MODEL_POLICY` (`claude-haiku-4-5`, `claude-sonnet-4-5`) — no third
   provider invented here. Adding an OpenAI-compatible candidate (OpenRouter, etc.) for a real
   model-mix comparison is a follow-up once that provider's key and price are both confirmed by a
   human, not guessed by this task.

## Decisions (to copy into each phase's handoff `## Decisions`)

- **7.6 Multi-turn cases seed prior turns directly, not by replaying them live** · planner ·
  risk: low. Why: `memoryTranscriptStore().appended` is a plain array the caller can push onto;
  replaying every prior turn live for every (model, suite, case) would multiply live-call cost and
  make the sweep non-deterministic across providers. Reversible: yes.
- **7.6 The price table is reused, not rebuilt; real prices are never invented by a builder or
  planner** · planner · risk: low. Why: `packages/gateway/src/pricing/prices.yaml` already exists
  (2.4) and its own comment already names this task as the moment to re-check it; business-sensitive
  numbers need a named human, per the lead's hard constraint. Reversible: yes (prices.yaml is a
  plain data file).

## Lead answers (21 Oct 2026)

- **Q1:** reuse `packages/gateway/src/pricing/prices.yaml` as it is. A builder never edits a USD value. The human re-checks the real prices before the live run, and that run is the human's, as in 5.7.
- **Q2:** plain turns only. A case that needs a forced skill or persona is reported as a gap in the handoff. No contracts change.
- **Q3:** split cost by the tier each call actually used (route or generate), not by model.
- **Q4:** a `--models` flag on `edmate eval`.
- **Q5:** `evals/live-models.yaml` lists only the two models already priced. No new model.
- **Order:** Phase A (apps/cli) runs now, alongside 7.4 Phase A (packages/evals). Phase B touches packages/evals and starts after 7.4 Phase A merges or hands off.
