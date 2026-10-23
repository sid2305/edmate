# 5.6b plan: answer-context mode for the matcher (MCQ and code_output items served)

Status: READY. Revised 23 Oct 2026 after the architect's review (PLAN NEEDS CHANGES: 1 CRITICAL,
6 HIGH, 7 MEDIUM, 5 LOW; every one is folded in below) and the lead's decisions on Q1, Q4, Q5, Q7
and the phasing. Planner: opus. Sources:
- `docs/tasks/5.6/plan.md` (the architect's Phase A MEDIUM);
- `docs/tasks/5.6/handoff.md` (Phase C, "Open question for the lead", answered (c));
- `docs/tasks/5.6/review.md` (the MEDIUM deferred to 5.6b);
- `docs/tasks/5.6/architect-adr-0010.md` and `docs/adr/0010-*.md` (Consequences, line 43: "until the matcher has an answer-context-only key mode");
- the merged code in `packages/harness/src/pipeline/generate/answerKey.ts`, `streamGate.ts`, `toolLoop.ts`, `skillEvent.ts`, `steps/generate.ts`, `steps/postGuard.ts`, `runner.ts`, `guardrails/answerLeak.ts`, `guardrails/grounding.ts`, `routing/classify.ts`, `tools/practice*.ts` and `tools/demoPracticeBank.ts`.

Board: milestone M13, dep `5.6` (done), branch `m13/5.6b-answer-context-matcher`. **Risky:** it touches `packages/harness/src/guardrails/**` (Phase C). Scope is `packages/harness` only. Other builders are working in `apps/web/**` and `packages/db/**`, so this task stays out of both.

**One branch, one PR (lead decision).** Phases A, B and C each commit green on the same branch with a fresh builder. The PR is opened after Phase C and merged only then. MCQ and code_output items are enabled (`SERVABLE_KINDS`, demo records) only in Phase C, so no intermediate commit serves an item the pipeline can't yet guard.

## Acceptance (verbatim, board)

Title: "Answer-context mode for the matcher (5.6 architect MEDIUM): MCQ bare-label keys and code_output keys that appear in their own prompt can be checked without tripping the leak gate, so the bank can serve those kinds; the matcher also ignores the active item's own prompt (a reply restating a generated sum item "What is 3 + 4?" currently counts as saying the answer, 5.6 Phase C)"

Accept: "an MCQ item and a code_output item are served, re-shown and answered without a false leak block, and a real leak of either key is still blocked"

### How it is shown (paste into handoff.md)

| Claim | Evidence |
|---|---|
| Both kinds are served | `demoPracticeBank.test.ts`: the demo MCQ and code_output records are served at their level (this replaces the "never serves" test). `practiceItems.test.ts`: `pickItem` serves a valid MCQ or code_output item and refuses every malformed one in the item-rules list below. `toolLoop.test.ts`: an MCQ issued after an MCQ with the same key is served. |
| Re-shown without a false block | New `pipeline/runner.practiceKinds.test.ts` (scripted gateway, its own fixtures). (1) Issuing turn: the model restates the item's prompt and exact option listing, and the reply reaches the student unchanged, not as `ANSWER_LEAK_SAFE_HINT`. (2) Next turn: the loaded state holds `practiceItemId`, the practice tool is **not** offered that turn, the model re-shows the item, and the reply is delivered (the item is resolved through the entitled registry). Covered: the demo MCQ, an MCQ whose correct option is listed first (key A), a 3-line code_output prompt with its output on line 2, and the generated sum "What is 3 + 4?". Each stream-gate case is also pushed split across chunks. The existing test "a model that restates an arithmetic item is held too" flips to "is delivered". |
| Answered without a false block | Same file. The student answers ("B" for the MCQ, the output for code_output); a confirming reply that does not restate the key ("Nice work, that's right.") is delivered. A wrong answer whose reply re-shows the item is delivered. `classify.test.ts`: "B" grades correct; "a b c", "a or b", "is it a or b?" grade wrong. |
| A real leak is still blocked | Same file. For each kind, on the issuing turn (the stream gate) and on the next turn (postGuard): a sample of the leak table below (at least "The answer is B.", "Definitely B.", "✅ B) 7", "A, **B**, C", "The second option.", the correct option's text "7 works.", "It's not A or C.", "It prints 4.", a Cyrillic "В", the base64 of a leaking sentence, and a restated item followed by its answer) all give the safe hint. |
| Known limit documented | Same file: a correct answer "B" followed by the reply "Yes, B is right!" gets the safe hint (today's behaviour; Q5's pilot-blocking follow-up releases it). |
| The matcher, unit level | New `pipeline/generate/answerKey.labels.test.ts` and `answerKey.itemContext.test.ts`: every row of the leak and not-a-leak tables, the exempt-span edge cases, and `reach` covering the item text. |
| Nothing else regresses | `turbo run typecheck lint test --filter=@edmate/harness...` passes, including every existing `answerKey*`, `streamGate*`, `answerLeak`, `grounding`, `toolLoop`, `skillEvent`, `classify` and `runner.*` test, the evals leak and locked fixture tests, and the gate's linear-work (operation-count) test. `git diff origin/main -- packages/contracts apps packages/db` is empty. |

## Design

No contracts change and no HelpState change. Option text is never stored in `HelpState.answerKey` (`classifyAttempt` needs every key part, `classify.ts:249-251`, so a stored option text would grade "B" as partial); it is derived from the item each turn.

### 1. Label keys: a label leaks unless it sits in an exempt shape

A key that is one letter, optionally bracketed (`B`, `b`, `(B)`, `B)`), is a *label key*, whatever the item kind (Q2). The rule depends only on the key's shape, so nothing new goes through `mustNotReveal` or HelpState.

- **Default: a label mention leaks.** A mention is the letter as a whole word, in label form or bare, in either case, after look-alike folding (below).
- **Exempt shapes** (a mention inside one of these is not a leak):
  - (a) a list or question naming **two or more distinct labels of the item** (or, with no item context, two or more distinct letters A–F) with only separators between them (`,`, `/`, `or`, `and`, whitespace, a closing `?`), and nothing next to the key (no emphasis, mark or text);
  - (b) the item's exact option listing (design 2).
- **Overrides:**
  - An answer or confirm word in the same sentence overrides every exemption: answer, correct, right, wrong, it's, is it, go with, pick, choose, try, definitely, lean, hint, for sure, should be, must be. "B, right?" and "Is it B?" leak by default (one distinct label); "The answer is A or B" leaks by the override.
  - Repetition does not make a list: "B, B, B!" names one distinct label, so it leaks.
  - Emphasis (`**`, `__`) or a mark (✓ ✅ ✗ ❌ ← → "(correct)") on or next to any label of the sentence breaks exemption (a): "A ✗ B ✓ C ✗" and "A, **B**, C" leak.
- **The article rule** applies only to "a" and "i": a lowercase "a"/"i" followed by an ordinary word is not a mention ("the answer is a fraction"). After an answer word, "a because", "a since", "a so", "a as" and "a —" are mentions. Every other lowercase letter is a mention as a whole word ("the answer is b because…" leaks).
- **Look-alikes:** the label matcher folds with `guardrails/lockedMatch.foldConfusables` (one char for one char, so positions stay right) and also maps negative circled and squared letters (🅱 U+1F171, 🅑) and regional-indicator letters (🇧) to A–Z. This is an import of an existing helper, not a change to `guardrails/**`.
- **Base64:** inside decoded base64 a label counts only in an answer context or as a sentence on its own (LOW).

### 2. The active item's exempt spans

`AnswerKeyOptions` gains:
- `items?: readonly ItemContext[]`, where `ItemContext = { prompt: string; options?: readonly string[]; answerKey: readonly string[] }`;
- `practiceKeys?: readonly string[]`.

Exempt spans are computed on the original text (positions, not deletion). A key match is ignored only when it lies **fully inside** a span. Nothing is deleted and no sentence break is inserted, so an answer word outside a span still binds to a key outside it. Only two spans exist:
- **The prompt span:** a word-for-word restatement of an item's prompt, compared in the `compact` folded form (case, spaces, commas and quote marks ignored).
- **The listing span:** the item's exact, in-order, complete option listing. The prompt may come before it, and only whitespace and newlines separate the options. No answer or confirm word, emphasis (`**`, `__`) or mark (✓ ✅ ← "(correct)") may sit on or next to any option.

Rules for both spans:
- **Word boundaries.** A span must start and end at word boundaries in the original text, or it is not applied. So a prompt ending "x = 5" followed by "7" never swallows part of the key "57".
- **Options alone are never exempt.** A single option, a partial listing or a reordered listing gets no span. Neither does the correct option on its own, so "The answer is B) The loop runs forever.", "✅ B) 7" and "**B) 7**" leak.
- **Reach.** `reach` grows by the longest span (bounded by the item caps in the item rules), so a sentence judged straight after a restatement sees all of it.
- **Base64.** Spans apply inside decoded base64 too.

### 3. Keys derived from the item

These keys come from each item's **own** `answerKey`, never from a key carried over from another item.

- **Correct option text.** For an MCQ (`ItemContext.options` present, key one label in range), the text of the correct option ("7" from "B) 7") is a **full-strength key everywhere outside the item's spans**. It is matched exactly like an ordinary `mustNotReveal` entry, with today's number and text rules. So "The answer is 7.", "7 works.", "plug in 7" and "x = 7 makes both sides 11" leak. "Option B says 7." leaks too (the safe failure).
- **Position keys.** These are the correct option's 1-based position as a digit ("2"), an ordinal ("second", "2nd"), a number word ("two"), "option 2" and "number two". They count in an answer context, or as a sentence on their own, like a label. So "It's the second option.", "Go with option 2.", "The 2nd one." and "Number two!" leak.
- **Ruling options out (Q1).** A sentence outside the spans that names every wrong option of the item (by label or option text) and not the correct one is a leak. This holds in any context: negated ("It's not A or C.", "Not 6 or 8"), listed ("A and C are wrong.") or questioned. Without item context this check does not run (logged limit).

### 4. Practice keys never get the own-code exemption

`answerKey.ts:310-319` exempts a code-shaped key the student wrote as code unless a confirm word is near. Code_output keys ("Hello, World!", "[1, 2, 3]", "(1, 2)") are often code-shaped. So:
- Every key in `practiceKeys` or in any `items[].answerKey` is never added to `own`.
- `practiceKeys` holds the loaded HelpState's `answerKey` when `holdsPracticeKey`, plus `practiceCarriedKey` and every key issued this turn.

### 5. Grading: a label answer must name exactly one label (Q4, lead decision)

In `routing/classify.ts` `partMatched`, a label key (a single letter after `normaliseText`, optionally bracketed) matches only when the message names **exactly one distinct label** (A–F as whole words, after the article rule from design 1). It never matches the article "a" before a word.
- "B", "b", "(b)" and "I think it's b" grade correct.
- "a b c", "a or b" and "is it a or b?" (check_answer) grade wrong.
- Other keys are graded as before. A student who types the option text ("7") instead of "B" is still graded wrong (out of scope, below).

### Item rules (`practiceItems.ts` `validateItem`)

- **MCQ shape:** 3 to 6 options (Q1), each starting with its label in order ("A) ", "B) ", …). `answerKey` is exactly one bare capital letter in range. Anything else is refused: "(B)", "b", "opt-2", a label out of range, or two keys.
- **Caps (every kind):** prompt at most 600 characters, each option at most 160. These bound the stream gate's hold-back and `reach`.
- **MCQ key checks:** key-in-prompt, key-in-options and key-in-id use the label matcher from design 1, not `keyInPrompt`. So the "a" in "Which is a prime?" and the id `…:3:a` don't refuse the item.
- **Correct option in the prompt (MEDIUM):** the correct option's text, checked full-strength, and its position keys, checked with the design-3 rules, must not appear in the prompt.
- **code_output:** keeps its exemption from key-in-prompt and is still checked against the options and the id.
- **One joined listing (MEDIUM):** wherever a newly issued item's shown text is checked against earlier keys (`toolLoop.ts:259`, `skillEvent.ts:64`, `practice.ts:162`), it is checked as one joined text (`[prompt, ...options].join('\n')`) with the new item as `items` context. Then "B) 9" inside the new item's exact listing is exempt, and an MCQ after an MCQ with the same key is served.
- **New helpers:**
  - `PracticeBank.itemFor(itemId, scope): PracticeItem | undefined`, scoped exactly like `answerKeyFor`;
  - `generatedPrompt(g: GeneratedId)`, which rebuilds a generated item's prompt from its id. `generateArithmeticItem` uses it too, so there is one source.

### Where the item context comes from

- **Issuing turn:** the runner keeps an `ItemContext` for **every** item issued this turn, built from `IssuedItem.shown` and `IssuedItem.answerKey` by `itemContextOf`. generate passes each one to the gate with `addKeys(fresh, items)`. postGuard gets all of them.
  - `addKeys` takes the item even when `fresh` is empty, as with a second item that has the same key (LOW).
- **Every later turn:** when the loaded HelpState `holdsPracticeKey`, the runner resolves `practiceItemId` through a new optional `RegisteredTool.activeItem?(itemId, ctx): ItemContext | undefined` hook.
  - It searches the **entitled registry** (every registered tool whose skill is in `ctx.entitlement.skills`), not the tools offered to the model this turn.
  - The practice tool implements the hook: a bank item through `itemFor`, a generated item through `generatedPrompt` and `generatedAnswerKeyFor`. Both stay inside `ctx.entitlement`, and the hook returns `undefined` outside it.
- **Unresolved item or carried key (Q6, reworded):** the key gets no spans and no derived keys.
  - Its label is still guarded by the design-1 default, so a re-show is a false positive (the safe failure).
  - Its MCQ option text and position are **not** guarded. That is the turn after a bank item is withdrawn or falls out of scope, and the `practiceCarriedKey` turn.
  - Logged `risk: high` (below).

### The stream gate holds back a possible re-show (HIGH)

A newline ends a sentence, so today the gate would judge a re-shown item line by line before the whole item is visible. A listing whose first line is the correct option ("A) 7", key A) trips, and so does a code_output prompt holding its output on line 2.

- **Hold-back:** `streamGate.ts` holds back text that is a prefix of an active item's prompt span or listing span, compared in the same folded form, until the span is complete (then it's judged with the span exempt) or stops matching (then it's judged as normal).
- **Bounds:** the hold is bounded by the item caps. Matching stays linear: one cursor per active item per span, advanced per pushed character, never re-scanned.

### Not changed

`pedagogy/**`, the prompt packs, `compose.ts`, `packages/contracts`, `buildContext.ts`, `mustNotReveal`, `promptKeys` and the HelpState schema.

## Phase A: the matcher, grading and issue-time checks (pure; no pipeline wiring, no serving)

Expected about 90 calls; PARTIAL past about 110. Tests first: write the leak and not-a-leak tables and the `classify` cases as failing tests before the code.

1. `packages/harness/src/pipeline/generate/answerKey.ts` (modify):
   - label keys (design 1);
   - `ItemContext`, `AnswerKeyOptions.items` and `practiceKeys`;
   - exempt spans (design 2);
   - derived keys and the ruling-out check (design 3);
   - no own-code exemption for practice keys (design 4);
   - `reach`;
   - the header comment.
   - `revealsAnswerKey(value, mustNotReveal, opts?)` gains an optional third argument; existing callers are unchanged.
2. `packages/harness/src/pipeline/generate/labelKeys.ts` and `itemContext.ts` (new, optional): the builder may split the label matcher and the span and derived-key code out of `answerKey.ts` to keep files and functions small. `itemContextOf(issued: IssuedItem)` lives in `itemContext.ts`.
3. `packages/harness/src/routing/classify.ts` (modify): the design-5 label rule in `partMatched`.
4. `packages/harness/src/pipeline/generate/toolLoop.ts` (modify, line ~259) and `skillEvent.ts` (modify, line ~64): check the issued item's joined shown text with `{ items: [itemContextOf(issued)] }`. If `skillEvent` has no `IssuedItem` in reach, pass it from its caller in `toolLoop.ts`. If that needs a file outside this list, stop at PARTIAL.
5. Tests:
   - `answerKey.labels.test.ts` (new): design 1, design 4 (a code_output key "Hello, World!" with the item's code pasted in a fence by the student, then "It prints Hello, World!", leaks; the same key with no `practiceKeys` keeps today's own-code behaviour), and the look-alikes.
   - `answerKey.itemContext.test.ts` (new):
     - designs 2 and 3, every table row;
     - the span edges: a word-boundary miss, the prompt before the listing, a reordered listing, a partial listing, spans inside base64;
     - `reach` covering a capped item.
   - `routing/classify.test.ts` (modify): the design-5 cases, plus a regression check that numeric and text keys grade as before.
   - `toolLoop.test.ts` (modify): an MCQ issued after an MCQ with the same key B is served; one whose shown text says "The answer is B" is still refused.
   - `skillEvent.test.ts` (modify, if its check changes): the same pair.

### Leak table (key B; item "What is 3 + 4?" with options "A) 6", "B) 7", "C) 8" unless noted)

| Group | Strings (each gives a leak) |
|---|---|
| Answer forms | "The answer is B." · "Answer: B" · "It's B." · "B is correct." · "The correct option is (B)." · "Go with B." · "B" · "b." |
| Answer words, any position | "Definitely B." · "Try B." · "I'd lean towards B" · "Hint: B" · "B, for sure" · "Is it B?" · "B, right?" · "The answer is A or B" |
| Gamed lists | "B, B, B!" · "A ✗ B ✓ C ✗" · "A, **B**, C" · "B) 7 A) 6 C) 8" (reordered) · "A) 6 B) 7" (partial) |
| Correct option shown alone | "The answer is B) 7." · "✅ B) 7" · "**B) 7**" · "B) 7 (correct)" · "B) 7 ←" · "Option B says 7." |
| Lowercase after an answer word | "the answer is b because 7 is prime" · key A: "the answer is a because…", "it's a since…", "it's a — yes" |
| Look-alikes | "The answer is В." (Cyrillic) · "…Β." (Greek) · "…🅱." · "…🅑." · "…🇧." |
| Position | "It's the second option." · "Go with option 2." · "The 2nd one." · "Number two!" |
| Option text | "The answer is 7." · "7 works." · "Plug in 7." · key `x = 7`-style item: "x = 7 makes both sides 11" |
| Ruling out | "It's not A or C." · "A and C are wrong." · "Not 6 or 8." |
| Restated item plus answer | "What is 3 + 4? It's 7." · the exact listing followed by "B." · the listing with "← this one" after B) 7 |
| Boundaries | prompt ending "x = 5", reply "x = 57" with key "57" |
| code_output (key "4"; then key "Hello, World!") | "It prints 4." · the student pastes the item's code in a fence, reply "It prints Hello, World!" · "[1, 2, 3]"-style key in "The output is [1, 2, 3]" |
| Base64 | the base64 of "The answer is B." · the base64 of "B" alone |

### Not-a-leak table

| Group | Strings (each is delivered) |
|---|---|
| Listing | the exact listing on separate lines, with and without the prompt before it · key A listed first ("A) 7" first line) · the same listing split across pushes (gate test, Phase B) |
| Label questions and lists | "Which is correct: A, B or C?" · "Is it A, B or C?" · "A, B or C" · "A/B/C" |
| Article | "the answer is a fraction" (key A) · "I think so" (no "i" key involved) |
| Prompt restatement | "What is 3 + 4?" (generated sum, key "7") · a 3-line code_output prompt holding its output on line 2 · an MCQ after an MCQ with the same key |

Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1` (this includes the evals' leak and locked fixture tests), then `python3 .githooks/secret-scan.py --all`. Commit green and push the branch. Don't open the PR.

**State after Phase A:** the matcher has label keys (default leak), exempt spans, derived keys, and no own-code exemption for practice keys. Grading takes a label only when it's the sole label in the message. Issue-time checks use item context. Nothing in the pipeline passes `items` or `practiceKeys` to the gate or postGuard yet, and the bank still serves only `free_text` and `numeric`. A label key is already stricter everywhere (default leak), which is the safe direction. The handoff `## Decisions` carries the `risk: high` entry below. The next builder reads this plan and the Phase A handoff.

## Phase B: the item model and the stream gate (pure; no runner wiring, no serving)

Expected about 85 calls; PARTIAL past about 105. Tests first.

1. `packages/harness/src/tools/practiceItems.ts` (modify):
   - the `validateItem` item rules: MCQ shape, caps, the label-aware key checks, and the correct option kept out of the prompt;
   - `PracticeBank.itemFor`;
   - `generatedPrompt`.
   - `SERVABLE_KINDS` is **unchanged** here.
2. `packages/harness/src/tools/practice.ts` (modify):
   - the `activeItem` hook: scoped; tries the bank, then generated items; returns `undefined` outside scope;
   - `accept()` at line ~162 checks the joined shown text with the item's context.
3. `packages/harness/src/tools/demoPracticeBank.ts` (modify): `itemFor` only. The records change in Phase C.
4. `packages/harness/src/pipeline/tools.ts` (modify): the optional `RegisteredTool.activeItem` hook type, and `ItemContext` re-exported.
5. `packages/harness/src/pipeline/generate/streamGate.ts` (modify):
   - `StreamGateInput.items?` and `practiceKeys?`;
   - `addKeys(keys, items?)`, where `grow` rebuilds the matcher with every item seen so far and accepts an item when `keys` is empty;
   - the re-show hold-back (design: "The stream gate holds back a possible re-show");
   - `answerLeakStreamGate` passes `items` and `practiceKeys` along with `studentText`.
6. Tests:
   - `practiceItems.test.ts` (modify). `validateItem` refuses:
     - 2 options, and 7 options;
     - unlabelled or out-of-order options;
     - "(B)", "b", `opt-2`, an out-of-range label;
     - a prompt holding the correct option's text ("Which equals 7?");
     - a prompt over the cap, and an option over the cap.

     It accepts "Which is a prime?" with key A and an id ending `:a`.
   - `practice.test.ts` (modify): `activeItem` in scope; wrong teacher or module; unknown id; a generated-id round trip.
   - `demoPracticeBank.test.ts` (modify): `itemFor` scope.
   - `streamGate.test.ts` (modify):
     - `addKeys` with items, including empty `fresh`;
     - the hold-back cases, each pushed whole and split across pushes: key A listed first; the 3-line code prompt with its output on line 2; the listing followed by "B is right" (leaks); a prefix that stops matching (judged as normal);
     - the linear-work test still passes with an active item at the caps.

Same gate and secret scan as Phase A. Commit green and push.

**State after Phase B:** items can be validated, resolved per turn and held back in the stream. Nothing in the runner, postGuard or the guards passes item context yet, and the bank still serves no MCQ or code_output item. The handoff keeps the `risk: high` entry.

## Phase C: pipeline wiring, guards, enabling the kinds, the full-turn proof (risky: guardrails)

Expected about 100 calls; PARTIAL past about 120. Tests first: write `runner.practiceKinds.test.ts` failing, then wire.

1. `packages/harness/src/pipeline/types.ts` (modify): the generate input's `practice` gains `activeItem?: ItemContext` and `practiceKeys?`. The postGuard input gains `items?: readonly ItemContext[]` and `practiceKeys?`.
2. `packages/harness/src/pipeline/runner.ts` (modify):
   - **Every turn** with `holdsPracticeKey(built.helpState)`: resolve the loaded item through the entitled registry (the first tool whose skill is entitled and that has `activeItem`), not the offered tools.
   - Build `practiceKeys` (design 4).
   - Pass the loaded item to generate.
   - Pass the loaded item plus every item issued this turn (`itemContextOf`) to postGuard.
3. `packages/harness/src/pipeline/steps/generate.ts` (modify):
   - build the gate with the loaded active item and `practiceKeys`;
   - on each issued item, call `addKeys(fresh, [itemContextOf(issued)])`, even when `fresh` is empty;
   - the no-`addKeys` hold-the-rest path is unchanged.
4. `packages/harness/src/pipeline/steps/postGuard.ts` (modify): the `raw` re-check (line ~410) compiles with `{ studentText, items, practiceKeys }`, and `PostGuardCtx.items` and `practiceKeys` are set.
5. `packages/harness/src/guardrails/answerLeak.ts` (modify, **risky**):
   - `PostGuardCtx.items?` and `practiceKeys?` (the interface lives in this file);
   - `compileAnswerKeys` gets both;
   - the rewrite is re-checked with the same matcher.
6. `packages/harness/src/guardrails/grounding.ts` (modify, **risky**): its two `compileAnswerKeys` calls (lines ~226 and ~233) pass `items` and `practiceKeys` too, so a grounding fix is judged the same way.
7. Enabling the kinds (lead decision: the last phase):
   - `packages/harness/src/tools/practiceItems.ts` (modify): `SERVABLE_KINDS` holds all four kinds.
   - `packages/harness/src/tools/demoPracticeBank.ts` (modify): the MCQ record gets options "A) 6", "B) 7", "C) 8" and key `['B']`. The code_output record loses its "(it prints 4)" giveaway and becomes a real "what does this print" item whose output appears in, or is computed from, its own code (at least one variant puts the output on line 2 of a multi-line prompt).
8. Tests:
   - new `pipeline/runner.practiceKinds.test.ts`: the acceptance table, including the Q5 known-limit test, the "tool not offered this turn" case and the issuing-turn case with two items issued in one turn. It uses its own scripted fixtures, with no edit to `testing/gatewayFixtures.ts`.
   - modify `runner.practiceAnswerKey.test.ts` (flip the line-310 test).
   - modify `guardrails/answerLeak.test.ts` (**risky**): the prompt span is exempt; a leak beside it still rewrites; the rewrite is re-checked.
   - modify `guardrails/grounding.test.ts` (**risky**), only if a call-site test needs `items`.
   - modify `practiceItems.test.ts` and `demoPracticeBank.test.ts`: `pickItem` and the demo bank serve MCQ and code_output (the "never serves" test flips).

Same gate and secret scan. Then open the PR. The handoff logs the `risk: high` decision below and lists the Q8 candidate eval strings.

**State after Phase C:** the task is done. MCQ and code_output items are served. A re-show of the active item passes on the issuing turn and on later turns, and every leak-table form is held.

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**`: no contract change, and no ADR (Q7).
- `apps/web/**`, `packages/db/**`: other builders. The PracticeCard already renders `options` as given.
- `packages/harness/src/pedagogy/**` (policy, ladder, skills, helpState, compose): no change. The HelpState fields already exist.
- `packages/harness/src/routing/**` except `classify.ts` and `classify.test.ts`; `pipeline/steps/route.ts`; `pipeline/steps/buildContext.ts`; `testing/gatewayFixtures.ts`.
- `packages/harness/src/guardrails/**` except the Phase C files. `lockedMatch.ts` is imported, not edited.
- `content/prompt-packs/**`: practice@1.1.0 is signed (B-26) and unchanged.
- `evals/suites/**`: no new cases (Q8).
- If a file outside the phase lists needs a change, the builder stops at PARTIAL.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- Phase C: `packages/harness/src/guardrails/answerLeak.ts`, `guardrails/grounding.ts`, `guardrails/answerLeak.test.ts` and possibly `guardrails/grounding.test.ts` match `packages/harness/src/guardrails/**` (reviewers: code-reviewer).
- No other planned path matches. `pipeline/**`, `tools/**`, `routing/classify*.ts` and the new test files are not in the file. `pedagogy/**`, `contracts/**`, `docs/adr/**` and `.claude/**` are not touched.
- **Reviewers on the final PR (lead decision): code-reviewer, security-reviewer, architect (opus) and typescript-reviewer.** review.md's `Reviewers:` line names all four.
- Handoff `## Decisions` entry, `risk: high`, written in Phase A and kept through Phase C:

  > 5.6b The leak matcher gets an answer-context mode. A single-letter (label) key leaks unless it sits in an exempt shape (a separator-only list of two or more of the item's labels, or the item's exact option listing), and an answer word overrides every exemption. The active item's prompt and exact listing are exempt spans (matches fully inside are ignored, never deleted). The correct option's text is a full-strength key outside those spans, its position counts in an answer context, and naming every wrong option is a leak. Practice keys never get the own-code exemption. A label answer is graded only when it's the one label in the message. The bank serves mcq and code_output items. This closes ADR-0010's Consequences line 43 ("until the matcher has an answer-context-only key mode"); no new ADR (Q7).

  Also logged `risk: high`, as known limits:
  - an unresolved item and a `practiceCarriedKey` guard only their label: the option text, position and ruling-out checks don't run on that turn;
  - buildContext doesn't drop chunks holding the option text.

  Logged `risk: low`: a correct-answer confirmation that restates the key gets the safe hint (Q5; follow-up is pilot-blocking).

## Budget

Budget: 335 tool calls (3 phases, 1 package: packages/harness)

| Phase | Expected calls | PARTIAL past |
|---|---|---|
| A: matcher, grading, issue-time checks | about 90 (≈5 source files, 5 test files) | about 110 |
| B: item model, stream gate | about 85 (5 source files, 4 test files) | about 105 |
| C: wiring, guards, enabling, full-turn proof | about 100 (8 source files, 5–6 test files; the full-turn test takes the longest) | about 120 |

The budget line is the sum of the PARTIAL thresholds. Each phase gets a fresh builder (tdd-guide) that reads this plan and the previous handoff. The work doesn't fit two phases of about 100 calls each: the CRITICAL and HIGH findings roughly doubled the matcher work and added the gate hold-back, grading and issue-time changes. So it's split into three.

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (only the `turbo run typecheck lint test` gate, `vitest run` on the named test files, `git` on the task branch, and `python3 .githooks/secret-scan.py --all`).

## Exit conditions

- **DONE (per phase):** every test named for the phase passes, the full harness gate (`--filter=@edmate/harness...`) and the secret scan are clean, the commit is pushed, and the handoff has the phase's part of the acceptance table and the `risk: high` entry.
  - **Phase C DONE** also means: `git diff origin/main -- packages/contracts apps packages/db` is empty, the PR is open, and the handoff lists the Q5 follow-up and the Q8 candidate eval strings for the lead.
- **PARTIAL:** stop and hand off at `Status: PARTIAL` if:
  - the phase passes its threshold (A about 110, B about 105, C about 120 calls);
  - a file outside this plan's lists needs a change;
  - an existing leak, locked, safety or grading test would have to be weakened to pass;
  - or the gate's linear-work test fails and can't be fixed inside `answerKey.ts`, the new `labelKeys.ts`/`itemContext.ts` or `streamGate.ts`.

## Decided (lead, 23 Oct 2026)

- **Q1. MCQ format:** 3–6 options, labelled in order ("A) 6"); the key is one bare capital letter. A reply naming every wrong option and not the correct one is a leak.
- **Q2. Every single-letter key is a label key**, whatever the kind (design 1).
- **Q3. The correct option's text is guarded**, full-strength outside the item's spans (design 3; the architect's HIGH replaces "answer context only").
- **Q4. Grading:** the minimal `routing/classify.ts` change is in scope (design 5), and MCQ stays in this task. Out of scope: grading a typed option text ("7") as correct.
- **Q5. A correct-answer turn still guards the key** ("Yes, B is right!" gets the safe hint); no change in 5.6b. A runner test documents it. **The lead adds a follow-up board task, marked pilot-blocking:** release the practice key on a turn that route grades correct.
- **Q6. Unresolved item or carried key:** no spans and no derived keys; the label stays guarded. The lost option-text and position guard is logged `risk: high`.
- **Q7. No new ADR.** The `risk: high` entry names the ADR-0010 Consequences line (43) it closes.
- **Q8. No eval cases in 5.6b** (the lead signs eval cases). The handoff lists 7.2 candidates: emphasis ("A, **B**, C"), a mark ("✅ B) 7"), look-alikes (Cyrillic "В", "🅱"), ordinals ("the second option"), ruling out ("It's not A or C"), an own-code paste ("It prints Hello, World!"), a reordered listing, and a restated item that should pass.
- **Out of scope:** hints that quote part of the sum ("try adding 3 and 4") still trip, which is the safe failure. A model paraphrasing the code_output answer needs a judge (4.5b).

## Open questions

None.

## Lead answers (23 Oct 2026, after the architect re-verify)

The architect closed all earlier CRITICAL/HIGH findings and raised three new HIGHs and one narrowed MEDIUM. These rules override the sections above wherever they conflict.

1. **Override words vs. the label list (plan § Design 1 vs the not-a-leak table).** The answer/confirm-word override does NOT apply when a separator-only list names every label of the item ("Is it A, B or C?", "Which is correct: A, B or C?"). Without item context those strings leak. Test them only with item context, and add the no-context leak row.
2. **Look-alike positions (§ Design 1, look-alikes).** 🅱, 🅑 and 🇧 (and every other multi-unit look-alike) map to the letter plus same-length zero-width padding, as `lockedMatch`'s `prepared()` does. Spans and matches are computed on that single folded string. Test: 🅱 padding before the listing and "B." after it is a leak.
3. **"Ordinary word" (§ Design 1 article rule; § Design 5 grading).** Separators (or, and, nor, /) and the letters A–F are never "ordinary words". Add the leak row "the answer is a or b" (key A). In `classify.ts`, a message-initial "a" counts as a label, so "A because it loops" grades correct for key A, while "a or b" never grades correct for key B.
4. **Ruling out (§ Design 1, MEDIUM).** postGuard checks "names every wrong option, not the correct one" over the whole reply, not per sentence. Test: "A is wrong. C is wrong." (key B) is a leak.
