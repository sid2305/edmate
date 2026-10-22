# 7.6a handoff — live sweep follow-ups

Status: DONE

Tool calls used: 73 (harness count)

## What was built

All seven deferred findings from `docs/tasks/7.6/review.md` / the 7.6 handoff's open points.

1. **Second provider.** `apps/cli/src/commands/chat/gateway.ts`'s `createChatGateway(env, opts?)`
   now takes an optional `{ baseURL }`; when given, it builds an `openai-compatible` adapter
   factory too (`createOpenAICompatibleAdapter`, following `judgeGateway.ts`'s per-provider
   pattern), requiring `EDMATE_OPENAI_COMPATIBLE_API_KEY` in addition to the existing Anthropic
   key. Absent (the plain `edmate chat` case): only the Anthropic factory is built, unchanged.
   Threaded additively through `ChatDepsOptions.baseURL` (`chat/deps.ts`) →
   `LiveEvalAgentOptions.baseURL` (`eval/liveAgent.ts`) → `EvalCommandDeps.liveAgentFor`'s new
   `baseURL` option (`eval.ts`) → `cli.ts`'s wiring. `runModelSweep` passes each live-models.yaml
   entry's own `baseURL` (already in the schema since 7.6) through to `liveAgentFor`, never from
   an env var — the key alone comes from the env var, never logged.
2. **Sweep resilience.** Each (model, suite) pair in `runModelSweep` is now wrapped in its own
   try/catch: a throw (loader problem, agent-construction failure, live-call error) is recorded
   as `{ model, suite, error }` in `summary.json` (a new `SweepSummaryRow` union type) and logged
   to stderr; the sweep continues to every other pair; exit code 1 if any pair failed (error or a
   judged failure).
3. **Typed empty-suite detection.** `packages/evals/src/loader.ts`: new `NoCasesFoundError` (named
   `dir`), thrown instead of a plain `Error`, exported from `@edmate/evals`. `eval.ts`'s
   `loadSweepCases` catches `instanceof NoCasesFoundError`, not a message-text match.
4. **Cost as a required value.** `runModelSweep` now keeps the `ReportCost` it computed in a local
   `cost` variable and pushes that directly into the summary row; `report.cost!` is gone.
5. **`--models` + `--fixtures`/`--report` rejected.** A new usage check in `runEvalCommand`
   rejects the combination before dispatching to the sweep, with a message naming `--report-dir`
   as the sweep's own option. Documented in `EVAL_USAGE`.
6. **Cast removed.** `packages/harness/src/guardrails/blockReplies.ts`'s `isBlockReply` drops the
   `as string[]` cast — `Object.values` on a `Readonly<Record<BlockCode, string>>` already types
   as `string[]`.
7. **Schema comment.** `packages/evals/src/liveModels.ts`: a comment above `LiveModelEntrySchema`
   states it must never gain a key/secret field; every key comes from an env var only.

### Tests added (scripted gateways/fixtures only, rule 4)
- `apps/cli/src/commands/chat/gateway.test.ts`: `createChatGateway` with a `baseURL` builds both
  factories; without `baseURL` the `openai-compatible` factory is absent; a missing
  `openai-compatible` key still fails with `KeyConfigError`.
- `apps/cli/src/commands/eval.test.ts`: `--models` rejected with `--fixtures`; rejected with
  `--report`; an `openai-compatible` entry's `baseURL` reaches `liveAgentFor`; a failing pair
  (bad case file) is recorded in `summary.json` with an `error` field and the sweep still
  completes the other pair (exit 1).
- `packages/evals/src/loader.test.ts`: the no-cases case asserts `instanceof NoCasesFoundError`
  and its `.dir` field, not just the message.

## Test results

`corepack pnpm turbo run typecheck lint test --filter=@edmate/cli... --filter=@edmate/evals...
--filter=@edmate/harness...`: all 26 tasks green.
- `@edmate/cli:test` — 12 files, 123 tests (up from 116: +7 new across `gateway.test.ts` and
  `eval.test.ts`), all passing.
