**Status:** DONE

## Summary
Three 7.1-review follow-ups, all in `packages/evals/src`, no contracts/harness/case-YAML change:

1. **Unmatched verdicts reported.** `CalibrationSummary` gained `unmatched: string[]`
   (`calibration.ts`): `computeAgreement` now collects verdict case ids with no matching result,
   deduplicated, in input order. `report.ts` carries it through unchanged (plain passthrough type).
   `htmlReport.ts` shows a "Verdicts with no case in this run" `<li>` (escaped like
   `disagreements`), only when non-empty.
2. **Missing file vs invalid YAML.** `loadDoubleCheck` and `loadOne` (`loader.ts`) now split
   `readFileSync` from `load`: a read failure throws `cannot read file: <code>` (keeping `cause`);
   a parse failure still throws `invalid YAML: ...`.
3. **No absolute path in error text.** New `displayPath.ts`: relative-to-cwd when inside cwd, else
   basename. `CaseLoadError`/`DoubleCheckLoadError` build `message` from it; `filePath` keeps the
   caller's original path. js-yaml's `filename` option is now passed the display path too (so its
   own embedded message can't reintroduce the absolute path). The loader's duplicate-id message
   (`also in ${earlier}`) also goes through `displayPath` now.

## Files
- `packages/evals/src/displayPath.ts` — new, not re-exported from `index.ts` (internal helper).
- `packages/evals/src/calibration.ts`, `loader.ts`, `htmlReport.ts` — described above.
- `packages/evals/src/calibration.test.ts` — missing-file-vs-bad-YAML, no-absolute-path-in-message,
  `unmatched` dedup/order test, updated existing assertions.
- `packages/evals/src/loader.test.ts` — unreadable-file-vs-bad-YAML (via `chmod 000`,
  restored in `finally`), no-absolute-path-in-message, updated existing assertion wording.
- `packages/evals/src/htmlReport.test.ts`, `report.test.ts`, `reportDemo.test.ts` — updated
  `CalibrationSummary` literals for the new required `unmatched` field; new
  shown-only-when-present / escaping tests for `unmatched`.
- `packages/evals/src/__snapshots__/htmlReport.test.ts.snap` — regenerated (new blank line from
  the added conditional block).

## Tests
`corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`: 14/14 tasks green.
`@edmate/evals:test`: 22 files, 1021 passed. Coverage: `calibration.ts`/`htmlReport.ts` 100%
statements/functions/lines; `loader.ts` 100% (one uncovered branch, the `?? message` fallback
when `cause.code` is absent — not reachable from the EACCES/ENOENT paths exercised).
`python3 .githooks/secret-scan.py --all`: clean, no output.

## Deviations
None.

Tool calls used: 33

## Decisions

### 21 Oct 2026 · 7.1a: two LOW review notes left as they are · decided by lead · risk: low
- Decided: keep `packages/evals/src/loader.test.ts`'s `chmod 0o000` read-failure test (CI is non-root) and `packages/evals/src/displayPath.ts`'s cross-drive handling (already falls back to the basename).
- Why: neither changes behaviour on the CI or dev machines.
- risk: low.

### None
No open decision beyond the plan; `displayPath.ts` placement (new small internal module, shared
by both loaders, not exported from `index.ts`) was the plan's own implied design, not a new call.
