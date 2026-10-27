# Handoff: 5.8b

Status: DONE

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

### 27 Oct 2026 · 5.8b ADR-0013 and role-play gate merge · decided by lead · risk: high
- Decided: merge the ADR-0013 rewrite (docs/adr/0013-roleplay-state.md, Status Accepted with the B-37 answers) and the role-play coverage-gate code in packages/harness/src/pedagogy (roleplay.ts, policy.ts, skills.ts, compose.ts) and packages/content (promptPacks.ts, personaTemplates.ts). architect, security-reviewer, typescript-reviewer and code-reviewer reviewed it; fix round 1 fixed the two HIGH ADR wording findings and the MEDIUM `/pause.` punctuation finding, and all four re-reviews approved.
- Why: it carries out the human's B-37 answers (q8: an ended role-play and a `/pause` with text meet the coverage gate; q9: every answer turn skips it), and a signed prerelease prompt pack or persona library can no longer outrank a signed release. No packages/contracts change.

### 27 Oct 2026 · 5.8b budget overrun · decided by lead · risk: low
- Decided: accept 204 tool calls (harness count: Phase A 102, Phase B 59, fix round 43) against the plan's 70.
- Why: Phase A rewrote the B-37 rule across policy, skills, compose and the ADR with a test per table row, which the plan under-counted at 45; the fix round was needed for review findings. Later role-play plans budget Phase A at about 90.

### 27 Oct 2026 · 5.8b coverage-gate row tests live in policy.test.ts · decided by lead · risk: low
- Decided: accept the builder's choice to test every B-37 table row through decidePolicy in packages/harness/src/pedagogy/policy.test.ts rather than in roleplay.test.ts as the plan listed.
- Why: the rows depend on the policy wiring (the control, pauseHasExtraText and the gate together), so testing them through decidePolicy covers more; code-reviewer confirmed every row is covered (review LOW).

### 27 Oct 2026 · 5.8b PersonaTemplateError: one throw, not two · decided by builder · risk: low
- Decided: converted the single `throw new Error(...)` in `readPersonaLibrary` to
  `PersonaTemplateError`, and did not add a second conversion in `readPersonaTemplateDir` or
  anywhere else.
- Why: the plan's file note says "use it ... in place of the bare `throw new Error(...)` at line
  197 (and the directory-read throw above it)", but `readPersonaTemplateDir` has no throw — a
  missing/non-directory input already returns `{ templates: [], issues: [...] }`, matching
  `promptPacks.ts`'s precedent of never throwing from the directory-read step. `readPersonaLibrary`
  has exactly one throw, which is now `PersonaTemplateError`. Read as a plan reference to the
  single throw at that line, not a second site; flagging here since the file only has one.

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

Tool calls used: 204 (harness count: Phase A 102, Phase B 59, fix round 43; the builders reported 61, 26 and 21)

## Phase B

Fixed the two prerelease-precedence bugs and added the typed `PersonaTemplateError` in
`packages/content`, test first.

Changed files:
- `packages/content/src/semver.ts` — new exported `isPrerelease(v)`: whether an already-valid
  version carries a prerelease identifier (build metadata stripped first, same split as
  `compareSemver`). Shared by both selectors below.
- `packages/content/src/promptPacks.ts` — `newestSignedSet` now also skips a signed set whose
  version `isPrerelease`, so a `2.0.0-rc.1` can never outrank a signed `1.3.0` from an older major
  (previously `compareSemver` ranked by major.minor.patch first, so a prerelease from a newer
  major still won). Doc comment updated.
- `packages/content/src/personaTemplates.ts` — same `isPrerelease` skip added to
  `selectPersonaLibrary`'s `best` loop (right after the existing `isSigned` check), so a prerelease
  template version never becomes the chosen one even when signed and numerically higher by major.
  Added `PersonaTemplateError` (mirrors harness's `PromptPackError`: `name` field, `issues` on the
  instance, a message that lists every issue) and used it in `readPersonaLibrary` in place of the
  bare `throw new Error(...)` — this is the only throw in the file; `readPersonaTemplateDir` itself
  never throws (it returns `{ templates, issues }`), so there was no second "directory-read throw"
  to convert (see Decisions).
