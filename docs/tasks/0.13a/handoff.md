Status: DONE

## Summary
Closed the two LOW findings left from the 0.13 and 0.11 reviews:
1. `.github/scripts/docs_only.py` docstring now states explicitly that any path under `docs/`
   counts as docs-only whatever its extension (with examples `docs/system-design.html` and
   `docs/board/tasks.yaml`), and explains why (no code the `node` job builds/types/tests, even
   though `python-harness` still reads those files). No logic change.
2. Added `test_docs_only_classifier_treats_any_extension_under_docs_as_docs_only` to
   `.claude/tests/test_workflows.py`, covering: `docs/system-design.html` and
   `docs/board/tasks.yaml` as docs-only; `apps/web/docs/x.md` as not (path doesn't start with
   `docs/`); and a mix of `docs/system-design.html` + `apps/web/app/page.tsx` as not.
3. Reworded `.claude/agents/safety-reviewer.md` line 13 to say what happens to the reviewer's
   output: the team lead turns it into `docs/tasks/<id>/safety-review.md`, which the merge gate
   reads. The reviewer still never writes files.

Only the three named files were touched; `.claude/settings.json` and hooks were not touched.

## Decisions
### 25 Oct 2026 · 0.13a agent-system follow-ups wording · decided by builder · risk: low
- Decided: Worded the docstring addition and the safety-reviewer line exactly as the plan
  specified, without changing any matching behaviour or reviewer workflow.
- Why: The plan fixed the exact wording and test cases needed; no new judgment calls were
  required beyond following it.

### 25 Oct 2026 · 0.13a fix round · decided by builder · risk: low
- Decided: Added an explicit `NODE_JOB_READS` exception list to `.github/scripts/docs_only.py`
  holding only `docs/edmate-harness-build-plan.md` (read at test time by
  `packages/contracts/test/spec-drift.test.ts`): a diff touching only that path is no longer
  docs-only, so the `node` job still runs. Checked `packages/evals/src/rolePlayFixtures.test.ts`
  and `apps/web/e2e/stack/try-it.spec.ts` too: both only mention `docs/` in comments or read
  non-`docs/` paths (`content/skills/mock_interview`, `evals/suites/persona`,
  `docs/try-it/sample-lesson.md` via the `stack/**`-ignored e2e suite the `node` job doesn't run),
  so neither needed adding to the list. Also removed the docstring's blanket claim that `docs/`
  holds nothing the `node` job tests.
- Why: The security-reviewer's MEDIUM finding was correct: `docs/edmate-harness-build-plan.md` is
  the one doc path a `node`-job test actually reads at runtime, so a PR editing only that file
  must not skip the job meant to catch spec drift.

### 25 Oct 2026 · 0.13a merge · decided by lead · risk: high
- Decided: merge the changes to .github/scripts/docs_only.py, .claude/tests/test_workflows.py and .claude/agents/safety-reviewer.md.
- Why: both are risky paths. security-reviewer raised one MEDIUM: docs/edmate-harness-build-plan.md is read by spec-drift.test.ts. It is fixed with the NODE_JOB_READS exception, and the re-review approved; code-reviewer approved. No hook or settings file changed.

### 25 Oct 2026 · 0.13a budget · decided by lead · risk: low
- Decided: accept 14 harness tool calls for the build plus 25 for the fix round (builders reported 11 and 10), against a cap of about 15.
- Why: the fix round had to search packages/ and apps/ for test-time reads under docs/, which the first build was not asked to do.

## Gate
- `python3 -m unittest discover -s .claude/tests` → `Ran 367 tests in 134.916s` → `OK`
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0)

## Budget
Tool calls used: 39 (harness count 14 + 25; the builders reported 11 + 10)
