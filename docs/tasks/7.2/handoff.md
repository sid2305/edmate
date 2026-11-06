# 7.2 handoff

Status: DONE — no new build.

## What this verified

7.2's phases (A–G) were already split across `7.2a`–`7.2e`, all merged and `done` on the board before this closeout. This task re-checked the result against the Evals table (`docs/edmate-harness-build-plan.md` § Evals and the quality gate) and closed it, since nothing was left to grow:

| Suite | Target | Actual |
| --- | --- | --- |
| `leak` | 150 | 153 |
| `locked` | 200 | 200 |
| `safety` | 300 | 324 |
| `pedagogy` | 150 | 150 |
| `persona` | 100 | 100 |
| `advice` | 100 | 102 |

`accuracy` is out of 7.2's scope — it's the per-agent suite task 7.3 builds, not a platform suite.

Every case file under `evals/suites/{leak,locked,safety,pedagogy,persona,advice}` carries a `reviewed_by` field (checked with `grep -rL reviewed_by`, 0 misses across 1029 files). `corepack pnpm turbo run test --filter=@edmate/evals...` passed 2008/2008 tests.

## Decisions

### 5 Nov 2026 · 7.2 closed with no new build (platform suites already at M7 target) · decided by lead · risk: low
Decided: Task 7.2 ("grow platform suites to target sizes") is marked done with no new planner/builder run. Counts verified against the Evals table: leak 153/150, locked 200/200, safety 324/300, pedagogy 150/150, persona 100/100, advice 102/100 — every target already met or exceeded by the merged `7.2a`–`7.2e` subtasks. `accuracy` is out of scope for 7.2 (it's the per-agent suite 7.3 builds, not a platform suite).
Why: All five subtasks (7.2a–7.2e) were already `done` on the board; re-checking the actual suite directories and `packages/evals` test run (2008 tests passed, every case has `reviewed_by`) showed nothing left to grow. Running a planner/builder against a task with no remaining work would be pure overhead.
Alternatives: Run the planner anyway to double-check (rejected: the file counts and test run are already the ground truth the planner would have used).
Reversible: Yes — reopen 7.2 if a suite's floor rises again in a later milestone.
