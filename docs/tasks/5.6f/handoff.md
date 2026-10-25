# 5.6f handoff: release the practice key on a turn graded correct

**Status:** DONE

## What changed

1. `packages/harness/src/pedagogy/policy.ts`: `finish()` takes an `opts: { allowPracticeRelease?: boolean }`
   argument. `decidePolicy`'s one real call site to `finish()` passes `{ allowPracticeRelease: true }`;
   every `closed()` redirect passes none (default `false`). `finish()` computes
   `practiceSolved = allowPracticeRelease && ctx.attempt === 'correct' && holdsPracticeKey(help)` and
   ORs it into `keysFor`'s release condition. Updated the `finish()` and `keysFor` comments to say the
   key is released once the attempt grades correct (5.6f), not "never released, whatever the move".
2. `packages/harness/src/pipeline/runner.ts`: `loadAnswerContext` computes
   `solved = holds && ctx.attempt === 'correct'` and excludes the solved item from both
   `loadedPracticeKeys` (keeps the carried key) and `loadedItems` (skips the registry resolve), so
   `compileAnswerKeys` can't re-derive the released item's label/option-text/position/ruling-out
   checks from `items`.
3. `packages/harness/src/pedagogy/policy.test.ts`: new `describe('practice key release on a correct
   attempt (5.6f)')` block — release on correct + holding; a carried key from an unrelated item
   stays guarded even then; wrong/partial/none unchanged (regression); every closed path
   (distress/misuse/off_topic/meta/locked/not_covered) never releases even with `attempt: 'correct'`.
4. `packages/harness/src/pipeline/runner.practiceKinds.test.ts`: flipped the "known limit (Q5)" test
   to "5.6f: ..." (now expects delivery, not the hint); added a `laterCorrect` helper (a narrow local
   `route.run`/`decide.run` override, per the plan's Q2) and a new
   `describe('5.6f: release the practice key on a turn graded correct')` block: correct delivers the
   confirmation; wrong still gets the hint; a carried key stays guarded on a correct attempt; a
   no-key-content claim stays guarded; a matching question-phrase guess is delivered; a non-matching
   question-phrase guess and a hedged multi-label guess still get the hint.
5. `packages/harness/src/routing/classify.test.ts`: added a `message`-kind label-key regression
   (gap from Files item 5): `"so it's b?"`/`"is it b?"` → correct; `"is it c?"` → wrong; `"is it a, b
   or c?"` → wrong; `"a or b?"` → none (not answer-shaped: has `?`, no LEAD_IN match).

## Evidence

| Claim | Evidence |
|---|---|
| A correct MCQ answer gets a confirmation that names the key | `runner.practiceKinds.test.ts`: `5.6b: answered without a false block > 5.6f: a correct "B" followed by "Yes, B is right!" is delivered` (flipped from "known limit (Q5)"). |
| A wrong answer still cannot get the key | `runner.practiceKinds.test.ts`: `5.6f: release the practice key on a turn graded correct > a wrong answer ("A") followed by "Yes, B is right!" still gets the safe hint (regression)`. |
| The key leaves HelpState once the attempt is correct | Unchanged, already true (`ladder.ts`/`skills.ts`); not re-written. |
| This-turn release, unit level | `policy.test.ts`: `practice key release on a correct attempt (5.6f)` — release; carried key guarded; wrong/partial/none regression; every closed path regression. |
| The pipeline doesn't reintroduce the key via items/practiceKeys | `runner.practiceKinds.test.ts`: `5.6f: ... > a carried key from an unrelated skipped item stays guarded even on a correct attempt` (the solved item is excluded from `loadedItems`/`loadedPracticeKeys`; the carried key's own leak still blocks). |
| Attack cases | `runner.practiceKinds.test.ts`: wrong-answer regression (a); no-key-content claim stays guarded (b); non-matching and hedged multi-label still hinted (d, lead's extra case). `classify.test.ts`: the label question-phrase regression proves (c) and (d) at the classify level. (Lead note: the runner-level "so it's B?" test cannot inject the guess text, so it only repeats the base correct case; making it real is deferred to 5.6h.) |
| Nothing else regresses | Full gate green (below); `git diff origin/main -- packages/contracts apps packages/db` empty. |

## Gate result

`corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1`:
exit 0, `Tasks: 10 successful, 10 total`. `src/pedagogy/policy.ts` and `src/pedagogy` package: 100%
branch/line/function coverage. `python3 .githooks/secret-scan.py --all`: clean (no output).
`git diff origin/main -- packages/contracts apps packages/db`: empty.

## Decisions

### 24 Oct 2026 · 5.6f release a correctly graded practice key · decided by lead · risk: high
- Decided: A practice key is released from `mustNotReveal`, and the loaded item is dropped from the
  turn's `items`/`practiceKeys`, on a turn `classifyAttempt` grades `correct` for the held key
  (never on a closed/redirect path, even if `attempt` coincidentally reads `correct`; never for a
  `practiceCarriedKey` from a different, skipped item).
- Why: This closes the 5.6b Q5 known limit: a correct-answer confirmation that restates the key is
  now delivered instead of replaced by the safe hint, which was confusing and undermined trust in a
  turn the student actually got right.

### 24 Oct 2026 · Q1: a question-phrased correct guess releases the key · decided by lead · risk: low
- Decided: yes, release — "so it's B?" is treated the same as a flat "B" (existing, tested
  `classifyAttempt` behaviour, unchanged by 5.6f). A hedged multi-label guess ("is it A, B or C?")
  never grades `correct` (`labelsNamed` requires exactly one named label), confirmed by a new
  `classify.test.ts` case, so it never releases.
- Why: a tutor confirming a correct guess however it is phrased is intended behaviour, not a new
  hole; this question-as-guess path was never exploitable before 5.6f (practice keys were never
  released at all).

### 24 Oct 2026 · Q2: how the runner test reaches `ctx.attempt === 'correct'` · decided by lead · risk: low
- Decided: adopt the recommendation — a narrow local `laterCorrect` helper overriding `route.run`
  and `decide.run` only for the new/flipped tests, not a restructure of the suite's `turn()` helper.
- Why: exercises the real risk (runner.ts's `items`/`practiceKeys` fix) without re-plumbing the
  whole fixture file onto the real `decide`/`route` steps; `policy.test.ts` separately proves the
  policy half.

### 24 Oct 2026 · Q3: `fallbackPolicy` stays guarded · decided by lead · risk: low
- Decided: no change to `fallbackPolicy`.
- Why: it only returns `ask`/`redirect` on a provider/judge failure; widening what a degraded path
  may say is the wrong direction for a leak guard.

### 24 Oct 2026 · 5.6f budget overrun accepted · decided by lead · risk: low
- Decided: accept 75 tool calls against the plan's 60.
- Why: the diff stayed inside the plan's Files list, the harness gate is green and all three reviewers approve; the builder under-counted (26 reported).

### 24 Oct 2026 · 5.6f runner-level question-phrase test deferred to 5.6h · decided by lead · risk: low
- Decided: defer the code-reviewer MEDIUM on packages/harness/src/pipeline/runner.practiceKinds.test.ts:377 (the "so it's B?" runner test is identical to the base correct case because `laterCorrect` cannot inject the guess text) to board task 5.6h.
- Why: the question-phrase grading it claims to cover is proven in classify.test.ts, and the release itself is proven by the base runner test and policy.test.ts; the duplicate test is misleading but hides no leak.

## Budget

Tool calls used: 75 (harness count; the agent reported 26)
