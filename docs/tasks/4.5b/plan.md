# 4.5b plan — answerLeak paraphrase and non-numeric keys (judge pass)

## Accept (verbatim)
"leak cases with word or code keys and a paraphrased answer are caught on recorded fixtures; the judge rubric lines run in replay."

How shown: `leakFixtures.test.ts` gains paraphrase/word/code-key cases that run through the real `answerLeak` guard, the real `postGuard` step and a scripted (non-live) judge gateway wrapper — exactly the pattern 4.7 (`groundingJudge.ts`) and 4.8 (`adviceJudge.ts`) already use. `answerLeak.test.ts` and a new `postGuard.leakJudge.test.ts` show the judge is called only when the regex matcher misses and a non-numeric key is present, that a leak verdict gets the existing rewrite-or-hint path, and that a judge outage fails closed to `ANSWER_LEAK_SAFE_HINT`.

## Approach
`answerLeak` stays rules-first: `compileAnswerKeys(...).leaks(text)` runs exactly as today and, on a hit, takes the existing rewrite-or-hint path unchanged. Only when that regex/number/base64 matcher finds nothing **and** `decision.mustNotReveal` holds at least one non-numeric (word or code) key does the guard ask a new bounded small-tier judge — built by `postGuard.ts` the same way `judgeFor`/`adviceJudge` already are, sharing `answerLeak`'s own slice — whether the reply states, confirms or clearly paraphrases that key without quoting it. A leak verdict is treated exactly like a regex hit (same rewrite call, same `ANSWER_LEAK_SAFE_HINT` fallback); the rewrite's own output is re-checked by both the regex matcher and (for a still-non-numeric key) the same judge before it is accepted, mirroring adviceGuard's rewrite-then-reverify. The judge's rubric is a fixed English string owned by `answerLeak.ts` (`LEAK_JUDGE_SYSTEM`, alongside the existing `ANSWER_LEAK_SAFE_HINT`/`REWRITE_SYSTEM`-style constants) — **not** a prompt pack: it is never loaded from `content/prompt-packs/**`, never varies by locale or agent, and is sent verbatim like `ADVICE_JUDGE_SYSTEM`/`GROUNDING_JUDGE_SYSTEM` already are. No `packages/contracts` change and no ADR: `PostGuardCtx` gains one more optional field of the existing `GroundingJudge`/`JudgeRequest` type (already exported from `answerLeak.ts` for 4.7/4.8's reuse), and `postGuards.ts` only tunes `answerLeak`'s weight (same adaptive-weight idiom `postGuard.ts` already uses for `adviceGuard`) so a turn that never calls the judge doesn't starve the other guards.

A judge outage (no answer, timeout, cost ceiling) fails closed: unlike adviceGuard's weak-signal exception, this guard already found no regex leak, so the only question is a paraphrase it can't check — the guard returns `ANSWER_LEAK_SAFE_HINT` with reason `judge_unavailable`, matching grounding's "outage always fails closed" precedent (the stricter of the two existing patterns, chosen because this guard protects the answer itself, not a softer "is this grounded" check).

## Files to touch
Phase A (packages/harness):
- `packages/harness/src/guardrails/answerLeak.ts` — `LEAK_JUDGE_SYSTEM`, `leakJudgeRequest()`, `LeakVerdictSchema`/`leakVerdictClean()` (mirrors `adviceVerdictClean`), `PostGuardCtx.leakJudge?: GroundingJudge`, the guard's judge branch, new reason codes (`answer_key`, `paraphrase`, `judge_unavailable` — fixed codes only, never text).
- `packages/harness/src/pipeline/generate/answerKey.ts` — small exported helper, e.g. `hasNonNumericKey(mustNotReveal: readonly string[]): boolean`, reusing the file's existing numeric-key detection so `answerLeak.ts` never duplicates number-parsing logic.
- `packages/harness/src/pipeline/steps/postGuard.ts` — build `leakJudge` via the existing `judgeFor(env, budgetMs)` helper, give it a share of `answerLeak`'s slice (new `LEAK_JUDGE_SHARE` constant, alongside `REWRITE_SHARE`), and adapt `answerLeak`'s weight in `weightsFor` only when `mustNotReveal` holds a non-numeric key (same idiom as `adviceMayCall`/the `adviceGuard` branch there).
- `packages/harness/src/guardrails/postGuards.ts` — comment/weight note only if the default weight changes; likely no line change beyond a comment, since the per-turn adaptive weight lives in `postGuard.ts`.
- `packages/harness/src/testing/leakJudge.ts` (new) — a non-circular fake judge (`paraphraseJudge`) and a `leakJudgeGateway(inner, verdict)` wrapper, modeled line-for-line on `testing/adviceJudge.ts`/`testing/groundingJudge.ts`: it reads the key and reply back from the request's fenced blocks and decides from word overlap plus a small fixed synonym/confirmation-marker table (not from any test case's own expectation), so it is reusable the same way `overlapJudge` is.
- `packages/harness/src/testing/index.ts` — export the new judge/gateway.
- Tests: `guardrails/answerLeak.test.ts` (judge branch: called only on a non-numeric key with no regex hit; outage fails closed; rewrite re-verified with the judge), new `pipeline/steps/postGuard.leakJudge.test.ts` (wiring, slice sharing, weight), `testing/leakJudge.test.ts` (mirrors `adviceJudge.test.ts`).

