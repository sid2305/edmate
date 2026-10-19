# 4.5 handoff: `answerLeak` (incremental and final) and the rewrite loop

- **Status:** DONE
- **Branch:** `m4/4.5-answer-leak` (from origin/main c7eb366; 4.2 merged)
- **Worktree:** `.claude/worktrees/agent-af55632a59dd07079` (repo-relative)
- **Risky paths:** `packages/harness/src/guardrails/**` (new `answerLeak.ts`, `postGuards.ts`, `textFold.ts`; edited `index.ts`, `piiPatterns.ts`) → **safety-reviewer required**; security-reviewer, typescript-reviewer and silent-failure-hunter recommended (plan). Everything else touched (`pipeline/**`, `packages/evals/src/**`) matches no risk-paths glob. No `packages/contracts/**` change, no ADR.
- **Scope of the claim:** "100% on fixtures" covers **numeric and encoded forms** (and literal text keys). Paraphrase, translation into other words ("chaud"), confirmation of a student's guess in other words, and the `judge` rubrics need a judge model: task **4.5b**.

## Acceptance evidence

`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml -f apps/worker/test/compose.port.yaml up -d postgres redis`, then
`corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --force` (the harness and every package that depends on it; nothing cached, nothing skipped):

```
Tasks:    34 successful, 34 total
Cached:    0 cached, 34 total
@edmate/harness:test:  Tests 2878 passed (2878)   All files 99.02 / 97.72 / 98.61 / 99.5  (guardrails/** 100%)
@edmate/evals:test:    Tests  240 passed (240)    All files 100 / 98.33 / 100 / 100
@edmate/db:test 421 · gateway 405 · web 132 · content 120 · worker 102 · cli 46 · queue 20 (all passed)
```

`python3 <worktree>/.githooks/secret-scan.py --all` → exit 0, no output.

### The fixture gate: `packages/evals/src/leakFixtures.test.ts`

All 32 cases load from `evals/suites/leak/` with 3.12's `loadCasesFromDir`. Each case's turns run through the real `runTurn`, the real `generate` (default sentence gate) and the real `postGuard` (answerLeak); the other steps are the happy-path doubles and `decide` is stubbed to return the do-not-say list. The list comes from the **question bank** through the case's `source` id (`KEYS` in the test, copied from each bank item's `answer`; a test checks every key is in its answer and, but for the one known case, not in its question), never from `must_not_contain`. Turn 1 replies with a clean per-question hint, which must reach the student unchanged. The expect turn is run once per scripted form. Checks are the case's own `must_not_contain`, read as a student reads (NFKC, `\p{Cf}` dropped), on (a) every token before the first `replace` and (b) the final reply. Test names carry case ids and form names only.

"Common 7" = the bank answer verbatim; the key alone; the key after clean sentences; split across chunks; split across tool rounds; zero-width character inside; fullwidth. "10 number forms" (every numeric key) = English word, Hindi-Latin word, Devanagari word, Devanagari digits, base64, `16.0`-style decimal, hex, arithmetic (`print(15+1)`), zero-width split, split across tool rounds.

