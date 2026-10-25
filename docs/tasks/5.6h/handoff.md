**Status:** DONE

## What changed

`packages/harness/src/pipeline/runner.practiceKinds.test.ts` only:

- Imported `classifyAttempt` from `../routing/classify.js`.
- Added the `storedHelp(keys)` helper (a schema-valid `SessionHelpSchema` blob).
- `laterCorrect` now takes a 3rd `input: string` argument, computes `attempt` for real via
  `classifyAttempt({ text: input, kind: 'message' }, storedHelp(rec.answerKey))` (replacing the
  hardcoded `attempt: 'correct'` in the `route.run` stub), derives `mustNotReveal` from that
  `attempt`, and drives `runTurn` with `{ ...demoTurnInput, text: input }`.
- Updated all four existing `laterCorrect(...)` call sites with the 3rd argument (`'B'`, `'B'`,
  `'B'` before the `{ carried: ... }` options object, and `"so it's B?"`).
- Added a new test: `'is it C?'` graded for real now gets `ANSWER_LEAK_SAFE_HINT` instead of the
  delivered key.

No production code touched.

## Evidence

| Claim | Evidence |
|---|---|
| The runner test proves a question-phrased correct guess releases the key | `runner.practiceKinds.test.ts` "a question-phrased guess that matches the key (\"so it's B?\") is delivered, same as a flat \"B\"" now calls `laterCorrect(MCQ, [say('Yes, B is right!')], "so it's B?")`; `route.run` returns the real `classifyAttempt`-computed `attempt`, not a hardcoded `'correct'`. |
| ...and a wrong one does not | New test "a question-phrased guess that does not match the key (\"is it C?\"), graded for real, still gets the safe hint": `laterCorrect(MCQ, [say('Yes, B is right!')], 'is it C?')` expects `ANSWER_LEAK_SAFE_HINT`; `classifyAttempt` grades `'is it C?'` against the MCQ key as `'wrong'`, so `mustNotReveal` keeps the key guarded through postGuard. |
| The test fails if question-phrased grading changes | Temporary-hardcode check: replaced `const attempt = classifyAttempt(...)` with `const attempt = 'correct' as const;` and ran `vitest run src/pipeline/runner.practiceKinds.test.ts -t "does not match the key"` — the new "is it C?" case failed (`expected 'Yes, B is right!' to be 'Let's work this out together...'`, i.e. the key was wrongly delivered). Reverted the hardcode before committing; `git diff origin/main...HEAD` contains no trace of it. |
| Nothing else regresses | `turbo run typecheck lint test --filter=@edmate/harness --force --concurrency=1` green (all 59 cases in the file pass, including every `runner.practiceKinds*`, `policy*`, `classify*` test). `git diff origin/main...HEAD --stat` touches only `packages/harness/src/pipeline/runner.practiceKinds.test.ts`. |
| Clean secret scan | `python3 .githooks/secret-scan.py --all` — no output, clean. |

## Decisions

None.

### 25 Oct 2026 · 5.6h budget over the plan cap · decided by lead · risk: low
- Decided: accept 48 tool calls against the plan's 25 (stop at 35); the first builder stalled when the Mac slept, the lead committed its work, and a fresh finisher re-ran the gate, did the hardcode check and wrote the handoff.
- Why: the overrun came from the restart (repeated setup and gate runs), not rework; both reviewers approve with no findings.

## Budget

Tool calls used: 48 (harness count: 27 for the first builder, which stalled after its gate, plus 21 for the finisher; the finisher reported 13)
recorded in a handoff).
