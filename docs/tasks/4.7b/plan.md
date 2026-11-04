# Plan: 4.7b — grounding follow-ups (4.7 reviews)

Board: M13, deps GATE + `4.7` (done). Branch: `m13/4.7b-grounding-followups` (one branch, 4
phases, 4 commits; each phase's builder reads this plan plus the previous phase's handoff).

## Accept (verbatim)
> each item has a unit test; the reversed-premise pending case passes offline; "Yes, 6 - 3 is 3.
> Well done!" after "6 - 3 is 2, right?" gives the correction prompt; two concurrent ungrounded
> turns at groundingAsks 2 open at most one question.

**How it will be shown:** `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`
green after every phase, with `src/guardrails/**` at 100% coverage (vitest's own report, as 4.5/
4.6/4.7 showed in their handoffs). The three concrete behaviours named in the accept line each get
a named test: the premise-correction example (Phase B), the reversed-premise fixture
(`grounding-falsepremise-reversed-en`, already in `evals/suites/grounding` as `reviewed_by:
pending` per 4.7 fix round 1 — Phase A proves it still passes, now via Rule C, not only the judge)
and the two-concurrent-turns race (Phase D).

## Items and where each one lives (read via grep, confirmed against source)

1. **Per-request random judge delimiters + full-width/look-alike fence breaking.**
   `guardrails/grounding.ts`'s `fence()` (lines ~121-125) only breaks runs of 3+ ASCII `<`/`>` and
   reuses the fixed, shared `DATA_OPEN`/`DATA_CLOSE` (`<<<`/`>>>`) every request. A much stronger,
   already-tested `breakFenceRuns` (full-width NFKC fold, HTML entities, zero-width padding,
   idempotent) already exists in `pedagogy/modelRequest.ts` and is unused here. Fix: `fence()`
   calls `breakFenceRuns` instead of its own regex; the judge request also mixes in a per-request
   token from `x.ids.next('groundingFence')` (same deterministic-in-tests id port already used for
   `turnId`/`messageId`), so a retrieved chunk or a student message can never pre-stage the exact
   delimiter text. `ids` is a new optional `PostGuardCtx` field (`guardrails/answerLeak.ts`, same
   place `sources`/`judge`/`askTeacherReply`/`fixedTexts` were added in 4.7), set from
   `env.deps.ids` in `pipeline/steps/postGuard.ts`'s `x: PostGuardCtx` object (~line 493-517,
   alongside `judge`/`askTeacherReply`).
2. **Citation forms that dodge Rule B.** `pipeline/generate/citations.ts`'s `CITATION` regex
   (`/\[(\d{1,3})\]/g`) only matches a tight ASCII `[n]`. `"[ 3 ]"` (inner spaces), `"[３]"`
   (full-width digit U+FF13) and `"source 3"` (no brackets) are not recognised as citations at
   all, so a model can dodge Rule B's validity check by writing one of these forms to an entry
   that doesn't exist. Fix: a second, wider pattern used only inside `invalidCitations` (NOT
   `citedSources`, which must stay exactly the composer's own `[n]` numbering per 3.6/3.7 — widening
   it would mis-count real citation telemetry).
3. **Reversed numeric premise form.** `pipeline/generate/numbers.ts`'s `CLAIM_AFTER` only matches
   a claim value *after* the expression ("7 // 2 is 4"); `"I got 4 for 7 // 2"` (value first) is
   never read as a claim at all, so `arithmeticClaims`/`premiseUncorrected` can't see the wrong
   premise in the student's text. Fix: a sibling `CLAIM_BEFORE` pattern (same connector set,
   mirrored), merged into `arithmeticClaims`'s output. **Scope note:** the fully worded form
   ("seven // two is four") needs `arithmeticSpans` (`pipeline/generate/arithmetic.ts`) to parse
   number words as operands, which it does not (`TOKEN` is digit-only) — a much larger change than
   this task's budget. See Q1.
4. **`canonicalNumber` over 1e15, uncast.** `numbers.ts`'s `wordMentions` (line 343):
   `const value = canonicalNumber(num) as string;` — `canonicalNumber` returns `undefined` above
   `MAX_VALUE` (1e15), and a long spoken-number-word run (`"two thousand thousand thousand..."`)
   can reach it; the `as string` cast lies and pushes `value: undefined` into a `NumberMention`
   typed as `string`. Fix: skip emitting (treat as if `first < 0`) when `canonicalNumber` returns
   `undefined`, no cast. The other three call sites (407, 478, 575) already guard this correctly —
   confirmed by reading each; only line 343 needs the fix.
