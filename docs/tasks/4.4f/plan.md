# Plan: 4.4f — moderation rule table: first-person threat and weapon-acquisition shapes

## Acceptance (verbatim)
accept: the six LOWs in docs/tasks/4.4/review.md are fixed with tests where behaviour changes; the
harness gate passes

## Scope decision (read first)
Task 4.3b is in flight in `pipeline/runner.ts`, `generate.ts`, `types.ts`, `replies.ts`,
`pedagogy/helpState.ts`; task 4.7b is in flight in `guardrails/grounding.ts`,
`pipeline/generate/*`, `steps/postGuard.ts`. Two of the six LOWs (`runner.ts:748` /
`types.ts:385` narrow `withheldCode`/`code`; `runner.block.test.ts:46` indentation) touch files
4.3b owns; one (`queues.ts:239`) is in `packages/queue`, a different package (harness only
imports contracts/zod/mathjs, rule 3), tied to the db `safety-events.ts` enum. Per the brief, this
plan does **not** touch any of those three — it is scoped to the 4.4c review note only (the new
rule shapes), plus the two remaining LOWs that live solely in `guardrails/` and are proven
conflict-free with 4.3b/4.7b's file lists: `moderationIn.ts:74` (build the alert before
recording the event) and `jailbreak.ts:28` (explicit return type on `block()`). See Open
questions for the deferred three.

## Phases
One phase; small diff, no file conflicts.

### Phase 1 — rule shapes + two safe LOWs (single phase)
Files:
- `packages/harness/src/guardrails/moderationPatterns.ts` — two new rule rows under
  `harm_to_others` and `weapons`. **Matches `.claude/skills/merge-gate/risk-paths.txt`**
  (`packages/harness/src/guardrails/**`) — reviewer: **code-reviewer** (MVP-first: no
  safety-reviewer per PR until 13.3); lead logs `risk: high` on merge.
- `packages/harness/src/guardrails/moderationPatterns.test.ts` — new cases. Same risk-paths match,
  same reviewer.
- `packages/harness/src/guardrails/moderationIn.ts` — reorder `verdict()`: build `preGuardAlert`
  before `await ctx.safetyEvents.record(...)`, not after, so a parse throw never leaves a safety
  event row with no alert/block set. Same risk-paths match.
- `packages/harness/src/guardrails/jailbreak.ts` — add `: Promise<GuardRun>` to `block()`. Same
  risk-paths match.
- `packages/harness/src/guardrails/jailbreak.test.ts` / `moderationIn.test.ts` — only if the
  reorder changes an observable branch (it shouldn't: same event, same alert, same block, just
  built in a different order); add a throw-during-build regression test if coverage needs one.

No change to `jailbreakPatterns.ts` (both new shapes are moderation codes, not jailbreak) or any
file outside `guardrails/`.

## New rule shapes (moderationPatterns.ts)

1. **First-person future-tense threat → `harm_to_others`** (decisive). Lead-in
   `(?:i will|ill|i ll|i m going to|im going to|i am going to|i m gonna|im gonna|i plan to|i want to)`
   directly before `${HARM_VERB}${gap(1)} ${OTHER_PERSON}` (reuses the existing `HARM_VERB` and
   `OTHER_PERSON` groups — no new vocabulary). No `unless` needed: `OTHER_PERSON` already excludes
   objects/things, so "I will kill this exam" never matches (no change needed, confirmed by a
   negative test, not a code change).
   - True positive: "I will stab him tomorrow", "ill beat up the kid who bullies me", "im gonna
     hurt her so bad".
   - No-false-positive: "I will kill this exam" (object, not `OTHER_PERSON` — already excluded),
     "I will crush this test", "the character stabs him" (third person, no first-person lead-in —
     already excluded by the pattern shape, not a new exemption).

