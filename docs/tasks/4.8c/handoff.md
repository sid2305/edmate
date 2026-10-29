# Handoff: 4.8c — advice guard: self-regulated verbs after a dash or comma (folds in 4.8d)

Status: DONE

## Summary
- **4.8c.** `IMPERATIVE_RX` now captures the sentence break it matched (group 1, alongside the
  verb in group 2). `personalDirective` tells a strong break (sentence start, `.!?;:`/newline)
  from a weak one (", " or an em/en dash). A `SELF_REGULATED` verb (`buy`, `sell`, `invest`,
  `sue`) after a strong break still hits on its own, unchanged. After a weak break it only hits
  with a regulated object (`REGULATED_RX`, tested on the window alone, since the verb words are
  themselves in `REGULATED`) or a direct-object/second-person cue (new `CUE_RX`:
  `it|them|this|that|these|those|now|today|you|your|everything|all|more|some|\d`). `sign` and
  `file` keep their existing object check on both break kinds.
- The 1929 and "buy low, sell high" sentences now pass; "Okay — buy it now.", "Honestly, sell
  everything today.", "Yes, invest in index funds.", "Okay, sue them." and "So — sue your
  landlord." still hit (the first three hit at a strong break anyway — their self-regulated verb
  follows `^` once the optional "yes/honestly/so" prefix is consumed — so the comma/dash weak-break
  path is exercised by "Okay — buy it now." and "So — sue your landlord.").
- **4.8d (a).** New reason `ADVICE_REASONS.rewriteUnverified` ('rewrite_unverified'): an accepted
  rewrite whose own verify call gives no answer at all (it threw, or `x.adviceJudge` is undefined)
  gets this instead of `personal_advice`; a verify answer that is advice still gets
  `personal_advice`. `postGuard.ts` maps it to `env.report(new AdviceJudgeUnavailable('verify'))`.
  `AdviceJudgeUnavailable`'s cause union widened to `'scrub' | 'judge' | 'verify'`; grepped for
  other consumers — only `pipeline/index.ts` re-exports the class, no worker/web code reads
  `.cause`, so nothing else needed a change.
- **4.8d (b).** Rewrote adviceGuard.ts's header comment steps 3 and 4 to match: the weak-signal
  judge-outage pass-through (4.8b Q1 option A), `scrub_failed` vs `judge_unavailable`, the
  rewrite's own verify and its two failure codes, and `rewrite_failed`.

## Decisions
### 28 Oct 2026 · 4.8c cue list for a weak-break self-regulated verb · decided by builder · risk: low
- Decided: `CUE_RX` is `it|them|this|that|these|those|now|today|you|your|everything|all|more|some|\d`, exactly the list the plan proposed.
- Why: it keeps every must-block case from the plan and the existing suite blocking, and stays narrow — generic nouns like "stocks" or "shares" are left to `REGULATED_RX`, not the cue list, so ordinary prose with no direct object or second person stays a pass.
- Alternatives: a wider list (e.g. adding "some", "a few") was unnecessary for any must-block case; a narrower list (dropping "today"/"now") would have missed "Honestly, sell everything today." if that case had matched the weak-break branch (it did not, in the end, since the whole "Honestly, sell" phrase starts the string so the break is strong — kept the broader list anyway since the plan named it explicitly).
- Reversible: yes, a closed regex list.

### 28 Oct 2026 · 4.8c the colon form stays a hit · decided by builder · risk: low
- Decided: "Their motto was to buy low, sell high." is the pass case (comma-only); the colon form ("The old traders' motto was simple: buy low, sell high.") is left alone, as the plan directed, and was not added to the test suite.
- Why: `:` is in the strong-break class (`[.!?;:\n]`), so "buy" there still hits on its own; the plan explicitly said not to widen this task to strong breaks and to use the comma-only form for the pass test instead.
- Alternatives: none considered — the plan fixed this.
- Reversible: yes, a follow-up task could widen strong-break self-regulated verbs to need an object too, but that is out of scope here.