5. **The concurrent-turn race on `groundingAsks`.** `pipeline/runner.ts` reads `asked` from the
   *loaded* help state at turn start and compares it to `GROUNDING_ASKS_PER_SESSION` at line
   ~655-658, long before the turn's own save; two turns in the same session running concurrently
   both read `asked = 2`, both escalate, both save `3` — the cap (accept line: "at most one
   question" at `groundingAsks` 2) is not enforced across turns. There is no DB-level atomic
   increment available without a new contracts port (an ADR). Fix (recommended, see Q4):
   `runTurn` (line 140) serialises same-session turns in-process — a module-level
   `Map<sessionId, Promise<...>>` that chains each new turn's `turn.run()` onto the prior one for
   that `sessionId`, with the map entry removed once the chain settles (no memory growth across
   many sessions). This covers both the runner's live-open path and commit.ts's fallback-open path
   (both run inside the now-serialised `turn.run()`), with no change to `commit.ts` itself.
6. **The cast in `postGuard.ts`'s `watched()`.** Line 367-385: `(r as { result?: unknown } | null |
   undefined)?.result` casts away `GuardRun`'s own declared `result` type before narrowing with
   `typeof`/`'reason' in`. `GuardRun.result` is already optional and already a union that supports
   direct `'reason' in` narrowing (confirmed against `guard.ts` in-build, per 4.7's own Q3) — the
   cast is redundant and would silently hide a real type error if the field were ever renamed.
   Fix: read `r.result` directly, no `as`.
7. **Rule C re-review: opening praise/agreement must win over a later correct restatement.**
   `guardrails/grounding.ts`'s `premiseUncorrected` (lines 177-189): line 186
   (`if (claims.some((c) => c.correct && c.expr === p.expr)) return false;`) runs **before** the
   `agrees` check, so "Yes, 6 - 3 is 3. Well done!" after "6 - 3 is 2, right?" is read as corrected
   (a correct restatement on the same expression) and the opening "Yes" is never even checked —
   this is the accept line's named example, and it fails on the current code. Fix: check `agrees`
   (and the reply's own wrong claims) **first**; a correct same-expression restatement only clears
   the premise when the reply does not *also* open by agreeing with the student's wrong claim.
8. **Neutral judge-outage text when the locale has no safe reply.** On a judge outage with
   `x.safeReply` undefined, `grounding.ts` falls back to `ANSWER_LEAK_SAFE_HINT` — "Let's work this
   out together rather than jump to the final answer" — which is answerLeak's wording for a
   *different* failure (an answer about to leak) and is a non-sequitur on, say, an `explain` move
   with no answer-leak risk. Fix: a new fixed `GROUNDING_JUDGE_UNAVAILABLE_REPLY` ("I'm having
   trouble checking that against your material right now — let's come back to it in a moment."),
   used only when `x.safeReply` is undefined, added to grounding's own fixed-texts list (so it,
   too, passes with no judge call on the verification pass — 4.7's idempotence rule).

## Phases

### Phase A — `numbers.ts`: reversed premise + the uncast `canonicalNumber` (items 3, 4)
**Files:**
- Modify `packages/harness/src/pipeline/generate/numbers.ts` — `CLAIM_BEFORE`, merged into
  `arithmeticClaims`; the `wordMentions` emit-guard.
- Modify `packages/harness/src/pipeline/generate/numbers.claims.test.ts` (the claims table, same
  file 4.7 fix round 1 used) and `numbers.fixround.test.ts` or `numbers.test.ts` (whichever already
  covers `canonicalNumber`/`wordMentions` — confirm during TDD step 1, don't create a third file).
- No risky-path match (`pipeline/generate/**` is not on `risk-paths.txt`).

**Tests first:**
- Red: `arithmeticClaims("I got 4 for 7 // 2")` returns no claim today (CLAIM_AFTER only matches
  after); green: one claim, `correct: false`, `computedText: '3'`.
- Red: `premiseUncorrected("I got 4 for 7 // 2", "<ask-teacher text>")` is `false` today (no claim
  seen); green: `true` (an uncorrected reversed premise still escalates).
- Offline gate: `evals/suites/grounding/grounding-falsepremise-reversed-en.yaml`'s case, run through
  `groundingFixtures.test.ts` unchanged (no eval-file edit — confirms the existing pending case now
  passes via Rule C too, not only the fake judge; update the handoff table, not the fixture).
- Red: a spoken-number run that pushes past 1e15 (construct via repeated scale words) makes
  `wordMentions` emit `value: undefined` today (typed as `string`, so the bug shows as a runtime
  `undefined` landing in a caller that expects a string — e.g. `JSON.stringify` or a direct
  `.length` read — pick whichever existing caller the test can observe through); green: no
  `NumberMention` emitted for that run.

### Phase B — citations, the cast-free reason read, Rule C's agree-first order, the neutral outage text (items 2, 6, 7, 8)
**Files:**
- Modify `packages/harness/src/pipeline/generate/citations.ts` — a second pattern inside
  `invalidCitations` only (spaced brackets, full-width digit, `"source N"`); `citedSources`
  untouched.
- Modify `packages/harness/src/pipeline/generate/citations.test.ts`.
- Modify `packages/harness/src/pipeline/steps/postGuard.ts` — `watched()`'s cast-free read.
- Modify `packages/harness/src/pipeline/steps/postGuard.test.ts` or `postGuard.grounding.test.ts`
  (whichever already exercises `watched()`/the reason map — one assertion, no new scenario needed
  beyond proving the existing escalation-reason tests still pass with the cast removed).
- Modify `packages/harness/src/guardrails/grounding.ts` — `premiseUncorrected`'s check order;
  `GROUNDING_JUDGE_UNAVAILABLE_REPLY` plus its use in the `judgeUnavailable` branch and the `fixed`
  array.
- Modify `packages/harness/src/guardrails/grounding.test.ts`.
- **Risky path:** `packages/harness/src/guardrails/**` (grounding.ts/.test.ts) matches
  `risk-paths.txt` — **reviewers: code-reviewer** (MVP-first rule; `safety-reviewer` not required
  until task 13.3). `pipeline/**` (citations.ts, postGuard.ts) — no match.

**Tests first:**
- Red: `invalidCitations("see [ 3 ]", 2)` returns `[]` today (not matched); green: `[3]`. Same red/
  green for `"[３]"` and `"source 3"`. Negative control: `"pets[0]"`, fenced code with `[3]` inside
  — still ignored (existing `CODE`/`INDEXED` exemptions apply to the new pattern too).
- Red: an escalation-reason test (reuse one from `postGuard.grounding.test.ts`) still passes with
  the cast removed — this is a refactor, not a behaviour change, so the test proves "no regression"
  rather than red-then-green; note that in the handoff instead of forcing an artificial red state.
- Red: the accept line's own example — `premiseUncorrected("6 - 3 is 2, right?", "Yes, 6 - 3 is 3.
  Well done!")` returns `false` today; green: `true` → the guard's `run()` returns
  `PREMISE_CORRECTION_REPLY`. Also test the symmetric case with no opening agreement and a correct
  same-expression restatement ("6 - 3 is 3, not 2.") still clears the premise (no regression on
  4.7's own passing case).
- Red: a judge outage (timeout) with no `x.safeReply` falls back to `ANSWER_LEAK_SAFE_HINT` today;
  green: `GROUNDING_JUDGE_UNAVAILABLE_REPLY`. Idempotence: the guard returns `ok` on its own
  outage text (added to `fixed`).

### Phase C — per-request random judge delimiters + full-width/look-alike fence breaking (item 1)
**Files:**
- Modify `packages/harness/src/guardrails/grounding.ts` — `fence()` calls `breakFenceRuns`
  (imported from `pedagogy/modelRequest.ts`); `groundingJudgeRequest` mixes a per-request token
  from `x.ids` into the fence markers.
- Modify `packages/harness/src/guardrails/grounding.test.ts`.
- Modify `packages/harness/src/guardrails/answerLeak.ts` — `PostGuardCtx` gains optional `ids`.
- Modify `packages/harness/src/pipeline/steps/postGuard.ts` — `ids: env.deps.ids` in the `x`
  object.
- Modify `packages/harness/src/pipeline/steps/postGuard.grounding.test.ts`.
- **Risky path:** `guardrails/**` — **reviewers: code-reviewer**. `pipeline/**` — no match.

**Tests first:**
- Red: a full-width `＜＜＜` or HTML-entity `&lt;&lt;&lt;` run inside a retrieved chunk or the
  reply is not broken by today's `fence()` (only ASCII `<{3,}`/`>{3,}`); green: `breakFenceRuns`
  breaks it, same as `pedagogy/modelRequest.test.ts` already proves for that function alone — this
  task reuses, not re-tests, that coverage.
- Red: two judge requests built back-to-back from the same guard call (or across two runs with a
  stubbed `ids` returning two different values) produce the exact same fence text today (fixed
  `DATA_OPEN`/`DATA_CLOSE`); green: each request's fence includes `x.ids.next('groundingFence')`'s
  value, so the two differ. With a deterministic test double for `ids` (same pattern as
  `testing/ids.test.ts`), this is reproducible, not flaky.
- Red/green: when `x.ids` is `undefined` (an older caller, or a unit test that builds
  `groundingJudgeRequest` directly without a context), the request still builds with the fixed
  `DATA_OPEN`/`DATA_CLOSE` only — no crash, no silent `undefined` in the output text.

### Phase D — the concurrent-turn race on `groundingAsks` (item 5)
**Files:**
- Modify `packages/harness/src/pipeline/runner.ts` — the per-session queue in `runTurn` (line
  ~140).
- Modify `packages/harness/src/pipeline/runner.grounding.test.ts` (the existing cap tests already
  live here) — or a new `runner.sessionRace.test.ts` if the concurrency-queue tests would otherwise
  make this file hard to read; builder's call, noted either way in the handoff.
- **Risky path:** `pipeline/**` — no match. **4.4c overlap (required answer, see below): no.**

**Tests first:**
- Red: two `runTurn` calls for the same `sessionId`, both loaded with `groundingAsks: 2`, both
  producing an ungrounded reply concurrently (a scripted gateway with a controllable delay so both
  are in flight at once) — today both escalate and both save `groundingAsks: 3`, i.e. two
  `TeacherQuestion`s open. Green: exactly one opens; the other's turn starts only after the first's
  help state is saved, sees `groundingAsks: 3` (already at the cap) and gets the reply only — this
  is the accept line's own example, verbatim.
- A same-session-but-later turn (no concurrency, e.g. `await` the first `finished` before starting
  the second) is unaffected (same behaviour as before: at the cap, the reply only).
- Two turns in **different** sessions, started concurrently, run with no added latency (the queue
  must not serialise across sessions) — a timing assertion (e.g. both start within a few ms of each
  other, not one waiting on the other).
- Many sessions, one turn each, run and complete: the queue's internal map ends empty (no leaked
  entries) — a white-box test against whatever the implementation exposes for this (a size getter,
  or an exported test-only accessor), or a black-box memory-growth proxy if no accessor is added.

## `runner.ts` overlap with 4.4c (required answer)

**4.7b does not need to touch `runner.test.ts`, `guardrails/moderationIn.ts`, or `runner.block.test.ts`** (4.4c's files), and none of 4.7b's 8 items live in 4.4c's edited region. It does share one
file, `packages/harness/src/pipeline/runner.ts`, with 4.4c (Phase D only) — but at a different,
far-apart location: 4.4c's fix is inside `run()`'s step 5 ("Escalate beats block", around line
511); Phase D's fix is at the `runTurn` entry point (line 140), outside the `Turn` class's `run()`
body entirely. A line-level merge conflict is unlikely; a trivial import-line conflict is possible
if both land new imports near the top of the file. **Recommendation:** Phase D's builder rebases
onto the latest `main` immediately before starting (whether or not 4.4c has merged yet) and
re-runs the full gate after — no hard sequencing dependency, no need to wait for 4.4c.

## Files out of bounds
- `evals/suites/grounding/**` stays read-only (same posture as 4.7) — no new or edited fixture
  files; Phase A's reversed-premise case is an existing pending fixture, read not written.
- `packages/harness/src/guardrails/adviceGuard.ts`'s own judge/fence code (4.8) — not touched, even
  though it shares `DATA_OPEN`/`DATA_CLOSE` and a similar judge-request shape; widening its fencing
  the same way is a separate task if wanted.
- `packages/harness/src/pedagogy/**`, `packages/content/**` — `breakFenceRuns` is imported, not
  modified.
- `packages/contracts/**`, `docs/adr/**` — no contracts change in any phase (confirmed per item:
  `ids` reuses the existing `Ids` port already threaded through the harness; no new port, no new
  field in a public contract type).
- `packages/harness/src/pipeline/steps/commit.ts` — Phase D's fix is scoped to not need it (see
  item 5's design note); if TDD proves otherwise, stop and flag to the lead rather than widening
  silently.

## Gate (every phase)
```
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness
```
`src/guardrails/**` at 100% line/branch/function/statement coverage (the existing bar; Phases B and
C touch `grounding.ts` directly and must keep it there). Secret scan (`.githooks/secret-scan.py
--all`) on every phase before handoff, per rule 5.

## Open questions (non-blocking; recommendations given)

- **Q1** — the fully worded premise form ("seven // two is four") needs word-based arithmetic
  parsing in `arithmetic.ts`, well beyond this task's budget. Recommendation: scope Phase A to the
  reversed **numeric** form only (matches the accept line's literal "reversed-premise pending
  case"); leave the worded form to the judge, as 4.7 fix round 1 already decided, and say so again
  in the handoff decisions.
- **Q2** — how wide to make the new citation-variant pattern (just the three given examples, or a
  broader net for e.g. "ref 3", "source #3"). Recommendation: the three literal examples only
  (`"[ n ]"`, full-width digit, `"source N"`, English pilot wording) — a broader net risks false
  positives on ordinary prose; widen later if a real eval case needs it.
- **Q3** — the random judge-delimiter mechanism. Recommendation: `x.ids.next('groundingFence')`
  (the existing deterministic-in-tests `Ids` port), not `crypto.randomUUID()`/`Math.random()` —
  keeps the fixture gate and unit tests deterministic (rule 4).
- **Q4** — the concurrent-turn fix: an in-process per-session queue (Phase D) vs. a DB-level
  atomic increment. Recommendation: the in-process queue — no contracts/port change, no ADR; flag
  in the handoff that this does not cover a multi-process/multi-worker deployment (a residual for
  7.x, same posture as 4.7's own documented residuals), which is acceptable for the pilot's current
  single-process harness test doubles.
- **Q5** — sequencing against 4.4c. Recommendation: no hard dependency; Phase D rebases onto latest
  `main` right before starting (see above).

None of these blocks the work; all are code-shape or scope-sizing choices with a specific
recommendation, same posture as 4.7's own open questions.

## Budget
Budget: 195 tool calls (4 phases, packages/harness only: A 40, B 60, C 50, D 45)

## Allowed tools
Read, Grep, Glob, Edit, Bash (typecheck/lint/test for `@edmate/harness` and the secret scan only)

## Exit conditions
Each phase: `Status: DONE` once that phase's items have red-then-green (or refactor-with-no-
regression, item 6) tests passing, the gate command is green with `src/guardrails/**` at 100%
coverage, and the handoff lists which of this phase's open questions were decided and how.
`Status: PARTIAL` past roughly the phase's own call budget above, or if a phase discovers it needs
a file in "files out of bounds" (stop and report, don't widen silently) — Phase D in particular
stops and reports rather than touching `commit.ts` or any `4.4c` file beyond `runner.ts` itself.
The whole task is `DONE` once all four phases are green on the same branch's final commit and the
three accept-line behaviours (premise-correction example, reversed-premise fixture, two-concurrent-
turns cap) each have a named passing test.

## Status

**READY.** All eight items were traced to a specific, already-read line or function; none needs a
`packages/contracts` change or an ADR; the one file shared with the in-flight `4.4c` (`runner.ts`)
is touched at a different location with no real sequencing dependency. Open questions are scope and
mechanism choices with recommendations, not unclear spec.

## Lead review (4 Nov 2026)
READY. The recommendations are accepted. Notes:
- **Q1.** Fix the reversed numeric premise only. The worded form ("seven // two is four") is left to the judge. The builder logs this as a decision in the handoff.
- **Q2.** Accepted.
- **Q3.** Accepted.
- **Q4 (Phase D), three changes to the plan:**
  - Keep the per-session queue on the runner instance, created with the runner. Do not use module-level state, so tests and runners never share it.
  - Delete a session's entry when its queue drains.
  - A turn that throws or is cancelled must still release the next turn.
  - Note the multi-worker residual (the queue does not cover more than one worker process) in the handoff.
- **Q5, sequencing.**
  - Phases A to C start now. They touch no file that 4.4c or 4.3b touch.
  - Phase D touches `runner.ts`, which 4.4c (PR #417) and 4.3b also change. It starts only after both have merged, from the latest main.
- **Phases.**
  - Each phase is a fresh builder on `m13/4.7b-grounding-followups`, starting from the previous phase's handoff.
  - Each phase appends its own section to the handoff.
- **Review and decisions.**
  - The `guardrails/**` paths get a code-reviewer plus a lead `risk: high` decision on merge.
  - The worded-premise residual and the multi-worker residual go in the handoff decisions. No new board task is needed for them: 4.7's documented residuals already cover the judge path.
