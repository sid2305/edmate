# 5.6f plan: release the practice key on a turn graded correct

Status: READY. Planner: sonnet. Risk: high (pilot-blocking, student-safety answer-key leak path).
Sources: `docs/tasks/5.6b/plan.md` (design, Q5, "Lead answers"), `docs/tasks/5.6b/handoff.md` and
`review.md`, `docs/tasks/5.6g/handoff.md` (the stream gate's per-reply ruled-out record), and the
merged code in `packages/harness/src/pedagogy/{policy,ladder,skills,helpState}.ts`,
`packages/harness/src/pipeline/runner.ts`, `packages/harness/src/pipeline/generate/{answerKey,
streamGate,itemContext}.ts`, `packages/harness/src/routing/classify.ts`.

Board: milestone M13, dep `5.6b` (done), branch `m13/5.6f-release-correct-key`. Scope is
`packages/harness` only (`pedagogy/**` and `pipeline/runner.ts` plus their tests).

## Acceptance (verbatim, board)

Title: "5.6b plan Q5 follow-up (pilot-blocking): release the practice key on a turn that is graded
correct, so a confirmation that restates the key ("Yes, B is right!") is not replaced by the safe
hint; drop the key from HelpState once the attempt is correct"

Accept: "harness typecheck, lint and test green; a runner test shows a correct MCQ answer gets a
confirmation that names the key, and a wrong answer still cannot get the key"

### How it is shown (paste into handoff.md)

| Claim | Evidence |
|---|---|
| A correct MCQ answer gets a confirmation that names the key | `runner.practiceKinds.test.ts`, flipped "known limit (Q5)" test (now "5.6f: ..."): a turn graded correct, reply "Yes, B is right!", is delivered unchanged (no `ANSWER_LEAK_SAFE_HINT`). |
| A wrong answer still cannot get the key | Same file: a turn graded wrong (or none), the same reply "Yes, B is right!", still gets the safe hint (regression of today's behaviour). |
| The key leaves HelpState once the attempt is correct | Already true before this task (`ladder.ts` `reset('solved')`, `skills.ts` `practiceCheck`'s correct branch): `answerKey: []` on the next saved state. A test in `pedagogy/ladder.test.ts` or `skills.test.ts` (whichever already covers this) is checked, not re-written, unless it needs a new case for the *this-turn* release (below). |
| This-turn release, unit level | `pedagogy/policy.test.ts`: a loaded practice key, `ctx.attempt === 'correct'` → `mustNotReveal` and `promptKeys` drop the solved item's key; a `practiceCarriedKey` (from an unrelated skipped item) stays guarded even then; `attempt` wrong/partial/none → unchanged (regression); a closed path (distress/misuse/locked/off_topic/not_covered) never releases even if `attempt` happens to be `'correct'` (defense in depth). |
| The pipeline doesn't reintroduce the key via `items`/`practiceKeys` | `pipeline/runner.test.ts` or a new case in `runner.practiceKinds.test.ts`: on a correct attempt, the loaded item is excluded from `activeItems()`/`loadedPracticeKeys` (so `ownKeysOf(items)` in `compileAnswerKeys` can't re-derive the label/option-text/position/ruling-out checks for it), while a `practiceCarriedKey` from a different item is still passed through. |
| Attack cases | `runner.practiceKinds.test.ts` and/or `routing/classify.test.ts`: (a) a wrong answer ("A") followed by "Yes, B is right!" still gets the hint; (b) a claim with no key content ("I got that right", "that's correct, right?") stays `none`/`wrong` (not answer-shaped enough to match), so the key stays guarded; (c) a question-phrased guess that matches the true key ("so it's B?", key B) grades `correct` by the existing mechanism (`classify.ts`'s `LEAD_IN`, pre-dating this task: "is it 10/12?" already grades `correct` for a numeric key) and now releases, same as a flat "B" — flagged under Questions for the lead to confirm this is intended, not an exploit; (d) the same question phrasing with a *wrong* guess ("is it C?", key B) still grades `wrong` and stays guarded. |
| Nothing else regresses | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1` passes, including every existing `policy*`, `ladder*`, `skills*`, `runner.practiceKinds*`, `runner.practiceAnswerKey*`, `classify*`, `answerKey*`, `streamGate*` and `answerLeak*` test. `git diff origin/main -- packages/contracts apps packages/db` is empty. |

## Design

No contracts change. No prompt-pack change. The fix is two small, independent pieces; both are
needed together or the key still leaks through the other path.

### 1. `pedagogy/policy.ts`: release `mustNotReveal` on a correct practice attempt

Today `finish()` only drops `answerKey` when `s.move === 'solution' && pkg.finalAnswers !==
'never' && !holdsPracticeKey(i.help)` — i.e. a practice key is **never** released, whatever the
move (the comment says so, citing ADR-0010 §5). That blanket rule is what blocks "Yes, B is
right!" even on the turn that just graded the attempt correct, because `finish()` builds
`mustNotReveal` from the *loaded* `i.help` (before the ladder's `next` resets it for the *next*
saved turn) — the current turn's guard and the next turn's saved state are computed separately.

Add a second release condition, **scoped to the main skillStep path only** (never to the early
`closed()` redirects for distress/misuse/off_topic/meta/locked/not_covered/skill_not_entitled):

```
practiceSolved = i.ctx.attempt === 'correct' && holdsPracticeKey(i.help)
```

`decidePolicy`'s single call to `finish(i, skillStep(...))` passes this as an extra argument (e.g.
`finish(i, skillStep(...), { allowPracticeRelease: true })`); every `closed()` call keeps the
default (`false`). `finish()`'s `keysFor` release flag becomes:

```
(s.move === 'solution' && i.ctx.pkg.finalAnswers !== 'never' && !holdsPracticeKey(i.help))
  || (allowPracticeRelease && practiceSolved)
```

`keysFor`'s existing carried-key handling needs no change: when `release` is true, `answer = []`,
and `carried = practiceCarriedKey.filter(k => !answer.includes(k))` keeps every carried entry
(the filter is a no-op against an empty `answer`), so an unrelated skipped item's key stays in
`mustNotReveal`. `promptKeys` stays `[]` either way (`hidden` still reads the *unreleased*
`holdsPracticeKey(help)`), which is harmless: no guard reads `promptKeys`.

Update the two comments that currently promise "never released, whatever the move" (the file
header's rule list, and the `keysFor` doc comment) to say "released once the attempt grades
correct (5.6f)".

**Why not condition on `s.move === 'check'` instead of a passed flag:** `move === 'check'` is also
used for `explain`'s pending comprehension check, which has nothing to do with `attempt`; relying
on move alone would need an extra `holdsPracticeKey` guard anyway, and wouldn't stop a coincidence
with a closed path (closed paths never set `move` through `skillStep`, so they already can't
collide with `'check'`, but a passed flag makes the restriction explicit and reviewable at the one
call site, rather than implicit in which moves happen to be reachable from which path).

### 2. `pipeline/runner.ts`: drop the solved item from `items`/`practiceKeys`, not just `mustNotReveal`

Fixing `mustNotReveal` alone is not enough. `compileAnswerKeys` (`generate/answerKey.ts`) also
derives guarded keys from `opts.items` directly, **independent of `mustNotReveal`**:
`ownKeysOf(items)` pulls each active item's own `answerKey` and its correct option's text into the
same `labels`/`texts`/`numbers`/`derived` sets that `mustNotReveal` feeds (`compileAnswerKeys`'s
first loop is `for (const raw of [...mustNotReveal, ...ownKeys.flat()])`, and `derived` — the
position and ruling-out checks — reads `items` only). So if the loaded item stays in
`this.loadedItems`/`this.loadedPracticeKeys`, the matcher keeps guarding its label and option text
even once `mustNotReveal` is empty.

`loadAnswerContext(ctx, help)` runs once per turn, before `decide`, and already has `ctx.attempt`
in scope. Change it so a correctly-graded loaded item is excluded from both outputs:

```
const holds = holdsPracticeKey(help);
const solved = holds && ctx.attempt === 'correct';
this.loadedPracticeKeys = [
  ...new Set([...(holds && !solved ? help.answerKey : []), ...(help.practiceCarriedKey ?? [])]),
];
this.loadedItems = [];
const itemId = help.practiceItemId;
if (!holds || solved || itemId === undefined) return;
// ...unchanged resolve-through-the-entitled-registry block
```

This is the only change in `runner.ts`. `activeItems()` (`[...this.loadedItems,
...this.issued.map(itemContextOf)]`) and the `postGuard`/`generate` call sites that read
`this.loadedPracticeKeys` need no change: once `loadedItems`/`loadedPracticeKeys` no longer carry
the solved item, both already flow through correctly. A freshly issued item later in the *same*
turn (the model calling `practice.next_item` again) is unaffected: it is tracked through
`this.issued`/`this.issuedKeys()`, never through `loadedItems`.

### 3. HelpState: already correct, no change needed

`ladder.ts`'s `reset('solved')` and `skills.ts`'s `practiceCheck` correct branch already set
`answerKey: []` on the *next* saved state (the practice branch goes further and resets to
`INITIAL_HELP_STATE`, though `runner.ts`'s `withPractice` then re-overlays `practiceItemId` from
the loaded state when no item was issued this turn — `holdsPracticeKey` on that result is still
false, since `answerKey.length === 0`). So "the key leaves HelpState once the attempt is correct"
is true today; the gap closed by this task is only the **current** turn's guard, built from the
loaded (pre-reset) state. No change to `helpState.ts`, `ladder.ts` or `skills.ts` is planned; if
the builder finds the next-turn behaviour is not actually as described (e.g. a stale
`practiceItemId` somehow re-arms `holdsPracticeKey` next turn), stop at PARTIAL and report it
rather than patching blind.

### Not changed

`packages/contracts`, `content/prompt-packs/**`, `packages/harness/src/pipeline/generate/{answerKey,
streamGate,itemContext,labelKeys}.ts`, `packages/harness/src/routing/classify.ts`,
`packages/harness/src/tools/**`, `packages/harness/src/guardrails/**`. The matcher, the stream
gate's re-show hold-back and the grading rules (design 1-5 of 5.6b) are unchanged; this task only
changes *whether* a correctly-graded key is fed to them.

## Files to create/modify

1. `packages/harness/src/pedagogy/policy.ts` (modify): the `allowPracticeRelease` flag through
   `finish()`'s one real call site in `decidePolicy`; `keysFor`'s release condition; two comment
   updates.
2. `packages/harness/src/pipeline/runner.ts` (modify): `loadAnswerContext`'s `solved` branch.
3. `packages/harness/src/pedagogy/policy.test.ts` (modify): the unit-level cases in the acceptance
   table above.
4. `packages/harness/src/pipeline/runner.practiceKinds.test.ts` (modify): flip the "known limit
   (Q5)" test; add the wrong-answer regression and the attack-case tests. The flipped test needs
   `ctx.attempt === 'correct'` to actually reach the runner (the suite's default `route.run` stub
   always returns `attempt: 'none'` — see Questions Q2 for how the builder should wire this
   without re-plumbing the whole suite onto the real `route`/`decide` steps).
5. `packages/harness/src/routing/classify.test.ts` (modify, only if a gap is found): a regression
   test documenting that a question-phrased guess ("is it B?", "so it's B?") grades `correct` only
   when it actually names the true label, and `wrong` otherwise — this is existing behaviour
   (`classify.test.ts:190`'s numeric "is it 10/12?" case is the precedent), not a new rule; add it
   only if no existing test already pins this down for a label key.

No change to `packages/contracts`, `docs/adr/**`, `apps/**`, `packages/db/**`,
`content/prompt-packs/**`, `.claude/**`.

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**`: no contracts change, no ADR.
- `packages/harness/src/pipeline/generate/**`, `packages/harness/src/tools/**`,
  `packages/harness/src/guardrails/**`: the matcher and the stream gate already behave correctly
  once they're given the right `mustNotReveal`/`items`/`practiceKeys`; no change belongs here.
- `packages/harness/src/pedagogy/ladder.ts`, `skills.ts`, `helpState.ts`: already correct (design
  §3); touch only if the builder finds and documents a real gap, and then stop at PARTIAL first.
- `apps/web/**`, `packages/db/**`, `content/prompt-packs/**`: untouched.
- If a file outside this list needs a change, the builder stops at PARTIAL.

## Tests

Tests first (tdd-guide): write the flipped runner test and the new `policy.test.ts` cases failing
before the code changes.

- `pedagogy/policy.test.ts`: the full unit-level row of the acceptance table (release on correct +
  holding; carried key stays guarded; wrong/partial/none unchanged; closed paths never release).
- `pipeline/runner.practiceKinds.test.ts`:
  - flip "known limit (Q5): a correct 'B' followed by 'Yes, B is right!' gets the safe hint" to
    "5.6f: a correct 'B' followed by 'Yes, B is right!' is delivered";
  - "a wrong answer ('A') followed by 'Yes, B is right!' still gets the safe hint" (new, the
    acceptance's explicit "a wrong answer still cannot get the key");
  - "a claim with no key content ('I got that right') stays guarded" (new, attack case b);
  - "a question-phrased guess that matches the key ('so it's B?') is delivered, same as a flat
    'B'" and "...that doesn't match the key ('is it C?') still gets the hint" (new, attack cases c
    and d — see Questions Q1 before writing these as pass/fail-asserting tests).
- `routing/classify.test.ts`: only the gap-filling regression from Files item 5, if needed.
- Full gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test
  --filter=@edmate/harness... --force --concurrency=1`, then `python3 .githooks/secret-scan.py
  --all`. Commit green, push the branch, open the PR.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/pedagogy/policy.ts` and `policy.test.ts` match
  `packages/harness/src/pedagogy/**` (reviewers: code-reviewer, per the MVP-first exception
  currently in force for that group).
- `packages/harness/src/pipeline/runner.ts` and `runner.practiceKinds.test.ts` match no line in
  `risk-paths.txt` (`pipeline/**` is not listed).
- `packages/harness/src/routing/classify.test.ts` (if touched) matches no line either.
- **Recommended reviewers on the PR (lead decision, following the 5.6b precedent for this same
  leak-guard surface): code-reviewer (required), plus security-reviewer and typescript-reviewer**
  — this is the exact mechanism 5.6b's security fix round found a CRITICAL in, and it changes when
  an answer key is allowed to reach the student, so the extra scrutiny matches the task's own
  `risk: high` / pilot-blocking label even though `risk-paths.txt`'s current MVP-first exception
  only mandates code-reviewer for `pedagogy/**`.
- Handoff `## Decisions` entry (`risk: high`), to write once the build lands:

  > 5.6f A practice key is released from `mustNotReveal`, and the loaded item is dropped from the
  > turn's `items`/`practiceKeys`, on a turn `classifyAttempt` grades `correct` for the held key
  > (never on a closed/redirect path, even if `attempt` coincidentally reads `correct`; never for a
  > `practiceCarriedKey` from a different, skipped item). This closes the 5.6b Q5 known limit: a
  > correct-answer confirmation that restates the key is now delivered instead of replaced by the
  > safe hint.

## Questions

1. **Does a question-phrased guess that matches the true key ("so it's B?", "is it B?") release
   the key the same as a flat "B" would?** `classifyAttempt` already grades such text `correct`
   today, for both numeric keys (`classify.test.ts:190`, "is it 10/12?" against `5/6`) and label
   keys (the same `LEAD_IN` "is it"/"it's" mechanism, extended to labels in 5.6b design 5) — this
   predates 5.6f and is not changed by it. Before 5.6f the guard blocked the confirmation anyway
   (practice keys were never released), so this question-as-guess path was never actually
   exploitable; 5.6f makes the existing grade matter for the first time.
   **Recommended: yes, release it** — treating "is it B?" as equivalent to "B" is the system's
   existing, tested definition of a committed attempt, and a tutor confirming a correct guess
   however it was phrased is the intended behaviour, not a new hole. If the lead disagrees, the fix
   is to make `isAnswerShaped`/`classifyAttempt` for label keys exclude the "is it"/"it's" leading
   question forms specifically (not something 5.6f's own changes need to touch, and not undertaken
   without this answer — it would also need a classify.test.ts review for its numeric-key
   precedent).
2. **How should the flipped runner test reach `ctx.attempt === 'correct'`?** The suite's `turn()`
   helper always stubs `route.run` to `attempt: 'none'` and stubs `decide.run` to a fixed
   `PedagogyDecision` (bypassing `decidePolicy`/`policy.ts` entirely) — so neither policy.ts's new
   release logic nor runner.ts's `ctx.attempt` branch is exercised by the existing helpers without
   a change. **Recommended:** add a narrow, local override only for the new/flipped tests — e.g. a
   `laterCorrect(rec, reply)` helper that passes `steps: { route: { run: () => Promise.resolve({
   intent: 'on_task', attempt: 'correct', usage: [] }) } }` (keeping `decide` stubbed, but with
   `mustNotReveal: []` in the stubbed decision, matching what real `decidePolicy` would now
   compute) alongside the existing `holding(rec)` help state. This directly exercises the
   `runner.ts` fix (the real risk: `items`/`practiceKeys` reintroducing the key) without needing to
   wire the full real `decide` step through this already-large fixture file. A `policy.test.ts`
   case (Tests, item 1) separately proves the `policy.ts` half in isolation. If the builder finds
   this still awkward inside `turn()`'s current shape, a second, smaller helper function is fine;
   stop at PARTIAL rather than restructuring `turn()` itself.
3. **Should `fallbackPolicy` (the degraded/provider-error path) also release on a correct
   attempt?** **Recommended: no** — leave it guarded. `fallbackPolicy` only ever returns `ask` or
   `redirect`, is reached on provider/judge failure, and widening what a degraded path may say is
   the wrong direction for a leak guard; the task's acceptance only asks for the normal decide
   path.

## Budget

Budget: 60 tool calls (1 phase, 1 package: packages/harness)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (only the `turbo run typecheck lint test` gate, `vitest run`
on the named test files, `git` on the task branch, and `python3 .githooks/secret-scan.py --all`).

## Exit conditions

- **DONE:** every test named in Tests passes, the full harness gate
  (`--filter=@edmate/harness...`) and the secret scan are clean, `git diff origin/main --
  packages/contracts apps packages/db` is empty, the commit is pushed, the PR is open, and the
  handoff has the acceptance table above plus the `risk: high` decision entry and an explicit
  answer (adopted or overridden) to each Question.
- **PARTIAL:** stop and hand off at `Status: PARTIAL` if:
  - past about 75 tool calls;
  - a file outside the Files list needs a change (especially `ladder.ts`, `skills.ts`,
    `helpState.ts`, `classify.ts` or anything under `generate/**`/`guardrails/**`);
  - an existing leak, locked, safety or grading test would have to be weakened to pass;
  - wiring `ctx.attempt === 'correct'` into the runner test suite turns out to need a real
    `decide`/`route` step rewrite of `turn()` itself (Question 2) rather than a narrow local
    override.

## Lead answers (24 Oct 2026, sid2305's lead session)

Plan reviewed before the build (safety task). Approved as written, with these answers:

1. **Q1: yes, release.** A question-phrased guess that names exactly the true label ("so it's B?")
   is a committed attempt under the existing grading, and confirming it is intended. Add one more
   attack case: a hedged multi-label answer ("A or B?", "is it A, B or C?") must not grade
   `correct` (`labelsNamed` requires exactly one label) and must keep the key guarded. If it grades
   `correct`, stop at PARTIAL.
2. **Q2: adopt the recommendation.** A narrow local helper for the new and flipped tests; don't
   restructure `turn()`.
3. **Q3: no.** `fallbackPolicy` stays guarded.

Reviewers on the PR: code-reviewer, security-reviewer, typescript-reviewer. The handoff carries the
`risk: high` decision above. Budget 60 stands; stop at PARTIAL past 75.
