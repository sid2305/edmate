# Handoff: 5.8b

Status: DONE (Phase A)

## Phase A

Built the final B-37 coverage-gate rule in `packages/harness` and rewrote ADR-0013 §1 to match.
Test-first: ran the existing suite red after each behaviour change, then fixed the stale
assertions and added new table-row/edge-case tests until green.

Changed files:
- `packages/harness/src/pedagogy/roleplay.ts` — `rolePlaySkipsCoverageGate(r, control,
  pauseHasExtraText)` now returns `false` (gate applies) only for `r.phase === 'ended'` or
  `control === 'pause' && pauseHasExtraText`; every other role-play turn skips the gate, including
  an answer turn (`question`, N > 1) — the B-37 reversal. Doc comment rewritten.
- `packages/harness/src/pedagogy/roleplay.test.ts` — unchanged (its table already covered every
  `rolePlayStep` row; the gate rule lives in `policy.test.ts`, per the plan's acceptance test).
- `packages/harness/src/pedagogy/policy.ts` — `steersRolePlay` now excludes a `/pause` with extra
  text (B-37 q8); `decidePolicy` computes `gateSkipped` via the new `rolePlaySkipsCoverageGate`
  signature and carries it on `PolicyResult.rolePlayGateSkipped`; `finish` passes it through, and
  the `rolePlayStep` call site now also hands `skillStep` the `rolePlayStepPersonaId` it computed
  the step for.
- `packages/harness/src/pedagogy/policy.test.ts` — rewrote the "passes the gate" table (dropped the
  `ended` row, since it now meets the gate), added: an uncovered `ended` turn meets the gate; an
  ended turn with a locked hit is locked; an uncovered answer turn (N > 1) now skips the gate
  (reversal); a question turn with a locked hit skips the gate; a `/pause` with extra text during
  an active role-play gets the ordinary meta/off_topic redirect, a bare `/pause` still steers past
  it (new `it.each`); a bare `/pause` meeting the gate test.
- `packages/harness/src/pedagogy/skills.ts` — `pauseHasExtraText(input)` (new export, mirrors
  `rolePlayControl`'s text parsing); `SkillInput.rolePlayStepPersonaId`; `skillStep` throws
  `Error('skillStep: rolePlayStep was computed for a different persona')` when a passed-in
  `rolePlayStep` carries a persona id that disagrees with `ctx.persona.id` (bug-not-content-error,
  same pattern as `compose.ts`'s role-play check).
- `packages/harness/src/pedagogy/skills.test.ts` — added `pauseHasExtraText` table and the
  persona-mismatch throw test.
- `packages/harness/src/pedagogy/compose.ts` — imports `DEFAULT_COVERAGE_THRESHOLD`; on a
  gate-skipped role-play turn (`policy.rolePlayGateSkipped === true`), filters `ctx.retrieved` to
  `score === undefined || score >= DEFAULT_COVERAGE_THRESHOLD` before `materialBlock`. No
  prompt-pack prose changed (lead answer Q1: drop chunks, not reword).
- `packages/harness/src/pedagogy/compose.test.ts` — added a test that a sub-threshold chunk is
  dropped on a gate-skipped role-play turn and kept on a gated one; updated the "closed move"
  table's `not_covered`/`locked` cases to use an `ended`-phase help (a question-turn help no longer
  produces a closed move, since it now skips the gate).
- `packages/harness/src/pipeline/steps/decide.ts` — reads `pauseHasExtraText(env.input)` alongside
  `rolePlayControl(env.input)` and hands both to `decidePolicy`.
- `packages/harness/src/pipeline/roleplay.integration.test.ts` — updated the "uncovered: the start
  opens question 1" test: an answer to question 1 on an uncovered topic now also skips the gate
  (`move: 'ask'`, asks question 2) rather than hitting `ask_teacher`.
- `docs/adr/0013-roleplay-state.md` — `Status: Accepted`; §1 "Rule order" rewritten to the final
  B-37 rule (two gate-meeting exceptions, the compose chunk-filter note, the skillStep mismatch
  assertion); the stale "Coverage gate" Consequences bullet updated to match (it previously said
  "an answer turn (N > 1) still meets it", which the final rule reverses). Confirmed the
  "Rollback" note (lines 175-177, unchanged) already matches "strict HelpState schema drops
  personaPhase blobs on an older deploy" — no edit needed there.

Red-then-green evidence: before the fix, `corepack pnpm --filter @edmate/harness test -- run`
showed 6 failing tests (the stale `ended`-skips-gate, N>1-meets-gate, locked-hit-is-locked
assertions in `policy.test.ts`/`compose.test.ts`, and the integration test's `ask_teacher`
expectation) once `rolePlaySkipsCoverageGate`'s signature and rule changed; coverage then flagged
`src/pedagogy/**` below 100% (the new `skillStep` throw branch and `pauseHasExtraText` were
unexercised) until the mismatch-throw and `pauseHasExtraText` tests were added. All green after.

## Decisions

### 27 Oct 2026 · 5.8b ADR-0013 rewrite · decided by builder · risk: high
- Decided: rewrote ADR-0013 §1 "Rule order" to the final B-37 rule (two gate-meeting exceptions:
  `ended` phase, and `/pause` with extra text; every other role-play turn skips the gate,
  including N > 1 answers), set `Status: Accepted`, and updated the one stale Consequences bullet
  that restated the old (now-reversed) rule so the ADR does not contradict itself.
- Why: the plan scoped the edit to §1 and Status/Context, but left a "Coverage gate" bullet in
  Consequences that quoted the Phase B draft's rule verbatim; leaving it would make the ADR
  internally inconsistent once Status became Accepted. The edit is a restatement of the same
  decision this task makes in §1, not new scope. Reviewers: architect, security-reviewer,
  typescript-reviewer (risky path `docs/adr/**`, per the plan and lead answer).

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` → 10/10 tasks
  successful (typecheck, lint, test across `@edmate/harness` and its dependents: evals,
  `apps/cli`, `apps/web`, `apps/worker`). `src/pedagogy/**` coverage: 100% statements/branches/
  functions/lines.
- `corepack pnpm exec prettier --check <changed files>` → "All matched files use Prettier code
  style!" (one file needed `--write` first; re-checked clean, and the full gate re-run green after).
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Budget

Phase A tool calls used: 61
