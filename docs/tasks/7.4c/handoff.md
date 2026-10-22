# Task 7.4c handoff: per-scope gate deadline

Status: DONE
Tool calls used: 46 (harness count; the builder reported 27)

## What changed

- `packages/evals/src/gateScope.ts`: added `FULL_SCOPE_GATE_DEADLINE_MS = 2 * 60 * 60_000` and
  `defaultGateDeadlineMs(changes)`. Both the new function and `selectGateCases` now share one
  private `validateAndCheckFull` helper (fail-closed validation + the "is this a full-scope
  change" check), so the two places that decide full scope can't drift apart.
- `packages/evals/src/qualityGate.ts`: `runQualityGate` now falls back to
  `defaultGateDeadlineMs(input.changes)` instead of the flat `GATE_DEADLINE_MS` when the caller
  omits `deadlineMs`. `GATE_DEADLINE_MS`'s own definition (15 min) is untouched.
- `packages/evals/src/index.ts`: exports `defaultGateDeadlineMs`, `FULL_SCOPE_GATE_DEADLINE_MS`.
- `apps/cli/src/commands/gate.ts`: new `--deadline-ms <n>` flag (positive integer, same error
  style as the command's other flags), threaded through to `runQualityGate` as `deadlineMs` when
  given; omitted means the scope-aware default decides. Usage text updated.
- Tests first, per the plan: `gateScope.test.ts` (new `defaultGateDeadlineMs` describe block, both
  tiers + throws), `qualityGate.test.ts` (3 new cases: full-scope ~80-min run doesn't trip 120
  min; the same run trips 15 min under `material`; an explicit `deadlineMs` overrides the default
  both shorter and longer), `apps/cli/src/commands/gate.test.ts` (`--deadline-ms` parse errors,
  threaded override passing and tripping a run).
- `qualityGateDemo.test.ts`: untouched, as planned.

## Acceptance evidence

```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/evals... --filter=@edmate/cli...
...
@edmate/evals:test: Test Files  31 passed (31)
@edmate/evals:test:      Tests  1131 passed (1131)
@edmate/cli:test: Test Files  13 passed (13)
@edmate/cli:test:      Tests  142 passed (142)
 Tasks:    26 successful, 26 total
```

```
$ python3 .githooks/secret-scan.py --all
(no output, clean)
```

No file outside the plan's list was touched.

## Decisions

### 21 Oct 2026 · 7.4c budget overrun accepted · decided by lead · risk: low
- Decided: the build used 46 tool calls against a 30-call budget (1.53×); accepted without a fix round.
- Why: one phase, tests-first across two packages, 26/26 turbo tasks green, both reviewers approve with LOWs only; the overrun is the test setup for the deadline cases, not rework.
- risk: low

### 21 Oct 2026 · 7.4c review LOWs deferred to 7.4a · decided by lead · risk: low
- Decided: the two review LOWs (gateScope.ts DEFAULT_GATE_DEADLINE_MS duplicates GATE_DEADLINE_MS; selectGateCases validates the change set twice) go to board task 7.4a.
- Why: MVP first; neither changes behaviour.
- risk: low

### 21 Oct 2026 · 7.4c two-tier default and the 120-minute constant · decided by builder · risk: medium
- Decided: `material`, `packages`, `style_card` (and unions of only those) keep the existing
  15-minute `GATE_DEADLINE_MS` default; `first_publish` or `prompt_pack_bump` (alone or unioned
  with anything) default to a new `FULL_SCOPE_GATE_DEADLINE_MS = 2 * 60 * 60_000` (120 min). An
  explicit `GateInput.deadlineMs` / CLI `--deadline-ms` still overrides either tier.
- Why: the lead's plan answer (21 Oct 2026) already accepted this two-tier split and the 120-min
  number, following 7.2's "Risks" estimate (~80 min at MVP target suite sizes, ~2 h at the
  eventual full Evals-table size). 120 min covers the MVP target with margin and the full-table
  size exactly.
- risk: medium — the 120-minute constant is provisional, same footing as 7.4's
  `ASSUMED_CALL_SECONDS` / `GATE_CONCURRENCY`, until 7.6 / 7.7 measure real p95.
