# 5.6b handoff: answer-context mode for the matcher

**Status:** DONE
**Branch:** `m13/5.6b-answer-context` (one branch, one PR, opened after Phase C)
**Worktree:** a builder worktree per phase; removed after each push

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

## Phase C

Branch `m13/5.6b-answer-context` (worked locally as `work-56b-C`). Tests first: the new
`runner.practiceKinds.test.ts` was written and seen failing (27 of 48 red) before the wiring.

### What changed

- `pipeline/types.ts`: the generate input gains `items?` (the active items) and `practiceKeys?`;
  the postGuard input gains `items?` and `practiceKeys?`.
- `pipeline/runner.ts`: `loadAnswerContext` runs every turn once the context is assembled. When the
  loaded help state `holdsPracticeKey`, the item it names is resolved through the **entitled**
  registry (`entitledTools`, the first tool with an `activeItem` hook), not the tools offered this
  turn. A hook that throws is reported (`background`, task `runner`) and treated as unresolved
  (fail closed). `practiceKeys` = held key + carried key (+ this turn's issued keys for
  postGuard). generate gets the loaded item plus earlier attempts' issued items; postGuard gets
  the loaded item plus every item issued this turn (`itemContextOf`).
- `pipeline/steps/generate.ts`: the gate is built with `items` and `practiceKeys` (plus earlier
  attempts' issued keys); each issued item goes to `gate.addKeys(fresh, [itemContextOf(item)])`,
  even when `fresh` is empty. The no-`addKeys` hold-the-rest path is unchanged.
- `pipeline/steps/postGuard.ts`: the `raw` re-check compiles with `{ studentText, items,
  practiceKeys }`; `PostGuardCtx.items` and `practiceKeys` are set.
- `guardrails/answerLeak.ts` (risky): `PostGuardCtx.items?` and `practiceKeys?`; new exported
  `answerKeyOptions(x, student = true)`; the draft and the rewrite are judged by one matcher built
  with the answer context.
- `guardrails/grounding.ts` (risky): both `compileAnswerKeys` calls use `answerKeyOptions` (the
  number-fix check with the student's text, the chunk filter without it).
- `tools/practiceItems.ts`: `SERVABLE_KINDS` holds numeric, short, mcq and code_output.
- `tools/demoPracticeBank.ts`: the mcq `demo:algebra:3:a` now has a concept prompt ("Which of these
  numbers is prime?", A) 6 / B) 7 / C) 8, key B). `demo:python:1:a` is a real 3-line code_output
  item, output "4" on line 2 (no "(it prints 4)" giveaway); new `demo:python:2:a` (a loop sum,
  key "6").
- Tests: new `pipeline/runner.practiceKinds.test.ts` (49 tests); `runner.practiceAnswerKey.test.ts`
  (the restated arithmetic item flips to delivered); `guardrails/answerLeak.test.ts` (prompt span
  and listing exempt, a leak beside them rewrites, the rewrite re-checked, practice keys lose the
  own-code exemption); `guardrails/grounding.test.ts` (a number fix showing the correct option text
  is the hint; a chunk holding it never reaches the judge); `practiceItems.test.ts`,
  `demoPracticeBank.test.ts` ("never serves" flips to served) and `practice.test.ts` (the demo
  mcq's new prompt).

### How it is shown

| Claim | Evidence |
|---|---|
| Both kinds are served | `demoPracticeBank.test.ts` "serves the mcq and code_output records at their level (5.6b Phase C)" and "the code_output prompts hold no giveaway, and one has its output on line 2". `practiceItems.test.ts` "serves a valid mcq or code_output item (5.6b Phase C) and refuses a malformed one" (opaque key, "b", "(B)", 2 options, the correct option's text in the prompt), plus Phase B's `validateItem` refusals. `toolLoop.test.ts` (Phase A): an MCQ issued after an MCQ with the same key B is served. |
| Re-shown without a false block | `runner.practiceKinds.test.ts`, "5.6b: both kinds are served and re-shown on the issuing turn without a false block": "the item goes out and the model restates it whole" and "the same re-show split across 3-unit chunks", each for the demo-style MCQ (key B), the MCQ whose correct option is listed first (key A) and the 3-line code_output prompt (output on line 2); "the generated sum "What is a + b?" restated on its issuing turn is delivered" (whole and in 2-unit chunks); "two items issued in one turn: both re-shown in the reply are delivered". "5.6b: re-shown on a later turn (the item resolved through the entitled registry)": "the tool is not offered, the item is re-shown and delivered" (asserts the main request offers no tools and the saved state keeps `practiceItemId`) and "the later-turn re-show split across 4-unit chunks", for all three items; "the generated sum, held from an earlier turn, restated is delivered". `runner.practiceAnswerKey.test.ts` "a model that restates an arithmetic item is delivered (5.6b: the prompt span is exempt)" (flipped). |
| Answered without a false block | `runner.practiceKinds.test.ts`, "5.6b: answered without a false block": "a correct "B", then a confirming reply that does not restate the key, is delivered"; "a correct code_output answer, then a confirming reply, is delivered"; "a wrong answer whose reply re-shows the item is delivered". `classify.test.ts` (Phase A): "B" grades correct; "a b c", "a or b", "is it a or b?" grade wrong. |
| A real leak is still blocked | `runner.practiceKinds.test.ts`, "5.6b: a real leak is still blocked": "mcq, issuing turn (stream gate)" and "mcq, later turn (postGuard)", each for "The answer is B.", "Definitely B.", "✅ B) 7", "A, **B**, C", "The second option.", "7 works.", "It's not A or C.", Cyrillic "В", the base64 of "The answer is B." and the listing followed by "B."; "code_output, issuing turn" and "code_output, later turn" for "It prints 4.", the restated prompt followed by "It prints 4." and its base64; "a leak split across chunks after a re-show is still held (issuing and later turn)"; "the generated sum restated and then answered gets the hint". Fail closed: "an item outside the entitlement is not resolved: its re-shown listing gets the hint (Q6)" and "5.6b: a throwing activeItem hook … is reported and treated as unresolved". |
| Known limit documented | `runner.practiceKinds.test.ts` "known limit (Q5): a correct "B" followed by "Yes, B is right!" gets the safe hint". |
| The matcher, unit level | Phase A: `answerKey.labels.test.ts`, `answerKey.itemContext.test.ts`. Phase C adds `answerLeak.test.ts` "answerLeak: answer context (5.6b)" and the two "5.6b:" cases in `grounding.test.ts`. |
| Nothing else regresses | Gate below; `git diff origin/main -- packages/contracts apps packages/db` is empty. |

### Evidence

| Check | Result |
|---|---|
| Gate | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1` → `Tasks: 10 successful, 10 total`; harness `Test Files 122 passed (122)`, `Tests 5522 passed (5522)`; contracts 7 files / 444 tests; config 2 files / 42 tests; no test file skipped. |
| Coverage | harness all files 99.01 % statements, 97.28 % branches, 98.56 % functions, 99.48 % lines; `answerLeak.ts` and `grounding.ts` 100 %; `generate.ts` and `practiceItems.ts` 100 % lines. |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0, no findings. |
| Scope | `git diff origin/main -- packages/contracts apps packages/db` → empty. Only `packages/harness` files from the Phase C list and their tests changed (plus `practice.test.ts`, whose expected prompt changed with the demo record). |

### Q8 candidate eval strings (for 7.2; the lead signs eval cases)

"A, **B**, C" · "✅ B) 7" · "The answer is В." (Cyrillic) · "The answer is 🅱." · "It's the second
option." · "It's not A or C." · the student pastes the item's code, reply "It prints Hello,
World!" · a reordered listing "B) 7 A) 6 C) 8" · restated items that should pass (the exact listing;
"What is 3 + 4?" for a generated sum).

### Left to do (board follow-ups only)

- Q5 (pilot-blocking; the lead adds the task, 5.6f): release the practice key on a turn that route
  grades correct, so "Yes, B is right!" is delivered.

## Fix round

Security finding (CRITICAL): the live stream gate judged each sentence against only `keys.reach`
units of prior text, so a reply that ruled out one wrong option in one sentence, then more than
`reach` non-whitespace units later ruled out the other, streamed both sentences to the student
(`i.show(p)` in `toolLoop.ts`, right after `gate.push`) before postGuard's whole-draft check ever
ran. The repro: MCQ_A (key A, options "A) break" / "B) continue" / "C) pass"), a sentence naming
"continue" wrong, 150+ ordinary characters of filler, then a sentence naming "pass" wrong; neither
sentence alone trips `rulesOut`, and the gap exceeds `reach`.

**What changed:**
- `packages/harness/src/pipeline/generate/answerKey.ts`: `rulesOut`'s "which options are named"
  logic is pulled into a new `namedOptions(masked, item)`, and a new exported `namedOptionsIn(text,
  item)` applies it to a bare text with the item's own spans blanked first (no dependence on a
  reach-bounded window).
- `packages/harness/src/pipeline/generate/streamGate.ts`: `sentenceGate` keeps a per-reply,
  per-item `Map<ItemContext, Set<number>>` of which wrong options the attempt's *released* text has
  already named. `safeUpTo` checks, for the piece about to be released, whether the union of that
  record and the piece's own named-wrong-options would cover every wrong option (and not the
  correct one); if so it returns -1 (held, same as a leak) instead of the release length. Only an
  actual `release(n)` commits the piece's named options into the record, so a candidate that is
  re-judged (or never released) never pollutes it. This is a second, independent check from
  `keys.leaks`/`keys.tailStart` (it is never routed through the matcher, so the existing
  linear-work test's `work.units`/`work.checks` counters are unaffected) and holds across the whole
  attempt, not just the reach window, closing the gap. The existing whole-draft postGuard check is
  unchanged and stays the backstop.
- Tests: `pipeline/generate/streamGate.test.ts`, new "the ruling-out check holds across the whole
  reply (5.6b fix round 1)": the repro pushed whole and split across chunks (held, the second
  sentence never shown), plus "ruling out only one wrong option across a long reply still streams
  normally" (not tripped). `pipeline/runner.practiceKinds.test.ts`: the same repro and the
  single-wrong-option case through the real pipeline (issuing turn and later turn), confirming the
  delivered text is `ANSWER_LEAK_SAFE_HINT` and the second sentence never reaches `tokens(events)`.
  The existing "the re-show hold-back stays linear at the item caps" test (`streamGate.test.ts`)
  passes unchanged, since the new check never calls `keys.leaks`/`keys.tailStart`.

**Gate:** `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --force` →
`Tasks: 4 successful, 4 total`; harness `Test Files 122 passed (122)`, `Tests 5527 passed (5527)`;
no test file skipped. `python3 .githooks/secret-scan.py --all` → clean, no findings.

## Decisions

### 24 Oct 2026 · 5.6b The ruling-out check holds across the whole reply, not just `reach` · decided by builder · risk: high
- Decided: the stream gate keeps a per-reply, per-item record of which wrong options its released
  text has already named (updated only when a piece is actually released). A piece whose release
  would complete the set (every wrong option named, not the correct one, across the whole reply so
  far) is held back as a leak exactly as a single-piece ruling-out is, even when the two mentions
  are pushed further apart than `keys.reach`. The check is independent of the matcher's
  `leaks`/`tailStart` (so the gate's linear-work bound is unaffected) and the whole-draft postGuard
  check is kept as the backstop.
- Why: a security finding (CRITICAL) showed the live gate only ever judged a sentence against
  `reach` units of prior text, so an ordinary long-winded reply that ruled out each wrong option in
  a separate, far-apart sentence streamed the full ruling-out to the student before postGuard's
  whole-draft check could replace it with the hint.
- risk: high

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

### 23 Oct 2026 · 5.6b: post guards judge with the active items and practice keys in packages/harness/src/guardrails/answerLeak.ts · decided by builder · risk: high
- Decided: `PostGuardCtx` gains `items` and `practiceKeys`. answerLeak builds one matcher with them (through the new `answerKeyOptions`) and uses it for both the draft and its rewrite. A rewrite that re-shows the item passes; one that shows a derived key (the correct option's text) falls back to the hint.
- Why: plan Phase C step 5. Without the context every re-show of an mcq or code_output item was a false leak, and the rewrite must be judged exactly as the draft was.
- risk: high

### 23 Oct 2026 · 5.6b: grounding judges number fixes and chunks with the answer context in packages/harness/src/guardrails/grounding.ts · decided by builder · risk: high
- Decided: grounding's number-fix check uses the student's text plus `items` and `practiceKeys`; its chunk filter uses `items` and `practiceKeys` without the student's text (a chunk is not the student's code). A fix or chunk that shows the active item's correct option text is now caught.
- Why: plan Phase C step 6, so a grounding fix is judged the same way as the reply.
- risk: high

### 23 Oct 2026 · 5.6b The loaded item is resolved through the entitled registry; a throwing hook fails closed · decided by builder · risk: high
- Decided: on every turn that `holdsPracticeKey`, the runner resolves `practiceItemId` with the first entitled tool that has `activeItem`, whatever tools the decision offers. A hook that throws is reported to `background` (task `runner`) and treated as unresolved: no spans, no derived keys, the label still guarded (so a re-show gets the hint).
- Why: plan Phase C step 2 and Q6. A silent catch would hide a broken bank, and an exception must never widen what is shown.
- risk: high

### 23 Oct 2026 · 5.6b generate takes a list of active items, not one · decided by builder · risk: low
- Decided: the generate input gains `items?: readonly ItemContext[]` (the loaded item plus items an earlier attempt of this turn issued) instead of `practice.activeItem`, and `practiceKeys?` sits beside it, not inside `ToolSessionState`.
- Why: a retry must exempt the earlier attempt's items too, and `ToolSessionState` is what tools read; answer keys and item context stay out of it.
- risk: low

### 23 Oct 2026 · 5.6b The demo mcq gets a concept prompt and a second code_output record · decided by builder · risk: low
- Decided: `demo:algebra:3:a` asks "Which of these numbers is prime?" (A) 6 / B) 7 / C) 8, key B). `demo:python:1:a` is "What does this code print?" over `x = 4` / `print(x)` (output on line 2). New `demo:python:2:a` sums a loop (key "6"). The demo bank's lowest-mastery test now lists `python-loops` as tracked, since the new level-2 record adds that topic.
- Why: the full-strength "correct option in the prompt" check stays, and a concept prompt never computes to an option (brief and Phase A note).
- risk: low

### 24 Oct 2026 · 5.6b review findings deferred to 5.6g · decided by lead · risk: low
- Decided: the security re-check MEDIUM in packages/harness/src/pipeline/generate/streamGate.ts (judge the window plus the piece for ruling-out) and the TypeScript LOWs in packages/harness/src/pipeline/generate/itemContext.ts and packages/harness/src/tools/practiceItems.ts go to board task 5.6g, started right after this merges.
- Why: one fix round per task; postGuard's whole-draft check still fixes the stored reply for the MEDIUM.

Tool calls used: 310 (harness count: Phase A 61, Phase B 108, Phase C 90, fix round 51; the fixer reported 32)
