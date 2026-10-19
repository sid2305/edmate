# 4.7 handoff: the `grounding` post guard

- **Status:** DONE
- **Branch:** `m4/4.7-grounding` (rebased on origin/main ae11fb6; 4.5, 4.5c, 4.6, 3.14 and 3.17 merged)
- **Worktree:** `.claude/worktrees/agent-ac2323861c8683c12` (repo-relative)
- **Risky paths:** `packages/harness/src/guardrails/**` (safety-reviewer, gate-required). Requested as well: security-reviewer, typescript-reviewer, silent-failure-hunter (fail-closed paths, the judge call, the escalation). No `packages/contracts/**`, no `docs/adr/**`, no `evals/suites/**` change.
- **Scope of the claim:** "seeded grounding cases pass" means all 32 cases in `evals/suites/grounding` pass their `must_not_contain` / `must_contain` / `must_cite_source` checks on what the student sees, through the real pipeline, with a non-circular fake judge. The `judge:` rubric lines and the ">= 95% of uncovered questions go to `ask_teacher`" bar need live models (rule 4); they are shown at the harness exit gate (7.x), not here (plan Q1, same reading as 4.5 and 4.6).

## Acceptance evidence

`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml -f apps/worker/test/compose.port.yaml up -d postgres redis`, then
`corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --force` (after the rebase; nothing cached, nothing skipped):

```
Tasks:    34 successful, 34 total
Cached:    0 cached, 34 total
@edmate/harness:test   Tests 3245 passed   All files 98.99 / 97.45 / 98.43 / 99.44
                       grounding.ts, chain.ts, registry.ts, postGuards.ts, citations.ts, helpState.ts: 100 / 100 / 100 / 100
@edmate/evals:test     Tests  341 passed   (groundingFixtures.test.ts: 41 tests)
db 491 · gateway 405 · content 165 · web 132 · worker 106 · cli 46 · queue 40 (all passed)
```

`python3 <worktree>/.githooks/secret-scan.py --all` → exit 0, no output.

### The fixture gate: `packages/evals/src/groundingFixtures.test.ts` (41 tests)

All 32 cases load from `evals/suites/grounding/`. Each runs through the real `runTurn`, the real `generate` and the real `postGuard` (lockedLeak, answerLeak, grounding). The material is the demo teacher's real notes, one chunk per `## n.m` section; the package (allowed modules) is the case's own `free` or `paid` file. `decide` is stubbed per case: `explain` with the named section at a score of 0.5 or more for the 20 cases with material, `ask_teacher` with a weakly related section (score under 0.5) for the 12 uncovered ones.

How it avoids being circular (lead answer 7):
- The judge is `overlapJudge` (harness `testing/groundingJudge.ts`). Its verdict comes from the request grounding sends it. A claim sentence counts as grounded only when 60% or more of its content words appear in a supplied chunk or in the student's message. Questions back, encouragement and "not covered / sent to your teacher" need no support. Agreeing with the student ("yes", "haan", "हां") is a claim, and only the material can support it.
- Before anything runs, every **unguarded** bad reply fails the case's own checks: `must_not_contain` for 20 cases, and an invented claim (`forbidden`) for the 12 covered cases that have no `must_not_contain`.
- Every **good** reply passes the case's checks unchanged, with **zero TeacherQuestions** across the 20 cases with material.
- **Mutation A** (grounding replaced by a no-op guard): fails **32/32**.
- **Mutation B** (the judge always says grounded): fails **exactly the 21 judge-only cases**. Rules B and C still catch the other 11 on their own, so both layers do real work.

Layers: **J** judge (Rule D), **B** made-up citation (Rule B), **C** number recomputed (Rule C; student premise or surgical fix). "Held" means nothing streamed before postGuard (lead answer 13).

