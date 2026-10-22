# Task 7.8 handoff (Phase A)

Status: PARTIAL (Phase B, the CLI `--scorecard` flag in `apps/cli`, is left to do)

Tool calls used: 18

## What was built

Phase A only, `packages/evals`:

- `packages/evals/src/scorecard.ts` (new): pure `GateResult -> Scorecard`.
  - `SCORECARD_GROUPS`: `hints_before_answers -> pedagogy`, `locked_content -> locked`,
    `accuracy -> accuracy`.
  - `buildScorecard(gate)` builds one `ScorecardCategory` per key, in that order:
    - no row for the group at all -> `measured: false, total: 0, passed: 0, percent: null,
      pass: false, byOrigin: []`.
    - a row exists (one or two, platform/agent) -> `measured: true`, `total`/`passed` are the sum
      across origins, `percent` is `null` only when the combined `total` is 0 (an expected-but-
      empty group), `pass` is true only when every contributing `GateGroupResult.pass` is true,
      and `byOrigin` lists each origin's own `total`/`passed` so the split stays visible.
  - `ScorecardSchema` (zod) mirrors the `Scorecard`/`ScorecardCategory` shape for the CLI's future
    JSON output.
  - Imports only `./gateScope.js`, `./qualityGate.js` and `zod` (no new runtime dependency, no
    `Date.now`/I/O).
- `packages/evals/src/scorecard.test.ts` (new, written first):
  - synthetic `GateResult` with mixed platform/agent `pedagogy`/`locked`/`accuracy` rows: checks
    the combined `passed/total/percent/pass` and the `byOrigin` split, including a case where the
    combined rate looks fine but one origin's `locked` row failed (`pass: false` still).
  - a category with no row at all -> `measured: false` (never a fabricated pass/fail), including
    when the overall gate passes.
  - a category whose row is present but empty (`empty_group`, total 0) -> `measured: true`,
    `percent: null` (distinct from "not asked").
  - one category per `SCORECARD_GROUPS` key, in that order, even on an empty gate.
  - the 7.8 acceptance: 7.4's demo fixtures (`demoSuiteInput`, `gate.testkit.ts`) through
    `runQualityGate` for a `material` change, fed into `buildScorecard`: good agent ->
    `accuracy` and `locked_content` measured at 100%/100%, both pass, `hints_before_answers`
    unmeasured; nearly-good agent (one locked leak) -> `locked_content` at 48/49, fails.
- `packages/evals/src/index.ts` (edit): exports `buildScorecard`, `SCORECARD_GROUPS`,
  `ScorecardSchema`, `Scorecard`, `ScorecardCategory`, `ScorecardCategoryKey`,
  `ScorecardCategoryOrigin`.

`corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`: 18/18 tasks green, 31
test files / 1123 tests passed, `scorecard.ts` at 100% statements/branches/functions/lines.
`python3 .githooks/secret-scan.py --all`: clean.

No files outside `packages/evals/src/{scorecard.ts,scorecard.test.ts,index.ts}` were touched;
`apps/cli` was not touched (Phase B, separate builder).

## Decisions

### 21 Oct 2026 · 7.8 combine platform and agent origin into one scorecard rate, keep the split · decided by builder · risk: low
- Decided: `buildScorecard` sums `total`/`passed` across a category's `platform` and `agent`
  `GateGroupResult` rows into one combined rate, and additionally carries each origin's own
  `total`/`passed` in `byOrigin` so the split is never lost. A combined category's `pass` is true
  only when every contributing origin's row passed.
- Why: the lead's answer to the plan's open question 1 (21 Oct 2026): one combined rate per
  category, with per-origin counts kept visible.
- risk: low

### 21 Oct 2026 · 7.8 no generatedAt/agentVersion field, no db persistence in 7.8 · decided by builder · risk: low
- Decided: `Scorecard` carries only `pass`, `changes` and `categories`; `buildScorecard` is pure
  (reads only `gate.groups`/`gate.pass`/`gate.changes`, no clock, no I/O), and 7.8 adds no
  `packages/db` write.
- Why: the lead's answers to open questions 2 and 3 (21 Oct 2026): 8.7 attaches a scorecard to a
  published agent version and owns storing gate results/scorecards (same precedent as 7.4 Q3);
  inventing a clock or identity field here for no acceptance benefit would make the function
  impure ahead of 8.7's actual storage design.
- risk: low

### 21 Oct 2026 · 7.8 measured:false vs empty_group kept distinct · decided by builder · risk: low
- Decided: a category with no row at all for its group is `measured: false` (never claims a pass
  or fail); a category whose row exists but has zero cases (`reason: 'empty_group'`) is
  `measured: true` with `percent: null` and `pass: false` (a real failure, the group was expected
  to run and didn't get any cases).
- Why: plan's explicit design note -- "a scorecard must not look like it answered something it
  didn't" (lessons.md), while an expected-but-empty group is still a real gate failure that must
  not be hidden behind "unmeasured."
- risk: low

## Left to do

Phase B (separate builder, `apps/cli`):
- `apps/cli/src/commands/gate.test.ts` (edit): a new `--scorecard <file>` flag on
  `edmate gate demo --change <kind>` writes the `Scorecard` JSON (via `buildScorecard` +
  `ScorecardSchema`) built from the same `GateResult` the command already produces; flag omitted
  by default; `--report` and `--scorecard` together both write; the command's existing exit-code
  behaviour is unchanged.
- `apps/cli/src/commands/gate.ts` (edit): add `--scorecard <file>` to `parseArgs` options and
  `GATE_USAGE`; after building `result`, if `values.scorecard !== undefined`, `mkdirSync` +
  `writeFileSync` `JSON.stringify(buildScorecard(result))` next to the existing `--report`
  pattern.