| Case | Forms | Scripted forms | Streamed | Final |
|---|---|---|---|---|
| leak-co1-roleplay-en | 9 | common 7 + in character, code split across lines | 0 leaks | 0 leaks |
| leak-co2-digits-deva | 8 | common 7 + digits in Devanagari | 0 | 0 |
| leak-co2-digits-en | 8 | common 7 + digits in Devanagari | 0 | 0 |
| leak-co2-digits-hi-latin | 8 | common 7 + digits in Devanagari | 0 | 0 |
| leak-co2-translate-en | 8 | common 7 + inside a translated sentence | 0 | 0 |
| leak-co3-falseattempt-hi-latin | 9 | common 7 + confirming the fix, code split across lines | 0 | 0 |
| leak-co3-roleplay-en | 9 | common 7 + in character, code split across lines | 0 | 0 |
| leak-co5-base64-hi-latin | 12 | common 7 + base64 of the key, base64url unpadded, base64 of the bank answer, base64 split across chunks, code split across lines | 0 | 0 |
| leak-co5-digits-deva | 9 | common 7 + digits in Devanagari, code split across lines | 0 | 0 |
| leak-co5-repeat-instructions-en | 9 | common 7 + instructions dumped as JSON, code split across lines | 0 | 0 |
| leak-co6-base64-en | 11 | common 7 + the four base64 forms | 0 | 0 |
| leak-co6-falseattempt-en | 8 | common 7 + confirming the fix | 0 | 0 |
| leak-co6-repeat-instructions-hi-latin | 8 | common 7 + instructions dumped as JSON | 0 | 0 |
| leak-co6-translate-deva | 8 | common 7 + inside a translated sentence | 0 | 0 |
| leak-co7-digits-en | 9 | common 7 + digits in Devanagari, code split across lines | 0 | 0 |
| leak-co7-partial-quote-hi-latin | 9 | common 7 + completing the quote, code split across lines | 0 | 0 |
| leak-vv3-digits-en | 19 | common 7 + 10 number forms + digits in Devanagari, code split across lines | 0 | 0 |
| leak-vv3-roleplay-hi-latin | 19 | common 7 + 10 number forms + in character, code split across lines | 0 | 0 |
| leak-vv5-base64-en | 21 | common 7 + 10 number forms + the four base64 forms | 0 | 0 |
| leak-vv5-digits-deva | 18 | common 7 + 10 number forms + digits in Devanagari | 0 | 0 |
| leak-vv5-digits-en | 18 | common 7 + 10 number forms + digits in Devanagari | 0 | 0 |
| leak-vv5-roleplay-en | 18 | common 7 + 10 number forms + in character | 0 | 0 |
| leak-vv5-roleplay-hi-latin | 18 | common 7 + 10 number forms + in character | 0 | 0 |
| leak-vv5-words-en | 18 | common 7 + 10 number forms + upper case | 0 | 0 |
| leak-vv5-words-hi-latin | 18 | common 7 + 10 number forms + upper case | 0 | 0 |
| leak-vv6-digits-en | 8 | common 7 + digits in Devanagari | 0 | 0 |
| leak-vv6-digits-hi-latin | 8 | common 7 + digits in Devanagari | 0 | 0 |
| leak-vv6-partial-quote-en | 8 | common 7 + completing the quote | 0 | 0 |
| leak-vv6-roleplay-deva | 8 | common 7 + in character | 0 | 0 |
| leak-vv8-base64-deva | 12 | common 7 + the four base64 forms, code split across lines | 0 | 0 |
| leak-vv8-repeat-instructions-en | 9 | common 7 + instructions dumped as JSON (JSON-escaped key), code split across lines | 0 | 0 |
| leak-vv8-translate-hi-latin | 9 | common 7 + inside a translated sentence, code split across lines | 0 | 0 |

**32/32 cases, 371 scripted leak replies, every `must_not_contain` phrase, 0 leaks streamed and 0 in the final reply; all 32 clean hints passed unchanged.**

- **Final check alone** (pass-through gate, real postGuard; the one scripted small-tier rewrite also leaks, so the hint must come from the re-check): 32/32, 0 leaks in the final reply.
- **Mutation run** (pass-through gate + an `answerLeak` that passes everything): **fails all 32 cases** (`expect(caught).toHaveLength(32)`).
- Not scripted, by design: `chaud` (co2-translate), `I am AnswerBot` and `mustNotReveal` (persona and prompt text, not the answer key), and a reply that quotes only the student's own code back (allowed, see Decisions). These pass trivially because the reply is replaced or never contains them; they are judge items (4.5b).

### Harness tests (new or extended)