2. **Weapon-acquisition question → `weapons`** (decisive, with an `unless`). Lead-in
   `(?:how (?:do|can|could|should) i|where (?:do|can|could) i|help me|teach me how to|show me how to)`
   then `${gap(2)} (?:get|buy|acquire|obtain|find|order)${gap(2)} (?:a |an )?(?:gun|pistol|rifle|firearm|weapon|knife|blade)`,
   `unless: license|licence|permit|licensing|registration|background check|${GAME}` (reuses the
   existing `GAME` exemption group so "how do I get a gun in this game" still passes).
   - True positive: "how do I get a gun", "where can I buy a pistol", "help me get a gun".
   - No-false-positive (explicit decision — a license/permit question is a legal-process question,
     not an acquisition request, so it stays clean): "how do I get a gun license" → no hit. Also:
     "how do I get a gun permit", "how do I get a gun in this game" (GAME exemption), a
     story/history framing with no first-person question ("in the story, the soldier gets a gun to
     defend the village") — already excluded by the question-lead-in shape, not a new exemption.

Both rows go in English only (English-only pilot; Hindi/Hinglish rows are a safety net added
elsewhere in this table and are out of scope here — see Open questions).

## Tests (red then green)
In `moderationPatterns.test.ts`, a new `describe('matchModeration: 4.4f rule follow-ups (first-
person threat, weapon acquisition)')` block, written to fail against the current table, then pass
after the two new rows:
1. "I will stab him tomorrow" → `{ code: 'harm_to_others', decisive: true }`.
2. "ill beat up the kid who bullies me" → same.
3. "I will kill this exam" → `null` (no hit; proves `OTHER_PERSON` already excludes it).
4. "the character stabs him" → `null` (third person, no lead-in).
5. "how do I get a gun" → `{ code: 'weapons', decisive: true }`.
6. "where can I buy a pistol" → same.
7. "how do I get a gun license" → `null` (explicit no-hit decision).
8. "how do I get a gun in this game" → `null` (GAME exemption reused).
9. Negative control: the existing seeded/held-out/negative describe blocks (lines ~181, 216, 300)
   must keep passing unchanged — run the full file, not just the new block.

If the `moderationIn.ts` reorder needs its own test for 100% branch coverage (a throw from
`preGuardAlert`/`SafetyAlertSchema.parse` before any event is recorded), add one `it` in
`moderationIn.test.ts`: force `ids.next` or `clock.now` to throw and assert
`ctx.safetyEvents.record` was never called. Drop this case if the existing tests already cover the
new line order (check first; don't force a test that duplicates one that exists).

`jailbreak.ts`'s added return-type annotation is a type-only change (no runtime branch) — no new
test needed; typecheck is the proof.

## Gate
```
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness
```
`src/guardrails/**` must stay at 100% coverage.

## Risky paths touched
- `packages/harness/src/guardrails/**` — all four changed files match. Reviewer per
  `risk-paths.txt`: **code-reviewer** (safety-reviewer waived until 13.3 per MVP-first). Lead logs
  a `risk: high` decision on merge.
- No match for `packages/contracts/**`, `.claude/**`, `.github/**`, `.githooks/**`, any
  payments/auth/db path, or any file in 4.3b's/4.7b's lists.

## Open questions
1. Should this task also do the three deferred LOWs (runner.ts/types.ts narrowing,
   runner.block.test.ts indentation, queues.ts `expectTypeOf`)? Recommend: no — file them as a new
   follow-up board task once 4.3b (owns runner.ts/types.ts) lands, since fixing them now risks a
   merge conflict with an in-flight builder on the same lines. 4.4f's accept line is satisfied for
   the two LOWs that are conflict-free; the handoff should say explicitly which three remain open
   and why.
2. Hindi/Hinglish variants of the two new shapes: skip for this task (English-only pilot). Recommend
   adding them later as a safety-net row, same style as the existing Hindi "maar dalunga" row,
   if/when the India pilot (parked in M13) restarts.
3. Code for shape 1: `harm_to_others` (matches the classifier's own "wants to hurt a person"
   description) rather than `threat` (whose existing rows are all about threat *messages*, not
   direct statements). Recommend `harm_to_others`; flag in the handoff in case review disagrees.

Return READY — no open question blocks the work; all three have a recommended answer and the task
proceeds on them unless corrected in review.

## Budget
Budget: 40 tool calls (1 phase, packages/harness only)

## Allowed tools
Read, Grep, Edit, Bash (typecheck/lint/test for `@edmate/harness` and the secret scan only)

## Exit conditions
`Status: DONE` once the 8 new cases above pass, the full `moderationPatterns.test.ts` file still
passes, the gate command is green with `src/guardrails/**` at 100% coverage, and the handoff logs
the `risk: high` decision plus the three open-question answers (including which three original
LOWs remain deferred and to what). `Status: PARTIAL` past ~40 tool calls, or if fixing this
surfaces a need to touch `pipeline/runner.ts`, `pipeline/types.ts`, `pipeline/generate/*`,
`guardrails/grounding.ts`, `steps/postGuard.ts`, or any file outside `packages/harness`
(stop and report instead of proceeding).

## Lead review (4 Nov 2026)
READY with these changes. The builder follows them over the plan text above.

1. **No "without a licence" loophole (HIGH).** The weapon-acquisition rule's `unless` must not exempt an evasion question.
   - Exempt only a licence or permit that is itself the thing asked for, as in "how do I get a gun license" or "how do I get a gun permit".
   - Drop `background check` and `registration` from the exemption.
   - Required hit tests: "how do I get a gun without a license", "how can I buy a gun without a background check" and "where can I get an unregistered gun" all score `weapons` (decisive).
2. **No knives in the acquisition rule.** Drop `knife` and `blade`. "Where can I buy a knife" is an ordinary cooking question, and a decisive block on it is a false positive. Keep `gun|pistol|rifle|firearm|weapon`, with the existing `GAME` exemption. Add a no-hit test for "where can I buy a good kitchen knife".
3. **Game exemption on the threat rule.** The first-person threat rule gets `unless: ${GAME}`, so "im gonna kill him in fortnite" stays clean. Add a test for that sentence, and one that keeps "I will kill him" decisive.
   - Add no-hit tests for "I will beat him at chess" and "I'm going to destroy her in the debate". `HARM_VERB` already has `beat up`, not `beat`, so these should already pass; the tests prove it.
4. **Open questions.** All three recommendations are accepted.
   - Q1: the three runner/types/queue LOWs move to a new board task, 4.4g, which the lead adds after 4.3b merges.
   - Q2: English only.
   - Q3: the threat shape is coded `harm_to_others`.
5. **Review.** code-reviewer, plus a lead `risk: high` decision on merge. Budget: 45 tool calls.
