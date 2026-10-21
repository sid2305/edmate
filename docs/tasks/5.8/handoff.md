# 5.8 handoff: role-play engine

**Status:** PARTIAL (Phases A and B done; Phases C and D remain)

- Branch: `m5/5.8-roleplay` (Phase A from local `work-5.8a`; Phase B from local `work-5.8b`, pushed as `work-5.8b:m5/5.8-roleplay`)
- Worktrees: Phase A `.claude/worktrees/agent-af0a80a7590251a3b`; Phase B `.claude/worktrees/agent-acb4f174cc4cf8459` (under the repo root)
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

## Phase B: persona forms, role-play compose, persona library, gate rule

### Files
- `pedagogy/promptPacks.ts`: the seven role-play sections in `FRAME_SECTIONS` (numbers-only slots) and `OPTIONAL_FRAME_SECTIONS`; `ROLEPLAY_SECTIONS` (frozen, compile-time exhaustive); `roleplay_state` an optional persona slot, the count slots now optional; `checkPersonaForm` (exactly one form: legacy or role-play, every missing or extra item named); `rolePlaySections(frame)` (all seven, frozen, or undefined); the library uses `FrozenMap`.
- `pedagogy/frozenMap.ts` (new): a read-only `Map` with a neutral `"<label> is read-only"` error (ADR point 7).
- `pedagogy/compose.ts`: a role-play turn (new-form frame and `policy.reason === 'mock_interview'`) renders the persona with the phase's section in `{{roleplay_state}}` and the move line `move-roleplay`; throws if the persona or `policy.rolePlay` is missing. Closed moves and every legacy-form turn take the old path, byte-identical (legacy clamp comment added).
- `pedagogy/personas.ts` (new): `PersonaLibrary`, `createPersonaLibrary` (schema-checked copies, key = id, no duplicates, deep-frozen), `PersonaStartPayloadSchema` (strict, `PersonaSchema.shape.id`), `resolvePersona`.
- `pedagogy/roleplay.ts`: `Readonly` union members; `rolePlaySkipsCoverageGate`.
- `pedagogy/policy.ts` / `skills.ts`: `rolePlayStep` runs before the coverage gate and is handed into `skillStep` (`SkillInput.rolePlayStep?`), so it runs once; the gate runs only for a question-N>1 turn.
- `pedagogy/helpState.ts`: comment rewrap. `pedagogy/index.ts`: exports.
- `pipeline/types.ts`: `PipelineDeps.personas?`. `pipeline/steps/buildContext.ts`: `resolvePersona`.
- `testing/testSteps.ts`: `personas` option. `testing/promptPackFixtures.ts`: the role-play fixture set (`0.2.0-fixture-roleplay`), not in the default fixture library.
- `docs/adr/0013-roleplay-state.md`: §1 rule order (gate exemption, lead default pending B-37); §5 legacy-clamp note; Consequences "Coverage gate" now decided, with the grounding finding.

### Tests (acceptance evidence)
```
corepack pnpm vitest run src/pipeline/roleplay.integration.test.ts → 7 passed
corepack pnpm vitest run src/pedagogy/promptPacks.test.ts          → 41 passed
corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...
  → @edmate/harness: Tests 5209 passed (116 files); contracts 348; config 42
  → Tasks: 10 successful, 10 total
  → coverage: compose, frozenMap, personas, policy, roleplay, skills 100/100/100/100; promptPacks 100 lines
python3 .githooks/secret-scan.py --all → exit 0, no output
```
What the tests pin:
- `promptPacks.test.ts`: both forms load; each missing section, extra section, kept count slot and half-legacy persona is named; a frame with no persona section reports only that.
- `compose.test.ts` / `compose.snapshot.test.ts`: each phase's line under the new form, `move-roleplay` never `move-ask`, no "Ask question" on a debrief, the throws, closed moves on a persona turn, the coach fallback, hostile persona text literal; 6 new-form snapshots; the snap file only grew (216 lines added, 0 removed), so legacy output is byte-identical.
- `personas.test.ts` (22): library checks, strict payload, every resolution path.
- `policy.test.ts`: uncovered start → question 1; start with a locked hit → question 1; pause, stopped, resume, debrief, ended pass the gate; uncovered question 3 → `ask_teacher`, locked → `locked`; off_topic and distress still close; covered and no-persona turns unchanged.
- `buildContext.test.ts`: persona resolution through the step.
- `pipeline/roleplay.integration.test.ts` (real admit, entitle, buildContext, decide, generate; help state saved and reloaded each turn): start, two answers, `/pause`, resume, stop, ended, restart → `1/5, 2/5, 3/5, pause 3/5, resume 3/5, stopped (2 answered), ended, 1/5`; the last answer debriefs then ends; uncovered: start opens question 1 with no material, the answer meets the gate (`ask_teacher`), pause/resume/stop still steer. Grounding (real postGuard, fake overlap judge): a last-answer debrief and a stop debrief that keep to the material pass and are shown; a debrief judging delivery beyond the material, and a stop debrief on an uncovered topic, are replaced by the ask-teacher reply.

