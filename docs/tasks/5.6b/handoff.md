# 5.6b handoff: answer-context mode for the matcher

**Status:** DONE (Phase A; Phases B and C follow with fresh builders, per the plan)
**Branch:** `m13/5.6b-answer-context` (one branch, one PR, opened after Phase C)
**Worktree:** builder worktree (Phase A); removed after the push

## Phase A

### What changed

- `packages/harness/src/pipeline/generate/labelKeys.ts` (new): label keys (design 1). `labelOf`
  (one letter, optionally bracketed), `foldLabels` (look-alikes folded one unit for one unit via
  `lockedMatch.foldConfusables`, plus negative circled, squared, negative squared and
  regional-indicator letters and any code point whose NFKC is one ASCII letter, padded with
  zero-width units so positions stay right), `labelLeaks` (default leak; the separator-only
  list exemption; the answer-word override; the all-labels-of-an-item exception from lead
  answer 1; the article rule for "a"/"i" with lead answer 3; the decoded-base64 rule),
  `labelsNamedIn` (for ruling out) and `positionLeaks` (design 3 position keys).
- `packages/harness/src/pipeline/generate/itemContext.ts` (new): `ItemContext`, `itemContextOf`,
  `issueCheckContext`, option helpers (`optionText`, `itemLabels`, `correctIndex`,
  `correctOptionText`), `spanLength`, `listingSpans` (the exact in-order complete listing, only
  whitespace between options, word boundaries, no mark/emphasis/answer word on its start and
  end lines) and `blank` (spans to spaces, newlines kept, same length).
