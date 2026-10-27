# Task 5.8b plan

## Acceptance (verbatim)
"each item fixed or recorded in ADR-0013; the coverage-gate rule matches the human's B-37 answers
with tests." Shown by: a `rolePlaySkipsCoverageGate` test table covering every row (bare `/pause`,
`/pause` with text, `ended`, `stop`, resume, debrief, answer N>1, start), a `decidePolicy` test for
the off_topic/meta redirect on `/pause <text>`, a `skillStep` persona-mismatch assertion test, a
`compose` test that sub-threshold chunks are dropped on a gate-skipped role-play turn, prerelease
tests for `newestSignedSet` and `selectPersonaLibrary`, a `PersonaTemplateError` type test, and
ADR-0013 showing `Status: Accepted` with its rollback note intact.

## B-37 rule (final, replaces ADR-0013 §1's "pending" rule)
Only two role-play cases still meet the coverage gate: a turn whose stored phase is `ended`, and a
`/pause` that carries extra text after the command. Every other role-play turn skips it: a bare
`/pause`, `stop`, resume, debrief, and — this reverses ADR-0013 §1 as drafted — every answer turn
(`question`, N > 1), because a gated answer could route a personal reply to the teacher inbox
(B-37 q9). The off_topic/meta redirect in `policy.ts` is steered past only by a bare `/pause`,
`stop` or `start`; `/pause <text>` now gets the ordinary redirect (B-37 q8, fix to `steersRolePlay`).

## Phase A — harness gate rule + ADR-0013 (budget 45 tool calls)
Files:
- `packages/harness/src/pedagogy/roleplay.ts` — `rolePlaySkipsCoverageGate` takes the control and
  whether `/pause` carried extra text (not just `RolePlay`); the `question === 1` skip keys on
  `control === 'start'`, not `r.question`. Update its doc comment.
- `packages/harness/src/pedagogy/roleplay.test.ts` — one test per table row above.
- `packages/harness/src/pedagogy/policy.ts` — `steersRolePlay` (line ~103) only on a bare `/pause`,
  `stop` or `start`; thread the "has extra text" bit from `rolePlayControl`'s caller into both
  `steersRolePlay` and the `rolePlaySkipsCoverageGate` call.
- `packages/harness/src/pedagogy/policy.test.ts` — `/pause <text>` hits the off_topic/meta redirect;
  bare `/pause` still steers; an answer turn (N>1) skips the gate (reversal case).
- `packages/harness/src/pedagogy/skills.ts` (~line 90) — `skillStep` asserts a passed-in
  `i.rolePlayStep` was computed for `i.ctx.persona.id` (throw, defence in depth, like the existing
  bug-not-content-error pattern in `compose.ts`); `skills.test.ts` covers the mismatch throw.
- `packages/harness/src/pedagogy/compose.ts` — on a gate-skipped role-play turn, filter `chunks` to
  `score === undefined || score >= DEFAULT_COVERAGE_THRESHOLD` before `materialBlock` (import from
  `./coverage.js`; no new frame text, so "reword no material" is NOT taken — see open question).
- `packages/harness/src/pedagogy/compose.test.ts` or `compose.snapshot.test.ts` — sub-threshold chunk
  dropped on a gate-skipped turn; kept on a gated one.
- `docs/adr/0013-roleplay-state.md` — §1 "Rule order" rewritten to the final rule above (no longer
  "pending B-37"); `Status: Accepted`; confirm the existing Consequences "Rollback" note already
  matches "strict HelpState schema drops personaPhase blobs on an older deploy" (it does, lines
  175-177) — no new rollback text needed, just drop "pending the human's answer to B-37" from
  Status/Context.

Tests first: write the roleplay.test.ts table and the policy.test.ts redirect/gate cases red, then
make `rolePlaySkipsCoverageGate`/`steersRolePlay` green; same red-then-green for the skills.ts
assertion and the compose.ts filter.

Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...`
(gates every dependent: evals, apps/cli, apps/web, apps/worker).

Risky paths (`.claude/skills/merge-gate/risk-paths.txt`):
- `packages/harness/src/pedagogy/**` — reviewers: code-reviewer (MVP-first default, every PR anyway).
- `docs/adr/**` — reviewers: architect, security-reviewer, typescript-reviewer. The ADR edit is a
  rewrite of a decision that was explicitly "pending B-37" (not new scope), but it still matches the
  glob, so all three review it and the handoff logs `risk: high`.

## Phase B — content: prerelease skip + typed error (budget 25 tool calls)
Files:
- `packages/content/src/promptPacks.ts` — `newestSignedSet` skips any signed set whose version has
  a prerelease identifier (not just lower-precedence ones): a `2.0.0-rc.1` must not outrank a signed
  `1.3.0`.
- `packages/content/src/personaTemplates.ts` — same fix in `selectPersonaLibrary`'s `best` loop
  (skip a prerelease candidate); add a typed `PersonaTemplateError` (mirrors harness's
  `PromptPackError`) and use it in `readPersonaTemplateDir`/`readPersonaLibrary` in place of the
  bare `throw new Error(...)` at line 197 (and the directory-read throw above it).
- `packages/content/src/promptPacks.test.ts`, `personaTemplates.test.ts` — prerelease-skipped case
  for each selector; `PersonaTemplateError` instanceof/message test.

Tests first: a failing "signed prerelease does not outrank a signed release" case for both
selectors, then the fix; a failing "throws PersonaTemplateError" case, then the typed class.

Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/content...`

Risky paths: `packages/content/src/promptPacks.ts` and `packages/content/src/personaTemplates.ts` —
reviewers: code-reviewer (same MVP-first group as Phase A). No ADR touched in this phase.

## Files out of bounds
`content/skills/**`, `content/prompt-packs/**` (prompt-pack prose — must not change this task),
`apps/cli`, `apps/web`, `packages/db` (5.8a wiring is a separate follow-up per ADR-0013 §7),
`packages/contracts` (ADR-0013 §6: none of this needs a contracts change).

## Open questions
1. "Drop sub-threshold chunks or reword 'no material'" — Phase A takes the drop-chunks path only,
   because rewording is prompt-pack text and out of bounds for this task. If review wants the
   reword instead, that is a new prompt-pack-text decision for the lead/human, not 5.8b.
2. "selectPersonaLibrary skips prerelease versions (or the ADR accepts them)" — plan takes "skips",
   matching the promptPacks.ts fix and ADR-0013's existing semver language; flag if the human wants
   the ADR to accept prereleases instead.

## Budget
Budget: 70 tool calls (2 phases: Phase A 45, Phase B 25; packages/harness, packages/content, docs/adr)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test and secret scan only)

## Exit conditions
Status: DONE when both phases' gate commands pass green and ADR-0013 shows `Status: Accepted` with
tests for every B-37 table row. Status: PARTIAL past ~50 tool calls in a phase, or if a finding
needs prompt-pack text changes (open question 1) or a contracts change — stop and hand back rather
than guess.

## Lead answers (27 Oct 2026)
- Q1: drop the sub-threshold chunks in compose.ts; no prompt-pack prose changes in this task.
- Q2: selectPersonaLibrary skips prerelease versions, like newestSignedSet.
- The ADR-0013 edit gets architect, security-reviewer and typescript-reviewer, and a lead risk: high decision. No safety-reviewer per PR until the pilot gate (MVP-first rule).
- Phase A and Phase B run one after the other on the same branch, each by a fresh builder; Phase B starts from Phase A's pushed branch.