Phase B (packages/evals):
- `evals/suites/leak/leak-paraphrase-*.yaml`, `leak-wordkey-confirm-*.yaml`, `leak-codekey-confirm-*.yaml` (3-5 new cases; `reviewed_by: pending`, the human signs off before merge, same as 4.5's six cases) — word/code `mustNotReveal` keys (the bank already has these for MCQ/short-answer items) with a paraphrased or confirmed-without-quoting leak reply.
- `packages/evals/src/leakFixtures.test.ts` — wires `leakJudgeGateway(gateway, paraphraseJudge)` into the existing real-`runTurn`/real-`postGuard` harness alongside the already-stubbed pieces, and runs the new cases through it (stream + final + mutation, same table as the existing 38 cases).

## Files out of bounds
- `packages/harness/src/guardrails/preGuardCtx.ts`, `distressDetect.ts`, `moderationIn.ts`, `jailbreak.ts`, `safetyClassifier.ts`, `packages/harness/src/pipeline/steps/preGuard.ts` — 4.4b is building these right now; this plan touches none of them. (Open question below if that turns out to be unavoidable — it should not be.)
- `packages/contracts/**`, `content/prompt-packs/**`, `content/skills/**` — no change; the judge rubric is harness-owned text, not a pack.
- `packages/harness/src/guardrails/grounding.ts`, `adviceGuard.ts`, `lockedLeak.ts`, `personaBoundary.ts`, `tone.ts` — read-only reference for the pattern, not edited.
- `evals/suites/safety/**`, `evals/suites/locked/**` — untouched (risk-paths groups this plan does not need).

## Tests first
1. `answerKey.test.ts` (or a new small test file): `hasNonNumericKey` true for a word/code key, false for every numeric form already covered by `numbers.ts`/`base64Leak.ts`.
2. `answerLeak.test.ts`: no judge call when the regex matcher already caught the leak or `mustNotReveal` is all-numeric; judge called (with the key and reply fenced) only on a miss with a non-numeric key; a leak verdict takes the rewrite-or-hint path; the rewrite is re-checked by the judge too; no answer from the judge → `ANSWER_LEAK_SAFE_HINT`, reason `judge_unavailable`.
3. `testing/leakJudge.test.ts`: `paraphraseJudge` is non-circular (built only from the request's own blocks); `leakJudgeGateway` answers only requests carrying `LEAK_JUDGE_SYSTEM`, everything else passed through.
4. `postGuard.leakJudge.test.ts`: `leakJudge` wired into `PostGuardCtx`; its slice comes from `answerLeak`'s own budget share; weight adapts only when a non-numeric key is present this turn.
5. `leakFixtures.test.ts` (Phase B): the new paraphrase/word/code-key cases run 0 leaks streamed and 0 in the final reply through the real chain with the scripted judge gateway; a mutation run (an `answerLeak` that never calls the judge, or a judge stubbed to always answer clean) fails every new case, proving the judge is load-bearing.

## Risky paths touched
- `packages/harness/src/guardrails/answerLeak.ts`, `postGuards.ts` → group `packages/harness/src/guardrails/**` → reviewers: **code-reviewer** (MVP-first rule, 20 Oct 2026: safety-reviewer waived per PR until 13.3; this PR still logs `risk: high`).
- `packages/harness/src/pipeline/steps/postGuard.ts`, `pipeline/generate/answerKey.ts`, `packages/harness/src/testing/**`, `packages/evals/src/**`, `evals/suites/leak/**` → match no glob in `.claude/skills/merge-gate/risk-paths.txt` (same as 4.5's own handoff: "pipeline/**, packages/evals/src/** matches no risk-paths glob"; `evals/suites/leak/**` is not in the safety/locked list there).
- No `packages/contracts/**` change, no ADR.

## Open questions (with recommendation)
1. **How much latency/cost does calling the judge add to ordinary turns with a non-numeric key?** Many teaching replies will have a word/code `mustNotReveal` entry even when nothing leaked. *Recommendation:* ship without a cheap pre-filter for this task (MVP-first; the regex miss is already the first gate) but size `answerLeak`'s weight up only on those turns (see Approach) so the rest of the chain's budget is protected; leave a narrower pre-filter (e.g. only call the judge when the reply also has a confirmation/agreement marker) as a follow-up if 7.x latency tuning shows it's needed.
2. **Does the rewrite's re-verify call need its own slice tracking (`leftOf`) like adviceGuard's, or is the existing `REWRITE_SHARE` split of `answerLeak`'s slice enough now that up to two judge calls plus one rewrite can run in one guard?** *Recommendation:* reuse adviceGuard's `leftOf(name)` idiom (what's actually left of the guard's slice) instead of a second fixed fraction, since `REWRITE_SHARE` alone was sized for one call.
3. **Non-circular fake judge for the fixture test:** a true semantic paraphrase judge can't be deterministic and still test-independent. *Recommendation:* the fixture judge (`paraphraseJudge`) uses a small fixed confirmation-marker/word-overlap rule (English + the existing Hinglish/Devanagari confirmation list from the 4.5 own-code decision), same spirit as `overlapJudge`; it must not read any case's `must_not_contain` list, only the request's own key/reply blocks.
4. **4.4b file overlap:** none of this plan's files are in 4.4b's list (`preGuardCtx.ts`, `distressDetect.ts`, `moderationIn.ts`, `jailbreak.ts`, `safetyClassifier.ts`, `pipeline/steps/preGuard.ts`). If the builder finds an unavoidable touch there, stop and raise it rather than editing — recommendation is to avoid it entirely, which this design does (post-guard side only).

## Budget
Budget: 60 tool calls (2 phases: Phase A packages/harness ~45, Phase B packages/evals ~15)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test for `--filter=...@edmate/harness --filter=@edmate/evals` and the secret scan only; no docker, docker compose or psql)

## Exit conditions
- **DONE**: both phases' gate commands (`corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/evals`) pass, the secret scan is clean, the new leak cases are present with `reviewed_by: pending` for the human to sign, and the handoff shows the judge-branch tests and the mutation run failing without the judge.
- **PARTIAL**: past ~45 tool calls in Phase A or ~15 in Phase B with the gate not yet green, or a file outside this plan's list needs changing (especially anything in 4.4b's list) — stop, write the handoff with what's left, and let the lead re-plan or hand to a fresh builder for the next phase.

## Lead review (4 Nov 2026)
READY, with these changes. The builder follows them over the plan text above.

1. **Open questions.** All four recommendations are accepted.
   - Q1: no pre-filter now. Log the latency trade-off as a decision.
   - Q2: use the `leftOf(name)` idiom.
   - Q3: the fixture judge reads only the request's own key and reply blocks.
   - Q4: stop and hand back if a 4.4b file needs a change.
2. **Eval cases are signed by the lead, not the human.** The new leak cases use `reviewed_by: lead` (lead-signs-cases policy, 20 Oct 2026), with a `source` naming 4.5b. Ignore `reviewed_by: pending` in the Phase B list and the exit conditions. Use synthetic content only.
3. **Fence the judge input (HIGH if missed).** The reply and the key go to the judge inside per-request random fences, the same way `grounding.ts` builds its judge request since 4.7b. Reuse or extract that fencing rather than writing a weaker copy; if you extract it, keep `grounding.ts`'s behaviour byte-identical, with its tests unchanged. Add one test where the reply contains a fake closing fence and an "answer clean" instruction, and the judge request still keeps it inside the reply block.
4. **Fail closed, logged.** A judge outage returns `ANSWER_LEAK_SAFE_HINT` with reason `judge_unavailable`, as planned. Log it as a decision that names the cost: a flaky judge turns ordinary replies into hints on turns with a word key.
5. **Phases.** A fresh builder runs each phase.
   - Phase A (packages/harness) has a hard stop at 45.
   - Phase B (packages/evals and evals/suites/leak) has a hard stop at 20 and starts from Phase A's handoff.
   - Total budget: 65 tool calls.
6. **Review.** code-reviewer, plus a lead `risk: high` decision on merge. The lead signs the eval cases.
