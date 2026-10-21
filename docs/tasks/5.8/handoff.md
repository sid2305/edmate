# 5.8 handoff: role-play engine

**Status:** PARTIAL (Phase A done; Phases B–D remain)

- Branch: `m5/5.8-roleplay` (built on local `work-5.8a`, pushed as `work-5.8a:m5/5.8-roleplay`)
- Worktree: `.claude/worktrees/agent-af0a80a7590251a3b` (under the repo root)
- Plan: `docs/tasks/5.8/plan.md` (Phase A plus "Lead answers (21 Oct 2026)")

## Phase A: ADR-0013 and the role-play state machine

### Files
- `docs/adr/0013-roleplay-state.md`: the architect's draft, with the ten typescript-reviewer points applied (listed below). No other change to its decisions.
- `packages/harness/src/pedagogy/roleplay.ts` (new): `rolePlayStep` (the ADR §1 table, with clamps), the `RolePlay` union keyed on phase, `RolePlayPhase`, `ROLEPLAY_PHASES`, `RolePlaySection`/`RolePlayStateSection`, `ROLEPLAY_PHASE_SECTION` (`Record<phase, section>`, frozen), and `RolePlayControl` (moved here from `skills.ts`, which re-exports it).
- `packages/harness/src/pedagogy/helpState.ts`: `StoredPersonaPhaseSchema` / `StoredPersonaPhase` (`'paused' | 'ended'`); `personaPhase` in `HelpStateSchema` (`exactOptional`); `parseSessionHelp`, `personaFields` and `withPersonaCount` carry it.
- `packages/harness/src/pedagogy/skills.ts`: `skillStep` uses `rolePlayStep`, saves the count and phase, and returns `rolePlay` (optional on `SkillStep`).
- `packages/harness/src/pedagogy/policy.ts`: `rolePlay?` on `PolicyResult`; `finish` passes it through with a conditional spread.
- `packages/harness/src/pedagogy/budgets.ts`: `SKILL_OUTPUT_TOKENS.mock_interview = 350`.
- `packages/harness/src/pedagogy/index.ts`: exports the above.
- Tests: `roleplay.test.ts` (new), `roleplay.legacy.test.ts` (new), `helpState.test.ts`, `skills.test.ts`, `policy.test.ts`, `budgets.test.ts`, `pipeline/runner.personaCount.test.ts`.

No change to prompt packs, content, contracts, apps or db. `roleplay.ts` imports only `@edmate/contracts` (a type) and its own pedagogy modules. No model calls.

### ADR-0013: typescript-reviewer points applied
1. Rollback restated: an unreadable blob is never saved over, so the rest of the session goes to `ask_teacher`; rollback is free until the 5.8a wiring, after that it needs a migration that removes `personaPhase`.
2. `rolePlay` is a union keyed on phase with each section's numbers; `ROLEPLAY_PHASE_SECTION` is a `Record<phase, section>`; `rolePlay` stays optional on `SkillStep`.
3. `finish` in `policy.ts` named, with the pass-through and its test.
4. Clamps: `total = M'`, `N = clamp(before, 1, M')` on pause and resume, `answered = clamp(before − 1, 0, M')`; one test per clamp.
5. The post-stop count change is listed next to the resume fix; the legacy-frame sequence test is named; the "prompts unchanged until Phase B" line is reworded.
6. Grounding on a debrief or stopped reply is noted as open, for a Phase B integration test (ask the human if it needs a judge change or exemption).
7. `createPersonaLibrary(entries)`, typed `ReadonlyMap<string, Readonly<Persona>>`, deep-frozen values; Phase B makes the `FrozenMap` error text neutral.
8. Group helper signature: `rolePlaySections(frame): Readonly<Record<RolePlaySection, string>> | undefined`, used by `parseFrame` and `compose`.
9. Strict start payload: an extra field fails closed to coach silently; B-37 item 6's answer changes the schema in this ADR or one that supersedes it.
10. Naming: `StoredPersonaPhase` vs `RolePlayPhase`, with the mapping stated.

None of the ten conflicted with the ADR's decisions. `python3 docs/adr/check-headings.py` passes (no output, exit 0).