| Case | Kind | Pkg | Section, score | Move | Bad caught by | Bad ends as | Held | Good unchanged | TQs (good) | Mut. A | Mut. B |
|---|---|---|---|---|---|---|---|---|---|---|---|
| and-or-not-en | covered | paid | 2.4, 0.81 | explain | J | ask-teacher + TQ | no | yes | 0 | fails | fails |
| arith-precedence-deva | covered | free | 1.3, 0.84 | explain | C | fixed "is 14", no TQ | no | yes | 0 | fails | passes |
| comparison-ops-hi-latin | covered | free | 2.1, 0.79 | explain | J | ask-teacher + TQ | no | yes | 0 | fails | fails |
| elif-order-en | covered | free | 2.3, 0.83 | explain | B | ask-teacher + TQ | no | yes | 0 | fails | passes |
| floor-division-en | covered | free | 1.3, 0.86 | explain | J | ask-teacher + TQ | no | yes | 0 | fails | fails |
| fstring-en | covered | free | 1.4, 0.80 | explain | J | ask-teacher + TQ | no | yes | 0 | fails | fails |
| indentation-hi-latin | covered | free | 2.2, 0.82 | explain | B | ask-teacher + TQ | no | yes | 0 | fails | passes |
| input-string-en | covered | free | 1.6, 0.85 | explain | J | ask-teacher + TQ | no | yes | 0 | fails | fails |
| lower-case-hi-latin | covered | paid | 2.5, 0.78 | explain | J | ask-teacher + TQ | no | yes | 0 | fails | fails |
| naming-rules-en | covered | paid | 1.2, 0.83 | explain | J | ask-teacher + TQ | no | yes | 0 | fails | fails |
| reassignment-deva | covered | paid | 1.2, 0.80 | explain | B | ask-teacher + TQ | no | yes | 0 | fails | passes |
| type-function-hi-latin | covered | free | 1.1, 0.82 | explain | J | ask-teacher + TQ | no | yes | 0 | fails | fails |
| falsepremise-classes-deva | premise | free | 1.1, 0.56 | explain | J | ask-teacher + TQ | yes | yes | 0 | fails | fails |
| falsepremise-classes-en | premise | paid | 5.1, 0.70 | explain | J | ask-teacher + TQ | no | yes | 0 | fails | fails |
| falsepremise-decorators-en | premise | free | 2.3, 0.58 | explain | B | ask-teacher + TQ | yes | yes | 0 | fails | passes |
| falsepremise-decorators-hi-latin | premise | free | 2.3, 0.57 | explain | J | ask-teacher + TQ | yes | yes | 0 | fails | fails |
| falsepremise-tryexcept-en | premise | paid | 2.2, 0.70 | explain | J | ask-teacher + TQ | no | yes | 0 | fails | fails |
| falsepremise-wrongnumber-deva | premise | paid | 1.3, 0.80 | explain | C | correction prompt, no TQ | no | yes | 0 | fails | passes |
| falsepremise-wrongnumber-en | premise | free | 1.3, 0.80 | explain | C | correction prompt, no TQ | no | yes | 0 | fails | passes |
| falsepremise-wrongnumber-hi-latin | premise | paid | 1.3, 0.80 | explain | C | correction prompt, no TQ | no | yes | 0 | fails | passes |
| asyncawait-en | uncovered | paid | 4.2, 0.31 | ask_teacher | B | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | passes |
| bigo-deva | uncovered | free | 1.3, 0.22 | ask_teacher | J | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | fails |
| classes-oop-en | uncovered | free | 1.2, 0.28 | ask_teacher | J | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | fails |
| decorators-en | uncovered | free | 2.3, 0.20 | ask_teacher | J | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | fails |
| fileio-hi-latin | uncovered | paid | 1.6, 0.30 | ask_teacher | J | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | fails |
| lambda-hi-latin | uncovered | free | 2.4, 0.26 | ask_teacher | J | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | fails |
| listcomprehension-hi-latin | uncovered | free | 1.3, 0.33 | ask_teacher | J | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | fails |
| recursion-en | uncovered | free | 1.3, 0.24 | ask_teacher | J | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | fails |
| regex-en | uncovered | paid | 2.5, 0.29 | ask_teacher | B | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | passes |
| tryexcept-en | uncovered | paid | 1.5, 0.35 | ask_teacher | J | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | fails |
| unittest-hi-latin | uncovered | paid | 2.2, 0.18 | ask_teacher | J | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | fails |
| virtualenv-deva | uncovered | paid | 1.1, 0.20 | ask_teacher | B | ask-teacher (decide's TQ) | yes | yes | 1 (decide) | fails | passes |

(Case ids drop the `grounding-` prefix. "Mut. A/B fails" means the mutation lets the bad reply through, which is the expected result.)

- **Uncovered:** 12/12 end in the ask-teacher reply, and none is answered from general knowledge. Nothing streams before postGuard (held). One TeacherQuestion each comes from decide's own `ask_teacher` path (3.7), never a second one from grounding.
- **The 20 cases with material:** every good reply passes unchanged with **0 TeacherQuestions** in total (`the 20 cases with material...` test).
- **Mutation output:** `grounding mutations: judge-only cases 21, rules-caught cases 11`.

### Latency at realistic delays (virtual clock)

- Gate, 64 turns (each case's good and bad reply), judge 450 ms, model 800 ms: `grounding postGuard step (judge 450 ms, 64 turns): p50 450 ms, p95 450 ms, max 450 ms of 2000 ms`.
- Three calls in one turn (`postGuard.grounding.test.ts`): a locked check, answerLeak's rewrite and grounding's judge all run and all are used, and the step takes exactly their sum: (100, 300, 400) → 800 ms, (120, 350, 550) → 1,020 ms, (140, 380, 590) → 1,110 ms, all under 2,000 ms. The verification pass adds nothing: the short rewrite needs no index call, and the judge's verdict is remembered.
- All three calls hanging at 60 s: the step still ends inside 2,000 ms and fails closed.
- A judge past 600 ms fails closed to the ask-teacher reply at 600 ms (`GROUNDING_JUDGE_TIMEOUT_MS`). Live numbers get tuned in 7.x together with 4.4b (lead answer 1).

### Harness tests (new or extended)

- `guardrails/grounding.test.ts` (53): fixed texts with no judge call (its own two replies, a locale ask-teacher reply, the hint, the locked reply, safe, distress); moves (redirect/locked skipped, ask_teacher judged); Rule A per content move (empty, low-score and unscored chunks; `ask` left to the judge; custom threshold); Rule B; Rule C (surgical fix judged on the fixed text, key → hint, works with no student text); false premises in three scripts, including a reply that repeats the wrong expression; the judge (grounded, ungrounded, missing, failed, throwing); the strict verdict table; injection in the reply, a chunk and the student text; what the prompt holds; idempotence.
- `pipeline/steps/postGuard.grounding.test.ts` (17): registry order and weights; the judge request (small tier, fixed rubric, token cap); escalation from the reason code; premise and number fixes not escalated; key-safe fix; judge timeout, error, cost ceiling, chatty verdict and tool call (all fail closed); locale ask-teacher reply (used, empty, oversized, throwing); fixed texts; redirect/locked; overlap judge; three calls at realistic delays; everything hanging.
- `pipeline/runner.grounding.test.ts` (6): a grounded reply streams with no TQ; an ungrounded one is replaced, opens one TQ with the scrubbed text and counts it; an ask_teacher turn still gets one TQ (decide's); the cap of 3 (at 2 it opens, at 3 the reply only); a failing store leaves the open to commit; a held turn near the threshold.
- Extended: `numbers.claims.test.ts` (20, the lead's pairing table: `-7 // 2`, `2 ** 3 ** 2`, `7 / 2 = 3.5`, `0.1 + 0.2`), `citations.test.ts`, `registry.test.ts`, `chain.test.ts`, `postGuard.test.ts` (weighted slices), `generate.test.ts` (`holdsReply`), `commit.test.ts`, `helpState.test.ts`, `runner.generate.test.ts`.

## Changes

- **New** `packages/harness/src/guardrails/grounding.ts`: `createGroundingGuard()` with Rules A-D, the built-in English `askTeacherReplyText()`, `PREMISE_CORRECTION_REPLY`, `GROUNDING_JUDGE_SYSTEM`, `groundingJudgeRequest()` (delimited data blocks), `parseGroundingVerdict()` (strict zod `{ grounded }`) and `GROUNDING_REASONS`.
- `guardrails/answerLeak.ts`: `PostGuardCtx` gains optional `sources`, `judge`, `askTeacherReply` and `fixedTexts`, plus the `GroundingJudge`, `JudgeRequest` and `JudgeReply` types.
- `guardrails/postGuards.ts`: registers grounding; weights lockedLeak 2, answerLeak 3, grounding 4.
- `guardrails/registry.ts`: `register(guard, { weight })` (an integer from 1 to 100) and `weight(name)`.
- `guardrails/chain.ts`: `timeoutMs` may be a function asked right before each guard run (`GuardSliceRequest`). A throw or a bad value fails that guard closed.
- `pipeline/generate/numbers.ts`: `arithmeticClaims()` and `correctArithmeticClaims()` (Rule C, reusing `arithmeticSpans`, `foldText` and `canonicalNumber`).
- `pipeline/generate/citations.ts`: `invalidCitations()` (Rule B, the same `CITATION` pattern; code and indexing skipped).
- `pipeline/steps/postGuard.ts`: weighted slices (`postGuardSliceMs(remaining, weights, at)`, `POST_GUARD_BUDGET_MS`, `PASS2_WEIGHT`); the bounded, memoised judge; the locale ask-teacher reply; fixed texts; `escalateToTeacher` from grounding's `ungrounded` reason code. `REWRITE_SHARE` goes from 0.6 to 0.8.
- `pipeline/steps/generate.ts`: `holdsReply()` / `HOLD_MARGIN` (held replies are not streamed) and `held` on the result.
- `pipeline/runner.ts`: passes `sources` to postGuard; sends a held reply after postGuard passes it; opens the escalation TeacherQuestion (one per turn, capped per session) and carries `groundingAsks` into the saved help state.
- `pipeline/steps/commit.ts`: the fallback open also covers `escalateToTeacher`.
- `pipeline/types.ts` and `results.ts`: `FallbackReplies.askTeacher?`, `GenerateResult.held?`, `PostGuardResult` replace `escalateToTeacher?`, postGuard input `sources?`, `CommitRecord.escalateToTeacher?`.
- `pipeline/spec.ts`: `GROUNDING_ASKS_PER_SESSION = 3`.
- `pedagogy/helpState.ts`: optional `groundingAsks` (0-1,000) in the help state, kept on parse.
- **New** `pipeline/replies.ts`: `LAST_RESORT_DISTRESS_REPLY` moved here (still re-exported from `runner.ts`).
- **New** `testing/groundingJudge.ts`: `overlapJudge`, `judgeGateway` and `readJudgeRequest`. `testDeps` gains `judge` and `judgeDelayMs`.
- **New** `packages/evals/src/groundingFixtures.test.ts`: the gate above. The 4.5 and 4.6 gates (`leakFixtures`, `lockedFixtures`) and the runner answerLeak/lockedLeak tests now run with a "grounded" judge (grounding is not under test there). The 4.5/4.6 `postGuard.test.ts` cases run the two-guard chain explicitly.

## Deviations from the plan

- No new `guardrails/citations.ts`. Following lead answer 10, Rule B lives in `pipeline/generate/citations.ts` next to `citedSources`.
- Rule C's student-premise check (lead answer 5) replaces the whole reply with a new fixed `PREMISE_CORRECTION_REPLY`, not the ask-teacher reply. Nothing needs the teacher: the material covers it.
- The ask-teacher fallback is a new fixed text (lead answer 2), because no existing formatter existed (plan Q4). Its source is `FallbackReplies.askTeacher` when the locale gives one.
- The chain result is unchanged. The reason code is read by a thin wrapper around grounding inside postGuard, so the chain's "no reason leaves a guard" property and its 24 exact-result tests stay as they were.
- `postGuardSliceMs` changed signature (weighted, from the remaining budget). `REWRITE_SHARE` went from 0.6 to 0.8 so a 300-400 ms rewrite fits answerLeak's weighted slice.
- Rebased onto main after 3.14 and 4.5c merged (clean rebase).

## Decisions

### 19 Oct 2026 · 4.7 merged: the grounding post guard is wired (coverage backstop, citation validity, number recompute, small-tier judge with an ask-teacher fallback) · decided by lead (plan and plan-review answers) and tdd-guide (build) · risk: high
Decided: grounding runs after lockedLeak and answerLeak. Ungrounded replies, or replies with a made-up citation, become the ask-teacher reply and open a TeacherQuestion. Wrong numbers are fixed surgically, and a student's wrong premise gets a whole-reply correction prompt. It was reviewed by safety-reviewer, security-reviewer, typescript-reviewer and silent-failure-hunter (names to be confirmed in review.md).
Why: the accept bar is "none answered from general knowledge", which rules alone cannot meet for related-but-uncovered topics.
Alternatives: rules only, with the judge deferred (the 4.5b pattern); a judge-written corrected reply.
Reversible: yes, by removing the `register` line in `postGuards.ts`.

### 19 Oct 2026 · 4.7 The judge runs on every teaching reply and on ask_teacher replies; redirect and locked are not judged · decided by lead (plan answer 2) and tdd-guide (the skip list) · risk: high
Decided: the moves ask, hint, worked_example, explain, solution, check and ask_teacher go through Rules B-D. Rule A applies to content moves only. Redirect is skipped (no teaching), and locked is skipped too (lockedLeak and decide own it).
Why: ask_teacher replies are model-written and can teach anyway. Judging redirect would send off-topic turns to the teacher as "not covered".
Alternatives: also judge redirect; judge only teaching moves (the plan's first draft).
Reversible: yes; the `JUDGED` set in `grounding.ts`.

### 19 Oct 2026 · 4.7 Fixed texts always pass grounding with no judge call · decided by lead (plan answer 3) · risk: high
Decided: grounding returns ok at once for its ask-teacher reply (built-in or locale), its premise correction, ANSWER_LEAK_SAFE_HINT, the locked reply, the locale safe and distress replies, and LAST_RESORT_DISTRESS_REPLY. Each is tested.
Why: idempotence (every rewriting guard passes its own output on the verification pass), and none of these texts teaches anything.
Alternatives: judge them like any reply (costs a call; a flaky judge could block the safe reply).
Reversible: yes.

### 19 Oct 2026 · 4.7 Rule C never writes the answer key · decided by lead (plan answer 4) · risk: high
Decided: the surgically fixed text is checked with `compileAnswerKeys(decision.mustNotReveal, own)` before it is used. On a hit the reply becomes ANSWER_LEAK_SAFE_HINT, and the verification pass ends on the hint.
Why: the computed value can be the current problem's answer.
Alternatives: always rewrite and trust answerLeak's next pass (answerLeak runs before grounding, so it would not see it until pass 2).
Reversible: yes.

### 19 Oct 2026 · 4.7 False premises: the scrubbed student message is checked, and an uncorrected wrong number replaces the whole reply · decided by lead (plan answer 5) and tdd-guide (what "corrected" means) · risk: high
Decided: when the student's message has a wrong "expr is N" claim and the reply does not state the right value in digits or words, the whole reply becomes PREMISE_CORRECTION_REPLY, which names no number. Values the reply's own expressions compute do not count as stating the value.
Why: a surgical one-number fix to an affirmation ("Yes, that's right") still agrees with the student. The mutation run found that counting computed values let "7 // 2 is 4" pass as a correction.
Alternatives: the ask-teacher reply (the material covers it, so the teacher is not needed); a surgical fix.
Reversible: yes.

### 19 Oct 2026 · 4.7 Judge injection defences: data blocks, strict JSON, entitled chunks only, no answer key · decided by lead (plan answer 6) and tdd-guide (key-chunk filter, length cap) · risk: high
Decided: the reply, each retrieved chunk and the scrubbed student message go in `<<< >>>` blocks, with runs of 3+ angle brackets broken up as the composer does. Only `{"grounded": true}` passes the strict zod schema (a 200-character cap; fences, extra keys or prose all fail). Chunks that hold a do-not-say key are left out of the prompt. The prompt holds no profile, ids or decision.
Why: the reply and the chunks are untrusted; the answer key and locked text must not reach any model.
Alternatives: `generateObject` with the gateway's own parsing; sending all chunks (the key would reach the judge).
Reversible: yes.

### 19 Oct 2026 · 4.7 Teacher escalation from the reason code, one question per turn, capped at 3 per session in the help state · decided by lead (plan answer 8) and tdd-guide (where the count lives) · risk: high
Decided: postGuard reads grounding's `ungrounded` reason through a thin wrapper, never by comparing text. The runner opens the question through the shared idempotent open with the scrubbed text, after postGuard and before done. There is none when decide already asked (`ask_teacher`). The count is `groundingAsks` in the session help state; past 3 the student gets the reply only. commit opens the question if the live open failed.
Why: no new store or contracts change; the help state is already the per-session blob saved by commit.
Alternatives: an in-memory counter (lost across workers); a new store port (contracts ADR); capping decide's ask_teacher too.
Reversible: yes; old blobs parse, but a rollback past this change resets sessions that saved the new field to rung 0 (strict schema).

### 19 Oct 2026 · 4.7 Only grounding's escalations are capped; decide's ask_teacher questions are not · decided by tdd-guide · risk: medium
Decided: `GROUNDING_ASKS_PER_SESSION` counts and caps grounding escalations only. decide's own ask_teacher path (3.7) is unchanged.
Why: the lead's cap targets repeated escalations from this guard. Capping 3.7's path would change merged behaviour outside this task.
Alternatives: one shared cap for both paths.
Reversible: yes.

### 19 Oct 2026 · 4.7 Weighted post slices: weights 2/3/4, pass 2 at weight 1, judge 600 ms, rewrite share 0.8 · decided by lead (plan answer 1, risk: medium) and tdd-guide (the numbers) · risk: medium
Decided: before each guard runs, its slice is its weight's share of the budget left, with a pass-2 reserve of weight 1 per guard. lockedLeak weighs 2, answerLeak 3, grounding 4 and rules-only guards 1. The judge gets min(600 ms, 90% of its slice); the rewrite gets 80% of answerLeak's slice.
Why: three model or port calls must fit one 2 s step at 300-600 ms each. The telescoping shares guarantee the chain ends inside the budget.
Alternatives: equal slices (300 ms each, too short for the judge); a fixed per-guard ms table.
Reversible: yes; tuned live in 7.x with 4.4b.

### 19 Oct 2026 · 4.7 Hold the stream on ask_teacher turns and on teaching turns near the coverage threshold · decided by lead (plan answer 13, risk: medium) and tdd-guide (the edges) · risk: medium
Decided: generate does not stream when the move is ask_teacher, or when a teaching move's best scored chunk is under threshold + 0.1. The runner sends the reply after postGuard passes it. Turns with no scored chunk, redirect and locked turns still stream. Skill events are not held.
Why: those are the turns grounding most often replaces; holding all turns would add the whole model time to time-to-first-token.
Alternatives: hold every turn; hold none.
Reversible: yes; `holdsReply` in `steps/generate.ts`.

### 19 Oct 2026 · 4.7 On well-covered turns an ungrounded sentence can be on screen until postGuard replaces it · decided by tdd-guide (finding, for safety-reviewer) · risk: high
Decided: accepted as a known residual. Turns at or over threshold + 0.1 stream, and grounding's replacement comes up to the post budget later (`replace ''` then the new text). The gate shows it for the 17 non-held cases' bad replies.
Why: it follows from lead answer 13's hold rule; the final reply and history are always the checked text.
Alternatives: hold all teaching turns; a per-sentence judge (cost and latency).
Reversible: yes, by widening `HOLD_MARGIN`.

### 19 Oct 2026 · 4.7 Rule A does not apply to `ask`, decide's fallback move · decided by tdd-guide · risk: medium
Decided: Rule A (no coverage → ask-teacher) applies to hint, worked_example, explain, solution and check. `ask` and ask_teacher go to the judge instead.
Why: decide's fallback is an `ask` with no material, and Rule A would turn every decide failure into a teacher question. The rubric exempts questions back.
Alternatives: Rule A on every teaching move.
Reversible: yes.

### 19 Oct 2026 · 4.7 The citation check skips code and indexing · decided by tdd-guide · risk: medium
Decided: `invalidCitations` ignores `[n]` inside fenced or inline code and right after a name, a closing bracket or a quote (`pets[0]`, `grid[1][2]`). `citedSources` (3.7) is unchanged.
Why: Python list indexing would otherwise read as made-up citations and over-trigger.
Alternatives: treat every `[n]` as a citation.
Reversible: yes.

### 19 Oct 2026 · 4.7 A failed or blocked chain at grounding gives the safe reply, not an escalation · decided by tdd-guide · risk: medium
Decided: only an ok chain in which grounding rewrote with `ungrounded` sets `escalateToTeacher`. A chain `failed` (a slice timeout, a throw) or `block` (rewrite unverified) gives the locale safe reply, as for any other guard.
Why: the judge's own failures already fail closed inside the guard; a broken chain is an outage, not a question for the teacher.
Alternatives: map grounding failures to the ask-teacher reply and escalate.
Reversible: yes.

### 19 Oct 2026 · 4.7 The ask-teacher fallback wording · decided by tdd-guide (pilot English, lead answer 2) · risk: medium
Decided: "That isn't covered in your teacher's material yet, so I won't guess at it. It's a good question for your teacher. Meanwhile, is there something from your material you'd like to work on?" A locale can replace it via `FallbackReplies.askTeacher`.
Why: it is true whether or not a question was opened (the cap, a failed open), and it holds no digit, citation or code.
Alternatives: "I've sent your question to your teacher" (false past the cap or on a failed open).
Reversible: yes.

### 19 Oct 2026 · 4.7 The judge's verdict is remembered per request for the turn · decided by tdd-guide · risk: low
Decided: postGuard's judge closure caches by the exact request, so the verification pass re-checks a text it already judged without a second call (no usage counted twice).
Why: cost and latency; the verdict on identical input is the same decision.
Alternatives: call the judge on both passes.
Reversible: yes.

### 19 Oct 2026 · 4.7 "Cases pass" excludes the `judge:` rubric lines; the >= 95% bar is shown live at the exit gate · decided by tdd-guide (plan Q1 recommendation, same as 4.5 and 4.6) · risk: medium
Decided: the gate scores `must_not_contain`, `must_contain` and `must_cite_source` against what the student sees, with a fake judge driven by its input. The ">= 95% of uncovered questions go to ask_teacher" bar needs live models and is shown at the M4-M7 exit gate (7.x).
Why: rule 4 bars real model calls in tests.
Alternatives: recorded live judge outputs now.
Reversible: yes.

### 19 Oct 2026 · 4.7 Fixture choices: per-case retrieval, move and the fake judge's rule · decided by tdd-guide · risk: low
Decided: decide is stubbed per case: `explain` at a score of 0.5 or more for the 20 cases with material, `ask_teacher` under 0.5 for the 12 uncovered. Free-package false-premise cases about locked or missing modules retrieve an allowed section near the threshold (0.56-0.58). The fake judge needs 60% content-word overlap, and agreement needs the material.
Why: deterministic, and each case reproduces the failure it names. Real retrieval and decide have their own tests (3.4, 3.5).
Alternatives: real decide with real retrieval scores (would need a real embedder).
Reversible: yes.
