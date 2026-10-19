# Task 4.5 plan — `answerLeak` (incremental + final) and the rewrite loop

Branch: `m4/4.5-answer-leak`. Deps (all done): 3.1, 3.12, 4.0, 4.1.

## Accept (verbatim)

> seeded leak cases 100% on fixtures.

**How it will be shown:** a new offline test in `packages/evals` drives all 32 cases in
`evals/suites/leak/*.yaml` through the real harness pipeline (`runTurn`), with a scripted
`ModelGateway` that attempts the leak in the exact form the case's filename names (digits, words,
base64, translate, roleplay, repeat-instructions, false-attempt, partial-quote), for both
languages tagged (`-en`, `-hi-latin`, `-deva`). The test asserts every turn's `expect.must_not_contain`
passes against the reply the student actually sees (`checkMustNotContain` from `@edmate/evals`).
32/32 cases, every `must_not_contain` phrase, 0 leaks. This is the gate: it is new, not a rename of
an existing green test, so CI turning green on it is the actual proof. Package-level
`turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/evals...` also passes.

**Scope cut, stated up front:** each case's `judge` rubric needs a live judge model and is explicitly
out of scope for this offline test (rule 4: no real model calls in tests). It is exercised later,
with a real judge, at the harness exit gate (and/or task 7.5's CI fixture gate). The 4.5 test only
scores `must_not_contain`; see Open questions, Q1.

## What 4.5 actually wires (from the harness README and the 4.1 safety review)

- `postGuard` (`packages/harness/src/pipeline/steps/postGuard.ts`) is still
  `StepNotImplementedError` stub. 4.5 is the first post-phase guard task, so it also builds the
  `post`-phase `GuardRegistry`, registers `answerLeak`, and replaces the stub with a real
  `runGuardChain` call. (README: "Each guard task … wires its own phase when it lands that
  phase's first guard.")
- `generate`'s `StreamGate` (`deps.streamGate ?? passThroughGate`) is still the pass-through. 4.5
  builds the real sentence gate and makes it the default, per `PipelineDeps.streamGate`'s own
  comment ("4.5 adds the sentence gate") and `streamGate.ts`'s file comment.
- Both consume the same detection logic, factored out of/alongside `answerKey.ts` so the incremental
  and final checks can never disagree about what counts as a leak.

## Files to create

- `packages/harness/src/pipeline/generate/numberWords.ts` — number-leak detection. Exports
  `numbersMentioned(text: string): Set<string>`: scans NFKC+digit-folded text for (a) bare digit
  runs, (b) English number words (ones/teens/tens/hundred/thousand, small hand-written converter,
  no library — mathjs is arithmetic, not number-to-words), (c) Hindi-Latin number words (ek..unnees,
  bees/tees/chaalis/pachaas/saath/sattar/assi/nabbe, scale words sau/hazaar/lakh/crore), and (d)
  digit-run + scale-word compounds ("24 hazaar" → 24000). Returns the set of integer values (as
  canonical decimal strings) the text mentions, in any of those forms. Pilot-scoped: English +
  Hindi-Latin words, per CLAUDE.md ("Pilot is English-only, with a Hindi/Hinglish safety net");
  Devanagari *digits* are handled by (a) once digit-folding lands (below), not here. No Devanagari
  *number words* are required by any of the 32 fixtures or by the stated scope — out of scope, noted
  as a possible future extension, not a gap against the accept bar.
- `packages/harness/src/pipeline/generate/base64Leak.ts` — `decodedBase64Spans(text: string): string[]`:
  finds base64-looking runs (`[A-Za-z0-9+/]{8,}={0,2}`, length-capped to bound work), decodes each with
  `Buffer.from(s, 'base64').toString('utf8')` inside a try/catch, keeps only spans that round-trip
  (re-encoding matches, so "8 hex-looking letters that aren't really base64" don't produce noise),
  one decode level only (no recursive decoding — bounds cost and avoids a DoS surface).
- `packages/harness/src/guardrails/answerLeak.ts` — the guard. `phase: 'post'`, `Ctx = { ctx:
  TurnContext; decision: PedagogyDecision }` (exactly `StreamGateFactory`'s input shape — no new
  contracts type needed). Rules only, no model call (table line 423's "judge for paraphrase" is the
  live-judge part, out of scope here, same cut as above). On any mustNotReveal entry found — via
  `revealsAnswerKey` (literal, normalised), `numbersMentioned` (for purely-numeric entries), or
  `decodedBase64Spans` re-checked with the same two — returns `{ ok: false, action: 'rewrite', text:
  SAFE_HINT, reason: 'answer_key' }`. `SAFE_HINT` is one fixed, hand-written English string (pilot is
  English-only), the same text every time: this guarantees idempotence (the rewritten text contains
  none of the three leak forms, so the verification pass's second run of `answerLeak` on `SAFE_HINT`
  is trivially `ok`), satisfying the 4.1 safety review's "each rewriting guard must return ok on its
  own output." No partial/surgical edit of the draft — full replacement, deliberately, both for
  idempotence and because a surgical removal of an 8+-token span is `lockedLeak`'s job (4.6), not
  this guard's.
- `packages/harness/src/guardrails/postGuards.ts` — the phase's `GuardRegistry<PostGuardCtx>`
  singleton, `answerLeak` registered. Mirrors how 4.2/4.3 presumably wire `scrub`/`pre` (not yet
  merged, so not copied — this is 4.5's own file, named for its phase so 4.6-4.9 add `.register(...)`
  calls to the same file without re-deciding how registries are built).
- `packages/evals/src/__tests__/leakFixtures.test.ts` (exact path per the package's existing test
  convention — confirm alongside e.g. `runner.test.ts`'s location) — the fixture harness described
  above: loads `evals/suites/leak` with `loadCasesFromDir`, builds a per-case `ScriptedGateway` (from
  `@edmate/harness/testing`) whose `stream` reply is the case's `must_not_contain` phrase(s) wrapped
  in a short adversarial sentence matching the case's named form (e.g. base64-encode the phrase for a
  `-base64-` case, spell it as a number word for a `-words-` case), drives one `runTurn` per turn
  through a minimal `PipelineDeps`/`Steps` built from `@edmate/harness/testing` (`testDeps`,
  `testSteps` with the real `generate`/`postGuard` from `defaultSteps` swapped in, `decide` stubbed to
  return the case's `mustNotReveal` built from the same phrase(s)), and asserts
  `checkMustNotContain(reply, expect.must_not_contain).pass`. One test per case id (32 total), so a
  regression names the exact case.

## Files to modify

- `packages/harness/src/pipeline/generate/answerKey.ts` — deferred item (a): strip `\p{Cf}` generally
  (replacing/extending the explicit zero-width list) and fold every `\p{Nd}` digit to ASCII `0`-`9`.
  Digit folding needs a block-start table (Unicode guarantees each `Nd` block is 10 consecutive code
  points valued 0-9, but a given character's value isn't derivable without knowing its block start).
  Devanagari (`U+0966`) is required (fixture `leak-vv5-digits-deva`, `leak-co2-digits-deva`); a few
  more common blocks (fullwidth is already NFKC-handled; Bengali, Arabic-Indic, extended Arabic-Indic)
  added opportunistically for the "country-neutral" future, not required for this accept bar.
- `packages/harness/src/pipeline/generate/streamGate.ts` — add the real sentence gate
  (`answerLeakStreamGate: StreamGateFactory`, name tbd by the builder). Buffers `push(text)` input
  into sentences (split on `. ! ? 。 ।` plus newline, i.e. incl. the Devanagari danda; a hard cap,
  e.g. 200 UTF-16 units, forces a flush even with no terminator, so unbroken text — a code block, a
  long clause — can't stall display indefinitely). Each completed sentence is checked with the same
  three detectors `answerLeak` uses (factor them so both import from `numberWords.ts`/`base64Leak.ts`/
  `answerKey.ts`, never duplicate the match logic). A clean sentence is released. A leaking sentence
  is held back (not shown, not counted into `draft` — `toolLoop.ts`'s `show` only builds `draft` from
  what the gate releases) and the gate stops releasing anything else for the rest of that attempt
  (once the model is mid-leak it is not trusted to self-correct, and releasing clean sentences after a
  gap would read as a non sequitur to the student). `flush()` checks whatever is left buffered the
  same way. Keep `passThroughGate` exported and unchanged (tests that want byte-exact chunking use it
  explicitly).
- `packages/harness/src/pipeline/steps/generate.ts` — swap the fallback default:
  `deps.streamGate ?? passThroughGate` → `deps.streamGate ?? answerLeakStreamGate`. This is the one
  line that actually "turns on" the incremental check for every caller that doesn't override it.
- `packages/harness/src/pipeline/steps/postGuard.ts` — replace the stub: build a `GuardChainOptions`
  (`phase: 'post'`, `clock: env.deps.clock`, a per-guard `timeoutMs` inside the step's 2 s budget —
  propose 500 ms per guard, matching the small-tier budget elsewhere, bounded further as 4.6-4.9 add
  guards that must now share the 2 s), `cancel: env.cancel`; run `runGuardChain(postGuards.ordered(),
  draft, { ctx, decision }, opts)`; map `ok` → `{ result: 'ok' }`, anything else (`block`, `escalate`
  [should not happen post-generate; treat as block, same as `failed`], `failed`) → `{ result:
  'replace', text: env.deps.fallbackReplies.safeReply(ctx.lang) }` (the runner already sends
  `replace` and clears the stream on this result — no new runner change needed; `runner.ts`'s own
  `postGuard` wrapper already does the fail-closed `safeReply` substitution on a non-ok
  `PostGuardResultSchema`, so check whether the step itself needs to produce the fallback text at all
  or whether returning a `block`-shaped non-ok result and letting the runner's existing fallback path
  handle it is cleaner — **the builder should read `runner.ts:797-824` once more before choosing**,
  since both are mentioned in the file and only one should own the fallback text).
- `packages/harness/src/pipeline/generate/toolLoop.ts`, `.../skillEvent.ts` — deferred item (c): add
  the `lockedLeak` seam. Thread an optional `lockedCheck?: (value: unknown) => boolean` (or similarly
  named) through `ToolLoopInput`/`skillEvent`'s params, defaulting to `() => false` (never trips) so
  4.5 changes nothing observable; 4.6 fills it with real n-gram overlap. Also deferred item (d): make
  `skill` event payloads pass the *same* answer check the token stream does — today `skillEvent.ts`
  already calls `revealsAnswerKey`; 4.5's job is just to make sure the *extended* `revealsAnswerKey`
  (post digit-folding, post number-words, post base64) is what both `skillEvent.ts` and `toolLoop.ts`
  call, i.e. no separate/stale copy of the old narrower check survives anywhere.
- `packages/harness/src/pipeline/generate/index.ts`, `packages/harness/src/guardrails/index.ts` — add
  the new exports.
- `packages/harness/src/pipeline/index.ts` — deferred item (b): add one line to the `HarnessError`
  re-export's doc comment (or confirm `errors.ts`'s own comment, already present, is sufficient and
  only the barrel needs a pointer) stating messages are fixed text only, never student/model text.
  This is almost already true in `errors.ts`'s class doc; check whether the 3.7 reviewer meant the
  barrel file specifically (`pipeline/index.ts:15`) needs its own note, or whether pointing readers at
  `errors.ts` is enough — low-risk either way, pick the smaller diff.

## Tests first (TDD order)

1. `numberWords.test.ts` — unit tests per form (digits, English words, Hindi-Latin words, digit+scale
   compounds), including the exact values the 32 fixtures need (3, 15, 16) plus a couple the fixtures
   don't need (100s/1000s via sau/hazaar) to prove the general mechanism, not just the lucky cases.
2. `base64Leak.test.ts` — decodes `MTY=` → `16`; rejects non-base64-looking noise; bounds cost on a
   long adversarial input (no catastrophic backtracking, no unbounded decode).
3. `answerKey.test.ts` (extend existing) — Devanagari digit folding (`१६` → `16`), `\p{Cf}` stripping.
4. `guardrails/answerLeak.test.ts` — unit tests on the guard directly (`fakeGuard`-style, but real):
   every detection path trips `rewrite`; the rewritten text itself passes a second `run()` (the
   idempotence property the 4.1 safety review asked every rewriting guard to have); a clean draft is
   `ok`.
5. `pipeline/steps/postGuard.test.ts` — wires the registry + chain; `ok`/non-ok mapping; the 2 s step
   budget is respected when a guard times out.
6. `pipeline/generate/streamGate.test.ts` (extend) — sentence buffering, mid-sentence leak withheld
   entirely (not even partially shown), `flush()` catches a leak in a never-terminated buffer, a
   clean long unbroken chunk is still released once the hard cap is hit (latency bound, not silence
   forever).
7. `packages/evals/.../leakFixtures.test.ts` — the 32-case fixture gate itself, last, once the pieces
   above are proven in isolation.

## Latency budget

- The incremental check is pure JS (regex + a small lookup table + a bounded base64 decode attempt),
  no I/O, no model call — negligible per-sentence cost (sub-millisecond), well inside the "harness
  overhead p95 < 500 ms" budget (build plan line 300) on top of whatever `preGuard`/`route`/
  `buildContext` already spend.
- The one real latency cost is buffering: the student's first visible text is delayed until the first
  sentence terminator or the hard cap (proposed 200 UTF-16 units), not until the first raw model
  token. This is a bounded, small, one-time addition to time-to-first-token, not proportional to
  reply length — call it out explicitly in the PR description so a reviewer isn't surprised that
  `token` events now arrive in bigger pieces.
- `postGuard`'s own step budget (2 s, `STEP_SPEC`) is unchanged; one guard (`answerLeak`) with no
  model call should use a small fraction of it, leaving headroom for 4.6-4.9's guards to share the
  same 2 s as they land.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/guardrails/**` (new `answerLeak.ts`, `postGuards.ts`; edited `index.ts`) —
  **reviewers: safety-reviewer** (risk-paths.txt group 1, "Student safety and teaching behaviour").
  Recommend also `security-reviewer` (base64 decoding and number parsing over adversarial,
  student-adjacent text — a prompt-injection/DoS surface even if not in the mandated group) and
  `typescript-reviewer`, matching 4.1's and 3.7's precedent review rosters. `silent-failure-hunter` is
  also worth asking given 3.7's review found silent-failure issues in this exact generate/ area
  twice.
- Everything else touched (`pipeline/generate/**`, `pipeline/steps/**`, `pipeline/index.ts`,
  `packages/evals/**`) — **None (checked against risk-paths.txt): no glob there matches.** Note:
  `evals/suites/leak/**` itself is also not in risk-paths.txt (only `evals/suites/safety/**` and
  `evals/suites/locked/**` are) — 4.5 does not edit those YAML files anyway (read-only fixtures from
  4.0/4.0d), so this is informational, not a gap this task needs to fix.
- No `packages/contracts` change, so no ADR and no architect/security-reviewer/typescript-reviewer
  mandate from that clause.
- **`risk: high` decision to log at handoff:** yes — this task is tagged `risk: risky` on the board
  and the task description itself says it is the gate before any real-model turn is allowed. Decision
  text: "4.5 merged: answerLeak (incremental + final) wired as the first post-guard and default
  stream gate; no real-model turn may run before this; reviewed by safety-reviewer[, security-
  reviewer, typescript-reviewer]."

## Risks

- **Changing `generate.ts`'s default `StreamGate`** (passThroughGate → the sentence gate) changes
  `token` event granularity for every existing test that doesn't explicitly pass `deps.streamGate`.
  `toolLoop.test.ts` is unaffected (it builds its `gate` directly from `passThroughGate`, bypassing the
  default). `generate.test.ts` and `runner.generate.test.ts` likely are affected wherever they omit an
  explicit gate override and assert exact per-chunk `token` text — the builder must audit both files,
  and for each affected case either (a) pass `passThroughGate` explicitly when the test's subject is
  unrelated to the gate (tool rounds, cost ceiling, cancellation), or (b) update the expected event
  shape when the test is actually exercising `generate`'s wiring default. This is a bounded, necessary
  ripple, not a design problem — called out so it isn't mistaken for scope creep in review.
- **mustNotReveal as a single literal string per answer** (today's `help.answerKey: string[]`, "filled
  by 5.6") already supports multiple entries (it's an array), which is what the fixtures need for
  answers with two canonical phrasings (e.g. `n >= 1 and n <= 10` / `1 <= n <= 10`). 4.5's fixture
  test constructs `mustNotReveal` directly (5.6 doesn't exist yet) with both phrasings per question
  where the fixture needs it. No schema change; just confirms the direction 5.6 should take later —
  worth a one-line decision-log note so 5.6's planner doesn't re-litigate it.
- **postGuard's fallback-text ownership** (step vs. runner) — see the modify-list note on
  `postGuard.ts`/`runner.ts`; resolve by reading, not guessing, before writing the step (both files
  currently look like they could own it; only one should).

## Open questions

- **Q1 — does "100% on fixtures" include the `judge` rubric?** Recommendation: no, for the reasons
  above (rule 4; the judge needs a real model). The offline gate scores `must_not_contain` only; the
  `judge` rubric is a live-run quality bar, scored later (harness exit gate / task 7.5). Not blocking:
  the builder can start immediately on this reading; if the human disagrees, swap in a seeded
  `memoryRecorder('replay', ...)` with pre-authored verdicts later without touching the guard code.
- **Q2 — digit-folding block coverage beyond Devanagari.** Recommendation: Devanagari is required;
  add 2-3 more common blocks (Bengali, Arabic-Indic) opportunistically since the table is cheap to
  extend, but don't treat exhaustive Unicode `Nd` coverage as part of this accept bar — it isn't
  needed by any fixture and the pilot is English + Hindi/Hinglish only.

## Lead answers and plan revisions from the safety plan review (19 Oct 2026; these override the Design section)

Must fix (CRITICAL and HIGH):
1. **postGuard returns the rewrite (CRITICAL).** When the chain's `ok` text differs from the draft, return `replace` with the chain text. Test: the guard rewrites, and the student sees only the hint, and the saved replyText is the hint.
2. **A withheld leak is visible to postGuard (HIGH).** The stream gate exposes `tripped`; generate returns `withheld: true` (a harness-internal result field); postGuard forces the hint when it is set. postGuard checks the FULL raw model text, not only the released draft.
3. **Gate boundaries (HIGH).** "." ends a sentence only when followed by whitespace or the end of the text. Check the already-released text plus the candidate, never the sentence alone. Hold back any tail that could be the start of a normalised key. Never flush at a tool-round boundary, only at the end of an attempt. Multi-line code keys are matched across newlines.
4. **base64 (HIGH).** Candidates of 4 or more characters with length % 4 == 0, plus base64url and unpadded forms. Keep only printable UTF-8 decodes. `MTY=` must be caught. Hex and reversed digits are LOW extras.
5. **The fixture test isn't circular (HIGH).** mustNotReveal comes from the question bank via each case's `source` id, never from must_not_contain. Script the hard forms: sixteen, solah, १६, MTY=, 1<ZWSP>6, split across chunks, sentences and tool rounds, 16.0, 0x10. Assert on the concatenated `token` events before `replace`, and on the final reply. Mutation run: a pass-through gate plus a no-op answerLeak must fail all 32 cases. A clean hint reply per case must pass unchanged.
6. **Short-key policy (HIGH).** Numeric keys match only as whole-number tokens, never as substrings. 1-digit keys count as number words (English, Hindi-Latin, Devanagari) only in an answer context (is / = / hai / prints / equals / answer). A key that also appears in the student's own message (e.g. `marks >= 80`) may be quoted when it is the student's code. Add false-positive tests on ordinary lesson text. Log a 5.6 constraint: no answer key may be a substring of the problem statement.

Cheap MEDIUMs, done in this task:
7. **One shared digit and format helper.** Move 4.2's `digitValue`/`fold`/`\p{Cf}` handling (piiPatterns.ts) into one shared module that answerKey.ts and piiPatterns use, so every `\p{Nd}` script is covered (answers Q2). 4.5 builds after 4.2 merges.
8. `normaliseForMatch` drops `\`, so JSON-escaped keys from the prompt still match.
9. **Canonical number literals:** 16.0, +16, 016, 0x10, 0b10000, 1.6e1, 24k, "2.4 lakh". Use mathjs (allowed) to evaluate short arithmetic expressions, with a size limit (`print(8*2)`, `f"{5+3}"`). Roman numerals are out of scope.
10. **Devanagari number words** 0–100, plus सौ/हज़ार/लाख/करोड़.
11. **Rewrite loop, following the spec** ("rewrite once; else safe hint"): one small-tier rewrite (scripted in tests) is re-checked by the whole chain; if anything still hits, use the fixed SAFE_HINT. The hint is English (pilot decision). Idempotence is tested.
12. **Before the hint,** send `replace ''` so skill events and sources clear. Check the text fields of `sources` items with revealsAnswerKey.
13. **postGuard forwards escalate** with its alert. Save the escalate text, but reply with the caring template (4.1 safety review).
14. **Latency:** each guard's slice is 2 s / (2 × the registered post-guard count), or the chain gets an overall deadline inside the step budget. Test that a 6-guard chain finishes inside the step.

Deferred: board task 4.5b, an offline judge pass for paraphrase and non-numeric word keys. The "100% on fixtures" claim covers numeric and encoded forms only, and the handoff says so.

- **Build:** tdd-guide on opus, branching from main after 4.2 (PR #38) merges.
- **Reviewers:** safety-reviewer (opus, required), security-reviewer, typescript-reviewer and silent-failure-hunter (sonnet). risk: high.