### Tests (acceptance evidence)
```
corepack pnpm vitest run src/pedagogy/roleplay.test.ts          → 27 passed (red first: module missing)
corepack pnpm vitest run src/pedagogy/helpState.test.ts         → 73 passed (6 failed against the old helpState.ts)
corepack pnpm vitest run src/pedagogy/budgets.test.ts src/pedagogy/skills.test.ts src/pedagogy/policy.test.ts
                                                                → red first: 9 failed | 131 passed; then green
corepack pnpm vitest run src/pedagogy/roleplay.legacy.test.ts   → 3 passed
corepack pnpm vitest run src/pipeline/runner.personaCount.test.ts → 16 passed (10 new)
corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...
  → @edmate/harness: Test Files 114 passed, Tests 5121 passed; Tasks: 10 successful, 10 total
  → coverage: roleplay.ts, helpState.ts, skills.ts, policy.ts, budgets.ts all 100 / 100 / 100 / 100
python3 docs/adr/check-headings.py                               → (no output, exit 0)
python3 .githooks/secret-scan.py --all                           → (no output, clean)
```
What the tests pin:
- `roleplay.test.ts`: each table row (start; persona switch, including while ended; a blob with no persona id; stored ended with no control, `/pause` and `stop`; pause; pause while paused; stop; stop while paused; resume; resume at M; debrief; question), a whole role-play sequence, and each clamp (M = 0; M over PERSONA_QUESTIONS_MAX; pause, resume and stop with no count and with a count above M; stop right after the start; an ordinary turn with a count above M; an ordinary turn with no count).
- `helpState.test.ts`: save-and-load round trip of `paused` and `ended`; an old blob without the field; unknown values unreadable; `serializeSessionHelp` rejects them; `copyHelp`, `personaFields`, `withPersonaCount`; the field fits the JSON limit at every other maximum.
- `skills.test.ts` / `policy.test.ts`: `skillStep` saves and clears the phase per row and returns `rolePlay`; other skills, the coach fallback and a solved practice item carry the phase; `decidePolicy` passes `rolePlay` through, and a non-persona turn, a closed move and `fallbackPolicy` carry none; a persona debrief has `maxOutputTokens` 350 and move `ask`.
- `runner.personaCount.test.ts`: a failed debrief or stop turn (generate error, postGuard-failure safe reply, guard replace, cancel) saves no `ended`; a failed pause saves no `paused`; a failed resume keeps the loaded `paused`; an ok reply saves either phase.
- `roleplay.legacy.test.ts` (fixture set, legacy frame): start, answer, stop, message → `1/5, 2/5, 2/5, 2/5`; start, answer, `/pause`, message → `1/5, 2/5, 2/5, 2/5`; all asked → `1/5 … 5/5, 5/5 (debrief), 5/5 (ended)`.

### Deviations
- File name: the plan said `docs/adr/0013-role-play-state.md`; the lead's answer and the prompt say `docs/adr/0013-roleplay-state.md`, which is used.
- `RolePlayControl` moved from `skills.ts` to `roleplay.ts` (to avoid an import cycle); `skills.ts` re-exports it, so no import site changed.
- `rolePlayStep` returns `stored: StoredPersonaPhase | null` (null removes the field) rather than an optional property, so the "clear" case is explicit under `exactOptionalPropertyTypes`.
- The section-name types (`RolePlaySection`, `RolePlayStateSection`) are defined in `roleplay.ts` now, so `ROLEPLAY_PHASE_SECTION` is typed; Phase B adds the sections to `FRAME_SECTIONS` and `OPTIONAL_FRAME_SECTIONS` and should import these types.

## Left to do
- **Phase B** (harness): the persona forms and the all-or-none group in `promptPacks.ts` (`rolePlaySections`); `compose.ts` new-form path (`move-roleplay`, the phase section into `{{roleplay_state}}`, throw if `rolePlay` is missing); `personas.ts` (`PersonaLibrary`, `createPersonaLibrary`, `resolvePersona`, strict payload schema on `PersonaSchema.shape.id`); `PipelineDeps.personas?`; `buildContext`; `testSteps`; the pipeline integration test (start, two answers, `/pause`, resume, stop); the coverage-gate decision (open question 6, lead default) with an uncovered-fixture test; the debrief-with-grounding integration test (ADR point 6; ask the human if it needs a judge change).
- **Phase C** (content): `frame@1.2.0`, `set@1.3.0` (`reviewed_by: pending`), `readPersonaLibrary`, content snapshots.
- **Phase D** (evals): about 10 `persona-roleplay-*` cases and `rolePlayFixtures.test.ts`, after 5.9 leaves `packages/evals`.
- Reviews: ADR-0013 needs architect, security-reviewer and typescript-reviewer sign-off on the applied points; code-reviewer for `pedagogy/**`.

## Decisions
- **Role-play phases and `personaPhase`** — risk: high. The ADR-0013 §1 table: a stored `personaPhase?: 'paused' | 'ended'` plus the existing count and id; a start or persona switch opens question 1; `/pause` holds the question; `stop` goes straight to the debrief (lead default, pending B-37) and ends; the answer to question M' debriefs and ends; every later turn is `ended` until a new start; a follow-up question from the interviewer counts toward M. The move stays `ask` in every phase.
- **Resume fix (intended change, every set)** — risk: medium. The turn after `/pause` no longer adds one: a legacy-frame session shows "question N of M" again on that turn where it used to show N + 1. A pre-5.8 trace of a resume turn re-decides to N.
- **Post-stop count (intended change, every set)** — risk: medium. After a `stop` with fewer than M questions asked, every later turn is `ended` and keeps the count: a legacy-frame session keeps showing "question N of M" where it used to rise towards M. Pinned by `roleplay.legacy.test.ts`.
- **Clamps on the numbers handed on** — risk: low. `total = M'`, pause/resume `N = clamp(before, 1, M')`, `answered = clamp(before − 1, 0, M')`; the saved count is never clamped down.
- **`SKILL_OUTPUT_TOKENS.mock_interview = 350`** — risk: low. Applies to every persona turn (debrief room); the coach fallback and locked `no_persona` keep their budgets.
- **`pedagogy/roleplay.ts`, not `src/roleplay/`** — risk: low. Keeps it under the `pedagogy/**` risk group; the empty `src/roleplay/.gitkeep` is left as it is.
- **`RolePlayControl` lives in `roleplay.ts`**, re-exported by `skills.ts` — risk: low.
