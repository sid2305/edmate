# Task 4.7 plan — `grounding` post-guard

Branch: `m4/4.7-grounding`. Board deps: 3.1, 3.12, 4.0, 4.1 (all done). Board: `risk: risky`.
**Sequencing note:** 4.6 (`m4/4.6-locked-leak`) is running and changes `GUARD_ORDER.post` to
`[lockedLeak, answerLeak, grounding, adviceGuard, personaBoundary, tone]` and adds async seams
(`PostGuardCtx.lockedCheck`) that this guard sits next to. Cut this branch from `main` only after
4.6 merges (same sequencing 4.6 used after 4.5), so `order.ts` and `postGuards.ts` already show
`grounding`'s declared slot and the async rewrite idiom is in place.

## Accept (verbatim)

> seeded grounding cases pass; ≥ 95% of uncovered questions go to `ask_teacher`, none answered
> from general knowledge.

**How it will be shown:** a new offline fixture gate,
`packages/evals/src/__tests__/groundingFixtures.test.ts` (mirrors 4.5's `leakFixtures.test.ts` and
4.6's `lockedFixtures.test.ts`), drives the 32 cases in `evals/suites/grounding/*.yaml` through the
real pipeline (`runTurn`) with a per-case `ScriptedGateway` reply engineered to reproduce the
failure the case is testing (a false premise affirmed, a wrong recomputed number, a hallucinated
answer to a genuinely uncovered topic), asserting the case's `must_not_contain` / `must_contain` /
`must_cite_source` pass against what the student actually sees. Two mutation runs (grounding
stubbed to always return `ok`; its judge call stubbed to always say "grounded") must each fail
every case whose only protection is this guard, proving the rules layer and the judge layer are
each doing real work, not one vacuously covering for the other. Package-level
`turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/contracts... --filter=@edmate/evals...`
also passes.

**Open question Q1 (same shape as 4.5/4.6's Q1): does "cases pass" include the `judge:` rubric
lines?** Recommendation: no — rule 4 bars real model calls in tests; the fixture gate scores
`must_not_contain`/`must_contain`/`must_cite_source` directly against the scripted reply. The
`judge:` lines describe the live-model quality bar proven at the harness exit gate (M4-M7 GATE),
not this offline test. Not blocking: proceed on this reading, flag it in the handoff like 4.5/4.6
did.

**Important distinction to state in the guard's file comment:** the grounding guard's own
small-tier model call (production, via `env.gateway`, in-pipeline, scripted in tests like
`answerLeak`'s `rewrite`) is a different thing from the eval suite's `judge:` lines (3.12's eval
runner grades the finished transcript afterwards, with recorded/pinned judge outputs). The fixture
gate here only exercises the former.

## Design: three rule layers, one judge layer, two actions

Unlike `lockedLeak` (code-only) and `answerLeak`'s MVP cut (judge deferred to 4.5b), grounding's
accept bar — "none answered from general knowledge" at the exit gate, with live models — cannot be
met by rules alone: a citation-index check and a number recompute catch specific, mechanical
failures, but not a model asserting an unsupported fact about material that *was* retrieved (the
`falsepremise-classes` case: the `lists-dicts` module was relevantly retrieved, but the claim about
classes is not in it). So, unlike 4.5's deferral, this task ships the judge now; flagged as the
reason 4.7 is a larger build than 4.5/4.6 and should get the same opus-tier build tier.

**Rule A — no-coverage backstop (cheap, no model call).** If `ctx.retrieved` has no chunk for the
entitled modules scoring above the same coverage threshold `decide` (3.5, already merged) uses to
pick `ask_teacher`, and the reply is not already the fixed ask_teacher text (below), force the
ask_teacher fallback. This is the main backstop for wholly uncovered topics (`recursion`, `bigo`)
answered anyway despite `decide` already having a coverage signal, and needs no model call.

**Rule B — citation validity (cheap; closes the 3.7-deferred item).** Every `[n]` marker in the
reply must resolve to a real entry in `ctx.retrieved` (by chunk id, 1-indexed in retrieval order —
**to confirm against `pedagogy/compose.ts`'s actual citation-numbering scheme during TDD step 1**,
not assumed here). An out-of-range or fabricated index is itself a violation → ask_teacher fallback
(a citation to nothing is worse than none, so no attempt to guess the "real" source).

**Rule C — numbers recomputed (cheap, reuses 4.5's shared matcher).** Extend
`pipeline/generate/numbers.ts` with a small exported helper (reusing `arithmeticSpans`,
`numberMentions`'s existing `answerContext` window logic, and `canonicalNumber` — one algorithm,
not two, same philosophy as 4.5/4.6) that finds, in the reply, an arithmetic expression together
with a nearby claimed result (the `grounding-falsepremise-wrongnumber-*` cases: "7 // 2 is 4"), and
flags it when the claimed value ≠ the recomputed one. Action: a **mechanical, surgical rewrite**
replacing only the false numeric span with the canonical computed value — deterministic, so it is
trivially idempotent (recomputing the corrected text recomputes to itself) and unlike
`lockedLeak`'s span never risks re-introducing withheld content.

**Rule D — small-tier judge (only when A/B/C found nothing and the move isn't already
`locked`/`ask_teacher`).** One bounded call, same idiom as `answerLeak`'s `rewrite` closure: given
the reply and the retrieved + teacher-note chunks actually supplied to `decide`, a fixed-rubric
prompt returns a strict classification (grounded / not grounded) of whether every substantive claim
is supported. **Fail closed**: a timeout, error or unparsable response counts as "not grounded"
(same posture ADR-0007 took for `lockedLeak`'s port call). On "not grounded" → ask_teacher
fallback, **never** a creative rewrite (a judge-authored "corrected" rewrite would need a second
judge pass to re-verify and could itself invent content — the fixed fallback avoids both problems
and is idempotent by construction, same trick as `ANSWER_LEAK_SAFE_HINT`).

**The ask_teacher fallback text.** Recommend reusing the exact fixed wording `decide`'s real
`ask_teacher` move already composes (the "That isn't covered in `<teacher>`'s material yet..."
line from the build plan's "Ask the teacher" section) rather than a second hand-written string, so
the two paths can never say something different — **to confirm during TDD step 1** whether that
text is already an exported, callable formatter (likely in `pedagogy/compose.ts` or
`pipeline/pedagogy/policy.ts`'s `fallbackPolicy`); if not, a small extraction refactor exposes it.
This text, by construction, holds no citation and no bare answer-context number, so Rule A/B/C never
re-trip on it (idempotence) — the same guard recognises its own output and treats it as `ok`.

## The one real plumbing question: signalling "open a TeacherQuestion" from a post-guard

`commit` (step 11, already built: 3.7 moved the `ask_teacher` → `TeacherQuestion` creation there)
currently acts on `decision.move === 'ask_teacher'`. Grounding's fallback needs the same thing to
happen even though `decide` (step 7) picked a normal teaching move. **Recommended design (no
contracts change):** add `escalateToTeacher?: boolean` to the harness-internal `PostGuardResult`
(`pipeline/types.ts`); `postGuard.ts` sets it when the chain's rewritten/replaced text equals the
exported ask_teacher fallback constant; `runner.ts`/`commit.ts` (not read this round — **confirm
the exact call site during TDD**, given 3.7/3.17 already built the `ask_teacher` → `TeacherQuestion`
path) open a `TeacherQuestion` and emit the `teacher_question` SSE event (already exists, 3.7)
whenever either `decision.move === 'ask_teacher'` **or** `escalateToTeacher` is true — reusing the
existing creation call, not a new one. No `packages/contracts` change: `TeacherQuestion` itself is
untouched; only harness-internal step plumbing changes. This is the task's one open design
question, same shape as 4.6's central question but harness-internal rather than a contracts/ADR
matter — flagged, not blocking, since the direction is specific enough to start.

## Files to create

- `packages/harness/src/guardrails/grounding.ts` — `createGroundingGuard()` (Rules A, B, D; calls
  into numbers.ts for C), the fixed fallback-detection, `GuardRun` shaping (`action: 'rewrite'`
  throughout — no new `Guard` action kind planned; confirm against `guard.ts`'s existing union
  during TDD before assuming this is sufficient).
- `packages/harness/src/guardrails/grounding.test.ts` — unit tests per rule, idempotence, judge
  absent/timeout → fail closed to ask_teacher.
- `packages/harness/src/guardrails/citations.ts` — pure `invalidCitations(text, retrieved)` (Rule
  B), unit-tested alone.
- `packages/evals/src/__tests__/groundingFixtures.test.ts` — the 32-case gate plus the two mutation
  runs.

## Files to modify

- `packages/harness/src/pipeline/generate/numbers.ts` — add the claimed-vs-computed mismatch
  helper (Rule C); explicitly in scope per the task's read list.
- `packages/harness/src/guardrails/postGuards.ts` — `.register(createGroundingGuard())` in the
  position after `answerLeak`.
- `packages/harness/src/guardrails/order.ts` — confirm `grounding`'s declared slot (should already
  exist post-4.6; add the line only if 4.6 did not).
- `packages/harness/src/pipeline/steps/postGuard.ts` — build the judge closure (bounded slice, same
  share-of-slice idiom as `rewriter()`/`REWRITE_SHARE`); set `escalateToTeacher`; pass `ctx.retrieved`
  through to the guard (already available via `PostGuardCtx.ctx`, no new field expected for this
  part).
- `packages/harness/src/pipeline/types.ts` — add `escalateToTeacher?: boolean` to `PostGuardResult`.
- `packages/harness/src/pipeline/steps/runner.ts` / `commit.ts` (exact site TBD, not read this
  round) — open a `TeacherQuestion` and emit `teacher_question` on `escalateToTeacher`, reusing the
  existing `ask_teacher` call site.
- `packages/harness/src/pedagogy/compose.ts` or `pipeline/pedagogy/policy.ts` — only if the
  ask_teacher fallback text needs extracting into a shared exported formatter (see above).

## Tests first (TDD order)

1. `numbers.ts` extension — claimed-vs-computed mismatch detection (unit).
2. `citations.ts` — in-range / out-of-range citation detection (unit).
3. `grounding.test.ts` — all four rules; idempotence on both fallback shapes; judge
   absent/timeout/bad-response → fail closed.
4. `postGuard.test.ts` (extend) — `grounding` registered and ordered correctly; `escalateToTeacher`
   set on the ask_teacher fallback path; the chain's existing verification pass re-runs `grounding`
   on the replaced text and returns `ok` (4.1 safety-review requirement: every rewriting guard must
   pass on its own output).
5. `commit.test.ts` / `runner.test.ts` (extend) — `escalateToTeacher` opens exactly one
   `TeacherQuestion`, matching the existing `ask_teacher`-move path's behaviour and dedup.
6. `packages/evals/.../groundingFixtures.test.ts` — the 32-case gate and mutation runs, last.

## Latency

Rules A/B/C are pure JS (sub-millisecond, like 4.5). Rule D's judge call only fires when rules find
nothing, keeping it off the common path. It shares the existing `postGuardSliceMs` budget the same
way `answerLeak`'s rewrite and (per 4.6) `lockedLeak`'s port call do — fits inside the 2 s post
budget shared by up to 6 guards and a verification pass by construction (each guard's slice is the
budget divided by `2 × count`). Because a single turn could now stack three model/port calls in one
pass (`lockedLeak`'s port call, `answerLeak`'s rewrite, `grounding`'s judge), add an explicit
integration test simulating all three firing in the same turn and asserting total elapsed time
stays under the budget minus margin — the same discipline 4.4b applied to pre-guards.

## Idempotence

Covered per-rule above: the numeric rewrite is deterministic (recomputes to itself); the
ask_teacher fallback is a fixed string with no citation and no answer-context number, so every rule
recognises it as clean on a second pass. Both need a direct `grounding.test.ts` proof (run twice)
and a `postGuard.test.ts` proof that the chain's verification pass doesn't re-trip.

## Out of bounds

- `evals/suites/grounding/**` stays read-only (32 existing, human-reviewed fixtures from
  4.0/4.0d) unless a genuine coverage gap turns up — flag to the lead rather than inventing cases.
- No 5.10 work (teacher studio answer flow, `CorrectionStore`) — this task only triggers the
  existing `TeacherQuestion`-opening mechanism, already built for `ask_teacher` moves.
- No 4.5b (answerLeak paraphrase judge), no 4.8 (`adviceGuard`), no 4.9 (`personaBoundary`/`tone`).
- No new `packages/contracts` port expected (unlike 4.6) — conditional, see Decisions below.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/guardrails/**` (new `grounding.ts`, `citations.ts`, tests; edited
  `postGuards.ts`, `order.ts`) — **reviewers: safety-reviewer** (required by the gate). Recommend
  also security-reviewer and typescript-reviewer, matching the 4.5/4.6 roster.
- `packages/harness/src/pipeline/**` (`postGuard.ts`, `types.ts`, `runner.ts`/`commit.ts`,
  `numbers.ts`) — **None (checked against risk-paths.txt): no glob matches**; still recommend
  safety-reviewer sees this diff given it carries the teacher-question escalation signal, but it is
  not gate-required.
- `evals/suites/grounding/**` — not edited (read-only); if a gap forces an edit, treat as the
  safety-reviewer group (same posture as `evals/suites/locked/**`).
- `packages/contracts/**`, `docs/adr/**` — **none planned.** Conditional: if TDD step 1 shows the
  citation-numbering check genuinely needs a new `TurnContext`/`DecideResult` field rather than
  reading `ctx.retrieved` directly, that becomes a contracts change requiring an ADR and a second
  `risk: high` decision (architect, security-reviewer, typescript-reviewer) — flag to the lead
  before building it, do not add it unilaterally.

**`risk: high` decisions to log at handoff:**
1. The board's `risk: risky` entry itself: "4.7 merged: `grounding` post-guard wired (coverage
   backstop, citation validity, number recompute, small-tier judge fallback); ungrounded or
   wrongly-numbered claims are rewritten or routed to `ask_teacher`; reviewed by safety-reviewer[,
   security-reviewer, typescript-reviewer]."
2. Conditional, only if citation plumbing needs a contracts field: the ADR itself (architect,
   security-reviewer, typescript-reviewer).

## Open questions (non-blocking; recommendations given)

- **Q1** — does "cases pass" include the `judge:` rubric? Recommendation: no, see above.
- **Q2** — citation numbering scheme (`[n]` → which `ctx.retrieved` entry): confirm against
  `pedagogy/compose.ts` in TDD step 1; recommendation above (1-indexed retrieval order) is a
  starting assumption, not fixed.
- **Q3** — exact `Guard`/`guard.ts` action union and whether `action: 'rewrite'` is enough to carry
  both the surgical number fix and the whole-reply ask_teacher fallback, or whether a new action
  kind is cleaner: recommendation is to reuse `'rewrite'` for both (keeps `guard.ts` untouched,
  matches 4.6's "minimise the diff" precedent) and have `postGuard.ts` detect the fallback text by
  equality; confirm once `guard.ts`/`chain.ts` are read in the build.
- **Q4** — whether the ask_teacher fallback text should be extracted from an existing formatter or
  is net-new: confirm against `pedagogy/compose.ts` / `pipeline/pedagogy/policy.ts`'s
  `fallbackPolicy` in TDD step 1.

None of Q2-Q4 is a product decision or an unclear spec — they are code-shape facts the build phase
settles by reading files outside this plan's read list (`guard.ts`, `chain.ts`, `runner.ts`,
`commit.ts`, `compose.ts`, `policy.ts`), same posture the task brief's "Read ONLY" scope implies.

## Status

**READY.** The design is specific enough to start (three cheap rules, one fail-closed judge, one
plumbing signal for `ask_teacher`), no contracts change is expected, and the open questions are
build-time code-shape confirmations, not decisions needing the human.

## Lead answers and plan revisions from the safety plan review (19 Oct 2026; these override the plan)

1. **Latency (HIGH; lead decision, risk: medium).** Post-guard slices are weighted. A guard that makes a model or port call (lockedLeak, answerLeak's rewrite, grounding's judge) gets a larger share of the 2 s post budget than a rules-only guard. Implement it as a per-guard `weight` in the post registry, with the slice computed from the remaining budget. The judge's timeout is a configurable constant (default 600 ms). The three-calls integration test uses realistic scripted delays (300–600 ms) and must finish inside the step. Final numbers are tuned with live latency in 7.x, together with 4.4b.
2. **The judge runs on ask_teacher replies too (HIGH).** Those replies are model-written. Add a new fixed `ask_teacher` fallback text to the fallback replies (English, pilot).
3. **Fixed texts are always ok (HIGH).** grounding returns ok with NO judge call on its own fallback, 4.6's locked-move reply, ANSWER_LEAK_SAFE_HINT, the safe reply and the distress template. Test each.
4. **Rule C never writes a key (HIGH).** Check the corrected value with `compileAnswerKeys(decision.mustNotReveal, own)` before rewriting. On a hit, use the hint, never the correction. Test that the verification pass ends in the hint and never shows the key.
5. **False premises (HIGH).** The judge gets the SCRUBBED student message, and Rule C also checks claims in the student's text. When the wrong premise came from the student, replace the WHOLE reply (a gentle correction prompt or the ask_teacher fallback), never a one-number surgical fix.
6. **Judge injection (HIGH).** The reply and chunks go in delimited data blocks. Accept only strict JSON `{ "grounded": boolean }` parsed with zod; anything else means not grounded. Test injection in the reply and in a chunk. Assert that the judge prompt holds only entitled chunks from ctx.retrieved, no mustNotReveal, no student name, and only the scrubbed student text.
7. **Non-circular fixtures (HIGH).** Use a fake judge whose verdict follows from its input: grounded only if every claim sentence overlaps a supplied chunk or the student's text. Assert that each case's UNGUARDED reply fails (or, for the 12 cases without must_not_contain, that it escalates or opens no TeacherQuestion). Two mutation runs. The ≥ 95% bar is shown live at the exit gate (7.x); say so in the handoff.
8. **Plumbing (MEDIUM).** `escalateToTeacher` comes from a fixed reason code (`ungrounded`) in the guard trace, never from comparing text. The TeacherQuestion body is the scrubbed student message only, opened through 3.17's idempotent open by turn id (one question per turn). Cap repeated asks per student per session (default 3; then the fallback text only).
9. **Rule C pairing (MEDIUM).** Rewrite only when the claim directly follows the expression ("expr is/=/== N"); otherwise leave it to the judge. Table tests: -7 // 2, 2 ** 3 ** 2, 7 / 2 = 3.5, 0.1 + 0.2.
10. **Citations (MEDIUM).** Reuse pipeline/generate/citations.ts (the CITATION regex and the composer's [n] → sources numbering). No new citations.ts.
11. **Over-triggering (MEDIUM).** The judge rubric exempts encouragement, questions back to the student, restating the student's own code or message, and the fixed texts. All 20 covered cases pass unchanged with zero TeacherQuestions.
12. **Rule A (MEDIUM).** Note in the plan that it's close to redundant with coverageGate, and that the judge is the real defence for related-but-uncovered topics.
13. **On-screen exposure (MEDIUM; lead decision, risk: medium).** Hold the stream (no streaming, release after postGuard) when decision.move is ask_teacher or coverage is within 0.1 of the threshold.

- **Build:** tdd-guide on opus, AFTER 4.6 merges, branching from that main.
- **Reviewers:** safety-reviewer (opus), security-reviewer, typescript-reviewer, silent-failure-hunter. risk: high.
