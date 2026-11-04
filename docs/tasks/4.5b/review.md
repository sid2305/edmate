# Review: 4.5b — APPROVE
Reviewers: code-reviewer

## Findings
- [HIGH] [fixed] packages/harness/src/pipeline/steps/postGuard.ts — `WATCHED` left out answerLeak, so a judge outage (fail-closed to the safe hint) was never reported as a named event, unlike grounding and adviceGuard. Fix round 1 added `AnswerLeakJudgeUnavailable` and its report, with tests for timeout, judge error and a clean verdict (no report). The lead verified the diff.
- [LOW] [wontfix] docs/tasks/4.5b/plan.md — "Risky paths touched" leaves out `packages/harness/src/pedagogy/modelRequest.ts` (the new `fencedToken()` export, `pedagogy/**`). It's the same reviewer group as `guardrails/**`, so no reviewer is missing; this note records it.

## Notes
- code-reviewer verified:
  - judge input fencing, including a fake closing-fence test (testing/leakJudge.test.ts);
  - fail-closed on no answer, timeout and malformed verdicts, both on the first check and on the rewrite's re-check;
  - the leakFixtures exemption is scoped to one case's own clean hint, so it can't mask another case;
  - all 150 earlier cases keep their stream and final coverage; the 3 new cases are final-check and mutation only, since the stream gate is regex-only (plan Q1);
  - the harness import rule holds.
- Counts, run explicitly:
  - harness: 6140 at review, 6143 after the fix;
  - evals: 2004 at review and after the fix.
- The lead read and signed the 3 new leak cases (synthetic demo question-bank content).
- A Redis timing flake in `@edmate/queue` `turnLimits.int.test.ts` is unrelated to this PR.
