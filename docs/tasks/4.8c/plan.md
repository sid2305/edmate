# Plan: 4.8c — advice guard: self-regulated verbs after a dash or comma (folds in 4.8d)

Status: READY. Written by the lead (28 Oct 2026). One phase, one builder.

## Goal
1. **4.8c (the 4.8b Phase A review MEDIUM).** `IMPERATIVE_RX` treats an em/en dash or ", " as a sentence break. A `SELF_REGULATED` verb (buy, sell, invest, sue) matched there skips the `REGULATED_RX` object check, so history prose becomes a hard-rule hit:
   - "The stock market fell sharply in 1929 — invest wisely was the advice given then, in hindsight."
   - "The old traders' motto was simple: buy low, sell high." (here `sell` comes after ", ")
2. **4.8d (the 4.8b Phase B review LOWs).**
   - (a) A rewrite-verify outage (the judge throws, or no judge is configured on the verify call) now reports a distinct reason code instead of the generic `personal_advice`.
   - (b) The header comment in adviceGuard.ts matches the current outage behaviour.

## Files
- `packages/harness/src/guardrails/adviceGuard.ts`: the rule, the new reason code and the header comment.
- `packages/harness/src/guardrails/adviceGuard.test.ts`: reproducers.
- `packages/harness/src/pipeline/steps/postGuard.ts`: maps the new reason to a report (see 2a).
- `packages/harness/src/pipeline/errors.ts`: widens the `AdviceJudgeUnavailable` cause union.
- `packages/harness/src/pipeline/steps/postGuard.advice.test.ts`: a test for the new report.
- Nothing in `packages/contracts`. Reason codes are harness-local strings (`ADVICE_REASONS`). Do not add a new contracts error class.

Risky group: `packages/harness/src/guardrails/**` (safety). Reviewer: code-reviewer, plus a risk: high lead decision (MVP-first rule).

## Design
### 1. 4.8c rule
- In `personalDirective()`, record which break matched each `IMPERATIVE_RX` hit.
  - A **strong break** is the start of the text or `[.!?;:\n]`. It keeps today's behaviour: a `SELF_REGULATED` verb alone is a hit.
  - A **weak break** is ", " or an em/en dash. There a `SELF_REGULATED` verb counts only when the rest of its sentence (`windowAfter`) has one of:
    - a regulated object (`REGULATED_RX`, tested on the window **without** the verb itself, since the verb words are in `REGULATED`);
    - or a direct-object or second-person cue. The builder picks the narrowest closed list that keeps every existing must-block test blocking, for example `it|them|this|that|these|those|now|today|you|your|everything|all|more|some|\d`. Record the chosen list as a builder decision.
- `sign`, `file` and the other verbs keep their current logic on both break kinds.
- The `buy low, sell high` sentence: "buy" follows ": ", which is a strong break. If the strong-break "buy" still trips the rule, do **not** widen this task to strong breaks. Record it as a builder decision ("the colon form stays a hit; the judge is not consulted for hard-rule hits"), and make the pass test the comma-only form instead: "Their motto was to buy low, sell high." There "buy" is not at a break, and "sell" follows ", ".

### 2. 4.8d
- (a) Add `ADVICE_REASONS.rewriteUnverified: 'rewrite_unverified'`. Use it when the rewrite was produced and passed `rewriteRejected`, but the verify judge gave **no answer**: it threw, or `x.adviceJudge` is undefined. The output is unchanged (the fixed fallback); only the reason changes.
  - A judge answer that is not clean stays `personal_advice`.
  - The rewrite call itself throwing stays `rewrite_failed`.
  - Map the new reason in postGuard.ts to `env.report(new AdviceJudgeUnavailable('verify'))`. The class lives in harness, at `packages/harness/src/pipeline/errors.ts:181`; widen its cause union to `'scrub' | 'judge' | 'verify'` and update its doc comment. Grep for other `AdviceJudgeUnavailable` cause consumers (worker, web) and keep them type-clean.
- (b) Rewrite the step 3 and step 4 header comment (lines 21–29) so it says:
  - a judge outage on a weak-signal-only turn passes unchanged (4.8b Q1, option A);
  - any stronger reason fails closed with `judge_unavailable`, or with `scrub_failed` when the scrub threw;
  - an accepted rewrite is judged once more, and no clean verdict means the fixed fallback (`rewrite_unverified` when no answer, `personal_advice` when the verdict is advice);
  - a throwing rewrite call gives `rewrite_failed`.

## Tests (write first, confirm red, then green)
- Must pass (ok, no hard-rule hit):
  - the 1929 sentence;
  - "Their motto was to buy low, sell high.";
  - "Prices rose for a decade, sell-offs came later." (a word boundary sanity check).
- Must still block (hard-rule hit) after a weak break:
  - "Okay — buy it now.";
  - "Honestly, sell everything today.";
  - "Yes, invest in index funds.";
  - "Okay, sue them.";
  - "So — sue your landlord.".
- Every existing `adviceGuard.test.ts`, `postGuard.advice.test.ts` and `packages/evals/src/adviceFixtures.test.ts` case still passes unchanged. **Do not edit an existing assertion to make it pass**; if one breaks, narrow the rule instead.
- 4.8d (a):
  - the verify judge throws → reason `rewrite_unverified`, text is the fallback;
  - no judge configured on the verify path → `rewrite_unverified`;
  - the verify judge says advice → `personal_advice`.
- Coverage for `src/guardrails/**` stays at 100%.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`. This includes the dependents, so evals, the worker and web all run.
- `python3 .githooks/secret-scan.py --all`.
- No real model calls; use the scripted judge and rewrite fakes already in the tests.

## Budget
About 60 tool calls (harness count), one phase. Stop at 90 and hand back PARTIAL.
