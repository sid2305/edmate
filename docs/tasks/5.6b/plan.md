# 5.6b plan: answer-context mode for the matcher (MCQ and code_output items served)

Status: READY. Each open question below has a recommended default, and none blocks Phase A.
Planner: 23 Oct 2026 (opus). Sources:
- `docs/tasks/5.6/plan.md` (the architect's Phase A MEDIUM);
- `docs/tasks/5.6/handoff.md` (Phase C, "Open question for the lead", answered (c));
- `docs/tasks/5.6/review.md` (the MEDIUM deferred to 5.6b);
- `docs/tasks/5.6/architect-adr-0010.md` (ADR-0010's Consequences: "until the matcher has an answer-context-only key mode");
- the merged code in `packages/harness/src/pipeline/generate/answerKey.ts`, `streamGate.ts`, `steps/generate.ts`, `steps/postGuard.ts`, `runner.ts`, `guardrails/answerLeak.ts`, `tools/practice*.ts` and `tools/demoPracticeBank.ts`.

Board: milestone M13, dep `5.6` (done), branch `m13/5.6b-answer-context-matcher`. **Risky:** it touches `packages/harness/src/guardrails/**` (see below). Scope is `packages/harness` only. Other builders are working in `apps/web/**` and `packages/db/**`, so this task stays out of both.

## Acceptance (verbatim, board)

Title: "Answer-context mode for the matcher (5.6 architect MEDIUM): MCQ bare-label keys and code_output keys that appear in their own prompt can be checked without tripping the leak gate, so the bank can serve those kinds; the matcher also ignores the active item's own prompt (a reply restating a generated sum item "What is 3 + 4?" currently counts as saying the answer, 5.6 Phase C)"

Accept: "an MCQ item and a code_output item are served, re-shown and answered without a false leak block, and a real leak of either key is still blocked"

### How it is shown (paste into handoff.md)

| Claim | Evidence |
|---|---|
| Both kinds are served | `demoPracticeBank.test.ts`: the demo MCQ and code_output records are served at their level (this replaces the "never serves" test). `practiceItems.test.ts`: `pickItem` serves a valid MCQ or code_output item and still refuses a malformed one (unlabelled options, a key that is not a label in range, an `opt-2`-style key). |
| Re-shown without a false block | New `pipeline/runner.practiceKinds.test.ts`, which uses a scripted gateway and its own fixtures. (1) On the issuing turn, the model restates the item's prompt and options word for word, and the reply reaches the student unchanged, not as `ANSWER_LEAK_SAFE_HINT`. (2) On the next turn the loaded state holds `practiceItemId`, the model re-shows the item, and the reply is delivered. Both kinds are covered, plus the generated sum "What is 3 + 4?". The existing test "a model that restates an arithmetic item is held too" flips to "is delivered". |
| Answered without a false block | Same file. A next turn where the student answers ("B" for the MCQ, the output for code_output) gets a confirming reply that does not restate the key, and it is delivered. A wrong answer whose reply re-shows the item is delivered too. |
| A real leak is still blocked | Same file. For each kind, on the issuing turn (the stream gate) and on the next turn (postGuard): "The answer is B.", "It's B.", "B is correct.", the correct option's text in an answer context ("The answer is 7."), "It prints 4." and the base64 of a leaking sentence all give the safe hint. So does a reply that restates the item and then adds the answer. |
| The matcher, unit level | New `pipeline/generate/answerKey.itemContext.test.ts`: the leak and not-a-leak tables below, the item mask, and a check that `reach` covers the item text. |
| Nothing else regresses | `turbo run typecheck lint test --filter=@edmate/harness...` passes, including every existing `answerKey*`, `streamGate*`, `answerLeak`, `toolLoop`, `skillEvent` and `runner.*` test, the evals leak and locked fixture tests, and the gate's linear-work (operation-count) test. `git diff origin/main -- packages/contracts apps packages/db` is empty. |

## Design (smallest change that meets the accept line)

There are three matcher additions, all in `answerKey.ts`, and no contracts change.

1. **Label keys are answer-context only.** A key that is a single letter, optionally in brackets (`B`, `b`, `(B)`, `B)`), is a *label key*. It counts only in an answer context. Today such a key matches every word "a" or "b" at a word boundary, so it is unusable whatever the kind. The rule depends only on the key's shape, so no flag goes through `mustNotReveal` or HelpState.
   - **Leak:** "The answer is B.", "Answer: B", "It's B.", "B is correct/right.", "The correct option is (B).", "Go with/pick/choose B.", "B" or "b." on its own, and any of these inside base64.
   - **Not a leak:**
     - a question sentence ("Which is correct: A, B or C?", "Is it A or B?");
     - a list of two or more labels ("A, B or C", "A/B/C");
     - an option listing ("A) 6  B) 7  C) 8");
     - restating an option ("Option B says 7.");
     - a lowercase bare letter followed by a word ("the answer is a fraction").
   - A lowercase letter counts only in label form (`(b)`, `b)`), or when sentence punctuation or the end of the text follows it.
2. **The active item's own text is masked.** `AnswerKeyOptions` gains `items?: readonly ItemText[]`, where `ItemText = { prompt: string; options?: readonly string[] }`. Before matching, each word-for-word restatement of an item's prompt is replaced by a sentence break, in the same `compact` folded form (case, spaces, commas and quote marks ignored), and the normal checks then run on the result. The same applies to an option, but only one with at least 12 folded units that does not fold to a key. Short options like "7" are never masked.
   - So "What is 3 + 4?" and a code_output prompt that holds its own output pass. "What is 3 + 4? It's 7." still leaks, and so does a partial quote of the code (the safe failure).
   - `reach` grows by the longest masked text, so a sentence judged straight after a restatement sees all of it.
3. **The correct MCQ option's text is guarded too, in answer context only.** When a label key is held and an `items` entry has labelled options, the text of the option under that label ("7" from "B) 7") is added as an answer-context-only key. A number counts only where `m.answerContext` holds, like today's weak mentions. Text counts only next to an answer marker, using the same marker test as 1.
   - "The answer is 7." leaks. The option listing does not.

**Item rules** (`practiceItems.ts`):
- `SERVABLE_KINDS` holds all four kinds.
- An MCQ is servable only when it has 2 to 6 options, each starting with its label in order ("A) ", "B) ", ...), and its `answerKey` is exactly one label in range. A label like that shows on the existing PracticeCard with no web change.
- The MCQ's key-in-prompt, key-in-options and key-in-id checks use the label matcher from 1, not `keyInPrompt`. Otherwise "a" in "Which is a prime?" or the id `…:3:a` would reject the item.
- The `code_output` rules stay as they are: exempt from key-in-prompt, still checked against the options and the id.
- `PracticeBank` gains `itemFor(itemId, scope): PracticeItem | undefined`, scoped exactly like `answerKeyFor`.
- A `generatedPrompt(g: GeneratedId)` helper rebuilds a generated item's prompt from its id. `generateArithmeticItem` uses it too, so there is one source.

**Where the item text comes from:**
- **Issuing turn:** `IssuedItem.shown` already holds `[prompt, ...options]`. generate hands the item to the gate with the key (`addKeys(keys, items?)`), and the runner passes every issued item's text to postGuard.
- **Later turns:** when the loaded HelpState `holdsPracticeKey`, the runner resolves `practiceItemId` through a new optional `RegisteredTool.activeItem?(itemId, ctx): ItemText | undefined` hook. The practice tool implements it: a bank item through `itemFor`, a generated item through `generatedPrompt`, both inside `ctx.entitlement` and returning `undefined` outside it. The runner passes the result to generate (gate input) and to postGuard.
- An unresolved item gets no mask. That is today's behaviour: false positives, never fewer checks.

**Not changed:** `pedagogy/**`, `routing/**`, the prompt packs, `compose.ts` and `packages/contracts`. `mustNotReveal`, `promptKeys` and HelpState are unchanged.

## Phase A: matcher and item model (pure; no pipeline wiring)

Tests first. Write the two tables as failing tests before the code.

1. `packages/harness/src/pipeline/generate/answerKey.ts` (modify):
   - label keys (design 1);
   - `ItemText` and `AnswerKeyOptions.items`, with the mask (design 2);
   - the derived option-text key (design 3);
   - `reach`;
   - an update to the file header comment.
   - `revealsAnswerKey` keeps its signature. Label keys reach it through `compileAnswerKeys`.
2. `packages/harness/src/pipeline/generate/answerKey.itemContext.test.ts` (new): the leak and not-a-leak tables (design 1 and 3), the mask cases (restated prompt passes; restatement plus answer leaks; partial quote leaks; a short option is never masked; masking also applies inside decoded base64), and `reach` covering the item text.
3. `packages/harness/src/pipeline/tools.ts` (modify): the optional `RegisteredTool.activeItem` hook type, and `ItemText` re-exported from `answerKey.ts`.
4. `packages/harness/src/tools/practiceItems.ts` (modify): `SERVABLE_KINDS`, the MCQ label rules in `validateItem`, `PracticeBank.itemFor`, `generatedPrompt`.
5. `packages/harness/src/tools/demoPracticeBank.ts` (modify):
   - The MCQ record gets options "A) 6", "B) 7", "C) 8" and key `['B']`.
   - The code_output record loses its "(it prints 4)" giveaway. It becomes a real "what does this print" item whose output appears in, or is computed from, its own code.
   - Add `itemFor`.
6. `packages/harness/src/tools/practice.ts` (modify): the `activeItem` hook (scoped; bank, then generated; `undefined` outside scope).
7. Tests (modify):
   - `practiceItems.test.ts`: the "never serves an mcq (or code_output)" test becomes "serves a valid one, refuses a malformed one"; the opaque `opt-1`/`opt-2` key cases become refusals; add the label-in-prompt case "Which is a prime?".
   - `demoPracticeBank.test.ts`: kinds served; `itemFor` scope.
   - `practice.test.ts`: `activeItem` in scope, wrong teacher or module, unknown id, generated id round-trip.

Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1` (this includes evals' leak and locked fixture tests), then `python3 .githooks/secret-scan.py --all`. Commit green.

**State after Phase A:** the matcher has label keys and item masking, and the bank serves MCQ and code_output items. But nothing in the pipeline passes `items` yet, so a restated item still trips the gate and postGuard (the safe failure, today's behaviour). Label keys are already safe everywhere, because the rule depends only on the key's shape. Phase B's builder reads this plan and the Phase A handoff.

## Phase B: pipeline wiring and the full-turn proof (risky: guardrails)

Tests first. Write `runner.practiceKinds.test.ts` failing, then wire.

1. `packages/harness/src/pipeline/generate/streamGate.ts` (modify):
   - `StreamGateInput.items?`;
   - `addKeys(keys, items?)`, where `grow` rebuilds the matcher with every item seen so far;
   - `answerLeakStreamGate` passes `items` with `studentText`.
2. `packages/harness/src/pipeline/steps/generate.ts` (modify):
   - build the gate with the loaded active item;
   - on an issued item, call `addKeys(fresh, [itemTextOf(item.shown)])`;
   - the no-`addKeys` hold-the-rest path is unchanged.
3. `packages/harness/src/pipeline/types.ts` (modify): the generate input's `practice` gains `activeItem?: ItemText`, and the postGuard input gains `items?: readonly ItemText[]`.
4. `packages/harness/src/pipeline/runner.ts` (modify):
   - resolve the loaded item once (`holdsPracticeKey(built.helpState)`, then the first offered tool with `activeItem`);
   - pass it to generate;
   - pass the loaded item plus every issued item's text to postGuard.
5. `packages/harness/src/pipeline/steps/postGuard.ts` (modify): the `raw` re-check (line ~410) compiles with `{ studentText, items }`, and `PostGuardCtx.items` is set.
6. `packages/harness/src/guardrails/answerLeak.ts` (modify, **risky**):
   - `PostGuardCtx.items?` (the interface lives in this file);
   - `compileAnswerKeys` gets `items`;
   - the rewrite is re-checked with the same matcher.
7. `packages/harness/src/guardrails/grounding.ts` (modify, **risky**): its two `compileAnswerKeys` calls (lines ~226 and ~233) pass `items` too, so a grounding fix is judged the same way.
8. Tests:
   - new `pipeline/runner.practiceKinds.test.ts` (the acceptance table; its own scripted fixtures; no edit to `testing/gatewayFixtures.ts`);
   - modify `runner.practiceAnswerKey.test.ts` (flip the line-310 test);
   - modify `streamGate.test.ts` (`addKeys` with items; a restatement split across pushes);
   - modify `guardrails/answerLeak.test.ts` (**risky**: items mask the prompt; a leak beside it still rewrites).

Same gate and secret scan as Phase A. The handoff logs the `risk: high` decision below.

**State after Phase B:** the task is done. MCQ and code_output items are served. A restatement of the active item passes on the issuing turn and on later turns, and every real leak form in the table is held.

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**`: no contract change, and no ADR (Q7).
- `apps/web/**`, `packages/db/**`: other builders. The PracticeCard already renders `options` as given.
- `packages/harness/src/pedagogy/**` (policy, ladder, skills, helpState, compose): no change. The HelpState fields already exist.
- `packages/harness/src/routing/**`, `pipeline/steps/route.ts`, `testing/gatewayFixtures.ts`: grading is unchanged (Q4).
- `content/prompt-packs/**`: practice@1.1.0 is signed (B-26) and unchanged.
- `evals/suites/**`: no new cases (Q8).
- If a file outside the two phase lists needs a change, the builder stops at PARTIAL.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/guardrails/answerLeak.ts`, `packages/harness/src/guardrails/grounding.ts` and `packages/harness/src/guardrails/answerLeak.test.ts` (Phase B) match `packages/harness/src/guardrails/**`. **Reviewers: code-reviewer** (the MVP group; safety-reviewer returns at 13.3).
- No other planned path matches. `pipeline/**`, `tools/**` and the new test files are not in the file, and `pedagogy/**`, `contracts/**`, `docs/adr/**` and `.claude/**` are not touched.
- The lead's practice for tool and leak-gate PRs adds **security-reviewer** (both phases). **architect** is recommended for Phase A, since this closes the architect's own MEDIUM and ADR-0010's Consequences note.
- Handoff `## Decisions` entry, `risk: high`:

  > 5.6b The leak matcher gets an answer-context mode: single-letter (label) keys and the correct MCQ option's text count only in an answer context, a word-for-word restatement of the active practice item is masked before matching, and the bank serves mcq and code_output items.

  Also log, `risk: low`: a sentence judged with its window cutting through an earlier restatement may still trip (the safe failure).

## Budget

Budget: 130 tool calls (2 phases, 1 package: packages/harness)

Phase A is about 55 calls (6 source files plus tests; pure). Phase B is about 75 calls (7 source files, 2 guards, plus the full-turn test, which takes the longest). Each phase gets a fresh builder (tdd-guide). Phase B starts after Phase A's green commit.

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (only the `turbo run typecheck lint test` gate, `vitest run` on the named test files, `git` on the task branch, and `python3 .githooks/secret-scan.py --all`).

## Exit conditions

- **DONE (per phase):** every test named for the phase passes, the full harness gate (`--filter=@edmate/harness...`) and the secret scan are clean, and the handoff has the acceptance table filled for that phase. Phase B DONE also means `git diff origin/main -- packages/contracts apps packages/db` is empty and the `risk: high` decision is logged.
- **PARTIAL:** stop and hand off at `Status: PARTIAL` if:
  - the phase passes about 70 calls (A) or about 90 calls (B);
  - a file outside this plan's lists needs a change;
  - an existing leak, locked or safety test would have to be weakened to pass;
  - or the gate's linear-work test fails and can't be fixed inside `answerKey.ts` or `streamGate.ts`.

## Open questions (each with a recommended default; none blocks Phase A)

- **Q1. MCQ option format.** Recommended default: options carry their label in order ("A) 6"), and the key is exactly one label. The student then sees letters on the existing PracticeCard with no web change.
- **Q2. Is every single-letter key a label (answer-context only), whatever the kind?** Recommended default: yes. A bare letter as an ordinary key already matches every "a", and the rule depends only on the key's shape, so there is nothing to store.
- **Q3. Guard the correct option's text ("the answer is 7")?** Recommended default: yes, in answer context only (design 3). It is small, and without it an MCQ can be leaked by its text.
- **Q4. A student who types the option text ("7") instead of "B" is graded wrong.** Recommended default: accept this for MVP and leave `routing/**` untouched. Follow-up task: grade an MCQ by label or by the correct option's text.
- **Q5. On a correct-answer turn the key is still guarded, so "Yes, B is right!" gets the safe hint.** This is today's behaviour for every kind (`keysFor` reads the loaded help). Recommended default: no change in 5.6b, since it is a policy change in `pedagogy/**`. "Answered" is shown with a confirmation that doesn't restate the key. Follow-up task: release the key on a turn that route grades correct.
- **Q6. The item can't be resolved on a later turn** (bank item gone, out of scope). Recommended default: no mask and no derived option-text key. The label key stays guarded, so this means false positives only.
- **Q7. New ADR?** Recommended default: no. ADR-0010's Consequences already name this follow-up, and there is no contract, stack or pack change. The `risk: high` decision plus the architect's review of Phase A cover it.
- **Q8. Eval cases?** Recommended default: none in 5.6b. The lead signs eval cases, and 7.2 grows the leak suite. Two candidate cases are listed in the handoff for 7.2 (an MCQ label leak and a restated-item non-leak).
- **Out of scope:** hints that quote part of the sum ("try adding 3 and 4") still trip, which is the safe failure. A model paraphrasing the code_output answer needs a judge (4.5b).