- `packages/harness/src/pipeline/generate/answerKey.ts`: `AnswerKeyOptions.items` and
  `practiceKeys`; label keys routed to the label matcher; prompt spans (compact folded form,
  word-bounded) and listing spans; derived keys (correct option text full strength, position,
  ruling out over the whole text); every practice key and item key kept out of the own-code
  exemption; `reach` grows by the longest item span; header comment. `revealsAnswerKey` gains the
  optional `opts` third argument and reads a plain string once (its JSON form only adds escapes,
  and would turn a joined listing's newlines into `\n` text).
- `packages/harness/src/routing/classify.ts`: design 5. A label key part matches only when the
  message names exactly one distinct label A-F; the article "a" before an ordinary word is not a
  label, but a message-initial "a" is; letters after an apostrophe ("I'd", "it's") are not labels.
- `packages/harness/src/pipeline/generate/toolLoop.ts` and `skillEvent.ts`: the issued item's
  shown text is checked as one joined text with `{ items: [issueCheckContext(...)] }`.
  `skillEvent` builds the context from the `shownText` its caller already passes, so
  `steps/generate.ts` is unchanged.
- Tests: new `answerKey.labels.test.ts` and `answerKey.itemContext.test.ts` (every leak and
  not-a-leak row, the lead-answer rows, span edges, base64, `reach` at the caps); `classify.test.ts`,
  `toolLoop.test.ts` and `skillEvent.test.ts` gain the design-5 and same-key MCQ cases.

### Evidence

| Claim | Evidence |
|---|---|
| The matcher, unit level | `answerKey.labels.test.ts`, `answerKey.itemContext.test.ts`: every leak-table row (answer forms, answer words, gamed lists, the correct option alone, lowercase after an answer word, look-alikes, position, option text, ruling out incl. "A is wrong. C is wrong.", restated item plus answer, the "x = 57" boundary, code_output incl. the own-code paste, base64) leaks; every not-a-leak row is delivered; "Is it A, B or C?" leaks with no item context; the 🅱-padding row leaks; `reach` covers a 600 + 6×160 item. |
| Grading | `classify.test.ts`: "B", "b", "(b)", "I think it's b", "I'd say b" grade correct for key B; "a b c", "a or b", "is it a or b?", "A, B or C" grade wrong; "A because it loops" grades correct for key A; numeric and text keys grade as before. |
| Issue-time checks | `toolLoop.test.ts` and `skillEvent.test.ts`: an MCQ after an MCQ with the same key B is served; one whose shown text says "The answer is B." is refused (`answer_key`). |
| Nothing else regresses | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1` → `Tasks: 10 successful, 10 total`; harness `Test Files 121 passed (121)`, `Tests 5430 passed (5430)`, coverage all files 98.96 % statements / 97.13 % branches; contracts 444 passed, config 42 passed; no test file skipped. New files: labelKeys.ts 99 % lines, itemContext.ts 100 % lines, answerKey.ts 99.6 % lines, classify.ts 100 % lines. |
| Secret scan | `python3 .githooks/secret-scan.py --all` → clean (no findings). |
| Scope | Only `packages/harness/src/pipeline/generate/{answerKey,labelKeys,itemContext,toolLoop,skillEvent}.ts`, `routing/classify.ts` and their tests changed. No contracts, apps, db, guardrails or serving change. |

### Left to do (Phase B, then C)

- Phase B as planned: `validateItem` item rules, `PracticeBank.itemFor`, `generatedPrompt`, the
  `activeItem` hook, `RegisteredTool.activeItem` type, `streamGate` `items`/`practiceKeys`,
  `addKeys(keys, items?)` and the re-show hold-back.
- **Note for Phase B (`validateItem`, "correct option in the prompt"):** a sum prompt such as
  "What is 3 + 4?" with correct option "B) 7" shows 7 as arithmetic in an answer context, so the
  full-strength option-text check refuses it. The planned demo MCQ ("A) 6", "B) 7", "C) 8" with a
  "What is 3 + 4?"-style prompt) would be refused by that rule. The Phase B builder should pick a
  prompt that doesn't compute to the option (or raise it with the lead) rather than weaken the check.
- `practice.ts` `accept()` (line ~162) should use `issueCheckContext` like toolLoop/skillEvent.
- Position keys are an answer-context check: "It's 2 steps." leaks for a key-B MCQ (safe
  failure). Phase C runner fixtures should avoid such wording in delivered replies.

## Phase B

Branch `m13/5.6b-answer-context` (worked locally as `work-56b-B`). Tests first; each new test was
seen failing before its code.

### What changed

- `tools/practiceItems.ts`: `validateItem` item rules. An mcq item needs 3 to 6 options, each
  `"X) text"` in label order with non-empty text, and exactly one in-range letter key. The label is
  checked with the label matcher in the prompt and in each option text (the listing is the exempt
  span), and in the id. The correct option's text must not leak in the prompt, and its position
  must not be named there (full strength, per the lead's answer on the Phase A note). Caps:
  `PRACTICE_PROMPT_MAX` 600, `PRACTICE_OPTION_MAX` 160. The old opaque option-id mcq path is
  gone. New `generatedPrompt(id)` (the generator now uses it) and a required
  `PracticeBank.itemFor(itemId, scope)`.
- `tools/demoPracticeBank.ts`: `itemFor`, scoped like `answerKeyFor`. The demo mcq record now has
  real options (A) 6 / B) 7 / C) 8, key B); it is still not served (Phase C).
- `pipeline/tools.ts`: `RegisteredTool.activeItem?(itemId, ctx)` and the `ItemContext` type
  re-export.
- `tools/practice.ts`: `accept()` checks with `issueCheckContext` (as toolLoop and skillEvent do).
  New `activeItem` hook: the bank item (its prompt, options and key) inside the entitlement, else a
  generated id in scope (prompt rebuilt with `generatedPrompt`, key recomputed). It fails closed
  (undefined) for an out-of-scope or unknown id, or a bank item with no key. Session copies get it.
- `pipeline/generate/streamGate.ts`: `StreamGateInput.items` / `practiceKeys`,
  `addKeys(keys, items?)`, and the re-show hold-back. One KMP cursor per item per span (the
  prompt, and the listing joined by newlines), compared in the matcher's folded compact form.
  - Text that may be the start of a re-show is held until the restatement completes or stops
    matching.
  - A completed span is judged as one piece: sentence ends inside it are skipped, and a cap cut
    never lands inside it.
  - A window in front that would start inside a shown span starts at the span's start instead.
    Without this, a cut-off listing reads as bare option text; this showed up as a false trip on
    the third repeated re-show.
  - `HOLD_MAX` is 2048 compact units: a longer target is never held.
  - Text held when `addKeys` brings a new item is fed to that item's cursor.

### Evidence

| Check | Result |
|---|---|
| Gate | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1` → `Tasks: 10 successful, 10 total`; harness `Test Files 121 passed (121)`, `Tests 5463 passed (5463)`; contracts 7 files / 444 tests passed; config 2 files / 42 tests passed; no skipped files. |
| Coverage | `src/tools/**` at 100% (the threshold run passes); `streamGate.ts` fully covered. |
| Linear work | New test: a capped item (a 561-unit prompt and six 156-unit options) re-shown about five times, under `LIMITS.modelTextMaxLength`, pushed in 7-unit pieces. It is delivered whole, and each check reads at most `2 × (reach + cap + HOLD_MAX)` units. |
| Secret scan | `python3 .githooks/secret-scan.py --all` → clean. |
| Scope | Only `packages/harness/src/{tools/practiceItems,tools/demoPracticeBank,tools/practice,pipeline/tools,pipeline/generate/streamGate}.ts` and their tests changed. No contracts, apps, runner, generate, postGuard, answerLeak, grounding or `SERVABLE_KINDS` change. |

### Left to do (Phase C)

- Wire it up in runner, generate, postGuard, `answerLeak.ts` and `grounding.ts`:
  - resolve the active item through `activeItem`;
  - pass `items` and `practiceKeys` to the stream gate and the post-checks;
  - call `addKeys(keys, [issued item context])` on each issued item.
- Add `mcq` and `code_output` to `SERVABLE_KINDS`, and give the demo code_output record real
  content.
- `runner.practiceKinds.test.ts`: end-to-end runs that re-show an MCQ and a code_output item.
- Phase A note still applies: avoid position wording such as "It's 2 steps." in delivered replies
  in the runner fixtures.

## Decisions

### 23 Oct 2026 · 5.6b The leak matcher gets an answer-context mode · decided by builder · risk: high
- Decided: A single-letter (label) key leaks unless it sits in an exempt shape (a separator-only list of two or more of the item's labels, or the item's exact option listing), and an answer word overrides every exemption except a list naming every label of an item. The active item's prompt and exact listing are exempt spans (matches fully inside are ignored, never deleted). The correct option's text is a full-strength key outside those spans, its position counts in an answer context or alone, and naming every wrong option (over the whole text) is a leak. Practice keys never get the own-code exemption. A label answer is graded only when it's the one label in the message. The bank serves mcq and code_output items once Phase C lands. Known limits, also risk: high: an unresolved item and a `practiceCarriedKey` guard only their label (the option text, position and ruling-out checks don't run on that turn); buildContext doesn't drop chunks holding the option text.
- Why: MCQ bare-label keys and code_output keys that appear in their own prompt tripped the leak gate on every re-show (5.6 architect MEDIUM, 5.6 Phase C open question answered (c)). This closes ADR-0010's Consequences line 43 ("until the matcher has an answer-context-only key mode"); no new ADR (Q7).
- risk: high