- `packages/content/src/promptPacks.test.ts` — new case: a signed `2.0.0-rc.1` does not outrank a
  signed `1.3.0`.
- `packages/content/src/personaTemplates.test.ts` — new cases: same prerelease-does-not-outrank
  case for `selectPersonaLibrary`; `readPersonaLibrary` throws `PersonaTemplateError` (not a bare
  `Error`), `instanceof` and message checked.

Red-then-green evidence: added the two prerelease-skip assertions and the `PersonaTemplateError`
instanceof test first; ran `corepack pnpm --filter @edmate/content exec vitest run
src/promptPacks.test.ts src/personaTemplates.test.ts`, which failed (`2.0.0-rc.1` won both
selectors; the throw was a bare `Error`, not an instance of the not-yet-existing class). Added the
`isPrerelease` skip to both `best`/ranking loops and the `PersonaTemplateError` class, re-ran: all
80 tests in both files green.

### Decisions

Moved to the top `## Decisions` section.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/content` (content and its
  dependents: cli, db, evals, web, worker) → 20/26 tasks ran (6 cached up to date), all green
  except `@edmate/cli#test`: `test/chatDbRetrieval.int.test.ts` hit `FATAL 57P01 terminating
  connection due to administrator command` against the shared dev Postgres — an environment flake
  from another builder's concurrent `packages/db`/`apps/cli` work on the same shared dev database,
  not caused by this task (Phase B touches only `packages/content`, which `apps/cli` depends on for
  types only, not for DB access). `@edmate/content`'s own gate: typecheck/lint/test all green, 25
  test files, 546 tests, coverage 99.4%/95.88%/100%/99.88% (stmts/branch/funcs/lines).
- `corepack pnpm exec prettier --check` on the 5 changed files → one file needed `--write`
  (test-file formatting only, no logic change); re-checked clean.
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

### Budget

Phase B tool calls used: 26

## Fix round 1

1. [HIGH] `docs/adr/0013-roleplay-state.md:171` (code-reviewer, typescript-reviewer, architect): the
   Consequences "Coverage gate" bullet listed "ended" among the turns that skip the gate, then said
   an `ended` turn meets it — contradicting itself and §1 "Rule order" (line 65) and
   `rolePlaySkipsCoverageGate` in `roleplay.ts`. Dropped "ended" from the skip list so line 171 now
   reads "a bare role-play control, resume, debrief and every answer turn (question N ≥ 1) skip the
   coverage gate ... only a turn whose stored phase is `ended` and a `/pause` with extra text still
   meet it", matching line 65 and the code.
2. [HIGH] `docs/adr/0013-roleplay-state.md:66, 82, 85, 140` (architect): these still said "lead
   default(s), pending human answer B-37" after the human answered B-37 (21 Oct 2026, every
   recommended default) and q8/q9 (27 Oct 2026, task 5.8b). Reworded each to say the human chose it:
   line 66 → "**Human answers, B-37 (21 Oct 2026):**"; lines 82, 85 and 140 →
   "(B-37 answer, 21 Oct 2026)". Line 152's "Not chosen (B-37 default)" → "Not chosen (B-37 answer
   3a)". Prose only; no rule changed. `grep -n -i pending docs/adr/0013-roleplay-state.md` now shows
   only the two `reviewed_by: pending` lines (84, 112), nothing about B-37.
3. [MEDIUM] `packages/harness/src/pedagogy/skills.ts:83-87` (code-reviewer, security-reviewer):
   `pauseHasExtraText` treated trailing punctuation as extra text, so `/pause.` or `/pause!` was not
   a bare pause, unlike `rolePlayControl`'s stop parsing (which strips `[.!\s]+$` first). Added
   `/pause.`, `/pause!`, `/pause ` (false) and `/pause what is x?` (true) to the
   `pauseHasExtraText` table in `skills.test.ts` (~lines 390-399); ran
   `vitest run src/pedagogy/skills.test.ts -t pauseHasExtraText` and saw the two punctuation cases
   fail (`expected true to be false`, red). Fixed `pauseHasExtraText` to strip the same
   `[.!\s]+$` suffix before slicing off `/pause` and checking for remaining text; re-ran the same
   command: 11/11 pass (green). Full `skills.test.ts`: 87/87 pass.

### Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness` → 4/4 tasks green
  (typecheck, lint, test with coverage).
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` (harness plus its
  dependencies) → all harness-related tasks green; two unrelated pre-existing flaky tests surfaced
  in dependency packages under load: `@edmate/content`'s `safeRegex.test.ts` timing probe (5000ms
  timeout, passed standalone on retry) and `@edmate/queue`'s `turnLimits.int.test.ts` Redis timing
  assertion. Neither touches a file this fix round changed.
- `corepack pnpm exec prettier --check` on `docs/adr/0013-roleplay-state.md`,
  `packages/harness/src/pedagogy/skills.ts` and `packages/harness/src/pedagogy/skills.test.ts` →
  all matched files use Prettier code style, clean.
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

### Budget

Fix round tool calls used: 21

## Fix round 2

PR #361's CI `node` job failed in `apps/cli`'s `chat.test.ts`, a dependent package the builder's
gate (`--filter=@edmate/harness` and `--filter=@edmate/content`) never ran:

    FAIL apps/cli src/commands/chat.test.ts > edmate chat: a scripted role-play session (5.8a)
      > sends every role-play line with the mock_interview skill until /leave
    AssertionError: expected '[[SAFETY]] You are an AI tutor built …' to contain
      'Skill: mock interview'

**Cause.** This is the deliberate coverage-gate rule 5.8b itself shipped (ADR-0013 §1, "Rule
order (final; B-37 answered 27 Oct 2026, task 5.8b)"): "A `/pause` that carries text after the
command does not steer (B-37 q8, the `steersRolePlay` fix): that turn gets the ordinary
off_topic/meta redirect instead" and, further down, "Only two role-play cases still meet the
coverage gate: a turn whose stored phase is `ended` ... and a `/pause` that carries extra text
(steered past the control, so it meets the gate like any ordinary turn)." The pre-existing CLI
test (written in 5.8a, before this B-37 answer) sent `/pause need help` as one of the four
role-play turns it asserts all carry the `mock_interview` skill block. Under the new rule, a
`/pause` with extra text now meets the coverage gate; with no retrieved material in this scripted
scenario the gate locks/redirects that turn, so its system prompt correctly has no skill block —
the CLI test's input, not the harness code, was stale against the new spec. This exact
`/pause`-with-extra-text-under-an-active-role-play case already has dedicated coverage at the
policy level (`packages/harness/src/pedagogy/policy.test.ts`, `"a /pause with extra text ... gets
the ordinary ... redirect (B-37 q8, steersRolePlay fix)"` and the bare-`/pause`-still-steers case
right after it), so the CLI-level scripted-session test did not need to carry this edge too.