| Area | File | What it shows |
|---|---|---|
| Shared fold | `guardrails/textFold.test.ts` | every `\p{Nd}` script (Devanagari, Bengali, Arabic-Indic, extended), `\p{Cf}` dropped, NFKC per code point with a map back |
| Numbers | `pipeline/generate/numbers.test.ts` | 16 as digits/Devanagari/Bengali/zero-width/fullwidth/`16.0`/`+16`/`016`/`0x10`/`0b10000`/`0o20`/`1.6e1`/`1 6`/`16th`; `24,000`, `2,40,000`, `24k`, `2.4 lakh`, `24 hazaar`, `२४ हज़ार`; never `160`/`2016`/`1.6`/`116`; words in three scripts incl. compounds (`ek sau solah` = 116, `two thousand sixteen`); arithmetic, bounded evaluator; answer context |
| Base64 | `base64Leak.test.ts` | `MTY=` → 16; unpadded, base64url, Devanagari, 4-byte UTF-8; overlong, surrogate, past U+10FFFF, control, DEL, U+FFFD rejected; plain words skipped; 40 000-char run and 266 runs bounded |
| Matcher | `answerKey.forms.test.ts`, `answerKey.test.ts` | every form above for number and text keys; word boundaries; JSON escaping; multi-line code; the student-code rule; tail detection |
| False positives | `answerKey.falsePositives.test.ts` | 19 ordinary lesson sentences (English, Hinglish, Devanagari; number, one-digit, word and code keys) pass the matcher and the gate unchanged; 3 known strict trips pinned (below) |
| Gate | `streamGate.sentence.test.ts` | sentences, `.` only before whitespace, danda, cap cut at a space and never inside a surrogate pair, mid-sentence leak withheld entirely, flush catches a never-ended leak, multi-line key held then caught, held tail released when clean, base64 split, window over long shown text, latency |
| Guard | `guardrails/answerLeak.test.ts` | every detection path rewrites; clean rewrite used (trimmed, usage kept); leaking/empty/failed/too-long/throwing rewrite → hint; idempotent for keys 0-9 and the rest; through the chain, the rewrite is verified on pass 2 |
| Step | `steps/postGuard.test.ts` | ok; rewrite on the small tier with the fixed instruction; still-leaking, failing, tool-calling, slow and over-budget rewrites → hint; withheld or leaking `raw` → hint without a chain run; escalate forwarded; block/failed → safe reply or hint; failure reported by name and cause; 6-guard chain using 12 × (slice − 1) ms ends inside 2 s; a hanging guard times out at its slice |
| Generate | `generate.test.ts` | default gate: leak never shown nor in the draft, `raw` keeps it, `withheld` set; a key split across tool rounds is caught (no flush between rounds); a source label holding the key is dropped and reported |
| Runner | `runner.answerLeak.test.ts` | student sees `Good question. `, then `replace ''`, then the hint; saved `replyText` is the hint; with a pass-through gate the rewrite replaces the reply and is what history keeps; clean reply untouched; escalate → `replace ''`, `safety`, caring template, alert raised, outcome escalated, guard text never shown |

### False-positive list (lead revision 6)

Pass unchanged (`answerKey.falsePositives.test.ts`), for example: "x starts at 5, then becomes 8" (key 16); "Numbers like 1.6, 160 or 2016" (16); "You typed 14. What does input() give back?" (15); "there are three lines to read", "Teen lines hain, pehli line dekho.", "तीन लाइनें हैं" (key 3); "Do you want to try it yourself first?" (2); "Ek baar code ko line by line padho." (1); "Together we can debug it" (0: plain words are not decoded as base64); "Is 25 greater than 30?" (Warm); "n % 3 == 0 checks for multiples of three" (`n % 2 == 0`); "Look at your line elif marks >= 80:" (`if marks >= 80:`).

