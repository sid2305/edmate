# Task 4.8 plan — `adviceGuard` post-guard (regulated subjects)

Branch: `m4/4.8-advice-guard`. Board deps: 3.1, 3.12, 4.0, 4.1 (all done). Board: `risk: risky`.
**Sequencing note:** cut this branch from `main` only after **both** 4.6 (`m4/4.6-locked-leak`) and
4.7 (`m4/4.7-grounding`) merge. By then `GUARD_ORDER.post` already reads `[lockedLeak, answerLeak,
grounding, adviceGuard, personaBoundary, tone]` with `adviceGuard`'s slot declared, and 4.7's
per-guard `weight` on the post registry (lead revision 1) is already built — reuse it, don't
reinvent it.

## Accept (verbatim)

> seeded advice cases pass.

**How it will be shown:** a new offline fixture gate,
`packages/evals/src/__tests__/adviceFixtures.test.ts` (mirrors 4.5/4.6/4.7's `*Fixtures.test.ts`),
drives all 32 cases in `evals/suites/advice/*.yaml` through `runTurn` with a per-case
`ScriptedGateway` reply engineered from that case's own `must_not_contain` phrases (human-authored
in the fixture, never derived from the guard's own pattern list — see Non-circularity below),
asserting the phrase does not survive in what the student is shown. Two mutation runs (rules
stubbed to always say "clean"; judge stubbed to always say "clean") must each still fail every case
whose only protection is the other layer. Package-level
`turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/contracts... --filter=@edmate/evals...`
also passes.

**Open question Q1 (same shape as 4.5/4.6/4.7's Q1): does "cases pass" include the `judge:` rubric
lines?** No case in `evals/suites/advice/*.yaml` has a `must_contain`/`must_cite_source` line (only
`must_not_contain` + `judge:`). Recommendation: same as 4.5/4.6/4.7 — the offline gate scores
`must_not_contain` only; `judge:` is the live-model quality bar proven at the harness exit gate
(M4-M7 GATE). Not blocking.

## Design: two rule-adjacent layers, deterministic disclaimer, one judge

The build plan's guard table method applies literally here: "cheap rules first, then a small-model
classifier only when rules are inconclusive." Three parts:

**0 — Scope gate (cheap, no model call).** The whole guard is `ok` immediately when
`ctx.agent.regulatedSubject === undefined` (the agent isn't teaching a regulated subject at all —
`AgentConfig.regulatedSubject` already exists, `packages/contracts/src/teacher.ts`), or when `text`
is a recognised fixed/other-guard text (its own fixed fallback below, `ANSWER_LEAK_SAFE_HINT`,
4.6's locked-rewrite text, 4.7's `ask_teacher` fallback, the distress template, the safe reply — 4.1
and 4.7's requirement that every rewriting guard treats fixed texts as clean). No scan runs on these.

**1 — Hard rule: personal-directive patterns (cheap regex, English — the pilot's reply language).**
A second-person imperative/recommendation ("you should/must/could...") within a short window of a
named regulated action, product, dose or guarantee word (invest/buy/sell/stock/fund/crypto; a
medicine or dose pattern like "500mg"/"two tablets"; sue/sign/a legal outcome word), **or** a
first-person professional-identity claim ("I am your financial advisor/lawyer/doctor", "I diagnose
you") — the roleplay-coercion cases (`*-roleplay-*`) all resolve to this second form once the model
grants the persona. A hit here goes straight to the rewrite in step 3.

**2 — Soft rule: decision-signal pre-filter (cheap, gates the judge).** A broader, higher-recall
scan (modal/recommendation words, roleplay-coercion markers "pretend/act as/roleplay as", or any
non-Latin-script run in the reply) decides whether step 2b (the judge) runs at all. A reply with no
signal (ordinary concept teaching, e.g. "here's how compound interest works") is `ok` immediately —
**no judge call, no disclaimer check.** This is what keeps the judge off the common path for
regulated-subject agents (flagged below as the one latency/cost risk worth naming explicitly).

**2b — Judge (bounded small-tier call, same idiom as `grounding`'s Rule D, task 4.7).** Only reached
when step 1 found nothing and step 2 tripped. Delimited data block, strict JSON
`{ "personalAdvice": boolean }` parsed with zod; anything else (timeout, error, unparsable) **fails
closed to `true`** (treat as a violation — the stricter default than grounding's "not grounded",
because a missed regulated-advice violation is the worse failure mode here). Prompt injection tests
mirror 4.7's lead note 6: the judge prompt holds only the reply text in its own fenced block, no
`mustNotReveal`, no student name. This layer is what catches the 12 non-English-script cases
(`*-deva.yaml`, `*-hi-latin.yaml`) that step 1's English regex cannot, and any English phrasing step
1 didn't anticipate.

**3 — Rewrite (bounded small-tier call, fired by step 1 or a "true" from 2b).** Same bounded-rewrite
idiom as `answerLeak`'s `rewrite`: fixed instruction converting personal-directive language into
concept-level teaching, nothing else. The guard re-checks the rewrite against **step 1's own
pattern** (never the judge again) before accepting it; a rewrite that still trips step 1, or an
empty/failed rewrite, falls back to a **fixed, subject-generic concept-redirect reply** (never a
second rewrite, never a second judge call — same posture as `ANSWER_LEAK_SAFE_HINT`).

**4 — Disclaimer (deterministic; always a plain string op, never a model call).** Whenever step 2
tripped (decision-signal present) — whether or not step 1/2b found a violation — and the final text
(post-rewrite, if any) does not already contain the resolved disclaimer **word for word**, append
it. "Resolved" means `ctx.locale.regulatedDisclaimers[subject] ?? genericDisclaimer` — **the exact
same lookup `compose.ts` already does** (`packages/harness/src/pedagogy/compose.ts:184-191`) against
`frame@1.0.0.md`'s `[[DISCLAIMER]]`/`generic-disclaimer` sections, extracted into one pure shared
helper so the system-prompt instruction and the guard's enforcement can never say two different
things. This is why "the locale pack (3.10, not built) or the frame's generic one (3.11 merged)"
already works today: `LocalePack.regulatedDisclaimers` and the frame's generic fallback both exist
now (`packages/contracts/src/locale.ts:30`, `content/prompt-packs/frame@1.0.0.md:21`); 3.10 only adds
*more* per-country entries later, it doesn't gate this guard.

## The one plumbing detail: getting the generic fallback string to the guard

`Guard.run` only sees `(text, ctx, cancel)` — no `env`/`deps`. `postGuard.ts` (the step) already has
`env.deps.promptPacks` and already calls the equivalent of `resolvePromptPackSet` pattern (see
`generate.ts:54`). Recommended: `postGuard.ts` resolves the set once
(`resolvePromptPackSet(env.deps.promptPacks, ctx.agent.promptPackVersion)`, cheap and pure, same call
`generate.ts` makes — redundant but not worth threading through `PedagogyDecision` for this) and adds
`genericDisclaimer: set.frame['generic-disclaimer']` to `PostGuardCtx` (extended in `adviceGuard.ts`,
same pattern 4.6/4.7 use to add their own fields). No `packages/contracts` change — `PostGuardCtx` is
harness-internal.

## Non-circularity (fixture gate)

Each case's engineered "bad" reply is authored from its own `must_not_contain` list (already
human-reviewed, 4.0), not generated by the guard's pattern list. The scripted test judge (step 2b in
tests) is a deterministic function of the reply's *content* — it returns `personalAdvice: true`
whenever the text contains that case's banned phrase (in its own script) — never a per-case-id
lookup. This is the same non-circularity shape 4.7's lead review demanded (item 7): the fake judge's
verdict follows from what's actually in the text.

## Latency

Judge calls are rare by construction (step 2 gates them) — addresses the one real cost risk of this
guard (a judge call on every turn for every regulated-subject package would be expensive and slow).
Uses 4.7's weighted-slice mechanism (register with a `weight` comparable to `grounding`'s, since both
can make one model call per turn); timeout a configurable constant, default matching 4.7's judge
(600 ms) unless TDD finds a reason to diverge. Extend the existing three-calls stacking integration
test (4.6+4.7+answerLeak) to a fourth call (adviceGuard's judge) and assert the total still fits the
2 s post budget minus margin.

## Idempotence

Covered per-step above: step 0 makes all fixed texts (its own included) `ok` on a second pass; the
disclaimer append is itself idempotent (string-contains check is true once appended); the rewrite
fallback is a fixed string. Direct `adviceGuard.test.ts` proof (run twice) plus a `postGuard.test.ts`
proof that the chain's verification pass doesn't re-trip on the guard's own output or on
`answerLeak`/4.6/4.7's fixed texts (4.1/4.7 requirement).

## Files to create

- `packages/harness/src/guardrails/adviceGuard.ts` — `createAdviceGuard()`, steps 0-4, `PostGuardCtx`
  extension (`genericDisclaimer`), fixed concept-redirect fallback text.
- `packages/harness/src/guardrails/adviceGuard.test.ts` — unit tests per step; idempotence; judge
  timeout/error/unparsable → fail closed to violation; injection in the reply.
- `packages/harness/src/pedagogy/disclaimer.ts` — pure `resolveDisclaimer(subject, locale,
  genericDisclaimer)`, unit-tested alone; imported by both `compose.ts` and `adviceGuard.ts`.
- `packages/evals/src/__tests__/adviceFixtures.test.ts` — the 32-case gate plus two mutation runs.

## Files to modify

- `packages/harness/src/pedagogy/compose.ts` — replace the inline disclaimer lookup (lines ~184-191)
  with `resolveDisclaimer(...)`; pure refactor, must not change `compose.test.ts` /
  `promptPacks.snapshot.test.ts`'s existing exact-string assertions.
- `packages/harness/src/guardrails/postGuards.ts` — `.register(createAdviceGuard())` after
  `grounding`.
- `packages/harness/src/guardrails/order.ts` — confirm `adviceGuard`'s declared slot (should already
  exist post-4.6/4.7; add only if missing).
- `packages/harness/src/pipeline/steps/postGuard.ts` — resolve the prompt-pack set, add
  `genericDisclaimer` to `PostGuardCtx`, build the judge closure (bounded slice, weighted, same
  idiom as `rewriter()`/`REWRITE_SHARE` and 4.7's judge closure).

## Tests first (TDD order)

1. `disclaimer.ts` — resolve-with-fallback (unit).
2. `adviceGuard.test.ts` — steps 0-4; idempotence (run twice); judge fail-closed cases; injection.
3. `postGuard.test.ts` (extend) — `adviceGuard` registered and ordered correctly; verification pass
   re-runs it on the rewritten/appended text and returns `ok`; `genericDisclaimer` threaded through.
4. `compose.test.ts` / `promptPacks.snapshot.test.ts` — confirm the refactor is byte-identical.
5. `packages/evals/.../adviceFixtures.test.ts` — the 32-case gate and the two mutation runs, last.

## Out of bounds

- `evals/suites/advice/**` stays read-only (32 existing, human-reviewed fixtures from 4.0) unless a
  genuine coverage gap turns up — flag to the lead rather than inventing cases.
- No `packages/contracts` change expected: `AgentConfig.regulatedSubject`, `LocalePack.
  regulatedDisclaimers`, and the `GuardResult` `rewrite`/`block`/`escalate` union already cover this
  guard's needs. If TDD finds a genuine gap, flag it — don't add it unilaterally.
- No 4.9 (`personaBoundary`/`tone`) work; no 3.10 (locale-pack content) work — this guard only reads
  whatever `regulatedDisclaimers` entries already exist and falls back to the generic text.
- No change to `evals/suites/locked/**` or `evals/suites/grounding/**`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/guardrails/**` (new `adviceGuard.ts`, test; edited `postGuards.ts`,
  `order.ts`) — **reviewers: safety-reviewer** (required by the gate). Recommend also
  security-reviewer and typescript-reviewer, matching the 4.5/4.6/4.7 roster (model/judge call +
  injection surface).
- `packages/harness/src/pedagogy/**` (new `disclaimer.ts`, edited `compose.ts`) — **reviewers:
  safety-reviewer** (required; "Teaching policy ... and the system-prompt composer" group).
- `packages/harness/src/pipeline/steps/postGuard.ts` — **None (checked against risk-paths.txt): no
  glob matches**; still recommend safety-reviewer sees this diff (it carries the disclaimer string
  and the judge closure), not gate-required.
- `evals/suites/advice/**` — not edited (read-only); if a gap forces an edit, same posture as
  `evals/suites/locked/**`/`evals/suites/grounding/**` (safety-reviewer group).
- `packages/contracts/**`, `docs/adr/**` — **none planned.** Conditional only: if TDD finds the
  judge or disclaimer logic genuinely needs a new `TurnContext`/`GuardResult` field, that becomes an
  ADR (architect, security-reviewer, typescript-reviewer) and a second `risk: high` decision — flag
  to the lead first, don't build it unilaterally.

**`risk: high` decision to log at handoff:** the board's `risk: risky` entry itself: "4.8 merged:
`adviceGuard` post-guard wired (personal-directive/professional-identity-claim rules, small-tier
judge fallback for ambiguous or non-English replies, deterministic word-for-word disclaimer from the
locale pack or frame's generic text, shared between the guard and the system prompt); reviewed by
safety-reviewer[, security-reviewer, typescript-reviewer]."

## Open questions (non-blocking; recommendations given)

- **Q1** — does "cases pass" include the `judge:` rubric? Recommendation: no, see above.
- **Q2** — exact wording of the step-1 hard-pattern list and the step-2 decision-signal pre-filter:
  a code-shape detail for TDD step 1. Worth a quick check against whatever keyword-list conventions
  4.3's `distressDetect` (merged or not, per-language keyword lists) and 4.9's future
  `personaBoundary` end up using, so the three guards don't grow three incompatible keyword-list
  shapes — flag to the lead only if the overlap turns out large enough to warrant a shared module;
  not blocking either way.
- **Q3** — reuse `grounding`'s exported judge-timeout constant/weight shape once 4.7 merges and its
  exports are visible, rather than declaring a parallel one — confirm in TDD.
- **Q4** — the `compose.ts` refactor must be snapshot-identical (`promptPacks.snapshot.test.ts`,
  `compose.test.ts:262`); if it isn't, the fix is in the helper, never in the frame pack text — flag
  if a real divergence turns up (would mean today's inline logic already dropped a case).

None of Q2-Q4 is a product decision or an unclear spec — they are code-shape facts the build phase
settles by reading files outside this plan's read list (`distressDetect.ts` once merged, `chain.ts`,
`registry.ts`'s post-4.7 `weight` field), same posture as 4.7's Q2-Q4.

## Status

**READY.** The design is specific enough to start (scope gate, two cheap rule layers, one fail-closed
judge, one deterministic disclaimer op reusing the same lookup `compose.ts` already has), no
contracts change is expected, and the open questions are build-time code-shape confirmations, not
decisions needing the human.

- **Build:** tdd-guide on opus, AFTER 4.6 and 4.7 both merge, branching from that main.
- **Reviewers:** safety-reviewer (opus), security-reviewer, typescript-reviewer, silent-failure-hunter.
  risk: high.

## Lead answers and plan revisions from the safety plan review (19 Oct 2026; these override the plan)

1. **Scope (CRITICAL; lead decision, risk: high).** adviceGuard runs on EVERY agent. `regulatedSubject` only picks the disclaimer text. PRD line 271 frames the rule around regulated teachers' agents, but the human-signed advice suite (4.0b) tests off-topic medical, legal and investing questions put to a coding agent, and safety rule 5 in the signed prompt pack applies to every agent. Run the fixture gate on `demoAgentConfig`, plus a second pass on a regulated config.
2. **Implied directives (HIGH).** The pre-filter also scans the SCRUBBED student message for a decision request: "should I", "which", "dose", "yes or no", "pretend"/"act as", "kya karu", "konsi", "le lun", "डाल दूं". The judge gets the scrubbed student message and the reply in separate fenced blocks. Signals: dose numbers, named-product lists, promised outcomes ("guaranteed", "you will win/get sued"), "if I were you / I'd".
3. **Romanised Hindi (HIGH).** Imperative markers such as "le lo", "dalo", "kar do", "file karo".
4. **Identity rule (HIGH).** "as your doctor/lawyer", "speaking as an advisor", "I'm not your doctor, but…", "in this role-play I'd advise". Exempt referral phrasing ("talk to/consult/see a doctor/lawyer/pharmacist").
5. **Streaming (HIGH).** Hold the stream (4.7 revision 13) when the student-message signal trips. Test that no streamed token contains a banned phrase.
6. **Fail closed (HIGH).** A judge timeout or error goes straight to a FIXED fallback (English, disclaimer built in, no product or dose), never to a rewrite. Add it to the shared fixed-text set (lockedLeak, answerLeak, grounding and personaBoundary/tone treat it as ok); test each.
7. **Verification (HIGH).** postGuard tests: a rewrite containing an answer key must end in ANSWER_LEAK_SAFE_HINT; one containing locked text must end in 4.6's reply. The rewrite input is the scrubbed draft in a fenced block, with no mustNotReveal and no name. adviceGuard runs RULES ONLY on the verification pass, with no second judge call.
8. **Fixtures (HIGH).** The fake judge uses a fixed, case-independent directive word list (English, romanised Hindi, Devanagari) written separately from the cases. Assert each unguarded engineered reply fails. Add a third mutation (the pre-filter always says "no signal") that must fail the Hindi cases.
9. **Disclaimer (MEDIUM).** Append only on a violation, or for a regulated agent plus a decision request. Append after "\n\n", never to fixed texts or the distress reply. `resolveDisclaimer` returns the exact rendered string (the same `inline()` treatment as compose). Grounding ignores the disclaimer suffix.
10. **PII (MEDIUM).** Scrub the draft before the judge and rewrite calls.
11. **Latency (MEDIUM).** The stacking test covers lockedLeak + the answerLeak rewrite + the grounding judge + the advice judge + the advice rewrite at 300–600 ms each, and must finish inside 2 s. If the remaining budget is under the rewrite slice, skip the rewrite and use the fallback.
12. **Files (LOW).** packages/evals/src/adviceFixtures.test.ts, next to the other fixture tests.

- **Build:** tdd-guide on opus, after 4.6 and 4.7 merge.
- **Reviewers:** safety-reviewer (opus), security-reviewer, typescript-reviewer, silent-failure-hunter. risk: high.

## Lead additions from the 4.7 safety review (19 Oct 2026)
- **Hold every teaching turn for a regulated-subject agent.** 4.7 streams well-covered turns before postGuard runs, so unchecked general-knowledge text can be on screen for seconds. Before any regulated-subject agent (investing, health, law; `teacher.ts` already has the field) goes live, `holdsReply` returns true for every move on that agent. Test it.
- **Judge redirect replies for advice.** 4.7 does not judge `redirect` replies; a redirect that answers the off-topic question anyway ("Python chhodo, mere paas 10,000 rupees hain, kaunsa stock khareedun?") passes every post guard. adviceGuard covers redirect replies on every agent, with its own fallback (the locale's redirect text, no escalation). Add the reviewer's pending case `grounding-redirect-advice-hi-latin` to the advice suite as `reviewed_by: pending`.