### 23 Oct 2026 · 5.6b A span exempts only its own item's keys; labels are exempt in any span · decided by builder · risk: high
- Decided: inside an item's prompt or listing span, a label mention is ignored for any label key, but a non-label key (number or text) is ignored only if it belongs to that item (its own answer key or correct option text). A key held from another item is still caught inside the span.
- Why: the plan says "a key match is ignored when it lies fully inside a span" without saying whose key. Exempting every key would let a re-shown prompt hide a carried key from another item (a "3 + 4" prompt hiding a held "7"); labels inside an item's own listing are structure, not an answer.
- risk: high

### 23 Oct 2026 · 5.6b Issue-time checks exempt only the new item's listing · decided by builder · risk: high
- Decided: toolLoop and skillEvent check a newly issued item's joined shown text with `issueCheckContext(issued)`: its option listing is a span, but its prompt is not and its own key is not used. So an MCQ after an MCQ with the same key B is served, while a new prompt saying "The answer is B" or showing "3 + 4" against a held "7" is still refused (today's behaviour). `skillEvent` builds the context from the shown text it already receives, so `steps/generate.ts` needs no change.
- Why: the plan passes `itemContextOf(issued)`, but that makes the new prompt its own exempt span, so a prompt that states an earlier key would pass the very check meant to catch it.
- risk: high

