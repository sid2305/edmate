# 5.6h plan: make the "so it's B?" runner test real

Status: READY. Planner: sonnet. Risk: low (board: `risk: low`). Test-only harness task.

Sources: board `docs/board/tasks.yaml` id `5.6h` (deps: `5.6f`); `docs/tasks/5.6f/plan.md`,
`review.md` and `handoff.md` (merged on `main`); the code under test,
`packages/harness/src/pipeline/runner.practiceKinds.test.ts` (the `laterCorrect` helper and its
four call sites) and `packages/harness/src/routing/classify.ts` (`classifyAttempt`,
`answerKeyOf`, `SessionHelpSchema`/`HelpStateSchema` in `pedagogy/helpState.ts`).

## Acceptance (verbatim, board)

Title: "5.6f review MEDIUM: packages/harness/src/pipeline/runner.practiceKinds.test.ts:377, the
"so it's B?" runner test repeats the base correct case because laterCorrect cannot inject the
guess text; drive the real route step (or pass the text through) so the runner test proves a
question-phrased correct guess releases and a wrong one does not, or remove it"

Accept: "the runner test fails if question-phrased grading changes; harness typecheck, lint and
test green."

### How it is shown (paste into handoff.md)

| Claim | Evidence |
|---|---|
| The runner test proves a question-phrased correct guess releases the key | `runner.practiceKinds.test.ts`: the "so it's B?" case now calls `laterCorrect(MCQ, [...], "so it's B?")`; `laterCorrect`'s `route.run` stub computes `attempt` from the real `classifyAttempt(...)` (routing/classify.ts) against that exact text and the held key, instead of a hardcoded `'correct'`. |
| ...and a wrong one does not | A new case: `laterCorrect(MCQ, [...], 'is it C?')` expects `ANSWER_LEAK_SAFE_HINT`; the same real-grading path now returns `'wrong'` for this text, so the stubbed `mustNotReveal` keeps the key guarded. |
| The test would fail if question-phrased grading changed | Manual check during the build (not committed): temporarily hardcode `laterCorrect`'s computed `attempt` to `'correct'` regardless of input and confirm the new wrong-guess case fails; revert before committing. |
| Nothing else regresses | `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1` passes, including every existing `runner.practiceKinds*`, `policy*`, `classify*` test. `git diff origin/main -- packages/contracts apps packages/db` is empty. |

## Design

Pure test change, no production code touched. `laterCorrect` (around line 174) currently hardcodes
`route.run: () => Promise.resolve({ intent: 'on_task', attempt: 'correct', usage: [] })`, so every
call grades `'correct'` no matter what text the model's reply (or the student's turn) contains —
that is exactly why the "so it's B?" case at line 377 is identical to the base case at 357/358: the
guess text is never read by anything.

Fix by computing `attempt` for real, from an `input` text the caller now passes in, using the
already-exported, already-tested `classifyAttempt` from `routing/classify.ts` (the same function
`classifyTurn`/the production `route` step calls) — this is the "pass the text through" option the
board task names, and is simpler than wiring the full real `entitle`/`route` steps (which would
need a schema-valid stored help blob threaded through `entitle`, plus `classifyTurn`'s intent-model
fallback plumbed through the gateway for an inconclusive intent). `classifyAttempt` is the one
piece of production logic actually in question (does a question-phrased guess grade correct?), so
calling it directly, with the real input text, is a faithful, narrow fix — not a new stub of the
behaviour under test.

```ts
import { classifyAttempt } from '../routing/classify.js';

/** A schema-valid raw stored help blob (pedagogy/helpState.ts's SessionHelpSchema) holding `keys`. */
const storedHelp = (keys: readonly string[]) => ({
  v: 1,
  rung: 0,
  stuckTurns: 0,
  attemptLogged: false,
  pendingCheck: false,
  answerKey: [...keys],
});

async function laterCorrect(
  rec: DemoPracticeRecord,
  reply: ScriptedStreamCall['steps'],
  input: string,
  o: { carried?: readonly string[] } = {},
) {
  const tools = memoryToolRegistry([practiceNextItemTool(demoPracticeBank(RECORDS))]);
  const t = testDeps({ script: { stream: [main(...reply, used)] }, overrides: { tools }, judge: 'grounded' });
  const carried = o.carried ?? [];
  const help = { ...holding(rec), ...(carried.length > 0 ? { practiceCarriedKey: [...carried] } : {}) };
  const attempt = classifyAttempt({ text: input, kind: 'message' }, storedHelp(rec.answerKey));
  const decision: PedagogyDecision = {
    ...demoPedagogyDecision,
    move: 'ask',
    mustNotReveal: attempt === 'correct' ? [...carried] : [...rec.answerKey, ...carried],
    tools: [],
  };
  const steps = testSteps({
    entitle: fixtureEntitle,
    route: { run: () => Promise.resolve({ intent: 'on_task', attempt, usage: [] }) },
    decide: { run: () => Promise.resolve(testDecideResult(decision)) },
    generate: defaultSteps.generate,
    postGuard: defaultSteps.postGuard,
    buildContext: () => Promise.resolve(builtWith(help)),
  });
  const { events, result } = await driveTurn(
    runTurn({ ...demoTurnInput, text: input }, { deps: t.deps, steps }),
    t.clock,
  );
  const commit = steps.commits[0];
  return { events, result, commit, help: commit?.next?.help, t };
}
```

