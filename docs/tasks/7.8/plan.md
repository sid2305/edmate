# Task 7.8 plan: the teaching scorecard

Board: `python3 .claude/skills/board/board.py show 7.8`.
Build plan line 632 (M7): "Teaching scorecard: per-agent pass rates for hints-before-answers,
locked content and accuracy, published with each agent version." PRD line 518 ("each published
agent version carries a public teaching scorecard … from its latest gate run") and line 243
(S14, teacher pages). Deps: 7.4 (done: `GateResult`, `GateGroupResult`, `runQualityGate`).

## Acceptance (verbatim)

"Teaching scorecard: per-agent pass rates for hints-before-answers, locked content and accuracy,
published with each agent version." *Accept:* "the demo agent's scorecard is generated from its
latest gate run."

## How it will be shown

1. `scorecard.test.ts` (`packages/evals`): `buildScorecard` on a synthetic `GateResult` with known
   `pedagogy`/`locked`/`accuracy` groups (platform and agent origin, mixed pass/fail) returns the
   right `passed/total/percent/pass` per category, and marks a category `measured: false` when the
   gate run's `groups` has no row for it at all (never fabricates a pass or a fail for data the run
   didn't produce).
2. A second `scorecard.test.ts` case runs 7.4's own demo fixtures through `runQualityGate` for a
   **material** change (the same scripted good/bad/nearly-good agents as `qualityGateDemo.test.ts`,
   reusing `gate.testkit.ts`) and feeds the result straight into `buildScorecard`: `accuracy` and
   `locked_content` come out measured with the expected rates (good agent 100%/100%, both pass;
   nearly-good agent's `locked_content` at 48/49, fails); `hints_before_answers` comes out
   `measured: false` (a material-change scope has no pedagogy cases, platform or per-agent) — this
   is the acceptance: a demo agent's scorecard generated from its (real, scripted) latest gate run.
3. `apps/cli/src/commands/gate.test.ts` (edit): a new `--scorecard <file>` flag writes the
   `Scorecard` JSON built from the same `GateResult` the command already produces; omitted by
   default; writing both `--report` and `--scorecard` together works; the CLI's existing exit-code
   behaviour is unchanged.

## MVP scope

- A pure function, `GateResult -> Scorecard`, in `packages/evals`, with a zod schema. No new
  contracts, no ADR, no db write, no risky path.
- **Persistence ("published with each agent version") is explicitly out of 7.8**, for the same
  reason 7.4 kept `eval_runs`/`eval_results` out (Q3, 7.4 plan/handoff): 8.7 is the publish flow
  that already owns the agent-version row and the public profile page (build plan line 644: "8.7
  Publish flow with quality-gate results, **the teaching scorecard** and the public profile
  page"). 7.8 hands 8.7 a `Scorecard` it can attach to the agent version it is about to publish;
  8.7 decides the storage shape (e.g. a jsonb column on `agent_versions`, or its own table) when it
  wires the real publish through `gatedPublish`. This keeps 7.8 to one package plus a thin CLI
  flag and touches no risky path.
- The CLI is the "published with each agent version" stand-in for the demo agent until 8.7: a new
  `--scorecard <file>` flag on the existing `edmate gate demo --change <kind>` writes the
  `Scorecard` JSON next to (or instead of) `--report`. That is enough to show "the demo agent's
  scorecard is generated from its latest gate run" without a publish flow or a db write.
- Categories map 1:1 to the PRD/build-plan words: `hints_before_answers` <- gate group `pedagogy`
  ("One question at a time, hints before answers, sources cited"), `locked_content` <- gate group
  `locked`, `accuracy` <- gate group `accuracy`. `safety`, `safety-distress`, `persona`, `advice`,
  `leak`, `grounding` are not scorecard categories (not named in S14/7.8) and are left out, not
  silently folded in.
- A category combines **both** origins (`platform` and `agent`) of its group into one rate (sum of
  `total`/`passed`), because the scorecard is one public number per category on one agent's page;
  "per-agent" in the board task reads as "per published agent," not "origin: agent" (open question
  1, recommendation below). `pass` for a combined category is true only when every contributing
  `GateGroupResult` passed (so a combined category can't hide one failing origin behind the
  other's pass).
- A category whose group has **no row at all** in `GateResult.groups` (out of scope for that
  change kind, e.g. `pedagogy` on a `material` gate) is `measured: false`, `total: 0`,
  `passed: 0`, `percent: null`, `pass: false`. This is deliberately not the same as
  `reason: 'empty_group'` (which means the group was expected and had zero cases — a real
  failure): `measured: false` means the question wasn't asked this run, and the scorecard must
  never claim a pass or a fail for a question it didn't ask (lessons.md: a check that silently
  skips looks like a pass — the risk here runs the other way, a scorecard must not look like it
  answered something it didn't).
- No change to `packages/contracts`, `packages/harness`, `packages/db`, `evals/suites/**`,
  `content/**`, `apps/web/**`, `apps/worker/**`, `docs/adr/**`.

## Design

### `packages/evals/src/scorecard.ts` (new)

```ts
// sketch, not final
export const SCORECARD_GROUPS = {
  hints_before_answers: 'pedagogy',
  locked_content: 'locked',
  accuracy: 'accuracy',
} as const satisfies Record<string, GateGroup>;
export type ScorecardCategoryKey = keyof typeof SCORECARD_GROUPS;

export interface ScorecardCategory {
  key: ScorecardCategoryKey;
  measured: boolean;
  total: number;
  passed: number;
  percent: number | null; // null when total === 0 (unmeasured or empty_group)
  pass: boolean;
}
export interface Scorecard {
  pass: boolean;       // gate.pass, unchanged
  changes: ChangeKind[];
  categories: ScorecardCategory[]; // one per SCORECARD_GROUPS key, in that order
}
export const ScorecardSchema: z.ZodType<Scorecard>; // zod mirror, for the CLI's JSON output

export function buildScorecard(gate: GateResult): Scorecard;
```

- `buildScorecard` is pure (no `Date.now`, no I/O): it only reads `gate.groups`, `gate.pass` and
  `gate.changes`. Any "generated at" timestamp is the CLI's job (file mtime is enough; no new
  field needed for 7.8 — open question 2).
- Imports only from `./gateScope.js` (`GateGroup`), `./qualityGate.js` (`GateResult`,
  `GateGroupResult`) and `zod`; no new runtime dependency.

### `packages/evals/src/index.ts` (edit)

Export `SCORECARD_GROUPS`, `ScorecardCategoryKey`, `ScorecardCategory`, `Scorecard`,
`ScorecardSchema`, `buildScorecard`.

### `apps/cli/src/commands/gate.ts` (edit)

- Add `--scorecard <file>` to `parseArgs` options and `GATE_USAGE`.
- After building `result`, if `values.scorecard !== undefined`: `buildScorecard(result)`,
  `mkdirSync` + `writeFileSync` the JSON (same pattern as `--report`, reusing the existing
  `dirname`/`resolve` imports already in the file).
- No change to the command's exit code or stdout summary lines.

## Files out of bounds

`packages/contracts/**`, `packages/harness/**`, `packages/db/**`, `evals/suites/**`,
`evals/fixtures/**`, `content/**`, `apps/web/**`, `apps/worker/**`, `docs/adr/**`, `.claude/**`.
Phase A touches only `packages/evals`; Phase B only `apps/cli`. Any other file needing a change ->
stop at PARTIAL.

## Risky paths touched

None (checked against `.claude/skills/merge-gate/risk-paths.txt`): `packages/evals/**` and
`apps/cli/**` match no listed glob (the risky-path db glob is
`packages/db/src/repositories/**`, untouched here). No `risk: high` decision is needed for the
merge; the handoff may still log the scope decisions below at whatever risk the lead judges.

## Open questions (recommendation each)

1. **Does "per-agent pass rates" mean combine platform + agent origin into one number, or report
   them separately per category?** Recommend: combine (sum total/passed, AND across origins for
   `pass`). The scorecard is a public, agent-facing number; a teacher's page showing two numbers
   for "locked content" (one for the platform suite, one for their own packages) would need its
   own explanation that the PRD/build-plan line doesn't ask for. If the lead wants both shown
   separately (e.g. for 9.2's teacher page to drill in), that is a one-line change to
   `buildScorecard`'s grouping key.
2. **Does the `Scorecard` need a `generatedAt` or `agentVersion` field now?** Recommend: no. 7.8's
   function is `GateResult -> Scorecard`; it has no agent identity or clock to draw from, and
   inventing one (e.g. `Date.now()`) would make `buildScorecard` impure for no acceptance benefit.
   8.7 is where a `Scorecard` gets attached to a specific agent id/version/timestamp when it is
   actually published; that shape is 8.7's to design against its storage choice.
3. **Persist the scorecard in `packages/db` now (open to the lead despite the recommendation
   above)?** Recommend: no, matching 7.4's Q3 precedent (gate persistence deferred to 8.7) and the
   lead's instruction for this task. If the lead disagrees and wants a db write in 7.8, that adds a
   risky-path touch (`packages/db/src/repositories/**`, reviewers: security-reviewer plus
   code-reviewer) and should be its own phase with its own `risk: high` decision; it is not planned
   here.

## Budget
Budget: 65 tool calls (2 phases: A packages/evals ~40, B apps/cli ~25)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (only `source ~/.nvm/nvm.sh && corepack pnpm install`,
`corepack pnpm turbo run typecheck lint test --filter=<pkg>...` for the phase's package, `git` on
the task branch, `python3 .claude/skills/merge-gate/merge_gate.py 7.8`,
`python3 .githooks/secret-scan.py --all`). No network, no real model or provider keys.

## Exit conditions
- **DONE (per phase):** that phase's package passes `typecheck lint test` (existing coverage bar);
  secret scan clean; no file outside the phase's list touched. Task DONE when Phase A's demo-gate
  scorecard test shows `accuracy`/`locked_content` measured with the right rates and
  `hints_before_answers` unmeasured for a material-change run, and Phase B's CLI test shows
  `--scorecard` writing the matching JSON with the command's exit code unchanged.
- **PARTIAL (stop and report):** a phase passes ~35 tool calls (A) or ~22 (B); a file outside the
  plan needs changing (e.g. `packages/contracts`, `packages/db`, `evals/suites/**`); or the lead
  answers an open question above in a way that changes the file list (e.g. asks for db
  persistence in 7.8).

## Lead answers (21 Oct 2026)
1. One combined rate per category (platform plus agent origin), and the scorecard also carries the passed/total counts per origin so the split stays visible. Logged risk: low.
2. No `generatedAt` or `agentVersion` in `Scorecard` now; 8.7 attaches a scorecard to a published agent version.
3. No db persistence in 7.8; 8.7 owns storing gate results and the scorecard (same as 7.4 Q3).