### Deviations
- "Role-play turn" in compose is `policy.reason === 'mock_interview'` with a new-form frame (review fix), so closed moves on a persona turn use the ordinary move lines.
- The legacy persona count slots became optional in `FRAME_SECTIONS`; `checkPersonaForm` requires both on the legacy form, so old frames are checked as strictly as before.
- The `roleplay-question` prose (Phase C) must say that with no material section the model asks which topic to practise.

## Left to do
- **Phase C** (content): `frame@1.2.0` with the seven sections and `{{roleplay_state}}` (the `roleplay-question` line says to ask which topic when there is no material; the debrief lines keep feedback to the material, see the question below), `set@1.3.0` (`reviewed_by: pending`), `readPersonaLibrary`, content snapshots.
- **Phase D** (evals): about 10 `persona-roleplay-*` cases and `rolePlayFixtures.test.ts`, after 5.9 leaves `packages/evals`.
- Reviews: Phase B needs code-reviewer and typescript-reviewer on `pedagogy/**` and `pipeline/**`; ADR-0013 needs architect, security-reviewer and typescript-reviewer sign-off on the applied points; code-reviewer for `pedagogy/**`.

## Decisions
- **Role-play phases and `personaPhase`** — risk: high. The ADR-0013 §1 table: a stored `personaPhase?: 'paused' | 'ended'` plus the existing count and id; a start or persona switch opens question 1; `/pause` holds the question; `stop` goes straight to the debrief (lead default, pending B-37) and ends; the answer to question M' debriefs and ends; every later turn is `ended` until a new start; a follow-up question from the interviewer counts toward M. The move stays `ask` in every phase.
- **Resume fix (intended change, every set)** — risk: medium. The turn after `/pause` no longer adds one: a legacy-frame session shows "question N of M" again on that turn where it used to show N + 1. A pre-5.8 trace of a resume turn re-decides to N.
- **Post-stop count (intended change, every set)** — risk: medium. After a `stop` with fewer than M questions asked, every later turn is `ended` and keeps the count: a legacy-frame session keeps showing "question N of M" where it used to rise towards M. Pinned by `roleplay.legacy.test.ts`.
- **Clamps on the numbers handed on** — risk: low. `total = M'`, pause/resume `N = clamp(before, 1, M')`, `answered = clamp(before − 1, 0, M')`; the saved count is never clamped down.
- **`SKILL_OUTPUT_TOKENS.mock_interview = 350`** — risk: low. Applies to every persona turn (debrief room); the coach fallback and locked `no_persona` keep their budgets.
- **`pedagogy/roleplay.ts`, not `src/roleplay/`** — risk: low. Keeps it under the `pedagogy/**` risk group; the empty `src/roleplay/.gitkeep` is left as it is.
- **`RolePlayControl` lives in `roleplay.ts`**, re-exported by `skills.ts` — risk: low.
- **Role-play turns skip the coverage gate except answers to question N > 1** — risk: medium. Lead default, pending B-37. `/pause`, `stop`, resume, debrief, ended and question-1 turns skip it, so `stop` always ends and a start never opens a teacher question; an answer turn still meets it. Recorded in ADR-0013 §1.
- **An uncovered or locked-hit start still opens question 1** — risk: medium. Lead default, pending B-37. No material section is shown; the Phase C prose asks which topic to practise.
- **`rolePlayStep` runs before the gate and is handed into `skillStep`** — risk: low. One computation per turn; `skillStep` still computes it when not given.
- **A compose role-play turn is `policy.reason === 'mock_interview'` with a new-form frame** — risk: low. Closed moves keep their own move lines.
- **Legacy count slots optional in the slot table, required by the form check** — risk: low.
- **`FrozenMap` shared by the prompt-pack and persona libraries** — risk: low. Neutral error text.

## Questions for the human
- **Debrief grounding (ADR-0013 point 6).** No judge change or exemption was needed: a debrief that keeps to the teacher's material passes the grounding judge. But a debrief that comments on delivery ("you spoke clearly") or a stop on an uncovered topic is replaced by the ask-teacher reply, because those claims are not in the material. Is that acceptable for the pilot (Phase C prose keeps debrief feedback to the material), or should delivery feedback get its own rule? Changing it would be a judge-prompt change under an ADR.

Tool calls used: about 80 (Phase B).