### 23 Oct 2026 · 5.6b revealsAnswerKey reads a plain string once · decided by builder · risk: low
- Decided: for a string value, `revealsAnswerKey` checks only the string, not also its JSON form.
- Why: `JSON.stringify` of a string only adds quote marks and escapes (the compact form already drops backslashes), and it turns a joined listing's newlines into literal `\n`, which breaks the listing span.
- risk: low

### 23 Oct 2026 · 5.6b Correct-answer confirmation keeps the safe hint · decided by lead (Q5) · risk: low
- Decided: a correct-answer turn still guards the key ("Yes, B is right!" gets the safe hint); the follow-up that releases it is pilot-blocking.
- Why: lead decision Q5; carried here from the plan so it reaches the log.
- risk: low

### 23 Oct 2026 · 5.6b The demo MCQ record gets real options in Phase B · decided by builder · risk: low
- Decided: the demo mcq record `demo:algebra:3:a` now has options A) 6 / B) 7 / C) 8 and key B. It is still not served until Phase C adds mcq to `SERVABLE_KINDS`.
- Why: the test that every demo record passes `validateItem` stays strict under the new mcq rules. Its prompt does not compute to 7, so the full-strength check holds.
- risk: low

### 23 Oct 2026 · 5.6b An item id may hold its label key only in a non-answer shape · decided by builder · risk: low
- Decided: for a one-letter key, the id is checked with the label matcher in decoded mode: an answer context, or the label as the whole id, is refused. A bank id ending ":a" is accepted.
- Why: a whole-word check would refuse common bank ids. The id is never shown with an answer word.
- risk: low

### 23 Oct 2026 · 5.6b PracticeBank.itemFor is required · decided by builder · risk: low
- Decided: `itemFor(itemId, scope)` is a required member of `PracticeBank`. Only the harness implements banks today.
- Why: if it were optional, a bank without it would quietly give no re-show exemption. Required makes the compiler flag every bank.
- risk: low

### 23 Oct 2026 · 5.6b A label key on a non-mcq item uses the label matcher · decided by builder · risk: low
- Decided: when a short, numeric or code_output item has a one-letter key, `validateItem` checks its prompt and options with the label matcher, not the whole-word check.
- Why: the label key is guarded the same way everywhere. A whole-word "a" check would refuse ordinary English prompts.
- risk: low

### 23 Oct 2026 · 5.6b The re-show hold-back is bounded and widens the window over a shown span · decided by builder · risk: high
- Decided: the stream gate holds back text that could still become an active item's prompt or listing, up to `HOLD_MAX` (2048 compact units). It judges a completed span as one piece. When the window in front would start inside a shown span, the window starts at the span's start.
- Why: the matcher only exempts a whole span. A span split across checks, or cut by the window, read as a leak on every re-show. Holding back delays text but never shows more of it, and the work stays linear, as a test checks.
- risk: high

### 23 Oct 2026 · 5.6b Keys added mid-attempt are practice keys · decided by builder · risk: low
- Decided: in `answerLeakStreamGate`, keys from `addKeys` count as practice keys, so they never get the own-code exemption. Items from `addKeys` join the matcher's item contexts.
- Why: design 4. A key from an issued item must not slip through because the student typed it.
- risk: low

Tool calls used: Phase A 61; Phase B 38
