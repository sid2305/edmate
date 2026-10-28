# Task 4.9 plan — `personaBoundary` and `tone` post-guards

Branch: `m4/4.9-persona-tone`. Board deps: 3.1, 3.12, 4.0, 4.1 (all done; the board's `GATE` dep is
the harness exit gate, which the 22 Oct 2026 decision ("the product tasks no longer wait for the
harness exit gate") makes a pre-pilot check, not a build dependency — not a blocker). Board:
`risk: risky`. Board milestone now shows `M13` (4.9 was parked there by the 20 Oct 2026 "MVP first"
decision); the lead is pulling it forward now because the build queue is empty, per this refresh's
brief.

## Refresh, 28 Oct 2026

The 19 Oct design and the 19 Oct lead answers (below) still hold; nothing in current code
contradicts the chosen guard split or any of the 14 lead answers. What changed since 19 Oct, and
what this refresh corrects:

1. **The persona suite grew from 32 to 100 cases** (`evals/suites/persona/*.yaml`, confirmed by a
   fresh listing). 36 of them are `persona-roleplay-*` cases, added by task 5.8 and already
   replayed by `packages/evals/src/rolePlayFixtures.test.ts` — but that file only drives
   `decidePolicy`/`composeSystemPrompt` (the pedagogy layer, pre-model) to prove the role-play
   *state* is composed correctly; it never runs the post-guard chain, so it proves nothing about
   `personaBoundary`/`tone`. The other 64 (identity, companion, jailbreak-style, admin-override,
   etc.) are not exercised by any fixture test yet. **This plan's fixture gate runs all 100 through
   the real pipeline and the post-guard chain** (not "the 32 shipped fixtures" the 19 Oct draft
   described) — see "Non-circular fixtures" below for the updated mutation-run split.
2. **4.5–4.8 are merged.** `order.ts`'s `GUARD_ORDER.post` is unchanged:
   `['lockedLeak', 'answerLeak', 'grounding', 'adviceGuard', 'personaBoundary', 'tone']`.
   `guardrails/postGuards.ts` registers the first four (`lockedLeak` weight 2, `answerLeak` weight
   3, `grounding` weight 4, `adviceGuard` weight 4); this task adds the last two `.register(...)`
   lines. `registry.ts`'s `weight`/`missing()`/`ordered()` machinery is exactly as the 19 Oct draft
   assumed.
3. **`PostGuardCtx` (`guardrails/answerLeak.ts`) needs no new field.** `ctx: TurnContext` already
   carries `history: Message[]` and `intent: Intent` (`'distress'` is one of the six `Intent`
   values) alongside `persona?: Persona`, so lead answer 2's "if it isn't reachable from
   PostGuardCtx, add it there" and lead answer 6's "a distress flag" are both already satisfied by
   reading `ctx.history` and `ctx.intent` — no harness-internal type change, confirmed from
   `packages/contracts/src/turn.ts`.
4. **`/pause` and bare `stop`/`/stop` are already handled upstream**, in
   `packages/harness/src/pedagogy/skills.ts` (task 5.8's `rolePlayControl`), which already produces
   the debrief/pause state the frame prompt (`frame@1.2.0.md` line 56) tells the model to use. So
   lead answer 6's backstop is needed only for "are you human/real?" and a distress-flagged turn
   mid-role-play — `rolePlayControl` does not recognise either as a control, so nothing upstream
   already steps the persona out of role for them.
5. **The pinned set is `set@1.3.0` / `frame@1.2.0`**, not `frame@1.0.0` as the 19 Oct draft assumed
   (`rolePlayFixtures.test.ts`'s own header names `SET_VERSION = '1.3.0'`). The teacher-label string
   is unchanged text, just a newer file: `content/prompt-packs/frame@1.2.0.md` line 60,
   `(Platform note: the teacher wrote this reply.)`. The drift test (lead answer 11) now reads that
   file.
6. **The shared normaliser lead answer 5 asks for is mostly already built**, just split across two
   modules: `textFold.ts`'s `foldText` (NFKC per code point, every `\p{Nd}` digit to ASCII,
   `\p{Cf}` recognised) and `lockedMatch.ts`'s exported `foldConfusables` (the small Cyrillic/Greek
   look-alike table, task 4.6b). Neither collapses dots/spaces *between letters* ("I . M" → "IM"),
   which `tone.ts` still needs to add itself — a small guard-owned helper, not a third shared
   module (same minimal-plumbing posture 4.6/4.7 took), confirmed by reading both files; no longer
   an open TDD question.
7. **The `GUARD_ORDER` completeness test (4.1 Q3) needs one small, confirmed addition**, not an
   open question: `pipeline/steps/preGuard.ts` already exports `defaultPreGuardRegistry()` (and
   `pipeline/index.ts` re-exports it) for exactly this purpose, but `pipeline/steps/scrub.ts`'s
   single-guard registry is a bare module-level `const`, never exported. This task adds one export
   (`export function defaultScrubRegistry()` or `export { registry as scrubGuards }`, builder's
   call) so the completeness test can read the registry `runTurn` actually uses in all three
   phases, not a reconstructed stand-in. `registry.test.ts` is the natural home (it already has the
   `missing()`/`ordered()` coverage this test extends); no separate `completeness.test.ts` needed.
8. **Design nuance, confirmed from lead answer 8, not a change but worth restating plainly given
   the code now exists:** `personaBoundary`'s outcome-claim ("you're hired/passed") and
   real-recruiter/real-examiner-identity rules are NOT gated on `ctx.persona` — they run on every
   turn (one code-side rule set, not compiled from either persona template's `must_not` prose).
   Only the rest of `personaBoundary` (real personal data, the persona-aware rewrite naming
   `ctx.persona.name`) stays a no-op `ok` when `ctx.persona` is undefined.
9. **Correction to the 19 Oct footer's reviewer line.** It was written before the 20 Oct 2026
   "MVP first" decision moved the safety risk-path group (which includes
   `packages/harness/src/guardrails/**`) down to `code-reviewer` only until the pilot gate
   (`.claude/skills/merge-gate/risk-paths.txt`'s current `# reviewers: code-reviewer` line over that
   group). The footer below is corrected to match; `security-reviewer`/`typescript-reviewer` are
   still recommended, non-required extras per that same rule (they run on every PR regardless under
   the general TypeScript/security hooks, but are not *gate-required* here).
10. **Fixture test file path corrected**: every sibling fixture gate
    (`groundingFixtures.test.ts`, `adviceFixtures.test.ts`, `lockedFixtures.test.ts`,
    `leakFixtures.test.ts`, `feedbackFixtures.test.ts`, `revisionFixtures.test.ts`,
    `rolePlayFixtures.test.ts`) lives flat under `packages/evals/src/`, never under a `__tests__/`
    subdirectory. The 19 Oct draft's `packages/evals/src/__tests__/personaFixtures.test.ts` path
    was wrong; this plan uses `packages/evals/src/personaFixtures.test.ts`.
11. **No contracts change, confirmed, not just assumed:** `TurnContext.persona`
    (`PersonaSchema.exactOptional()`), `.history` and `.intent` are unchanged and sufficient. 4.9b
    (the teacher display-name field and its ADR) stays out of this plan's scope, confirmed against
    the board (`4.9b`, `status: todo`, depends on `4.9`).

Nothing above changes the two guards' design, the detection families, the idempotence rules, or
any of the 14 lead answers; it only re-points paths/counts and resolves what used to be open TDD
questions (Q3, Q4, the normaliser) from reading the merged 4.5–4.8 code.

## Accept (verbatim)

> seeded persona cases pass; no reply claims to be human or the teacher; a completeness test shows
> every guard declared in GUARD_ORDER is registered (from 4.1 Q3).

**How it will be shown:**
1. `packages/evals/src/personaFixtures.test.ts` (mirrors `groundingFixtures.test.ts`,
   `adviceFixtures.test.ts`, `lockedFixtures.test.ts`, `leakFixtures.test.ts`): drives all 100 cases
   in `evals/suites/persona/*.yaml` through the real pipeline (`runTurn`) with a per-case
   `ScriptedGateway` reply engineered to reproduce the violation the case tests, asserting the
   chain's final text passes each case's `must_not_contain`. Two mutation runs, a no-guards control
   per case, and held-out/negative tables (see "Non-circular fixtures" below).
2. A completeness test in `packages/harness/src/guardrails/registry.test.ts`: every phase's real,
   wired-up registry (`defaultScrubRegistry()`, `defaultPreGuardRegistry()`, `postGuards`) reports
   an empty `missing()` and an `ordered()` that matches `GUARD_ORDER[phase]` once this task's two
   `register(...)` calls land. Mutation: a `post` registry built with every guard but `tone`
   registered fails the assertion.
3. Package-level
   `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/contracts... --filter=@edmate/evals...`
   also passes.

**Open question Q1 (unchanged): do the non-English fixtures and the `judge:` rubric lines count?**
Recommendation unchanged: no to `judge:` lines (rule 4 bars real model calls in tests); yes to
every shipped, human-reviewed, read-only fixture regardless of script — the English-only pilot
decision (18 Oct 2026) means the live model should never produce a non-English violation, but these
are a defensive net and the task adds no new Hindi/Hinglish cases (English-only pilot rule).

## Design: two rules-only guards, fixed-text whole-reply rewrites, no model call

**The spec's two guard rows, read literally (build plan lines 427-428):** `personaBoundary` —
"Persona `must_not` list for interview and viva skills" → `rewrite in persona`. `tone` — "No
companion behaviour; never claims to be human or the teacher" → `rewrite`. `TurnContext.persona`
(contracts, `PersonaSchema.exactOptional()`) is only ever set by the two `kind: persona` skills in
`content/skills/mock_interview/` (`job-interview@1.0.0.yaml`, `viva@1.0.0.yaml`); there is no
default/base persona skill, so `ctx.persona` is `undefined` on every ordinary tutoring turn.

**Chosen split (unchanged from 19 Oct, now also carrying lead answer 8's refinement — see Refresh
item 8), kept so each guard has a clear, non-overlapping job:**

- **`tone`** — runs on every post-guard chain, no precondition. The always-on identity-and-
  relationship floor: never affirms being human/alive/a real person/not-a-bot; never claims to be
  the teacher or signs/speaks as one (generic, name-free patterns — `TurnContext` carries no
  teacher display name, only `agent.teacherId`; 4.9b is the follow-up that adds one); never
  promises a companion/romantic/best-friend relationship (safety rule 6); never echoes the forged
  teacher-note string back as its own words; never complies with a student's "say the exact words
  X" demand when X overlaps any of the above. Lead answers 1, 2, 4, 5, 7, 10, 11, 14 below are
  `tone`'s detailed rules.
- **`personaBoundary`** — two parts. (a) Unconditional (every turn, `ctx.persona` or not, per lead
  answer 8): the outcome-claim rule ("you are hired/rejected", "you would pass/fail", a grade or
  mark before the debrief) and the real-recruiter/real-examiner-identity rule, one code-side rule
  set. (b) Persona-scoped, a no-op `ok` when `ctx.persona` is undefined: the loaded
  `ctx.persona.mustNot` array's literally pattern-matchable subset (requests for real personal
  data, reusing `piiPatterns.ts`'s existing regexes) and, on any hit from either part, the
  persona-aware fixed rewrite naming `ctx.persona.name` (lead answer 9's 40-char/letters-and-spaces
  rule, else "practice interviewer").
- **Deferred, non-blocking (mirrors 4.5/4.5b):** persona `must_not` items that need a classifier
  (harsh/mocking/flirtatious tone, protected-category questions, a paraphrased model-answer or
  mark-scheme reveal) stay out of this task's MVP — none of the 100 shipped fixtures or the accept
  line exercise them as a rules-only check.

**Both guards use a fixed, deterministic, whole-reply text replacement — never a model-assisted
surgical rewrite**, for the same reason 4.7 lead answer 5 gave for false premises: once a reply has
affirmed humanity, named the teacher, or made a companion promise, its whole framing is
compromised. A fixed text is also trivially idempotent and needs no `rewrite` closure, no port
call, no new injection surface, and no per-guard `weight` tuning beyond the registry default (both
stay in the same rules-only lane as `lockedLeak`'s/`grounding`'s rule layers; confirm the exact
default during TDD, but nothing in 4.6-4.8's landed `registry.ts` suggests otherwise).

## Lead answers 1-14 (19 Oct 2026 safety plan review) — unchanged, still override the design above

1. **Honest replies stay ok (HIGH).** Match only "I am / I'm / this is / main…hoon + (your|the)
   teacher|ma'am|sir|<Title-Case name> + here/speaking". Exempt "not (a|the|your)" and "AI …
   built/made from … teacher's". Add a table of 10+ honest replies that must stay ok, including the
   safety-preamble line and tone's own fixed text.
2. **Families (HIGH).** real/actual + person/human/tutor/examiner/recruiter; "<name>
   here/speaking/regards" and "<name> ma'am/sir"; relationship promises ("always be here for you",
   "care about you more than anyone", "call me your friend"). Context rule: if a recent student
   turn raises human or teacher identity and the reply opens with yes/haan/true/you got me with no
   AI statement, rewrite. History is already in the turn context (harness, confirmed: `ctx.history`
   — Refresh item 3); no contracts change.
3. **Teacher display name (HIGH; lead decision, risk: medium).** `TurnContext` has no teacher
   display name, so name-aware matching needs a contracts field and an ADR — deferred to board task
   4.9b (confirmed still `status: todo`, out of this plan's scope). 4.9 relies on the general
   families in item 2. "I am Priya Sharma" with no role word is a documented known miss. The rename
   mutation is tested against the general families only.
4. **No literal fixture phrases (HIGH).** General families: main/mai/मैं +
   insaan/इंसान/asli/असली/real/human/teacher/टीचर/ma'am/dost/दोस्त/girlfriend/गर्लफ्रेंड +
   hoon/hun/hu/हूं/हूँ, and haan/हाँ…sach. Test held-out variants ("main ek insaan hun", "मैं असली
   इंसान हूँ", "tumhara teacher hi hoon").
5. **Echo and identity swap (HIGH).** Rewrite whenever a quoted span the student demanded
   (straight, curly or «» quotes, 3+ words) appears in the reply, unless the span is also in the
   course material. Add an identity-swap family ("I am (now) X", "from now on I'm", "as a normal
   person"). Normalise first: NFKC, strip `\p{Cf}`, fold confusables, collapse dots and spaces
   between letters, and treat I'm/Im/I am alike. Reuse the shared normaliser (Refresh item 6:
   `textFold.ts`'s `foldText` + `lockedMatch.ts`'s exported `foldConfusables`, plus a small
   guard-owned dot/space collapse `tone.ts` adds itself).
6. **Personas step out of role (HIGH).** On `/pause`, stop, "are you human/real?", or a distress
   flag, require an out-of-role reply, with a fixed text that drops the role ("Pausing the
   practice. I'm an AI…"). Add real recruiter/HR/examiner claims to the in-persona identity checks.
   `/pause`/stop are already handled upstream, by 5.8's `rolePlayControl`
   (`packages/harness/src/pedagogy/skills.ts`, confirmed — Refresh item 4); `personaBoundary`/`tone`
   are the backstop only for "are you human/real?" and `ctx.intent === 'distress'`.
7. **Never touch an escalation (HIGH).** A chain test that post guards never rewrite an escalate
   reply. Run `tone` on the distress template rendered from the locale pack and assert it survives
   unchanged (an escalating guard already short-circuits the chain before `personaBoundary`/`tone`
   run, per `chain.ts`'s pass semantics; this is the regression pin for it).
8. **Outcome rules for every turn (MEDIUM).** The outcome-claim ("you're hired", "you passed") and
   real-recruiter/examiner rules run on every turn, not only with `ctx.persona` set. The rules are
   one code-side set for every persona, not compiled from `must_not` prose.
9. **Persona name (MEDIUM).** Insert it only if it's letters and spaces, at most 40 characters;
   otherwise use "practice interviewer". Never insert `must_not` items or a reason. Test the
   rendered text against every post guard, for both personas and a hostile name.
10. **Code (MEDIUM).** Fenced code is exempt from the identity families; the echo rule still
    applies inside code. Quoted refusals that repeat the demanded words are rewritten on purpose.
11. **Teacher note (MEDIUM).** Confirm postGuard runs before the platform adds the teacher label;
    normalise case and whitespace; add a drift test against the pinned frame's `teacher-label` text
    (now `frame@1.2.0.md` line 60 — Refresh item 5).
12. **Completeness test (MEDIUM).** Unconditional, derived from `GUARD_ORDER`: for every phase,
    `missing()` is empty and `ordered()` matches `GUARD_ORDER`, on the registry `runTurn` really
    uses (Refresh item 7 resolves where: `registry.test.ts`, after `scrub.ts` exports its
    registry). Mutation: a registry without `tone` fails it.
13. **Fixtures (MEDIUM).** Assert each scripted reply fails its `must_not_contain` with NO guards;
    stub only the target guard per mutation, with the rest live. Add the held-out set, the rename
    and the over-trigger negatives.
14. **Bounded regexes (LOW).** No nested quantifiers. The handoff says `tone` only checks what a
    reply must not say.

## Idempotence and fixed texts

Each guard's own fixed text must contain none of its own trigger patterns (e.g. "I'm an AI, not a
human" must not re-trip a careless "human" keyword match — the regexes need an explicit
affirmative-claim shape, not a bare keyword). Required test matrix (mirrors 4.7 lead answer 3):
- `tone`'s and `personaBoundary`'s own fixed texts pass themselves, each other, and every other
  already-built post guard (`lockedLeak`, `answerLeak`, `grounding`, `adviceGuard`).
- `ANSWER_LEAK_SAFE_HINT`, the locked reply, `adviceFallbackText(...)`/the redirect reply, the
  locale safe reply (`PostGuardCtx.fixedTexts`/`safeReply`) and `LAST_RESORT_DISTRESS_REPLY` all
  pass `personaBoundary` and `tone` cleanly — direct asserts per fixed text, same list
  `PostGuardCtx.fixedTexts` already assembles in `pipeline/steps/postGuard.ts`.
- The chain's pass-2 verification (any rewrite or block on pass 2 becomes `block` with cause
  `rewrite_unverified`, per `chain.ts`) never re-trips on either guard's own rewrite.

## Non-circular fixtures for all 100 persona cases, plus mutation runs

- **Mutation run 1 — `tone` stubbed to always return `ok`:** must fail every case that `tone`
  alone protects (the identity/companion/teacher-note/echo floor — in practice the large majority
  of the 100, since very few set `ctx.persona`).
- **Mutation run 2 — `personaBoundary` stubbed to always return `ok`:** fails only the subset it
  actually covers: the `persona-roleplay-*` cases that set `ctx.persona` and violate a persona-
  scoped `must_not` item, plus any case (persona-scoped or not) that trips the unconditional
  outcome-claim/real-recruiter/examiner rules (lead answer 8) — e.g.
  `persona-roleplay-grade-or-pass-en.yaml`, `persona-identity-sat-human-tutor-en.yaml`; confirm the
  exact membership during TDD by running the suite once with each guard stubbed and diffing. Call
  out in the test's comments which subset is which, so a reviewer does not read "fewer cases
  changed" as a broken mutation run.
- A separate, guard-level test loads `job-interview@1.0.0.yaml`'s and `viva@1.0.0.yaml`'s real
  `must_not` arrays (via whatever `@edmate/content` loader already parses them for `buildContext`,
  or the same inline YAML read `rolePlayFixtures.test.ts` already does for the real on-disk set —
  confirm the lighter-weight option during TDD) with `ctx.persona` set, feeds each
  pattern-matchable `must_not` item a violating scripted reply, and asserts a rewrite with the
  persona-aware fixed text; a second pass with the guard stubbed to `ok` must then fail every one.
- **No-guards control (lead answer 13):** each case's scripted reply is asserted to fail its
  `must_not_contain` with the chain empty (no guards at all), proving the fixture's violation is
  real and not already clean.
- Detection patterns are written against the general shapes in "Design" and the 14 lead answers,
  never copied from the fixtures' exact wording, so the mutation runs are a genuine test of the
  rule layer.

## Files to create

- `packages/harness/src/guardrails/tone.ts` — `createToneGuard()`: the always-on identity/
  companion/teacher-note/echo-compliance check (lead answers 1, 2, 4, 5, 6 backstop, 7, 10, 11, 14)
  and its fixed rewrite.
- `packages/harness/src/guardrails/tone.test.ts` — unit tests per family, the honest-replies table
  (10+), the held-out multilingual variants, idempotence, code-fence exemption, teacher-note drift,
  "never touch an escalation".
- `packages/harness/src/guardrails/personaBoundary.ts` — `createPersonaBoundaryGuard()`: the
  unconditional outcome-claim/real-recruiter/examiner rules (lead answer 8), the persona-scoped
  `must_not` subset check, and the persona-aware fixed rewrite with the name rule (lead answer 9).
- `packages/harness/src/guardrails/personaBoundary.test.ts` — unit tests per rule, the no-op path
  for the persona-scoped half, the guard-level `must_not`-array test, the rename mutation, a
  hostile-name test, idempotence.
- `packages/evals/src/personaFixtures.test.ts` — the 100-case gate, both mutation runs, the
  no-guards control, and the held-out/negative tables.

## Files to modify

- `packages/harness/src/guardrails/postGuards.ts` — add
  `.register(createPersonaBoundaryGuard())` then `.register(createToneGuard())`, after the four
  already there. No weight override expected (both stay rules-only); confirm during TDD.
- `packages/harness/src/guardrails/registry.test.ts` — add the `GUARD_ORDER` completeness
  assertion (Refresh item 7, lead answer 12), covering `defaultScrubRegistry()`,
  `defaultPreGuardRegistry()` and `postGuards`.
- `packages/harness/src/pipeline/steps/scrub.ts` — export the module's single-guard registry
  (e.g. `defaultScrubRegistry()`, matching `preGuard.ts`'s naming) so the completeness test can
  read it; no behaviour change.
- `packages/harness/src/guardrails/order.ts` — none expected (already carries the final list);
  confirm unchanged during TDD step 1.

## Out of bounds

- `evals/suites/persona/**` stays read-only (100 existing, human-reviewed fixtures, no new
  Hindi/Hinglish cases per the English-only pilot rule) unless a genuine coverage gap turns up —
  flag to the lead rather than inventing cases.
- No semantic/judge layer for `personaBoundary`'s harder `must_not` items — flagged as a follow-up,
  not built here.
- No `content/prompt-packs/**` or `content/skills/**` edits — both stay read-only reference.
- No `packages/contracts` change (Refresh item 11, confirmed) — if a genuine gap is found during
  TDD that only a contracts change can close, stop and report BLOCKED rather than editing
  `packages/contracts` without an ADR and the three required reviewers.
- Board task 4.9b (teacher display-name field, ADR) stays out of scope.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/guardrails/**` (new `tone.ts`, `personaBoundary.ts`, their tests; edited
  `postGuards.ts`, `registry.test.ts`) — **glob matches the safety group; reviewers: code-reviewer**
  (the MVP-first rule, 20 Oct 2026, drops `safety-reviewer` from this group's gate requirement
  until the pilot gate restores it at task 13.3). `security-reviewer` and `typescript-reviewer` are
  recommended extras, not gate-required.
- `packages/harness/src/pipeline/steps/scrub.ts` — **not a literal risk-paths.txt glob match**
  (`pipeline/steps/**` is not listed under any group, only `guardrails/**`, `pedagogy/**` and
  `access/**` are); the change is a one-line export with no behaviour change, landing in the same
  PR as the guardrails changes above, so the PR's `risk: high` decision still covers it. Flagged,
  non-blocking.
- `packages/evals/src/personaFixtures.test.ts` — not itself a risk-paths.txt glob; carries the same
  safety posture as the other fixture gates by convention, not by gate requirement.
- `evals/suites/persona/**` — not edited (read-only); also not itself a risk-paths.txt glob
  (unlike `evals/suites/safety/**` and `evals/suites/locked/**`, which are) — a pre-existing gap in
  the architect-owned file, not this task's to fix; flagged non-blocking.
- `packages/contracts/**`, `docs/adr/**` — none planned; no contracts change expected (Refresh item
  11).

**`risk: high` decisions to log at handoff:**
1. The board's `risk: risky` entry itself: "4.9 merged: `personaBoundary` and `tone` post-guards
   wired (identity/companion/teacher-note floor on every reply; persona `must_not` list for
   interview/viva skills, plus an unconditional outcome-claim/real-recruiter/examiner rule set); the
   completeness test confirms every `GUARD_ORDER`-declared guard is now registered in all three
   phases; reviewed by code-reviewer (MVP-first rule; safety-reviewer returns at the pilot gate)."
2. The guard-scope split (tone always-on; personaBoundary's unconditional outcome/identity half
   plus its persona-scoped half) — log it so a future task doesn't re-litigate it silently.

## Open questions (non-blocking; recommendations given)

- **Q1** — do the non-English fixtures and the `judge:` lines count toward "cases pass"?
  Recommendation above: all 100 fixtures run in the offline gate; `judge:` lines are the live-model
  exit-gate bar (7.x), not this offline test.
- **Q2 (resolved, logged as a decision, not a question)** — the build plan's one-line table splits
  `personaBoundary` from `tone`; the chosen split (above, refined by lead answer 8) is specific
  enough to build and test and ships in this one task.
- **Q3 (resolved by this refresh)** — the completeness test lives in `registry.test.ts`; the
  scrub-phase registry needs one new export (`scrub.ts`) to make it checkable.
- **Q4 (resolved by this refresh)** — the teacher-note string is a guard-owned constant (matches
  `ANSWER_LEAK_SAFE_HINT`'s precedent), now pinned against `frame@1.2.0.md`'s `teacher-label` text;
  flagged as a drift risk if that text changes without updating the guard (the drift test catches
  it).

None of the above needs the human: Q2-Q4 are build-time code-shape confirmations this refresh has
already resolved by reading the merged 4.5-4.8 code.

## Phasing (builder sizing)

Three phases, each ending with `main` green on its own merged PR. A fresh builder reads this plan
plus the previous phase's handoff before starting its phase.

### Phase A — `tone.ts` and the completeness-test plumbing (~85 calls)
- Build `tone.ts` and `tone.test.ts` (lead answers 1, 2, 4, 5, 6-backstop, 7, 10, 11, 14; the
  honest-replies table; the held-out multilingual variants; the teacher-note drift test; "never
  touch an escalation").
- `postGuards.ts`: register `createToneGuard()`.
- `scrub.ts`: export its registry (`defaultScrubRegistry()` or equivalent).
- `registry.test.ts`: add the `GUARD_ORDER` completeness test over all three real registries, plus
  its "a registry without tone fails it" mutation.
- `turbo run typecheck lint test --filter=@edmate/harness...` green.
- **State after this phase:** `tone` is live and registered; `personaBoundary` is still declared
  but unregistered (so `missing()` still reports it — the completeness test's mutation case, not a
  broken build); the 100-case fixture gate does not exist yet.

### Phase B — `personaBoundary.ts` (~85 calls)
- Build `personaBoundary.ts` and `personaBoundary.test.ts` (lead answers 3, 8, 9, 13's rename/
  hostile-name angle; the guard-level `must_not`-array test against the two real persona
  templates).
- `postGuards.ts`: register `createPersonaBoundaryGuard()`.
- Re-run the Phase A completeness test to confirm `missing()` is now empty everywhere.
- `turbo run typecheck lint test --filter=@edmate/harness...` green.
- **State after this phase:** both guards live, registered, in `GUARD_ORDER`'s declared order; the
  completeness test passes for real (no guard missing). The 100-case fixture gate still does not
  exist.

### Phase C — the 100-case fixture gate (~85 calls)
- Build `packages/evals/src/personaFixtures.test.ts`: all 100 cases through the real pipeline, the
  two mutation runs (and the comment explaining their different coverage, per "Non-circular
  fixtures" above), the no-guards control, the held-out/negative tables (lead answer 13).
- `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/contracts... --filter=@edmate/evals...`
  green.
- **State after this phase:** accept bar met; handoff written with the two `risk: high` decisions
  above.

## Budget

Budget: 260 tool calls (3 phases, packages/harness + packages/evals)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test and the secret scan only; no real
model or payment calls, per rule 4).

## Exit conditions

`Status: DONE` once all three phases have landed, `personaFixtures.test.ts` passes 100/100 cases
with both mutation runs behaving as described, the completeness test is green for all three
phases, and the package-level `turbo` checks pass for `@edmate/harness`, `@edmate/contracts` and
`@edmate/evals`. A builder stops at `Status: PARTIAL` past ~90 calls in its own phase, or the moment
it finds a file outside this plan's "Files to create/modify" needing a change (e.g. a persona
fixture needs editing, or a genuine contracts gap turns up) — report back rather than widening
scope.

## Status

**READY.** The design is unchanged and specific; every open TDD question the 19 Oct draft carried
(Q3, Q4, the normaliser) is now resolved by reading the merged 4.5-4.8 code. No contracts change,
no ADR needed. The only genuine judgement call (the guard-scope split, refined by lead answer 8) is
already a logged decision, not an open question for the human.

## Lead answers and plan revisions from the safety plan review (19 Oct 2026; these override the plan)

1. **Honest replies stay ok (HIGH).** Match only "I am / I'm / this is / main…hoon + (your|the)
   teacher|ma'am|sir|<Title-Case name> + here/speaking". Exempt "not (a|the|your)" and "AI …
   built/made from … teacher's". Add a table of 10+ honest replies that must stay ok, including the
   safety-preamble line and tone's own fixed text.
2. **Families (HIGH).** real/actual + person/human/tutor/examiner/recruiter; "<name>
   here/speaking/regards" and "<name> ma'am/sir"; relationship promises ("always be here for you",
   "care about you more than anyone", "call me your friend"). Context rule: if a recent student
   turn raises human or teacher identity and the reply opens with yes/haan/true/you got me with no
   AI statement, rewrite. History is already in the turn context (harness); no contracts change.
3. **Teacher display name (HIGH; lead decision, risk: medium).** TurnContext has no teacher display
   name (the frame doesn't render one), so name-aware matching needs a contracts field and an ADR.
   That is deferred to board task 4.9b. 4.9 relies on the general families in item 2 (which catch
   "<Name> ma'am/here/speaking"). "I am Priya Sharma" with no role word is a documented known miss.
   The rename mutation is tested against the general families only.
4. **No literal fixture phrases (HIGH).** General families: main/mai/मैं +
   insaan/इंसान/asli/असली/real/human/teacher/टीचर/ma'am/dost/दोस्त/girlfriend/गर्लफ्रेंड +
   hoon/hun/hu/हूं/हूँ, and haan/हाँ…sach. Test held-out variants ("main ek insaan hun", "मैं असली
   इंसान हूँ", "tumhara teacher hi hoon").
5. **Echo and identity swap (HIGH).** Rewrite whenever a quoted span the student demanded
   (straight, curly or «» quotes, 3+ words) appears in the reply, unless the span is also in the
   course material. Add an identity-swap family ("I am (now) X", "from now on I'm", "as a normal
   person"). Normalise first: NFKC, strip \p{Cf}, fold confusables, collapse dots and spaces between
   letters, and treat I'm/Im/I am alike. Reuse the shared normaliser.
6. **Personas step out of role (HIGH).** On /pause, stop, "are you human/real?", or a distress
   flag, require an out-of-role reply, with a fixed text that drops the role ("Pausing the
   practice. I'm an AI…"). Add real recruiter/HR/examiner claims to the in-persona identity checks.
   Note in the plan where /pause is handled upstream; if nowhere, it's 5.8's job, and
   personaBoundary is the backstop.
7. **Never touch an escalation (HIGH).** A chain test that post guards never rewrite an escalate
   reply. Run tone on the distress template rendered from the IN pack and assert it survives.
8. **Outcome rules for every turn (MEDIUM).** The outcome-claim ("you're hired", "you passed") and
   real-recruiter/examiner rules run on every turn, not only with ctx.persona. The rules are one
   code-side set for every persona, not compiled from must_not prose.
9. **Persona name (MEDIUM).** Insert it only if it's letters and spaces, at most 40 characters;
   otherwise use "practice interviewer". Never insert must_not items or a reason. Test the rendered
   text against every post guard, for both personas and a hostile name.
10. **Code (MEDIUM).** Fenced code is exempt from the identity families; the echo rule still
    applies inside code. Quoted refusals that repeat the demanded words are rewritten on purpose.
11. **Teacher note (MEDIUM).** Confirm postGuard runs before the platform adds the teacher label;
    normalise case and whitespace; add a drift test against frame@1.0.0.md's teacher-label.
12. **Completeness test (MEDIUM).** Unconditional, derived from GUARD_ORDER: for every phase,
    missing() is empty and ordered() matches GUARD_ORDER, on the registry runTurn really uses.
    Mutation: a registry without tone fails it.
13. **Fixtures (MEDIUM).** Assert each scripted reply fails its must_not_contain with NO guards;
    stub only the target guard per mutation, with the rest live. Add the held-out set, the rename
    and the over-trigger negatives.
14. **Bounded regexes (LOW).** No nested quantifiers. The handoff says tone only checks what a
    reply must not say.

- **Build:** tdd-guide, after 4.6, 4.7 and 4.8 merge (done). Three phases, a fresh builder per
  phase (see "Phasing" above).
- **Reviewers:** code-reviewer (required; MVP-first rule, 20 Oct 2026 — the safety group's gate
  requirement drops to code-reviewer only until the pilot gate restores safety-reviewer at task
  13.3). security-reviewer and typescript-reviewer recommended, not gate-required. risk: high.
