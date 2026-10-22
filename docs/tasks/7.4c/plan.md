# Task 7.4c plan: per-scope gate deadline

Board: `python3 .claude/skills/board/board.py show 7.4c` (M7, deps 7.4, risk: normal).
Context: `docs/tasks/7.4/plan.md` ("< 15 minutes" design, `GATE_DEADLINE_MS`), `docs/tasks/7.2/plan.md`
("Risks" and Lead answer 5: "board task 7.4c (M7) gives each scope its own `GATE_DEADLINE_MS`").

## Acceptance (verbatim)

"Give each change scope its own deadline (material stays under 15 minutes per the 7.4 accept)."
*Accept:* "a full-scope live gate is not cut off at 15 minutes; a material-change gate still is."

## How it will be shown

`qualityGate.test.ts` (new cases): a scope with `first_publish` or `prompt_pack_bump` in it gets a
default deadline big enough that a synthetic run sized like 7.2's MVP estimate (~80 min of
critical-path calls) does not trip; a scope of only `material` / `packages` / `style_card` (and
their unions) keeps today's 15-minute default and still trips on a synthetic over-budget run
(reusing the existing manual-counter `now()` pattern, no real timer). An explicit `deadlineMs`
still overrides the default either way. `qualityGateDemo.test.ts`'s existing material-change
assertion (`estimatedSeconds < 900`, no deadline override) is unchanged.

## Deadlines by scope, recommendation and reasoning

