# Task 7.1 handoff: eval reports and judge calibration

**Status:** DONE

## Summary

Added `packages/evals` report generation (JSON + static escaped HTML) and human double-check /
calibration. `toJsonReport` gained two optional `meta` fields (`judgeModel`, `calibration`), kept
backward compatible (absent unless passed). A new `toHtmlReport` renders a static, self-contained
page (inline `<style>` only, no `<script>`, no remote URL), escaping every dynamic value. A new
`calibration.ts` adds `HumanVerdictSchema`, `loadDoubleCheck` (YAML, throws naming the file),
`sampleForDoubleCheck` (deterministic ~10% by sorted id, min 1), and `computeAgreement`
(sampled/reviewed/agreed/rate/disagreements, never divides by zero, ignores verdicts for ids
outside the run without throwing). `reportDemo.test.ts` replays the existing synthetic 4-case
fixture suite through a scripted agent + `ScriptedGateway` judge (no real model call), writes
JSON + HTML to a gitignored `packages/evals/reports/` dir, round-trips the JSON, and carries a
`calibration` block computed against a new synthetic double-check fixture.

## Files

- `packages/evals/src/calibration.ts` (new), `src/calibration.test.ts` (new)
- `packages/evals/src/htmlReport.ts` (new), `src/htmlReport.test.ts` (new, includes a hostile
  case-id/suite/check-detail XSS probe and a hostile calibration-disagreement-id probe)
- `packages/evals/src/report.ts` (edit: optional `judgeModel`/`calibration` meta fields)
- `packages/evals/src/report.test.ts` (edit: one new test for the two fields)
- `packages/evals/src/index.ts` (edit: new exports)
- `packages/evals/src/reportDemo.test.ts` (new)
- `packages/evals/test/fixtures/doubleCheck/test.yaml` (new, synthetic, `reviewedBy: lead`)
- `.gitignore` (edit: `packages/evals/reports/`)

## Tests

`corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`: 22 test files, 1014
tests, all green. Coverage on `packages/evals`: 100% statements/lines/functions, 97.23% branches
(package bar is 80%; `calibration.ts` is 100%/100%/100%/100%). `htmlReport.ts` 86.36% branch
(uncovered: the suite-absent title/heading branch and the non-empty-disagreements-in-the-pass-case
combination — both exercised indirectly via other cases, not a gap in behaviour coverage).

`python3 .githooks/secret-scan.py --all`: clean (no findings).

## Deviations

- None from the plan's defaults (all five "Lead answers" accepted as-is).
- `computeAgreement`'s `sampled` and `reviewed` are computed identically (both = verdicts matched
  to a result in the run), per the plan's own definition of each; no behavioural difference is
  specified between them in this task, so the fields are intentionally equal today.

## Decisions

- None beyond the plan's own "Lead answers (21 Oct 2026)" (risk: low, already logged by the plan).

Tool calls used: 21
