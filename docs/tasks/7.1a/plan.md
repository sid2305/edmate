# 7.1a plan: 7.1 review follow-ups (calibration and loader errors)

Status: READY (small plan by the lead, 21 Oct 2026)

## Scope
Only `packages/evals`. No contracts, no harness, no case YAML.

1. **Unmatched verdicts are reported.** `computeAgreement` (`packages/evals/src/calibration.ts:86`) drops a verdict whose `caseId` is not in the run. Add `unmatched: string[]` to `CalibrationSummary`: the verdict case ids with no result, deduplicated, in input order. Show them in the JSON report (`report.ts`) and the HTML report (`htmlReport.ts`): a short "Verdicts with no case in this run" line or list, escaped like the other ids, and shown only when non-empty. Keep `sampled`/`reviewed`/`agreed`/`rate` as they are.
2. **A missing file is not "invalid YAML".** In `loadDoubleCheck` (`calibration.ts:31`) and `loadOne` (`loader.ts:28`), split the read from the parse. If the read fails, the message is `cannot read file: <code>` (for example `ENOENT`), and the cause is kept. If the parse fails, it stays `invalid YAML: ...`.
3. **No absolute path in error text.** `CaseLoadError` and `DoubleCheckLoadError` build `message` from a display path: the path relative to `process.cwd()` when it lies inside it, else the file's basename. The `filePath` property keeps the caller's path, for callers. Also check that js-yaml's own message (it gets `filename`) does not reintroduce the absolute path; pass the display path as `filename`.

## Tests (red first)
- An unmatched verdict id appears in `unmatched`, in the JSON report and in the HTML report; no line is shown when there are none.
- For each loader, a missing file and a bad-YAML file give different messages.
- For each loader, a file under a temp dir outside the cwd gives a message with no absolute path (assert the message does not contain the temp dir).
- Update the existing tests that expected the absolute path in the message (`calibration.test.ts:83`, and similar ones in the loader tests) to expect the display path.

## Risk paths
None (`packages/evals/src/**` is not in `risk-paths.txt`). Reviewers: code-reviewer and typescript-reviewer.

## Budget
Budget: 35 tool calls