| Scope | Default | Why |
| --- | --- | --- |
| `material`, `packages`, `style_card` (and unions of only these) | 15 min (today's `GATE_DEADLINE_MS`, unchanged) | 7.4's own demo proxy: a material gate on the 106+49 per-agent demo cases is 310 calls -> 80 critical-path calls -> 640 s (~10.7 min), with headroom under 900 s. `packages` runs a subset of material's cases (locked only) and `style_card` is a fixed 30-case sample, so both are smaller than material and fit the same bound without their own number. |
| `first_publish`, `prompt_pack_bump` (full scope, alone or unioned with anything) | 120 min (`FULL_SCOPE_GATE_DEADLINE_MS = 2 * 60 * 60_000`) | 7.2's plan ("Risks"): a live full-scope gate over today's 376 platform cases is already ~45 min by the 8 s/4-way proxy; at 7.2's MVP target sizes (~610 platform cases once 7.2a-e land) it is ~80 min; at the full Evals-table sizes (M13) ~2 h. 120 min covers the MVP target with real margin and the eventual full-table size exactly, so this task does not need re-opening when M13 grows the suites further — it stays a provisional constant like 7.4's `ASSUMED_CALL_SECONDS`/`GATE_CONCURRENCY`, replaced once 7.6/7.7 measure real p95. |

Only two tiers, not five: `packages` and `style_card` are always smaller-or-equal workloads than
`material`, so giving them their own number would add cases with no behavioural difference (and
risks someone tuning them out of sync with `material`). If a future suite makes `packages` alone
larger than `material` (it can't today: `agentLocked` is a subset check in `gateScope.ts`), that
is a new board task, not a guess made here.

## Must it be configurable?

Yes, two ways, both already partly in place:
- **Per call (already exists):** `GateInput.deadlineMs` stays an explicit override; `runQualityGate`
  only falls back to the scope's default when the caller omits it. No change needed here.
- **New: per scope, automatically.** Today every caller that omits `deadlineMs` gets the same flat
  15 minutes regardless of scope (that is the bug 7.2 flagged: a live full-scope gate fails closed
  at 15 min even though it needs ~45-80 min). The fix is a new pure function,
  `defaultGateDeadlineMs(changes: readonly ChangeKind[]): number`, in `gateScope.ts` (next to
  `CHANGE_KINDS`/`GATE_THRESHOLDS`, since it already classifies `full` there), used by
  `runQualityGate` as `input.deadlineMs ?? defaultGateDeadlineMs(input.changes)`. The CLI gets an
  optional `--deadline-ms <n>` flag that passes straight through as `GateInput.deadlineMs`, so a
  human can still override either tier for one run (e.g. while tuning) without a code change; no
  flag means the scope-aware default decides, so a full-scope run is no longer silently cut off at
  15 minutes and nobody has to remember to pass anything for the common case.

## Design

- `packages/evals/src/gateScope.ts` (edit): export `FULL_SCOPE_GATE_DEADLINE_MS = 2 * 60 *
  60_000` and `defaultGateDeadlineMs(changes)`, reusing the existing `full` check
  (`changes.has('first_publish') || changes.has('prompt_pack_bump')`) so the two places that
  decide "is this a full-scope change" never drift apart. `GATE_DEADLINE_MS` (15 min, in
  `qualityGate.ts`) is unchanged and stays the non-full default.
- `packages/evals/src/qualityGate.ts` (edit): `deadlineMs` falls back to
  `defaultGateDeadlineMs(input.changes)` instead of the flat `GATE_DEADLINE_MS`; the exported
  constant `GATE_DEADLINE_MS` itself is untouched (so existing imports/tests of its literal value
  keep working), and `GateStats.deadlineMs` reports whichever default (or override) actually ran,
  so the CLI's printed summary already shows it with no further change there.
- `packages/evals/src/index.ts` (edit): export `FULL_SCOPE_GATE_DEADLINE_MS`,
  `defaultGateDeadlineMs`.
- `apps/cli/src/commands/gate.ts` (edit): add `--deadline-ms <n>` (positive integer, same
  validation style as the other flags), passed through to `runQualityGate` as `deadlineMs` when
  given; omitted means the library default decides. Update the command's own `--help`/usage text.
- `apps/cli/src/cli.ts`: no change expected (the `gate` USAGE line already names its flags
  generically); touch only if the existing usage string enumerates flags and needs the new one
  added — if so, a one-line edit, still within this task's file list.

## Tests first

- `packages/evals/src/gateScope.test.ts` (edit): `defaultGateDeadlineMs` returns 15 min for
  `['material']`, `['packages']`, `['style_card']`, and unions of only those; returns 120 min for
  `['first_publish']`, `['prompt_pack_bump']`, and any union that includes either (e.g.
  `['material', 'first_publish']`); throws via the existing unknown-kind/empty-set checks it
  already reuses (no new error path).
- `packages/evals/src/qualityGate.test.ts` (edit): two new cases using the existing manual-counter
  `now()` pattern (no real timer) — (a) a `first_publish`-scoped synthetic run sized so its
  critical-path time is ~80 min does not trip the default deadline and completes; (b) the same
  size run under a `material`-only scope (or an explicit 15-minute override on the full scope)
  does trip, is recorded `not run: gate deadline passed`, and the gate fails closed. A third case
  confirms an explicit `deadlineMs` on a full-scope input overrides the 120-minute default both
  ways (shorter and longer).
- `packages/evals/src/qualityGateDemo.test.ts`: no edit expected; its material-change assertion
  (`estimatedSeconds < 900`, no `deadlineMs` given) keeps passing under the unchanged 15-minute
  default and proves this task didn't change material's behaviour.
- `apps/cli/src/commands/gate.test.ts` (edit): `--deadline-ms` parses and is threaded through (a
  passing run with a generous override, a failing run with a deliberately tiny override that
  trips the deadline on a synthetic multi-case suite); a non-numeric or non-positive value is a
  clear argument error, same style as the command's other flag checks.

Run `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...
--filter=@edmate/cli...` and `python3 .githooks/secret-scan.py --all` before the handoff.

## Files out of bounds

`packages/contracts/**`, `packages/harness/**`, `packages/db/**`, `evals/suites/**`,
`evals/fixtures/**`, `content/**`, `apps/web/**`, `apps/worker/**`, `docs/adr/**`, `.claude/**`.
`GATE_THRESHOLDS`, `selectGateCases`'s scope logic and `GATE_CONCURRENCY`/
`ASSUMED_CALL_SECONDS` are untouched — this task only changes which deadline number is picked by
default. Any other file needing a change -> stop at PARTIAL.

## Risky paths touched

Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`: none match.
`packages/evals/**` and `apps/cli/**` are both listed as not risky in 7.4's and 7.2's plans, and
nothing here touches `packages/db/**`, migrations, prompt packs, locale packs or `.claude/**`. No
`risk: high` decision is needed for this task; the handoff still logs the 120-minute constant as a
`risk: medium` decision (same footing as 7.4's `ASSUMED_CALL_SECONDS`/`GATE_CONCURRENCY`:
provisional until 7.6/7.7 measure real p95).

## Open questions

None — 7.2's Lead answer 5 already set this task's scope ("gives each change scope its own
`GATE_DEADLINE_MS`, so a live first-publish gate doesn't fail closed at 15 minutes"); the only
numbers this plan adds (120 min, the two-tier split) are planner recommendations for the lead to
accept or adjust in review, not open decisions blocking the start of the build.

## Budget
Budget: 30 tool calls (1 phase, packages/evals + apps/cli)

## Allowed tools
Read, Grep, Glob, Edit, Bash (only `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint
test --filter=@edmate/evals... --filter=@edmate/cli...`, `git` on the task branch, `python3
.claude/skills/merge-gate/merge_gate.py 7.4c`, `python3 .githooks/secret-scan.py --all`). No
network, no real model or provider keys, no `Write` (every file is an edit to an existing file).

## Exit conditions
- **DONE:** `@edmate/evals...` and `@edmate/cli...` pass typecheck, lint and test (coverage at the
  existing bar); the demo material-change test still asserts `estimatedSeconds < 900` unedited;
  the new scope-default tests pass for both tiers and for an explicit override; secret scan clean;
  no file outside this plan's list touched; handoff states tool calls used and logs the
  120-minute constant as a `risk: medium` decision.
- **PARTIAL (stop and report):** past ~28 tool calls; any file outside the listed set needs
  changing (e.g. `gateScope.ts`'s threshold table, `runner.ts`, `packages/db/**`); the CLI's usage
  string structure makes `--deadline-ms` awkward to add cleanly within budget.

## Lead answers (21 Oct 2026)
- I accept the two-tier default. material, packages and style_card stay at `GATE_DEADLINE_MS` (15 min). first_publish and prompt_pack_bump get `FULL_SCOPE_GATE_DEADLINE_MS` = 120 min. A mixed change takes the longer tier. The builder logs this as provisional (`risk: medium`) until 7.6/7.7 measure real p95.
- `GateInput.deadlineMs` stays the per-call override. The CLI's `--deadline-ms` must be a positive integer, and it is rejected otherwise.
- The build starts once 7.2a no longer has a builder in packages/evals (one builder per package).
