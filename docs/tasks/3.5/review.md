# 3.5 review — APPROVE
Reviewers: safety-reviewer (opus), typescript-reviewer (sonnet)

typescript-reviewer re-ran the harness gates fresh (1,897 tests then; pedagogy 100% coverage) and confirmed decide is pure and deterministic, moves/skills/rungs are exhaustive by type, the effective-ceiling math matches the spec, rule order matches the plan, and the tests are table-driven. safety-reviewer confirmed the ceiling, that `solution` never happens with `finalAnswers: never`, fixed non-zero budgets, and that repeating a locked question changes nothing; it re-verified all three of its findings at f713c17 (1,900 harness tests).

## Findings
- [HIGH] [fixed] packages/harness/src/pedagogy/ladder.ts:73 — an explain → coach sequence cleared `answerKey` mid-problem, so with `finalAnswers: never` the answer could leak. Only a solved problem clears it now; the sequence is tested. Re-verified by safety-reviewer.
- [MEDIUM] [fixed] packages/harness/src/pedagogy/skills.ts:99 — mock_interview without a persona fell back to coach even when coach wasn't entitled. Falls back only to an entitled skill, else `locked` (`no_persona`). Re-verified by safety-reviewer.
- [LOW] [fixed] packages/harness/src/pedagogy/policy.ts:90 — fallbackPolicy returned `ask` for distress. Now `redirect` with reason `distress`. Re-verified by safety-reviewer.
- [LOW] [deferred 5.3] packages/harness/src/pedagogy/coverage.ts:19 — with `lockedHit` true, an allowed chunk just above 0.5 still gets normal teaching; consider a higher bar when retrieval is built.
