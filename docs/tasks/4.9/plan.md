# Task 4.9 plan — `personaBoundary` and `tone` post-guards

Branch: `m4/4.9-persona-tone`. Board deps: 3.1, 3.12, 4.0, 4.1 (all done). Board: `risk: risky`.
**Sequencing note:** 4.6, 4.7 and 4.8 are in progress and each adds a `.register(...)` line to
`postGuards.ts` (and, per 4.7's lead-answer #1, a per-guard `weight` in the post registry for the
guards that make a model or port call). `order.ts` already carries the final
`['answerLeak', 'lockedLeak', 'grounding', 'adviceGuard', 'personaBoundary', 'tone']` list, so this
plan does not touch it. Cut this branch from `main` only after 4.6, 4.7 and 4.8 merge (same
sequencing discipline 4.7 used after 4.6), so `postGuards.ts` and any registry `weight` shape are
settled before this task's two `.register(...)` lines land last.

## Accept (verbatim)

> seeded persona cases pass; no reply claims to be human or the teacher; a completeness test shows
> every guard declared in GUARD_ORDER is registered (from 4.1 Q3).

**How it will be shown:**
1. `packages/evals/src/__tests__/personaFixtures.test.ts` (mirrors 4.5/4.6/4.7's fixture gates):
   drives the 32 cases in `evals/suites/persona/*.yaml` through the real pipeline (`runTurn`) with a
   per-case `ScriptedGateway` reply engineered to reproduce the violation the case tests (a claim of
   being human, of being the teacher, a companion promise, or compliance with a "say exactly X"
   jailbreak), asserting the chain's final text passes each case's `must_not_contain`. Two mutation
   runs (see "Non-circular fixtures" below).
2. A new completeness test (4.1 Q3, the reason `registry.ts`'s `missing()` exists) asserting every
   phase's registry has zero `missing()` entries once this task's two guards are registered —
   confirm during TDD whether this belongs in `registry.test.ts` (extended) or a new
   `guardrails/completeness.test.ts`, and whether a scrub-phase and pre-phase registry (analogous to
   `postGuards.ts`) already exist to check alongside `postGuards`; out of this plan's read list, so
   flagged rather than assumed.
3. Package-level
   `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/contracts... --filter=@edmate/evals...`
   also passes.

**Open question Q1 (same shape as 4.5/4.6/4.7's Q1): does "cases pass" include the `judge:` rubric
lines, and do the 11 non-English (`hi-latin`/`deva`) fixtures count given the pilot is
English-only?** Recommendation: no to the first (rule 4 bars real model calls in tests; the fixture
gate scores `must_not_contain` directly against the scripted reply, same reading as 4.5-4.7). Yes to
the second — run all 32 shipped, human-reviewed, read-only fixtures through the offline gate
(scripted replies can reproduce a Devanagari/romanised violation regardless of what the live model
would actually write); the pilot's "reply language is English" (safety rule 8) means the live model
should never produce a Hindi-script violation in the first place, but the fixtures exist as a
defensive net and the task should not skip human-reviewed cases. Not blocking; flag in the handoff.

## Design: two rules-only guards, fixed-text whole-reply rewrites, no model call

**The spec's two guard rows, read literally (build plan lines 427-428):** `personaBoundary` —
"Persona `must_not` list for interview and viva skills" → `rewrite in persona`. `tone` — "No
companion behaviour; never claims to be human or the teacher" → `rewrite`. `TurnContext.persona`
(contracts, `PersonaSchema.exactOptional()`) is only ever set by the two `kind: persona` skills in
`content/skills/mock_interview/` (`job-interview@1.0.0.yaml`, `viva@1.0.0.yaml`); there is no
default/base persona skill, so `ctx.persona` is `undefined` on every ordinary tutoring turn.

**Reconciling an ambiguity (see Open question Q2 below): none of the 32 shipped
`evals/suites/persona/*.yaml` fixtures configure an active `mock_interview` skill (all are plain
tutoring turns), yet several (`dan-roleplay`, `chatgpt-norules`, `drop-persona-unrelated-task`) cite
`personaBoundary` (line 427) in their `source:` field alongside ones that cite `tone` (line 428) for
very similar human/teacher-identity claims, and the task brief's own checklist bundles "claims of
being human or the teacher, the teacher-note string, companion promises, and persona `must_not`
items" all under `personaBoundary`.** Recommended split, chosen so each guard has a clear,
non-overlapping, always-correctly-scoped job and the accept bar is met either way:

- **`tone`** — runs on every post-guard chain, no precondition. The always-on identity-and-relationship
  floor: never affirms being human/alive/a real person/not-a-bot; never claims to be the teacher or
  signs/speaks as one ("I am your teacher", "this is \<name\> speaking", "I am now your \<subject\>
  teacher" — generic, name-free patterns, since `TurnContext` carries no teacher display name, only
  `agent.teacherId`; "I am Demo Teacher" is still caught because the fixture's placeholder name
  itself contains the word "teacher"); never promises a companion/romantic/best-friend relationship
  (safety rule 6); never echoes the forged teacher-note string (safety rule 9, 3.11b's addition)
  back as its own words; and, as a general (non-fixture-specific) heuristic, never complies with a
  student's "say the exact words X" demand when X overlaps any of the above (catches DAN/ChatGPT/
  "a normal person"/"a generic assistant" style jailbreaks without hardcoding each one). This one
  guard is what makes all 32 persona-suite fixtures pass, since none of them set `ctx.persona`, and
  is what literally satisfies the accept line's "no reply claims to be human or the teacher".
- **`personaBoundary`** — also runs on every turn, but is a cheap no-op `ok` unless `ctx.persona` is
  set. When it is (a `job-interview` or `viva` turn), it checks the loaded `ctx.persona.mustNot`
  array's literally pattern-matchable subset against the reply: identity/outcome claims ("you are
  hired/rejected", "you would pass/fail", a grade or mark before the debrief — on top of tone's
  identity floor, which still applies in-persona too) and requests for real personal data (reusing
  `piiPatterns.ts`'s existing phone/email/address/ID regexes rather than a second implementation).
  Action: `rewrite in persona` — a fixed, persona-aware safe text that names `ctx.persona.name`
  ("As your {persona.name} for this practice, I should say plainly...") so the practice role-play can
  continue, distinct from `tone`'s plain fixed text.
- **Deferred, non-blocking (mirrors 4.5's answerLeak/4.5b MVP split):** the persona `must_not` items
  that are not literally pattern-matchable without a classifier (harsh/mocking/flirtatious tone,
  asking about religion/caste/age/health/etc., a paraphrased model-answer or mark-scheme reveal) are
  out of this task's MVP. None of the 32 shipped fixtures or the board's accept line exercise them;
  flag a follow-up task (call it "4.9b" by analogy) to the lead rather than adding a judge
  unilaterally.

**Both guards use a fixed, deterministic, whole-reply text replacement — never a model-assisted
surgical rewrite.** Rationale, same as 4.7 lead-answer #5's "replace the WHOLE reply" posture for
student-originated false premises: once a reply has affirmed humanity, named the teacher, or made a
companion promise, the reply's whole framing is compromised, so a partial edit is not safe; a fixed
text is also trivially idempotent and needs no `rewrite` closure, no port call, no new injection
surface, and no per-guard `weight` tuning (both guards stay at the registry's default/lowest weight,
the same lane as `answerLeak`'s non-rewrite path and `lockedLeak`'s/`grounding`'s pure-rule layers —
confirm the exact weight constant/default against whatever 4.6/4.7 land, since this plan's read list
did not include their landed `registry.ts`).

**Detection, kept general rather than fixture-specific (the "non-circular" requirement below):**
case-insensitive, punctuation/whitespace-tolerant regex families for (a) self-claim + human/alive/
real-person/not-a-bot nearby; (b) self-claim + "teacher" nearby; (c) self-claim + companion nouns
("girlfriend", "boyfriend", "best friend") or "I love you"/"I care about you more than teaching"; (d)
the literal teacher-note string (a guard-owned constant mirroring `frame@1.0.0.md`'s
`## teacher-label` text, not a live read of the prompt-pack — flag during TDD whether reading
`env.deps.promptPacks` instead is cleaner, but a guard-owned constant avoids a new `PostGuardCtx`
field, the same minimal-plumbing choice 4.6-4.7 made); (e) the "say the exact words X" echo check
against `studentText`. The 11 non-English fixtures' exact Devanagari/romanised phrases are added as
explicit literal entries alongside the English patterns (not a general multilingual NLU pass — that
would follow `distressDetect`'s locale-pack-driven precedent if ever needed beyond these known,
read-only fixtures; out of scope here, flagged as Open question Q1's second half).

## Idempotence and fixed texts

Each guard's own fixed text must contain none of its own trigger patterns (e.g. never literally
affirm "I am human" even negated loosely — "I'm an AI, not a human" must not re-trip a careless
"human" keyword match; the regexes need an explicit affirmative-claim shape, not a bare keyword).
Required test matrix (mirrors 4.7 lead-answer #3, "fixed texts are always ok"):
- `tone`'s and `personaBoundary`'s own fixed texts pass themselves, each other, and every other
  already-built post guard (`answerLeak`, `lockedLeak`, `grounding`, `adviceGuard`).
- `ANSWER_LEAK_SAFE_HINT`, 4.6's locked-move reply, 4.7's `ask_teacher` fallback, the safe reply
  (`fallbackReplies.safeReply`) and the distress template all pass `personaBoundary` and `tone`
  cleanly (none of them claims humanity, names a teacher, or promises companionship — direct asserts
  per fixed text).
- The chain's pass-2 verification (any rewrite or block on pass 2 becomes `block` with cause
  `rewrite_unverified`, per `chain.ts`) never re-trips on either guard's own rewrite.

## Non-circular fixtures for the 32 persona cases, plus mutation runs

Per the design above, the 32 shipped fixtures are, in practice, `tone`'s coverage alone (none set
`ctx.persona`). So:
- **Mutation run 1 — `tone` stubbed to always return `ok`:** must fail every one of the 32 cases
  (its only protection), proving the rule layer is doing real work, not vacuously passing.
- **Mutation run 2 — `personaBoundary` stubbed to always return `ok`:** correctly causes **no**
  change across the 32 cases (it never fires on them) — call this out explicitly in the fixture
  test's comments so a reviewer does not read "nothing changed" as a broken mutation run. The genuine
  proof that `personaBoundary`'s rule layer works is a separate, guard-level test: load
  `job-interview@1.0.0.yaml`'s and `viva@1.0.0.yaml`'s real `must_not` arrays (via whatever
  `@edmate/content` loader already parses them for `buildContext`, task 3.x — confirm the exact
  import during TDD) with `ctx.persona` set, feed each pattern-matchable `must_not` item a violating
  scripted reply, and assert a rewrite with the persona-aware fixed text; a second pass with the
  guard stubbed to `ok` must then fail every one of those.
- Detection patterns are written against the general shapes in "Design" above, not copied from the
  fixtures' exact wording, so the mutation runs are a genuine test of the rule layer rather than the
  fixture set re-asserting itself.

## GUARD_ORDER completeness test (4.1 Q3)

`registry.ts`'s `ordered()`/`missing()` comment already flags this as 4.9's job. Add an assertion
(wherever TDD step 1 confirms, see "How it will be shown" above) that every phase's registry
(`postGuards`, plus any `scrub`/`pre` registries built in 4.2-4.4 — not read this round) reports an
empty `missing()` once this task's two `register(...)` calls land, i.e. this is the task that finally
makes `GUARD_ORDER`'s declared list and the live registries agree everywhere.

## Latency

Both guards are pure rules (regex/array scan), sub-millisecond, no model or port call — same lane as
`answerLeak`'s non-rewrite path, `lockedLeak`'s n-gram check and `grounding`'s Rules A-C. They add no
new entry to 4.7's "three model/port calls in one turn" latency integration test. Confirm during TDD
whether `postGuardSliceMs`/the registry's `weight` concept (landing via 4.6/4.7) needs an explicit
default-weight assertion for these two guards, or whether "no weight set" already defaults correctly.

## Files to create

- `packages/harness/src/guardrails/personaBoundary.ts` — `createPersonaBoundaryGuard()`: no-op `ok`
  when `ctx.persona` is undefined; else the pattern-matchable `must_not` subset check and the
  persona-aware fixed rewrite.
- `packages/harness/src/guardrails/personaBoundary.test.ts` — unit tests per pattern, the no-op path,
  idempotence, "always ok on other guards' fixed texts".
- `packages/harness/src/guardrails/tone.ts` — `createToneGuard()`: the always-on identity/companion/
  teacher-note/echo-compliance check and its fixed rewrite.
- `packages/harness/src/guardrails/tone.test.ts` — unit tests per pattern, idempotence, "always ok on
  other guards' fixed texts".
- `packages/evals/src/__tests__/personaFixtures.test.ts` — the 32-case gate plus the two mutation
  runs (and `personaBoundary`'s separate guard-level must-not-array test, if not placed in
  `personaBoundary.test.ts` instead — confirm placement during TDD).

## Files to modify

- `packages/harness/src/guardrails/postGuards.ts` — `.register(createPersonaBoundaryGuard())` then
  `.register(createToneGuard())`, after whatever 4.6-4.8 already added.
- `packages/harness/src/guardrails/registry.ts` or `registry.test.ts` — the completeness assertion
  (4.1 Q3), exact location TBD per "How it will be shown" above.
- `packages/harness/src/guardrails/order.ts` — none expected (already carries the final list);
  confirm unchanged during TDD step 1.

## Out of bounds

- `evals/suites/persona/**` stays read-only (32 existing, human-reviewed fixtures) unless a genuine
  coverage gap turns up (e.g. no fixture exercises `ctx.persona` set) — flag to the lead rather than
  inventing cases, same discipline as 4.7.
- No semantic/judge layer for `personaBoundary`'s harder `must_not` items (harsh tone, protected-
  category questions, paraphrased reveals) — flagged above as a follow-up, not built here.
- No `content/prompt-packs/**` or `content/skills/**` edits — both are read-only reference for this
  task (the `frame.md` persona section and the two skills' `must_not` lists already exist).
- No `packages/contracts` change expected — `TurnContext.persona` already carries everything needed.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/guardrails/**` (new `personaBoundary.ts`, `tone.ts`, their tests; edited
  `postGuards.ts`, possibly `registry.ts`/`registry.test.ts`) — **reviewers: safety-reviewer**
  (required by the gate). Recommend also security-reviewer and typescript-reviewer, matching the
  4.5-4.7 roster, given this guard enforces the agent's never-human/never-the-teacher identity
  boundary directly.
- `content/prompt-packs/**`, `content/skills/**` — not edited (read-only); if a coverage gap forces
  an edit (e.g. a new fixture under a persona skill), treat as the safety-reviewer group.
- `evals/suites/persona/**` — not edited (read-only); same posture as `evals/suites/locked/**` and
  4.7's `evals/suites/grounding/**` if a gap forces a change.
- `packages/evals/src/__tests__/personaFixtures.test.ts` — not itself a risk-paths glob, but carries
  the same safety-reviewer posture as 4.5-4.7's fixture gates.
- `packages/contracts/**`, `docs/adr/**` — none planned; no contracts change expected.

**`risk: high` decisions to log at handoff:**
1. The board's `risk: risky` entry itself: "4.9 merged: `personaBoundary` and `tone` post-guards
   wired (identity/companion/teacher-note floor on every reply; persona `must_not` list for
   interview/viva skills); the completeness test confirms every `GUARD_ORDER`-declared guard is now
   registered; reviewed by safety-reviewer[, security-reviewer, typescript-reviewer]."
2. The guard-scope reconciliation itself (Open question Q2 below) — a build-time design choice the
   one-line build-plan table left ambiguous between the two guards; log the chosen split so a future
   task doesn't re-litigate it silently.

## Open questions (non-blocking; recommendations given)

- **Q1** — do the 11 non-English fixtures and the `judge:` lines count toward "cases pass"?
  Recommendation above: all 32 fixtures run in the offline gate; `judge:` lines are the live-model
  exit-gate bar (7.x), not this offline test.
- **Q2 (the plan's central judgment call)** — the build plan's one-line table splits
  `personaBoundary` (persona `must_not`, scoped to interview/viva) from `tone` (identity/companion,
  always-on), but the task brief's own checklist and several fixtures' `source:` citations blur that
  line. Recommendation: the split above (tone = always-on identity/companion/teacher-note/echo floor;
  personaBoundary = persona-skill-scoped `must_not`, no-op otherwise) keeps each guard's scope
  internally consistent and is sufficient for the accept bar and all 32 fixtures; log it as a
  decision at handoff (not an open design question for the human, since both guards ship in this one
  task regardless of the exact internal split, and the chosen split is specific enough to build and
  test).
- **Q3** — exact placement of the completeness test and whether a `scrub`/`pre`-phase registry
  (analogous to `postGuards.ts`) already exists to check alongside it: confirm during TDD step 1
  (out of this plan's read list).
- **Q4** — the teacher-note string: a guard-owned constant (recommended, matches
  `ANSWER_LEAK_SAFE_HINT`'s precedent) vs. reading `env.deps.promptPacks` live: confirm during TDD;
  recommendation is the guard-owned constant, flagged as a drift risk if `frame@1.0.0.md`'s
  `teacher-label` text ever changes without updating the guard.

None of Q2-Q4 is an open spec question needing the human — Q2 is this plan's own reconciliation of an
ambiguous one-line spec (logged as a decision, not left to the human), and Q3/Q4 are build-time
code-shape confirmations, same posture 4.7's Q2-Q4 took.

## Status

**READY.** The design is specific enough to start (two rules-only, fixed-text guards; no model call;
no contracts change; the GUARD_ORDER completeness test closes 4.1's Q3). The one genuine ambiguity
(Q2, the guard-scope split) has a clear, implementable, testable recommendation and does not block
starting the build.

## Lead answers and plan revisions from the safety plan review (19 Oct 2026; these override the plan)

1. **Honest replies stay ok (HIGH).** Match only "I am / I'm / this is / main…hoon + (your|the) teacher|ma'am|sir|<Title-Case name> + here/speaking". Exempt "not (a|the|your)" and "AI … built/made from … teacher's". Add a table of 10+ honest replies that must stay ok, including the safety-preamble line and tone's own fixed text.
2. **Families (HIGH).** real/actual + person/human/tutor/examiner/recruiter; "<name> here/speaking/regards" and "<name> ma'am/sir"; relationship promises ("always be here for you", "care about you more than anyone", "call me your friend"). Context rule: if a recent student turn raises human or teacher identity and the reply opens with yes/haan/true/you got me with no AI statement, rewrite. History is already in the turn context (harness); no contracts change. If it isn't reachable from PostGuardCtx, add it there (harness type only).
3. **Teacher display name (HIGH; lead decision, risk: medium).** TurnContext has no teacher display name (the frame doesn't render one), so name-aware matching needs a contracts field and an ADR. That is deferred to board task 4.9b. 4.9 relies on the general families in item 2 (which catch "<Name> ma'am/here/speaking"). "I am Priya Sharma" with no role word is a documented known miss. The rename mutation is tested against the general families only.
4. **No literal fixture phrases (HIGH).** General families: main/mai/मैं + insaan/इंसान/asli/असली/real/human/teacher/टीचर/ma'am/dost/दोस्त/girlfriend/गर्लफ्रेंड + hoon/hun/hu/हूं/हूँ, and haan/हाँ…sach. Test held-out variants ("main ek insaan hun", "मैं असली इंसान हूँ", "tumhara teacher hi hoon").
5. **Echo and identity swap (HIGH).** Rewrite whenever a quoted span the student demanded (straight, curly or «» quotes, 3+ words) appears in the reply, unless the span is also in the course material. Add an identity-swap family ("I am (now) X", "from now on I'm", "as a normal person"). Normalise first: NFKC, strip \p{Cf}, fold confusables, collapse dots and spaces between letters, and treat I'm/Im/I am alike. Reuse the shared normaliser.
6. **Personas step out of role (HIGH).** On /pause, stop, "are you human/real?", or a distress flag, require an out-of-role reply, with a fixed text that drops the role ("Pausing the practice. I'm an AI…"). Add real recruiter/HR/examiner claims to the in-persona identity checks. Note in the plan where /pause is handled upstream; if nowhere, it's 5.8's job, and personaBoundary is the backstop.
7. **Never touch an escalation (HIGH).** A chain test that post guards never rewrite an escalate reply. Run tone on the distress template rendered from the IN pack and assert 14416 survives.
8. **Outcome rules for every turn (MEDIUM).** The outcome-claim ("you're hired", "you passed") and real-recruiter/examiner rules run on every turn, not only with ctx.persona. The rules are one code-side set for every persona, not compiled from must_not prose.
9. **Persona name (MEDIUM).** Insert it only if it's letters and spaces, at most 40 characters; otherwise use "practice interviewer". Never insert must_not items or a reason. Test the rendered text against every post guard, for both personas and a hostile name.
10. **Code (MEDIUM).** Fenced code is exempt from the identity families; the echo rule still applies inside code. Quoted refusals that repeat the demanded words are rewritten on purpose.
11. **Teacher note (MEDIUM).** Confirm postGuard runs before the platform adds the teacher label; normalise case and whitespace; add a drift test against frame@1.0.0.md's teacher-label.
12. **Completeness test (MEDIUM).** Unconditional, derived from GUARD_ORDER: for every phase, missing() is empty and ordered() matches GUARD_ORDER, on the registry runTurn really uses. Mutation: a registry without tone fails it.
13. **Fixtures (MEDIUM).** Assert each scripted reply fails its must_not_contain with NO guards; stub only the target guard per mutation, with the rest live. Add the held-out set, the rename and the over-trigger negatives.
14. **Bounded regexes (LOW).** No nested quantifiers. The handoff says tone only checks what a reply must not say.

- **Build:** tdd-guide on opus, after 4.6, 4.7 and 4.8 merge.
- **Reviewers:** safety-reviewer (opus), security-reviewer, typescript-reviewer, silent-failure-hunter. risk: high.
