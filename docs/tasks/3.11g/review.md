# 3.11g review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

The linear-time test for breakFenceRuns and neutraliseForgedLabel is sound: the code reviewer injected a quadratic loop and it failed on the ratio check, and it stayed green in 5 cold runs and 3 runs under full CPU load. Both reviewers found that the comment overclaimed: the 10 s bound and the 60 s test timeout can't stop a true infinite loop, because a synchronous call never yields. The lead rewrote the comment to say so, corrected the lessons.md citation, moved the `performance` declaration below the imports and built the inputs outside the timed closure.

## Findings
- [MEDIUM] [fixed] packages/harness/src/pedagogy/modelRequest.test.ts:321 — the comment said the loose bound guards against a genuine hang; a synchronous infinite loop is never interrupted (code reviewer confirmed with a real infinite loop). Comment now says only the CI job timeout ends such a run (typescript-reviewer rated it HIGH; the lead rates it MEDIUM, as no code path is wrong)
- [MEDIUM] [fixed] packages/harness/src/pedagogy/modelRequest.test.ts:318 — the docs/lessons.md citation claimed the opposite of what the lesson says (count work, don't time it); reworded
- [MEDIUM] [wontfix] packages/harness/src/pedagogy/modelRequest.test.ts:339 — up to six large runs near the 10 s bound could pass the 60 s test timeout before a clean failure; a linear run takes well under a second, so this only matters for an already-failing regression, which still fails
- [LOW] [fixed] packages/harness/src/pedagogy/modelRequest.test.ts:5 — the `performance` declaration split the import block; moved below the imports
- [LOW] [fixed] packages/harness/src/pedagogy/modelRequest.test.ts:339 — input building was inside the timed closure; inputs are now built first
