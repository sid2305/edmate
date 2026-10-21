# Task 7.1 plan: eval reports and judge calibration

Board: `python3 .claude/skills/board/board.py show 7.1`
Build plan: § M7 · Evals and the quality gate, line 625.
Deps: 5.4 (done), M3, M4 (done). Depended on by 7.2, 7.3, 7.6.

## Acceptance (verbatim)

"Eval reports and judge calibration: JSON + HTML reports per suite and model; 10% human
double-check with agreement tracking." *Accept:* "reports generated in CI; agreement recorded."

## How it will be shown

- A vitest test in `packages/evals` (runs in the existing CI `node` job's `turbo run test`, no
  new CI job) replays a small, fully-synthetic recorded suite through `runSuite`, builds a
  `JsonReport` and an `HtmlReport` per suite and writes both to a gitignored output dir — proving
  "reports generated in CI" on every PR and push, offline, with no new GitHub Action.
- A second test loads a checked-in human double-check file (synthetic, `reviewed_by: lead`),
  computes agreement against that run's results, and asserts the JSON/HTML report carries a
  `calibration` section (`sampled`, `reviewed`, `agreed`, `rate`) — proving "agreement recorded".
- `toHtmlReport` is pure and snapshot-tested: static `<style>` only, no `<script>`, no external
  URL, every dynamic string (id, student text, reply, check detail, reviewer, note) HTML-escaped.
- Unit tests for the sampler (deterministic for the same case-id set) and `computeAgreement`
  (matches, mismatches, no double-check file yet, 0 sampled, 0 reviewed).

## MVP scope (memory: MVP first)

- Proves the reporting + calibration mechanism end to end offline. Does **not** wire a real
  agent, does not touch `evals/suites/**`, and does not grow any platform suite — that is 7.2 (suite
  growth, reviewer per case) and 7.3 (per-agent generator). Once those suites have recorded
  fixtures, they reuse this same `toJsonReport`/`toHtmlReport`/`calibration` code unchanged.
- No new CI job, no new pinned GitHub Action (e.g. `upload-artifact`): report generation rides
  the `test` task every PR already runs. A later task can add artifact upload if the team wants
  reports downloadable, without touching this task's code.

## Files to create / modify

- `packages/evals/src/htmlReport.ts` (new): `toHtmlReport(report: JsonReport): string` — one
  static self-contained HTML page (inline `<style>`, no `<script>`, no remote asset); a summary
  line, a table of cases (id, suite, pass/fail, first failing check + detail), and a calibration
  block when the report carries one. Escapes every dynamic value.
- `packages/evals/src/htmlReport.test.ts` (new): snapshot of the rendered HTML for a small fixed
  `JsonReport` (pass, fail, error, calibration present/absent); asserts no `<script` substring and
  no `http://`/`https://` substring anywhere in the output.