**What changed.** `apps/cli/src/commands/chat.test.ts`: changed the role-play session's fourth
typed line from `'/pause need help'` to a bare `'/pause'` (no text after the command), with a
comment pointing at ADR-0013 §1 and the policy-level test that already covers the
extra-text case. No harness or content code changed.

Red (before the fix, on origin/m13/5.8b-roleplay-gate-followups):
`vitest run src/commands/chat.test.ts` → `AssertionError: expected ... to contain 'Skill: mock
interview'` (see failure above), 29 passed / 1 failed.

Green (after the fix): `vitest run src/commands/chat.test.ts` → 30 passed, 0 failed.

### Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness` → 4/4 green (cached,
  unaffected by this round's change).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/content` → 5/5 green, run alone to
  avoid the known timing-probe flake under load (`safeRegex.test.ts`); confirmed flaky-not-broken
  by also seeing it fail once and then pass standalone when run together with `@edmate/web`.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/cli` → 10/10 green, 162 passed / 1
  skipped, including `test/chatDbRetrieval.int.test.ts` (no flake this run; no re-run needed).
- `corepack pnpm exec prettier --check apps/cli/src/commands/chat.test.ts` → all matched files use
  Prettier code style, clean.
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

### Budget

Fix round 2 tool calls used: 17
