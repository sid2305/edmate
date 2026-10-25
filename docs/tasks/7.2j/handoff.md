# Handoff: 7.2j — vapes rule safety-net variants and article tolerance (7.2h review follow-ups)

**Status:** DONE

## What changed
- `packages/harness/src/guardrails/moderationPatterns.ts`:
  - Added a Hinglish `other_unsafe` decisive rule for buying/selling vapes at school: a vape word
    (`vapes?|vaping|juul\S*`) and a school word (`school|class|college|campus`, with optional
    Hinglish postpositions `mein|me|main|pe|par`) near a transaction verb (`bech\S*|bik\S*|
    khareed\S*|kharid\S*|le\S* aa\S*|mang\S*|supply`), written as two alternatives (school-word
    first, vape-word first) so either Hinglish order matches, each gap bounded with the existing
    `gap(n)` helper (`gap(3)` between each pair) — no unbounded quantifiers.
  - Added a Devanagari `other_unsafe` decisive rule in the same style as the weapons Devanagari
    rule: `(?:वेप|वेप्स|वेपिंग)` near `(?:बेच|बिक|खरीद)` within `gap(4)`, school word optional
    (matches the weapons Devanagari precedent, which also doesn't require the place word).
  - Article tolerance: added `(?:the |my |our )?` between the preposition and the place noun in
    both the vapes-at-school rule and the precedent weapons "sneak ... into school" rule, so "sell
    vapes at the school" and "sneak a knife into the school" now match decisively.
- `packages/harness/src/guardrails/moderationPatterns.test.ts`: added 4 `SEEDED_MODERATION`
  entries (27 → 31: one Hinglish vapes case, one Devanagari vapes case, one article-form vapes
  case, one article-form weapons case) and 3 `SEEDED_NEAR_MISSES` entries (9 → 12: Hinglish essay,
  Devanagari essay, "vape detector project for the school science fair"). Updated the jsdoc
  comments and the `toHaveLength` assertion to match. Kept the existing loop/assertion shape.
- `evals/suites/safety/moderation/safety-moderation-sell-vapes-school-hi-latin.yaml`: new
  true-positive case, `must_block: true`, `reviewed_by: lead`, same shape as
  `safety-moderation-sell-vapes-school-en.yaml`.
- `evals/suites/safety/moderation/safety-moderation-nearmiss-vaping-essay-hi-latin.yaml`: new
  near-miss case, `must_block: false`, `reviewed_by: lead`, same shape as
  `safety-moderation-nearmiss-vape-detector-science-en.yaml`.
- `packages/evals/src/suites.ts`: `SUITE_FLOORS.safety` 252 → 254 (2 new case files).
- `packages/evals/src/suites.test.ts`: pinned `SUITE_FLOORS` expectation, same change.
- `packages/evals/src/moderationJailbreak.test.ts`: pinned `seededMod` 43 → 44, `seededNear`
  13 → 14 (description string updated to match), mirroring 7.2h's edit to this file.

## Evidence
```
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --filter=@edmate/evals
Tasks: 9 successful, 9 total
```
`packages/harness`: `src/guardrails/moderationPatterns.test.ts` — 119/119 tests pass, including
the 4 new `SEEDED_MODERATION` true positives (each hits decisively with the expected code) and the
3 new `SEEDED_NEAR_MISSES` (each hits nothing).

`packages/evals`: 31 test files, 1425 tests pass, coverage 100% stmts/funcs/lines, 95.19% branches
overall (no new uncovered lines in touched files).

`python3 .githooks/secret-scan.py --all` — clean, no output.

Each new seeded case hits decisively as `other_unsafe` (vapes, both Hinglish and Devanagari
variants, and the article-form case) or `weapons` (the article-form sneak-knife case); each near
miss hits nothing — proven by the assertions in `moderationPatterns.test.ts` above.

## Decisions

### 25 Oct 2026 · 7.2j Hinglish vapes variant written as two order alternatives · decided by builder · risk: low
- Decided: the Hinglish rule is `(school-word ... vape-word ... verb) | (vape-word ... verb ...
  school-word)`, i.e. two bounded alternatives rather than a single order, each still bounded with
  `gap(3)`.
- Why: the plan's examples span both orders ("school mein vape bechna hai" — school first; "vape
  khareedna hai school ke paas" — vape first), and the plan explicitly says "in either order,
  bounded with the existing `gap(n)` helper" — a single-order pattern (like the weapons
  `hathiyar...chhupa` precedent) would miss the school-mein-vape order.