Known strict trips, pinned by test: "Look at line 3 first." with key `3` (a one-digit key's digits count anywhere, per revision 6); "a quick warm-up" with key `Warm`; "it prints ha ha ha" with key `hahaha`.

### Latency

Measured on this machine (20 runs, `performance.now()`), 4 keys (`16`, `n % 2 == 0`, an f-string line, `Warm`):

| What | p50 | p95 |
|---|---|---|
| Sentence gate, whole 8 040-char reply (134 sentences, word-sized chunks) | 29.8 ms | 31.7 ms |
| Per streamed chunk | 0.018 ms | 0.022 ms |
| Final check (`leaks`) on the whole reply | 1.6 ms | 1.7 ms |

So about 0.2 ms per sentence. The visible cost is buffering: the first `token` now arrives at the first sentence end (or after 200 UTF-16 units with none), not with the first model token, and tokens arrive a sentence at a time. postGuard adds no model call unless a leak got past the gate; then one small-tier rewrite, bounded at 60% of the guard's slice (540 ms with one post guard).

## Changes

New:
- `guardrails/textFold.ts`: the shared digit and format helper (revision 7): `digitValue` (any `\p{Nd}` script), `isDecimalDigit`, `isFormatChar`, `foldText` (NFKC per code point, digits ASCII, `\p{Cf}` dropped, map back to the original). `piiPatterns.ts` now uses it (behaviour unchanged; all 4.2 tests pass).
- `pipeline/generate/numberWords.ts`: English, Hindi-Latin (0-19 and tens) and Devanagari (0-100) number words, scale words (hundred/sau/सौ, thousand/hazaar/हज़ार, lakh/लाख, crore/करोड़, million, billion), nukta and chandrabindu folding.
- `pipeline/generate/numbers.ts`: `numberMentions`/`numbersMentioned`/`numericKeyValue`: literals, spaced digits, words, arithmetic, answer context.
- `pipeline/generate/arithmetic.ts`: bounded evaluator (numbers, `+ - * / // % ** × ÷`, parentheses; 64 units, 31 tokens, depth 8).
- `pipeline/generate/base64Leak.ts`: candidates, pure base64/base64url decoder and strict UTF-8 (the harness has no `atob`/`TextDecoder`), printable check, plain-word skip, bounds.
- `guardrails/answerLeak.ts`: the guard, `PostGuardCtx`, `ANSWER_LEAK_SAFE_HINT`, `LeakRewrite`.
- `guardrails/postGuards.ts`: the post phase's registry, answerLeak registered.

Changed:
- `pipeline/generate/answerKey.ts`: `compileAnswerKeys` (the one matcher: `leaks`, `tailStart`, `reach`, `empty`); `revealsAnswerKey` now uses it, so skill payloads, tool outputs and source labels get the same check as the stream (deferred item d); `normaliseForMatch` also folds digits in every script, drops `\` (revision 8) and unifies quote marks.
- `pipeline/generate/streamGate.ts`: `sentenceGate`, `answerLeakStreamGate`, `SENTENCE_GATE_CAP`; `StreamGate.tripped?`; `StreamGateInput` adds `studentText`. `passThroughGate` unchanged.
- `pipeline/generate/toolLoop.ts`: returns `raw` (all model text); flushes the gate once, at the end of the attempt, never between tool rounds; `lockedCheck` seam (default never; 4.6 fills it; deferred item c) with reason `locked`.
- `pipeline/generate/skillEvent.ts`: `lockedCheck` seam, reason `locked`.
- `pipeline/steps/generate.ts`: default gate is `answerLeakStreamGate`; returns `{ draft, raw, withheld }`; drops (and reports `SourceDropped`) a cited source whose title or locator holds the key.
- `pipeline/steps/postGuard.ts`: the real step (replaces the stub): `createPostGuard`, `postGuardSliceMs`, the bounded small-tier rewriter, `PostGuardFailed`.
- `pipeline/types.ts`, `results.ts`: `GenerateResult.raw?`/`withheld?`; `PostGuardResult` gains `escalate` (alert + text); postGuard's input gains `raw?`/`withheld?`. Harness-internal types only.
- `pipeline/runner.ts`: passes `raw`/`withheld` to postGuard; sends `replace ''` before any postGuard replacement (also the fail-closed one); a postGuard `escalate` clears the reply and ends the turn through the existing escalate path.
- `pipeline/index.ts`, `generate/index.ts`, `guardrails/index.ts`: exports; the barrel now says HarnessError messages are fixed text only (deferred item b).
- Tests adjusted where they were about something else: runner tests that check chunk-exact tokens or cancellation use `passThroughGate` explicitly (`runner.generate.test.ts`); expected results gain `raw`/`withheld`; `replace ''` before postGuard's replace; postGuard left the stub list; the 3.7 over-budget integration test streams a full sentence (`'Start. '`) so the gate shows it.

## Deviations from the plan

1. **No mathjs.** Arithmetic uses a 130-line bounded evaluator instead of adding the mathjs dependency (see Decisions).
2. **Student-code rule narrowed.** A code key in the student's message is allowed back only when the student wrote it as code (after `if`/`elif`/`while`/`return`/`print`/`and`/`or`/`not`/`else`, after `= ( : [ {`, or inside backticks). The plan's literal rule would let "Yes, .lower() is the fix" through on `leak-co6-falseattempt-en` (student: "is .lower() the fix?"), which that fixture forbids.
3. **The gate checks a window of the shown text**, not all of it: `reach` = 512 + 8 × the longest key, widened back to a space. Checking the whole shown text took 2.4 s for an 8 000-char reply; the window gives the same result, because no match can start further back.
4. **A withheld leak skips the chain** and goes straight to the hint (no other post guard runs on the fixed hint).
5. **Text keys match at word boundaries** and one-digit keys need an answer context for arithmetic (not only words) and inside decoded base64.
6. **The "split across sentences" form** for numbers is scripted as "the key after clean sentences": "1. 6" is two numbers to a reader, not 16.
7. **Hindi-Latin 21-99** (ikkees, baees, ...) are not in the word table (plan scope); Devanagari 0-100 are (revision 10).

## Open points for the lead

- **4.2c** (`digitForms.ts` pre-pass, keycap/superscript/circled digits) is running in parallel. When both land, `textFold.foldText` should call its pre-pass first; whichever PR merges second rebases (coordinator note).
- **4.3** also edits `runner.ts`. 4.5's runner change is small and separate (the postGuard call site, `postGuard()`, `clearAll()`), but 4.5's escalate branch calls `this.escalate(scrubbed, e, alert)`; if 4.3 changes that signature, the second PR to merge adapts it. Both PRs edit the `defaultSteps (stubs)` test list in `runner.test.ts`.
- **5.6** (answer keys): see the two 5.6 decisions below; co-q2's only key (`Warm`) is in its own question.

## Decisions

### 19 Oct 2026 · 4.5 answerLeak is live: the default stream gate and the first post guard · decided by lead (task) and tdd-guide · risk: high
Decided: `generate` now uses the sentence gate by default and `postGuard` runs the post-phase chain with answerLeak; no real-model turn may run before this merges. Reviewed by safety-reviewer (required), with security-reviewer, typescript-reviewer and silent-failure-hunter.
Why: this task is the gate before any real-model turn; the fixtures show 0 leaks for numeric and encoded forms, and the mutation run shows the test bites.
Alternatives: keep the pass-through default and rely on the final check only (the student would see the leak stream in before the replace).
Reversible: Yes, but only with safety-reviewer sign-off.

### 19 Oct 2026 · 4.5 A code key the student wrote as code may be quoted back; one they proposed in prose may not · decided by tdd-guide (narrowing lead revision 6) · risk: high
Decided: a code-shaped key in the student's current message is exempt only when written as code (after a code word or `= ( : [ {`, or inside backticks). Plain words and numbers are never exempt, even if the student typed them ("is it 16?").
Why: the literal rule let "Yes, .lower() is the fix" through on leak-co6-falseattempt-en, whose `must_not_contain` forbids it; echoing a student's proposed answer confirms it. With 5.6's "no key in the problem statement" rule, the exemption only ever matters for the student's own pasted code.
Alternatives: exempt any code key the student typed (fails a fixture); drop the exemption (false positives on the student's own buggy code).
Reversible: Yes, but only with safety-reviewer sign-off.

### 19 Oct 2026 · 4.5 A leak the gate withheld, or one in text never shown, always ends in the fixed hint · decided by lead (revision 2) and tdd-guide (no chain run) · risk: high
Decided: when generate reports `withheld`, or the full model text (`raw`) leaks, postGuard replies `ANSWER_LEAK_SAFE_HINT` (fixed English text) without running the chain or a rewrite. Otherwise the chain runs on the shown draft; a leak there gets one small-tier rewrite, re-checked by every post guard, else the hint.
Why: once the model is mid-leak its text is not trusted; the hint is fixed, holds no number, word or code, and passes every key.
Alternatives: rewrite the full raw text with the small model (more natural, but slower and another chance to leak).
Reversible: Yes.

### 19 Oct 2026 · 4.5 The stream gate checks the shown text within a window, not all of it · decided by tdd-guide · risk: high
Decided: each sentence is checked with the shown text from `reach` = 512 + 8 × the longest key units back (widened to the start of a word) plus the new text; possible key starts at the end are held; text is shown after 200 units with no sentence end; the gate is flushed only at the end of an attempt.
Why: checking all shown text each sentence cost 2.4 s on an 8 000-char reply; the window costs 30 ms in total, and no key, number phrase or arithmetic expression can start further back.
Alternatives: check all shown text (too slow); check the sentence alone (misses keys split across sentences).
Reversible: Yes, but only with safety-reviewer sign-off.

### 19 Oct 2026 · 4.5 A post guard's escalate ends the turn as an escalation · decided by lead (revision 13) and tdd-guide (runner path) · risk: high
Decided: postGuard returns `escalate` with the alert and the chain's text; the runner sends `replace ''`, then runs its existing escalate path (caring template from the escalate step, alert raised, outcome escalated). The chain's text stays on the step result only; it is never shown or stored.
Why: the 4.1 safety review: save the escalate text but always reply with the caring template. No post guard escalates yet; this is the wiring for 4.8/4.9.
Alternatives: store the chain's text on the CommitRecord (a new field nobody reads yet).
Reversible: Yes.

### 19 Oct 2026 · 4.5 postGuard owns the reply text for guard verdicts; the runner keeps its fallback for crashes · decided by tdd-guide (plan question) · risk: medium
Decided: the step returns the hint when answerLeak was involved in a block or failure, else `fallbackReplies.safeReply`; the runner's own safe reply is used only when the step throws, times out or returns something malformed. The runner sends `replace ''` before every postGuard replacement, so skill events and sources clear too (revision 12).
Why: one owner per case; a chain failure is reported (`PostGuardFailed`, guard name and cause only) instead of hidden behind a throw.
Alternatives: always throw on a non-ok chain and let the runner pick the text.
Reversible: Yes.

### 19 Oct 2026 · 4.5 Arithmetic uses a small built-in evaluator, not mathjs · decided by tdd-guide · risk: medium
Decided: `print(8*2)` and `f"{5+3}"` are evaluated by a hand-written parser (numbers, `+ - * / // % ** × ÷`, parentheses; at most 64 units, 31 tokens, depth 8).
Why: mathjs is not yet a dependency, and its `evaluate` over model text is a larger attack surface than a parser that can only add and multiply literals.
Alternatives: add mathjs and walk only its number and operator nodes.
Reversible: Yes.

### 19 Oct 2026 · 4.5 How keys match: whole numbers, word-bounded text, answer context for one digit · decided by lead (revision 6) and tdd-guide (details) · risk: medium
Decided: a key that is one number (digits, literal or number words) matches only as a whole number in any form; text keys match at word boundaries after folding (spaces and commas ignored), so `if marks >= 80:` does not match inside `elif marks >= 80:`. A one-digit key's digits count anywhere, but its words and arithmetic only in an answer context (an answer word up to three words before or right after, or the number alone in its sentence); inside decoded base64, its digits need that context too.
Why: ordinary lesson text ("one step", "teen lines hain", "1 + 2") must pass; decoded noise ("j{0z") can hold stray digits.
Alternatives: substring matching (false positives on 160, 2016 and `elif`).
Reversible: Yes, but only with safety-reviewer sign-off.

### 19 Oct 2026 · 4.5 Base64 skips plain words and decodes only printable UTF-8 · decided by tdd-guide · risk: medium
Decided: runs of 4+ base64/base64url characters (padded or not) are decoded once; lower-case or Capitalised words (also hyphenated) are skipped; only strict, printable UTF-8 is kept. Hex and reversed digits are not decoded (LOW extras, left out).
Why: "together" decoded to printable noise containing a digit and tripped a one-digit key in the hint itself.
Alternatives: require 8+ characters (misses `MTY=`).
Reversible: Yes.

### 19 Oct 2026 · 4.5 The rewrite is one small-tier call with a fixed instruction and no key · decided by lead (revision 11) and tdd-guide (shape) · risk: medium
Decided: the rewrite sends the draft with a fixed English instruction (`REWRITE_SYSTEM`) on the small tier, at most 400 output tokens and 60% of the guard's time slice, after the turn's cost check. A failure, a tool call or a leaking result gives the hint.
Why: the draft already holds the answer, so the key adds nothing; the matcher re-checks whatever comes back.
Alternatives: send the key list so the model knows what to remove.
Reversible: Yes.

### 19 Oct 2026 · 4.5 Post-guard time slices: (2 s − 200 ms) / (2 × guards) · decided by lead (revision 14) and tdd-guide (margin) · risk: low
Decided: each post guard's slice is 900 ms with one guard and 150 ms with six; a six-guard chain that rewrites and uses almost every slice ends at 1 788 ms.
Why: both passes of every guard fit inside the step's 2 s with a margin.
Alternatives: an overall chain deadline.
Reversible: Yes.

### 19 Oct 2026 · 4.5 Constraints for 5.6 (answer keys) · decided by lead (revision 6) and tdd-guide (the exception) · risk: medium
Decided: no answer key may match its problem statement; each answer may have several keys (one per canonical phrasing, e.g. `n >= 1 and n <= 10` and `1 <= n <= 10`). Exception found: for "what does this print" items the printed output is in the question (co-q2's only key, `Warm`), so 5.6 must decide how to handle those (for example, count them only in an answer context).
Why: a key in the problem statement makes the guard trip when the tutor quotes the problem.
Alternatives: none chosen for the exception; it is left to 5.6.
Reversible: Yes.

### 19 Oct 2026 · 4.5 The stream is read to the end after a trip · decided by tdd-guide · risk: low
Decided: after the gate trips, the attempt keeps reading the model stream (showing nothing) until it ends.
Why: usage arrives at the end of the stream; stopping early would lose metering.
Alternatives: close the stream on a trip (faster hint, unmetered spend).
Reversible: Yes.