- `packages/evals/src/calibration.ts` (new):
  - `HumanVerdictSchema` (zod, `strictObject`): `{ caseId: string.min(1), humanPass: boolean,
    reviewedBy: string.min(1), note?: string }`. No reviewer name is hard-coded anywhere; the
    field is free text the human fills in (mirrors the existing `reviewed_by` convention in
    `schema.ts`).
  - `loadDoubleCheck(path): HumanVerdict[]` — reads one YAML file (js-yaml is already a
    dependency), parses each entry against the schema, throws naming the file on a bad entry
    (same pattern as `loader.ts`'s `CaseLoadError`).
  - `sampleForDoubleCheck(caseIds: readonly string[], fraction = 0.1): string[]` — sorts ids,
    picks a deterministic ~10% (ceil, min 1 when non-empty) by fixed stride so the same case-id
    set always samples the same ids; a suite smaller than ~10 cases samples at least one case.
  - `computeAgreement(results: readonly CaseResult[], verdicts: readonly HumanVerdict[]):
    CalibrationSummary` — `{ sampled: number; reviewed: number; agreed: number; rate: number;
    disagreements: string[] }`; `sampled` is `verdicts.length` restricted to ids present in
    `results`, `reviewed` counts verdicts whose case id is in `results`, `rate = agreed / reviewed`
    (0 when `reviewed` is 0, never divides by zero). Unmatched verdict ids are reported, not
    silently dropped.
- `packages/evals/src/calibration.test.ts` (new): schema rejects unknown keys / wrong types / a
  missing `reviewedBy`; sampler determinism and the "at least one for a small suite" rule; full
  agreement, one mismatch, an unreviewed sampled case, a verdict for an id outside the run.
- `packages/evals/src/report.ts` (edit): `toJsonReport`'s `meta` gains two optional fields —
  `judgeModel?: string` (the `provider:model` label the run's judge fixtures carry, via
  `judgeModelLabel`) and `calibration?: CalibrationSummary` — both included only when passed
  (keeps the existing "no field unless given" contract and its tests).
- `packages/evals/src/report.test.ts` (edit): extends existing cases to cover the two new
  optional fields; no changes to existing assertions.
- `packages/evals/src/index.ts` (edit): export `toHtmlReport`, `HumanVerdictSchema`,
  `loadDoubleCheck`, `sampleForDoubleCheck`, `computeAgreement`, and their types.
- `packages/evals/src/reportDemo.test.ts` (new): the "shown" test above — records (offline, via
  `@edmate/harness/testing`'s `ScriptedGateway`, already an approved devDependency per 3.12) a
  tiny synthetic suite reusing `packages/evals/test/fixtures/suite`, replays it, writes
  `packages/evals/reports/<suite>/report.json` and `.html`, then re-reads and `JSON.parse`s the
  JSON file to confirm it round-trips. A second case in the same test loads
  `packages/evals/test/fixtures/doubleCheck/test.yaml` (new, synthetic, `reviewed_by: lead`),
  computes agreement, and asserts the written JSON report's `calibration.rate` matches.
- `packages/evals/test/fixtures/doubleCheck/test.yaml` (new): 1–2 synthetic verdict entries
  against the existing 4-case synthetic suite (no student data; it is hand-authored fixture
  content, same as the rest of `test/fixtures/`).
- `.gitignore` (edit, one line): add `packages/evals/reports/` next to the existing `coverage/`
  line, so generated reports are never committed (keeps the public repo free of generated
  content and avoids ever accidentally committing suite output).
- `docs/tasks/7.1/plan.md` (this file, already on `main` before the build starts).

No change to `.github/workflows/**`, `packages/contracts/**`, `packages/harness/**`,
`evals/suites/**`, or `apps/cli/**`.

## Tests first (tdd-guide)

1. `calibration.test.ts`: schema + sampler + `computeAgreement`, all pure, written red first.
2. `htmlReport.test.ts`: snapshot + "no script, no external URL" assertions.
3. `report.test.ts`: the two new optional meta fields.
4. `reportDemo.test.ts` last, once the above are green: wires the real pieces together and
   writes files, proving the CI-visible behaviour.

## Risky paths touched

Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:

- None. `packages/evals/**` is not listed under any group. The new `.gitignore` line and
  `docs/tasks/7.1/**` are not listed either. `evals/double-check/` (no entries added by this
  task — see open question 1) would not be under `evals/suites/safety/**` or `evals/suites/locked/**`
  even once used.
- Not a risk: high decision. This task needs no special reviewers beyond the normal merge gate
  (`code-reviewer`, `typescript-reviewer`, `silent-failure-hunter` per the usual PR review set).

## Open questions (recommended default each)

1. **Where do human double-check files for real suites live, and in what format?**
   Default: YAML, one file per suite, `evals/double-check/<suite>.yaml`, each entry
   `{ case_id, human_pass, reviewed_by, note? }` (mirrors `evals/suites/**`'s per-case YAML and
   the existing `reviewed_by` field). This task only adds the schema/loader/sampler/agreement
   code and one fixture file under `packages/evals/test/fixtures/`; it does not create
   `evals/double-check/` for the still-empty platform suites — 7.2 (suite growth, reviewer per
   case) is the natural task to start filling it in alongside the cases it reviews.
2. **What does "10%" sample from?** Default: 10% of the cases in a single suite run (ceil,
   minimum 1 for a non-empty suite), picked deterministically by sorted case id so the same suite
   content always samples the same cases (stable across reruns, changes only when cases are
   added/removed).
3. **Does this task add CI artifact upload (downloadable reports)?** Default: no. Reports are
   written to a gitignored path during the existing `test` task; "generated in CI" is satisfied
   by that file existing and round-tripping inside the test. Artifact upload would add a new
   pinned GitHub Action and touch `.github/workflows/ci.yml` (a risky path needing
   `security-reviewer`) for a nice-to-have; parked for a later task if the team wants it.
4. **Which suite proves the report pipeline for 7.1, given no platform suite has recorded
   fixtures yet (7.2/7.3 are still `todo`)?** Default: the existing synthetic
   `packages/evals/test/fixtures/suite` (4 cases, every check type already represented). 7.2/7.3
   point real suites through the same `toJsonReport`/`toHtmlReport`/`calibration` code once they
   have recorded fixtures; no reshaping needed.
5. **What does "per model" mean when the agent under test has no model identity yet (3.12: the
   CLI's agent is unwired)?** Default: label reports by the judge model recorded in the run's
   judge fixtures (`judgeModelLabel(judgeModel)`, already stored per fixture since 3.12). An
   agent-under-test model label is added later, once an agent pipeline exists (7.3+), as a new
   optional `meta` field — no change needed to today's shape.

## Budget: 30 tool calls

## Allowed tools
Read, Grep, Glob, Write, Edit, Bash (for `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`, `git`, `python3 .claude/skills/merge-gate/merge_gate.py`, `python3 .githooks/secret-scan.py --all`).

## Exit conditions
- Green: `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...` passes, coverage
  holds at the package's existing bar; `corepack pnpm turbo run build typecheck lint test` passes
  repo-wide; secret scan clean; no file outside the list above touched.
- Blocked: if the builder finds a reason the demo/synthetic approach cannot show "reports
  generated in CI" convincingly to the human (e.g. the lead wants a downloadable artifact before
  merge) — escalate via open question 3 rather than guessing.

## Lead answers (21 Oct 2026)
All five defaults accepted: double-check files for real suites start in 7.2; 10% of a suite's cases (ceil, min 1, deterministic by sorted case id); no CI artifact upload now (no `.github/**` change); the synthetic fixture suite proves the pipeline; "per model" is labelled by the judge model from recorded fixtures. Decided by lead · risk: low.
