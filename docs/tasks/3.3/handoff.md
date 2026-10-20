# 3.3 handoff: `route` Phase A (rules-first intent and attempt, model fallback)

Status: DONE (Phase A only; Phase B, the 200 labelled turns and `route.accuracy.test.ts`, is a separate run)
Branch: `m3/3.3-route-intent-attempt` (built on local `work-3.3`)
Worktree: `.claude/worktrees/agent-a6dfcb6531960a196`

## Files
- `packages/harness/src/routing/classify.ts` (+ `classify.test.ts`, 114 tests): intent rules in
  priority order (hard distress keyword, misuse, answer_seeking, meta, off_topic, on_task markers /
  answer-shaped / acks); `attempt` against the stored answer key (`parseSessionHelp`, read-only).
- `packages/harness/src/routing/modelFallback.ts` (+ `modelFallback.test.ts`, 8 tests): one
  small-tier `generateObject` against `{ intent: IntentSchema }`, text as JSON data, 300 ms deadline,
  honours the step's cancel token; throws on failure, timeout, cancel or an invalid answer.
- `packages/harness/src/routing/index.ts`: `classifyTurn(env, s)` plus re-exports.
- `packages/harness/src/pipeline/steps/route.ts`: `run` = `classifyTurn`; `onFailure` now runs the
  injected `distressCheck` (see Deviations).
- `packages/harness/src/pipeline/steps/route.test.ts` (11 tests): step wiring, schema-valid result,
  model reached only for an inconclusive intent, rejection on model failure, onFailure.
- `packages/harness/src/testing/gatewayFixtures.ts`: added `scriptedObjectRouteIntent`
  (same shape as `scriptedObjectIntent`, but a real `Intent` value; the old fixture's
  `'question'` is not one).
- `packages/harness/src/pipeline/runner.test.ts`: the "remaining stub throws" test now asserts
  route classifies instead (test file only; `runner.ts` untouched).

## Evidence
`PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1`
```
@edmate/harness:test:  ✓ src/routing/classify.test.ts (114 tests)
@edmate/harness:test:  ✓ src/routing/modelFallback.test.ts (8 tests)
@edmate/harness:test:  Test Files 97 passed (97)
@edmate/harness:test:  Tests 4443 passed (4443)
@edmate/harness:test: All files  | 98.85 | 97.11 | 98.17 | 99.31
@edmate/harness:test:   route.ts | 100 | 100 | 100 | 100
@edmate/harness:test:  src/routing | 99.25 | 97.89 | 100 | 100
 Tasks:    10 successful, 10 total
```
`python3 .githooks/secret-scan.py --all` → clean (no output).

## Deviations
1. **Soft distress phrases are not a route rule.** The plan said reuse `hasAnyDistressKeyword`
   (hard or soft). Route's `distress` escalates the turn in the runner, so a soft hit (a bare
   "suicide" in a Hamlet lesson) would escalate even when preGuard's classifier (4.3, safety
   reviewed) judged it safe. Route uses the same keyword tables, but only a **hard** phrase is a
   confident `distress`; a soft phrase is inconclusive and goes to route's model, which may answer
   `distress`. The runner's own last-resort checks (any soft hit when preGuard failed) are
   unchanged. The lead may want to confirm this.
2. **`route.onFailure` runs `deps.distressCheck`.** The plan said leave `onFailure` as is, but the
   spec row ("distress keywords still escalate") and the stub's own header said 3.3 adds it; before
   this, a route failure with a working `onFailure` never checked distress keywords. If
   `distressCheck` throws, `onFailure` throws and the runner's existing chain takes over.
3. **`usage` is always `[]`.** `ModelGateway.generateObject` returns no usage (contracts), so route
   can't report the fallback's usage; same as 4.3/4.4's classifiers. The production gateway is
   metered by the composition root. The test checks the call happened through the scripted
   gateway's own usage record instead.

## Decisions
- `answerKey` items are read as **required parts** of one answer: all matched → `correct`, some →
  `partial`, none → `wrong`. Numbers are compared by value (fractions, decimals, `1,000`, unicode
  minus); a decimal with 2+ places matches when it rounds to the key (0.83 for 5/6). Other parts
  match as whole words.
- Credit (`correct`/`partial`) needs answer-shaped text (a bare expression, a code block, "I got
  …", "is it …", a short reply of up to 3 naming words) or a `check_answer` turn; a key match
  inside a question like "why is it 5/6?" is `none`. With no readable key, answer-shaped text is
  `wrong` (an attempt that can't be credited), as the plan allowed.
- `skill_action` turns are always attempt `none` (the skill scores itself, 5.6); `hint_request`,
  `check_answer` and `skill_action` turns are intent `on_task` unless a hard distress phrase hits.
- off_topic, meta and misuse rules are deliberately narrow (they make decide redirect); greetings
  and acks ("hi", "ok", "thanks") are confident `on_task`. Anything no rule hits goes to the model.
- Romanised Hindi misuse ("homework kar do", "assignment likh do") and answer-seeking ("answer
  bata do") phrases are in as the pilot safety net only.
- The model fallback's deadline is an internal constant, 300 ms inside route's 400 ms (lead Q2).