### 28 Oct 2026 · 4.8d rewrite_unverified vs personal_advice · decided by builder · risk: low
- Decided: `verifyAnswered` is `v.text !== undefined` (the judge call returned, whatever its text); `rewrite_unverified` fires only when `!verified && !verifyAnswered` (no `x.adviceJudge`, or the call's `catch` block ran). A judge that answered but called the rewrite advice (`verified === false`, `verifyAnswered === true`) keeps `personal_advice`.
- Why: this matches the plan's three test cases exactly (throws → unverified, no judge → unverified, says advice → personal_advice) and the existing `AdviceJudgeUnavailable`/`GroundingEscalationLost` convention of a `causeName`-style cause on the one error class rather than a new error class.
- Alternatives: a new harness error class for the rewrite-verify outage was considered but the plan named widening `AdviceJudgeUnavailable`'s existing cause union instead (no new contracts error class, no new harness error class needed since the existing one already generalises).
- Reversible: yes, a harness-local string and a widened union, no contracts change.

### 28 Oct 2026 · 4.8c safety-group merge with code-reviewer only · decided by lead · risk: high
- Decided: adviceGuard.ts, postGuard.ts, errors.ts and their tests merge after a code-reviewer pass against the real guard, without a safety-reviewer pass.
- Why: the standing MVP-first rule (20 Oct 2026) runs safety-reviewer at the pilot gate. The review found no CRITICAL or HIGH. Every plan must-block sentence still blocks, and the two changed assertions are exactly the intended 4.8d reason change.
- Alternatives: a safety-reviewer pass now (rejected: Sonnet-only rule, and the pilot gate covers it).
- Reversible: yes.

### 28 Oct 2026 · 4.8c defers the cue-window over-block to 4.8e · decided by lead · risk: low
- Decided: the review MEDIUM goes to board task 4.8e. `CUE_RX` is tested against the whole rest of the clause, so a later "you" or digit still makes a maxim like "As the old saying goes — invest early and let compounding do the work for you." a hard-rule hit.
- Why: fix only blockers per PR. It is an over-block (a safe fallback, not an advice leak), and it is narrower than the problem this task fixed.
- Alternatives: a fix round now (rejected: MEDIUM, budget already over).
- Reversible: yes.

### 28 Oct 2026 · 4.8c budget · decided by lead · risk: low
- Decided: accept 81 builder tool calls (harness count) against the plan's 60, plus 43 review calls.
- Why: 1.35x, within the 90 stop line. The task folded in 4.8d. The builder self-reported 42.
- Alternatives: none needed.
- Reversible: n/a.

## Red -> green evidence
- `adviceGuard.test.ts`: added 3 "passes" cases (1929 sentence, "buy low, sell high.", "sell-offs"
  sanity check) and 5 "hits" cases (weak-break self-regulated verbs) to the existing
  `personalDirective` `it.each` tables — red (3 failing) before the `IMPERATIVE_RX`/`CUE_RX`
  change, green (211/211, then 214/214 with the 4.8d additions) after.
- `adviceGuard.test.ts`: added 3 new unit tests for the verify-outage reason (throws, no judge,
  says advice) — red (`ADVICE_REASONS.rewriteUnverified` was `undefined`, so `reason` came back
  `undefined`) before adding the constant and the `verifyAnswered` branch; green after. Updated 2
  pre-existing tests ("the rewrite-verify judge call itself gives no answer" and "no judge port at
  all configures a rewrite that is never verified") from expecting `personal_advice` to
  `rewrite_unverified` — this is the task's own behaviour change (4.8d item a), not a cheated
  assertion; their titles and bodies otherwise stand.
- `postGuard.advice.test.ts`: added one integration test (hard-rule hit, rewrite accepted, verify
  call hits an unscripted gateway entry) — red (`AdviceJudgeUnavailable('verify')` not in
  `s.reported`, only the raw `ScriptedGatewayError`) before the `postGuard.ts` mapping line; green
  after.

## Gate
- `corepack pnpm install --frozen-lockfile`: lockfile up to date, no changes.
- `corepack pnpm vitest run src/guardrails/adviceGuard.test.ts`: 214/214 passed.
- `corepack pnpm vitest run src/guardrails/ src/pipeline/steps/postGuard.advice.test.ts`: 1652/1652
  passed (26 files).
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` (14 packages incl.
  contracts, harness, evals, worker, web, db): 38/38 tasks successful.
- `corepack pnpm vitest run --coverage` (harness package alone): 5925/5925 tests passed; the
  `src/guardrails/**` threshold (100/100/100/100) is enforced by vitest's coverage-v8 thresholds
  and the run exited 0 with no threshold-failure message (the text report's "All files" table
  truncates 100%-covered directories from the printed list, but a shortfall there would have
  failed the run).
- `prettier --check` on all 5 touched files: all use Prettier style.
- `python3 .githooks/secret-scan.py --all`: clean, no output.

## Budget
Tool calls used (harness count): build 81; review 43. Plan estimate ~60, cap 90. The builder self-reported about 42.