`mustNotReveal`'s `attempt === 'correct' ? [...carried] : [...rec.answerKey, ...carried]` mirrors
what the real `decidePolicy`/`finish()` (5.6f) computes for the main skillStep path: released (down
to the carried entries only) on a correct attempt, guarded (key plus carried) otherwise. This keeps
`decide` a stub (per the 5.6f plan's Q2, still not restructuring `turn()`/wiring the real `decide`
step), while making the *input text* the one thing that decides, through real production logic,
whether the turn grades correct — which is the coverage gap the board task names.

`storedHelp` only needs to satisfy `classifyAttempt`'s `answerKeyOf` call (`pedagogy/helpState.ts`'s
`SessionHelpSchema.safeParse`); the shape matches the existing precedent in
`routing/classify.test.ts`'s own local `stored()` helper and `runner.test.ts`'s `stored` fixture.

### Call sites to update (all four existing `laterCorrect(...)` calls need a 3rd `input` argument)

1. Line ~351 (`describe('5.6b: answered without a false block')`, "a correct 'B' followed by 'Yes,
   B is right!' is delivered"): add `'B'` — the student's actual (correct) guess.
2. Line ~358 (`describe('5.6f: release the practice key on a turn graded correct')`, the same
   scenario restated): add `'B'`.
3. Line ~368 ("a carried key from an unrelated skipped item stays guarded even on a correct
   attempt"): add `'B'` before the `{ carried: ['4321'] }` options object (still a correct attempt
   on the loaded item; the carried key is unrelated and must stay guarded regardless).
4. Line ~377-380 (the test this task exists for, "a question-phrased guess that matches the key
   ('so it's B?') is delivered, same as a flat 'B'"): add `"so it's B?"` as the input — now a real,
   distinguishing input instead of a duplicate of case 1.

### New test (pairs with the fixed case 4, satisfies "a wrong one does not")

Add, in the same `describe('5.6f: release the practice key on a turn graded correct')` block right
after the fixed "so it's B?" case:

```ts
it('a question-phrased guess that does not match the key ("is it C?"), graded for real, still gets the safe hint', async () => {
  const r = await laterCorrect(MCQ, [say('Yes, B is right!')], 'is it C?');
  expect(r.commit?.replyText).toBe(ANSWER_LEAK_SAFE_HINT);
});
```

This is the test that actually distinguishes the fixed helper from the old one: with the old
hardcoded `attempt: 'correct'`, this case would have delivered the key (wrongly); with the real
`classifyAttempt('is it C?', ...)` grading `'wrong'` (matched in `classify.test.ts`'s own
`"is it c?"` case, 5.6f handoff), it now correctly stays guarded through the runner/postGuard path,
not just at the classify unit level.

The two existing `later()`-based cases at lines ~382 ("is it C?") and ~387 (hedged "is it A, B or
C?") are untouched: they use the other helper (`later`), which fixes `mustNotReveal` to the key
regardless of `attempt` (default `route` always returns `'none'`), so they were never affected by
this defect and don't need to change for this task. (They remain valid as "the hint shows whenever
`mustNotReveal` holds the key" checks; the *grading itself* for these phrasings is pinned down in
`classify.test.ts`, per the 5.6f plan's own design.)

### Why not drive the real `route` step (`classifyTurn`) instead of calling `classifyAttempt` directly

`classifyTurn` also computes `intent` (rules first, a model fallback only when the rule is not
confident) and needs `s.pkg.name` and a gateway able to answer an intent-model request. For a
plain answer-shaped text like `'is it C?'` the rule is confident (so the fallback is never
reached), but relying on that silently makes the test's gateway script coupling to intent routing
implicit. Calling `classifyAttempt` directly is the exact function whose behaviour is in question
(does this text, against this key, grade correct?), with no risk of an unrelated intent-routing
change making this test flaky. If a future reviewer wants the full `classifyTurn` path exercised
end-to-end, that is a bigger change (wiring `entitle`'s `helpState` and the intent-model stub) and
is out of scope for this low-risk, test-only task.

## Files to create/modify

1. `packages/harness/src/pipeline/runner.practiceKinds.test.ts` (modify only): add the
   `classifyAttempt` import, the `storedHelp` helper, the `input` parameter on `laterCorrect` and
   its real-grading `route.run`/`mustNotReveal` logic, the 3rd argument on all four existing call
   sites, and the one new "is it C?" test case.

No other file changes. No change to `packages/harness/src/pedagogy/**`, `pipeline/runner.ts`,
`routing/classify.ts`, `generate/**`, `guardrails/**`, `packages/contracts`, `apps/**`,
`packages/db/**`, `content/prompt-packs/**`, `.claude/**`.

## Files out of bounds

- Every non-test production file: `pedagogy/policy.ts`, `pipeline/runner.ts`, `routing/classify.ts`,
  `pedagogy/helpState.ts`, `generate/**`, `guardrails/**` — this task is a test-coverage fix only;
  if the builder finds `classifyAttempt`'s exported signature or `SessionHelpSchema`'s shape don't
  match what's documented above, it stops at PARTIAL rather than changing production code to fit.
- `packages/contracts/**`, `docs/adr/**`, `apps/**`, `packages/db/**`, `content/prompt-packs/**`,
  `.claude/**`: untouched.
- If a file outside the Files list needs a change, the builder stops at PARTIAL.

## Tests

Tests first (tdd-guide), in the spirit of the task even though this is itself a test file:

1. Make the `laterCorrect`/call-site change first; run the full file and confirm every existing
   case (including the now-non-duplicate "so it's B?" case) still passes.
2. Add the new "is it C?" case; confirm it passes against the fixed helper.
3. Confirm the fix actually closes the gap the board task names: temporarily revert
   `laterCorrect`'s `attempt` computation to the old hardcoded `'correct'` (keep the `input`
   parameter unused) and re-run just the new "is it C?" case — it must fail (`ANSWER_LEAK_SAFE_HINT`
   expected, key delivered instead). Revert the temporary hardcode before committing; do not leave
   it in any form in the committed diff.
4. Full gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test
   --filter=@edmate/harness... --force --concurrency=1`, then `python3 .githooks/secret-scan.py
   --all`. Commit green, push the branch, open the PR.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

None (checked against risk-paths.txt). The only file touched,
`packages/harness/src/pipeline/runner.practiceKinds.test.ts`, is under `packages/harness/src/pipeline/**`,
which is not listed in `risk-paths.txt` (the pedagogy/**, access/**, payments/**, contracts/**,
.claude/** and auth groups are the only harness-adjacent entries, none of which this touches). Board
task risk is `risk: low`; no `risk: high` decision entry is required for this task. Standard
code-reviewer review is sufficient (lead's call on the PR).

## Questions

None. The board task's own title already gives the accepted options ("drive the real route step
(or pass the text through) ... or remove it"); this plan adopts "pass the text through" (via the
real `classifyAttempt`, not the full `route`/`classifyTurn` step) as the lowest-risk option that
still satisfies the accept criterion, and explains why not the full-step option above, under
Design.

## Budget

Budget: 25 tool calls (1 phase, 1 package: packages/harness)

## Allowed tools

Read, Grep, Glob, Edit, Bash (only the `turbo run typecheck lint test` gate, `vitest run` on the
named test file, `git` on the task branch, and `python3 .githooks/secret-scan.py --all`).

## Exit conditions

- **DONE:** the fixed "so it's B?" case and the new "is it C?" case both pass against the real
  `classifyAttempt`-driven helper; the temporary-regression check in Tests item 3 was performed (not
  committed) and confirmed the new case fails without the fix; every existing
  `runner.practiceKinds.test.ts` case still passes; the full harness gate
  (`--filter=@edmate/harness...`) and the secret scan are clean; `git diff origin/main --
  packages/contracts apps packages/db` is empty; the commit is pushed and the PR is open; the
  handoff has the acceptance table above.
- **PARTIAL:** stop and hand off at `Status: PARTIAL` if:
  - past about 35 tool calls;
  - a file outside the Files list needs a change (especially any production file under
    `pedagogy/**`, `pipeline/runner.ts`, or `routing/classify.ts`);
  - `classifyAttempt`'s signature, `SessionHelpSchema`'s required fields, or `testSteps`'s
    `route`/`decide` override shape has changed since the 5.6f handoff in a way this plan's code
    snippet doesn't account for;
  - the "is it C?" case does not fail under the temporary-hardcode check in Tests item 3 (meaning
    the fix did not actually close the coverage gap) — report this rather than committing a test
    that looks fixed but still proves nothing.

## Lead answers (24 Oct 2026)
No questions. Reviewers: code-reviewer, typescript-reviewer. Budget 25; stop at 35 and return PARTIAL.