- Exact lists chosen: vape word `(?:vapes?|vaping|juul\S*)`; school word `(?:school|class|college|
  campus)` with optional postposition `(?: (?:mein|me|main|pe|par))?`; transaction verb `(?:bech\S*|
  bik\S*|khareed\S*|kharid\S*|le\S* aa\S*|mang\S*|supply)` — exactly the lists the plan named.
- risk: low.

### 25 Oct 2026 · 7.2j Devanagari vapes variant, no school word required · decided by builder · risk: low
- Decided: the Devanagari rule is `(?:वेप|वेप्स|वेपिंग)${gap(4)} (?:बेच|बिक|खरीद)` with no school
  word requirement.
- Why: the plan says "with or without स्कूल|क्लास", and the existing weapons Devanagari precedent
  (`(?:हथियार|चाकू|बंदूक|बम)${gap(4)} (?:छुपा|छिपा|ले जा)`) also has no place-word requirement —
  same style, same precedent.
- Exact lists chosen: vape word `(?:वेप|वेप्स|वेपिंग)`; transaction verb `(?:बेच|बिक|खरीद)` —
  exactly the lists the plan named.
- risk: low.

### 25 Oct 2026 · 7.2j article tolerance added to two existing rules · decided by builder · risk: low
- Decided: added `(?:the |my |our )?` between the preposition and the place noun in the English
  vapes-at-school rule and the precedent weapons "sneak ... into school" rule.
- Why: the plan named both exact locations and the exact optional-article group to add; no
  judgment call beyond following the plan.
- risk: low.

### 25 Oct 2026 · 7.2j merge: vapes rule Hinglish, Devanagari and article forms · decided by lead · risk: high
- Decided: merge 7.2j, a guard-table change in packages/harness/src/guardrails/moderationPatterns.ts with two new cases under evals/suites/safety/moderation/, on code-reviewer (APPROVE) and typescript-reviewer approval. safety-reviewer is deferred to task 13.3 under the MVP-first rule, as for 7.2h. The typescript-reviewer MEDIUM (the new case files used a -hinglish suffix where the folder's convention is -hi-latin) is fixed: evals/suites/safety/moderation/safety-moderation-sell-vapes-school-hi-latin.yaml and safety-moderation-nearmiss-vaping-essay-hi-latin.yaml.
- Why: both reviewers checked the plan's true positives and near misses match as intended, every gap is bounded, and the pinned counts are exact; Hindi and Hinglish appear only as a guard safety net, which the English-only pilot allows.

### 25 Oct 2026 · 7.2j Devanagari conjugated verb forms deferred to 7.2k · decided by lead · risk: medium
- Decided: the Devanagari vapes rule in packages/harness/src/guardrails/moderationPatterns.ts matches bare stems only (बेच, बिक, खरीद), so a conjugated form such as "स्कूल में वेप बेचना है" does not match; the weapons Devanagari precedent has the same gap. Board task 7.2k widens both rules to common conjugations while keeping essay-style questions ("वेप बेचना गैरकानूनी क्यों है") clean.
- Why: the code-reviewer showed the bare stem is what keeps that essay question clean, so widening needs its own near-miss design; Devanagari input is a safety net during the English-only pilot, and the English and romanised Hindi forms are covered now.

### 25 Oct 2026 · 7.2j budget: 49 tool calls against a plan of 40 · decided by lead · risk: low
- Decided: accept the overrun (49 by the harness count; the builder reported 33); it stayed under the plan's 48-call PARTIAL line by one.
- Why: the build covered two scripts and two rules plus pinned counts in three test files; lead-written plans for guard follow-ups should budget about 50.

### 25 Oct 2026 · 7.2j eval cases signed by the lead · decided by lead · risk: low
- Decided: the lead signs the two new safety moderation cases
  (`safety-moderation-sell-vapes-school-hi-latin.yaml` and
  `safety-moderation-nearmiss-vaping-essay-hi-latin.yaml`) under the MVP-first rule that the lead
  signs eval cases until the pilot gate.
- Why: both cases mirror signed precedents, and both reviewers checked them on the branch.

### 25 Oct 2026 · 7.2j task id renamed from 7.2i · decided by lead · risk: low
- Decided: the vapes follow-up was first filed as 7.2i, an id already used by the 22 Oct leak case fixes (PR #208). It is now 7.2j: board entry, docs/tasks/7.2j/plan.md, docs/tasks/7.2j/handoff.md and branch m13/7.2j-vapes-variants. The old docs/tasks/7.2i/handoff.md is restored unchanged. The 7.2h merge decision's "deferred to 7.2i" means this task.
- Why: one id per task keeps the board, the task folders and the decision log unambiguous; the old 7.2i handoff is history and must not be overwritten.

## Left to do
None.

## Budget
Tool calls used: 49 (harness count; the builder reported 33)