- `@edmate/evals:test` — 26 files, 1075 tests, all passing (loader.test.ts's no-cases test
  strengthened in place, not a new count).
- `@edmate/harness:test` — 119 files, 5249 tests, all passing (full package run, not just the
  risky-path file).
- `python3 .githooks/secret-scan.py --all`: clean (exit 0, no output).

## Risky path touched: `packages/harness/src/guardrails/blockReplies.ts`

One-line change: `Object.values(BLOCK_REPLIES) as string[]` → `Object.values(BLOCK_REPLIES)`
(drops an unnecessary cast; no behaviour change, `isBlockReply`'s own test suite — 52 tests in
`blockReplies.test.ts`, unchanged — still passes). Per the plan, reviewers: code-reviewer.

## Decisions

### 21 Oct 2026 · 7.6a merge: guardrails cast removal reviewed and merged · decided by lead · risk: high
- Decided: merge 7.6a with its one-line `packages/harness/src/guardrails/blockReplies.ts` change (an unnecessary cast removed, no behaviour change), reviewed by code-reviewer (the group's required reviewer during the MVP phase) and typescript-reviewer; both approved with no CRITICAL, HIGH or MEDIUM.
- Why: a risky path needs its required reviewers and a risk: high entry.
- risk: high

### 21 Oct 2026 · 7.6a wontfix: apps/cli/src/commands/eval.ts per-pair error messages · decided by lead
- Decided: keep writing `Error.message` from a failed (model, suite) pair to stderr and the gitignored summary.json, as code-reviewer's LOW noted.
- Why: it is the same surface as the file's existing error handling, and errors that could carry key material are key-safe by their own class invariant; no fix needed.
- risk: low

### 21 Oct 2026 · 7.6a budget: 73 tool calls against 60 · decided by lead
- Decided: accept the overrun (1.22×, the handoff's ~55 was the builder's estimate).
- Why: all seven deferred findings and the second provider landed in one green run.
- risk: low

### `createChatGateway`'s openai-compatible factory takes `baseURL` as a per-call option, not a second env var
- Decided: the live sweep threads each `live-models.yaml` entry's own `baseURL` field (already in
  the 7.6 schema) through `liveAgentFor`/`ChatDepsOptions`/`createChatGateway`'s new `opts.baseURL`
  parameter, rather than reading a single global env var the way `judgeGateway.ts`'s
  `EDMATE_JUDGE_BASE_URL` does for the one pinned judge model.
- Why: the judge is one fixed model per run, so one env var is enough; the sweep can list several
  `openai-compatible` candidates with different endpoints in the same `live-models.yaml` file, and
  each entry already carries its own `baseURL` (validated in 7.6) — reading it from the file keeps
  one source of truth instead of adding a second, parallel env-var convention.
- risk: low

### A failed (model, suite) pair's summary row has only `error` set, never zeroed-out numbers
- Decided: `SweepSummaryRow` is a union — `{ model, suite, passed, total, cost }` on success, or
  `{ model, suite, error }` on failure — rather than always shipping `passed`/`total`/`cost` with
  placeholder zeros plus an optional `error`.
- Why: a reader of `summary.json` (a human, or a future dashboard) must never mistake a crashed
  pair for a pair that ran and scored zero; the union makes that ambiguity a type error instead of
  a convention to remember.
- risk: low

### `loadSweepCases`'s typed-error catch narrows to `NoCasesFoundError` specifically, not `CaseLoadError`
- Decided: only `NoCasesFoundError` (no files at all) is treated as "zero cases, not an error";
  `CaseLoadError` (a bad file inside a non-empty directory) still propagates and fails that pair.
- Why: the plan's rule is specifically about an empty suite directory (`evals/suites/pedagogy`'s
  `.gitkeep`-only case); a malformed case file is a real authoring mistake that the 7.6a resilience
  item (point 2) now surfaces per-pair instead of aborting the whole sweep, never silently as zero
  cases.
- risk: low

## Open points
None carried forward; all seven plan items are closed.
