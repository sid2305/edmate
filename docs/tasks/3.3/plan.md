# 3.3 plan: `route` (intent and `attempt`, rules first)

## Acceptance (verbatim, board + build plan)
"≥ 90% accuracy on 200 labelled turns in English plus the pilot pack's languages, reviewed by a
named human."

**Pilot-scope reading (human decisions 18/20 Oct 2026, already settled, not reopened here):** the
200 labelled turns are English; a few Hindi/Hinglish turns are added only as the safety net where
routing feeds safety (i.e. cases whose correct `intent` is `distress` or `misuse`), matching how
3.10/3.11 scoped pilot languages. "Reviewed by a named human" means the labelled set and its
expected labels carry `reviewed_by` — during MVP the lead signs (`reviewed_by: sid2305`), per the
MVP-first memory note.

**How it's shown:** a table-driven accuracy test (`route.accuracy.test.ts`) runs the real
classifier over the labelled set and asserts overall accuracy ≥ 0.90 (and ≥ 0.90 within the
English-only subset, so the few safety-net turns can't curve the number). CI fails if accuracy
drops. A short `route.test.ts` / `classify.test.ts` covers rule-by-rule unit cases and the gateway
fallback path via the scripted gateway (no real model calls anywhere).

## Current stub (read, not a surprise to the builder)
- `packages/harness/src/pipeline/steps/route.ts`: `run` rejects with `StepNotImplementedError`;
  `onFailure` returns `{ ...ROUTE_DEFAULT }` (`policies.ts`: `{ intent: 'on_task', attempt: 'none' }`).
- `defaultSteps.route` (`steps/index.ts`) wires that stub in; the runner's `routeFallback`
  (`runner.ts`) already does the full policy (onFailure → injected `distressCheck` → `ROUTE_DEFAULT`,
  trace marked `fallback`/`failed`). **3.3 does not touch the runner or the fallback chain** — only
  `route.run` (and `route.onFailure`, which 3.1 already implemented as the spec default; leave it).
- `Steps['route']` contract (`pipeline/types.ts`): `run(env, s): Promise<RouteResult>` where
  `RouteResult = { intent: Intent; attempt: Attempt; usage: Usage[] }`.

## Design (rules first, model fallback through the gateway)
- New `packages/harness/src/routing/` module, imported only by `route.ts` (keeps
  `pipeline/steps/route.ts` thin, matches how `pedagogy/` and `guardrails/` are split out):
  - `classify.ts`: pure rules for **intent** (keyword/regex/structural checks — code block or
    numeric/short final-answer shape, question marks, off-topic markers, meta phrases like "how do
    you work", misuse markers) and **attempt** (none when no answer-shaped content; wrong/partial/
    correct only when the session's stored `answerKey` is readable — route reads it via
    `pedagogy/helpState.ts`'s existing `loadSessionHelp`/`parseSessionHelp` on `Entitled.helpState`,
    a **read-only import**, nothing there changes). No readable answer key → attempt is `none` or
    `wrong`-by-shape only, never `correct`/`partial` (never guesses a match it can't check).
  - `modelFallback.ts`: when the rules are not confident for **intent only** (attempt stays
    rules-only, see above), one `env.gateway.generateObject` call against `IntentSchema`, in the
    same shape as 2.6's `scriptedObjectIntent` fixture. Attempt never goes through the model.
  - `index.ts`: `classifyTurn(env, s): Promise<RouteResult>` — tries rules, falls back to the
    gateway only for intent, always returns a schema-valid `RouteResult` with usage.
- `route.ts` becomes: `run: (env, s) => classifyTurn(env, s)`; `onFailure` unchanged (3.1's).
- Distress consistency: reuse `guardrails/distressKeywords.ts`'s `hasAnyDistressKeyword` as one
  intent-`distress` rule (read-only import) so route's own distress signal doesn't diverge from the
  runner's last-resort check.
- No contracts change: `Intent`, `Attempt`, `RouteResult` all already exist and are frozen.

## Files to create / modify
- `packages/harness/src/pipeline/steps/route.ts` (rewrite the stub)
- `packages/harness/src/routing/classify.ts` (+ `classify.test.ts`)
- `packages/harness/src/routing/modelFallback.ts` (+ `modelFallback.test.ts`, scripted gateway only)
- `packages/harness/src/routing/index.ts`
- `packages/harness/src/pipeline/steps/route.test.ts` (step-level wiring test)
- `packages/harness/src/testing/gatewayFixtures.ts`: small addition only if `scriptedObjectIntent`'s
  shape doesn't already cover the fallback call (likely a same-shape addition, not a rewrite)
- Phase B only: a labelled-turns fixture (e.g. `packages/harness/src/routing/labelledTurns.ts` or
  `.json`, 200 English + a handful Hindi/Hinglish distress/misuse turns) and
  `route.accuracy.test.ts`

## Files out of bounds
- `packages/contracts/**` (no ADR planned; `Intent`/`Attempt`/`RouteResult` already fit)
- `packages/harness/src/pipeline/runner.ts`, `policies.ts`, `errors.ts` (3.1's territory; routeFallback
  stays as is)
- `packages/harness/src/pedagogy/**` (read-only import of `helpState.ts` only; no edits)
- `packages/harness/src/tools/**` (5.5 is in review now — stay out per the lead's note)
- `packages/harness/src/access/**`, `packages/harness/src/guardrails/**` (read-only import of
  `distressKeywords.ts` only; no edits)

## Tests first
1. `classify.test.ts`: table-driven, one row per intent/attempt rule (on_task, answer_seeking,
   off_topic, distress, misuse, meta; none/wrong/partial/correct with and without a readable
   answer key).
2. `modelFallback.test.ts`: scripted gateway only (reuse/extend `scriptedObjectIntent`); asserts
   the fallback is reached only when rules are inconclusive, and usage is reported.
3. `route.test.ts`: `route.run` wiring — schema-valid `RouteResult` on the happy path; a thrown
   rule/gateway error still rejects (so the runner's existing `routeFallback` policy applies — no
   new failure handling needed here).
4. Phase B: `route.accuracy.test.ts` against the 200+ labelled set, ≥ 90% overall and ≥ 90% on the
   English-only subset.

## Phase A (builder, ~90–110 tool calls): classifier + step wiring
Files: the six listed above except the labelled set. Green commit: `classify`/`modelFallback`/
`route` tests pass; `turbo run typecheck lint test --filter=harness`. State after this phase: route
no longer throws `StepNotImplementedError`; the runner's existing fallback path becomes dead code
for the happy path but stays as the safety net 3.1 built it as.

## Phase B (eval-author, separate task on the board as 3.3b or folded in as a sub-task): labelled
set + accuracy test. Needs the lead's `reviewed_by: sid2305` sign-off before merge (rule 7), tracked
in `.claude/blockers.md` when the set is ready, the same pattern as the eval-suite sign-offs
(B-9/B-10/B-11/B-17). Does not touch classifier code — only adds the fixture + its one test.

## Risky paths touched
None of Phase A's or Phase B's files match a `risk-paths.txt` glob: `pipeline/steps/**`,
`routing/**` and `testing/**` are not listed; only *reads* (not edits) touch `pedagogy/**` and
`guardrails/**`, which don't trigger the gate (it's edited paths, not imports). No `risk: high`
decision is needed for risk-paths reasons. The labelled set still needs the ordinary rule-7 human
sign-off (not a risk-paths reviewer group) before merge — log that as a normal decision, not
`risk: high`.

## The same-topic → locked anomaly (3.9 report)
Diagnosed (reviewer): `retrievalQuery.ts` appends the last agent message's tail to the query, which
dilutes `memoryRetrieval`'s overlap score below `DEFAULT_COVERAGE_THRESHOLD`; `probe()` then marks
any score above 0 as a locked hit, and `coverageGate` returns `'locked'` whenever coverage fails and
`lockedHit` is true. This is entirely in `buildContext`'s retrieval/probe path (3.4) plus
`pedagogy/coverage.ts`'s gate — **route and `attempt` are not involved**: `route` only supplies
`intent`/`attempt`, which `coverageGate` never reads, and the ladder (`ladder.ts`) only turns
`locked` into a move via `skills.ts`'s `skill_not_entitled`/`coverageGate` paths, not from repeated
`attempt` values. Recommend a separate harness follow-up task (query-building or probe-threshold
fix in `retrievalQuery.ts`/`coverage.ts`), not a widening of 3.3's scope.

## Open questions (none blocking)
- Exact file for the labelled set (flat `.ts` array vs `.json`) — recommend `.ts` with a typed
  `LabelledTurn[]` so the accuracy test gets type safety for free; no human decision needed.
- Whether `modelFallback` needs a confidence threshold config exposed to callers, or stays an
  internal constant — recommend an internal constant for MVP, revisit if accuracy comes in low.

## Lead answers (20 Oct 2026)
- Q1: the labelled set is a typed `.ts` `LabelledTurn[]`.
- Q2: the model-fallback confidence threshold stays an internal constant for the MVP.
- Phase B is a second builder run on the same branch (eval-author writes the set). Per the MVP rule (20 Oct 2026), the lead signs it as `reviewed_by: lead`, so no blocker entry is needed.
- The same-topic → locked anomaly is out of scope. It goes to the new board task 3.4c.

READY
