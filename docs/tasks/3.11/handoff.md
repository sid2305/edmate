# 3.11a handoff: prompt-pack code (persona-template loader, snapshot tests)

**Status:** DONE
**Branch:** `m3/3.11a-prompt-pack-code`
**Worktree:** `.claude/worktrees/agent-a4624c6a86d737195`

3.11a is the code half of prompt packs v1.0.0 (schema, loader, snapshot tests, the risk-paths
line). It ships no real pack or persona prose — that is 3.11b (`pedagogy-author`), which also
points `promptPacks.snapshot.test.ts` at `content/prompt-packs` once it exists.

## Acceptance evidence

| Item | Evidence |
|---|---|
| Gates (`@edmate/content` and its dependents) | `corepack pnpm turbo run typecheck lint test --filter=@edmate/content... --force` → `Tasks: 14 successful, 14 total`; `@edmate/content:test` → `Test Files 8 passed (8)`, `Tests 159 passed (159)`; `@edmate/harness:test` (dependency, unchanged) → `Test Files 53 passed (53)`, `Tests 2673 passed (2673)` |
| `personaTemplates.ts` coverage | `All files` row for `...naTemplates.ts` → `100 / 100 / 100 / 100` (package threshold needs 80%; this file needs 100% as a `packages/harness/src/access/`-adjacent guard-logic file by caution, and the risk-paths group it now sits in) |
| Persona schema and loader | `personaTemplates.test.ts` (10 tests): loads exactly the 2 fixture templates, both valid, `reviewedBy`/`mustNot`/`style` populated; missing directory; README/hidden files ignored; file outside the `<id>@<semver>.yaml` layout; 6 broken-variant cases (bad semver in the file name, file-name/template version disagreement, missing `must_not`, empty `style`, missing `reviewed_by`, invalid YAML) each give exactly one named issue |
| Snapshot cases (3.11 plan + lead answer item 8) | `promptPacks.snapshot.test.ts` (27 cases, 46 snapshots): every `SKILL_PACKS` skill + `study_plan`→redirect, `coach` rungs 0–4, every `MODE_PACKS` mode, locked with `name_package` **and** the generic reply, mock_interview with each of the 2 persona templates, mock_interview under a distress reason (snapshot shows no `[[PERSONA]]` and no `[[DO-NOT-SAY]]` section — confirmed by reading the written `.snap`), investing with a market disclaimer and without one (falls back to the frame's generic line — confirmed by reading the `.snap`); a coverage test fails if any skill or mode has no case; case names asserted unique |
| On-disk v1.0.0-shaped fixture | `packages/content/test/fixtures/prompt-packs/v1/` — the 3.6 fixture set copied and re-versioned to `1.0.0` (markers and structure unchanged, per the plan's "keep only the marker tokens... from the fixture"); `readPromptPackLibrary`/`resolvePromptPackSet` load it with no issues (asserted in the snapshot test) |
| "No fixture prose" gate | `noFixtureProse.test.ts` (2 tests): scans `content/prompt-packs/` and `content/skills/` recursively for the case-insensitive substring "fixture"; passes trivially today (neither directory exists yet) and will gate 3.11b's real content |
| Risk-paths edit | `.claude/skills/merge-gate/risk-paths.txt`: added `packages/content/src/personaTemplates.ts` under the existing safety-reviewer block, directly below `packages/content/src/promptPacks.ts` (3.6 precedent); the edit went through with no hook block |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0, no output |

## Changes

- `packages/content/src/personaTemplates.ts` (new): `PersonaTemplateSchema` (contracts' `PersonaSchema` + `reviewedBy`), `readPersonaTemplateDir`, `validatePersonaTemplateDir`. Flat `<id>@<semver>.yaml` layout, no front matter/body split (a persona template has no prose to fence); `<id>` is a file-naming slug (e.g. `job-interview`), never checked against the persona's own `name`, which is the role name ("Interviewer", "Viva examiner") the composer renders into the prompt. Issues collected and sorted, never fail-fast (`promptPacks.ts` precedent). `end_after_questions` is coerced from the FAILSAFE-loaded YAML string, same reason `version` stays a string.
- `packages/content/src/personaTemplates.test.ts` (new): loader tests described above.
- `packages/content/src/promptPacks.snapshot.test.ts` (new): snapshot of `composeSystemPrompt`/`composeMode` (re-exported from `@edmate/harness`, unchanged) against the on-disk `v1`-fixture set, covering every skill, every mode, both persona templates, distress-with-persona, locked with both reply styles, and investing with/without a disclaimer.
- `packages/content/src/noFixtureProse.test.ts` (new): the no-"fixture"-prose gate for the real content directories.
- `packages/content/test/fixtures/prompt-packs/v1/` (new): the 3.6 fixture set, re-versioned to 1.0.0 (same markers, same `## sections`), for the snapshot test to load now; 3.11b repoints the test at `content/prompt-packs`.
- `packages/content/test/fixtures/skills/mock_interview/valid/{job-interview,viva}@1.0.0.yaml` (new): fixture persona templates for the loader and snapshot tests.
- `packages/content/src/index.ts`: exports `PersonaTemplate`, `PersonaTemplateSchema`, `readPersonaTemplateDir`, `validatePersonaTemplateDir`.
- `.claude/skills/merge-gate/risk-paths.txt`: `packages/content/src/personaTemplates.ts` added to the safety-reviewer block (risky-path edit, see Decisions).

## Deviations from the plan

- The plan's step 2 ("`promptPacks.test.ts` gains one case asserting `content/prompt-packs` validates") is 3.11b's job, not 3.11a's: that directory doesn't exist until 3.11b writes it, so adding the assertion here would fail. Per the lead's split instructions, 3.11a's scope is code + fixtures + the no-"fixture"-prose gate only.
- The persona-template file layout drops the promptPacks.ts-style "front matter name must equal the file name" check: the file's `<id>` (e.g. `job-interview`) is a naming slug, while the persona's own `name` field is the role name rendered into the prompt ("Interviewer"). Requiring them to match would force either a non-role-name file-matching field or a role name baked into the filename; neither matches "mirroring the shape (not the bulk)" from the plan. Logged below.
- `end_after_questions` needed `z.coerce.number().pipe(...)` because the FAILSAFE YAML schema returns every scalar as a string (the same reason `promptPacks.ts` keeps `version` a string); `style` needed an explicit `.min(1)` the contracts `PersonaSchema` doesn't itself require, so the task's required "empty style" issue case has something to catch.

## 3.11c

3.11c pins the pilot to English only (18 Oct 2026 decision): a content-side policy check that
rejects any agent config not pinned to exactly `['en']`, plus defence in depth in the harness
composer so a non-compliant `agent.languages` can never make the model reply in anything but
English. See `docs/tasks/3.11c/handoff.md` for the task's own one-line handoff (decisions live
here, per the lettered sub-task convention).

### Acceptance evidence

| Item | Evidence |
|---|---|
| Gates (`@edmate/content` and `@edmate/harness`, nothing skipped) | `corepack pnpm turbo run typecheck lint test --filter=...@edmate/content --filter=...@edmate/harness --force` → `Tasks: 34 successful, 34 total`; `@edmate/content:test` → `Test Files 9 passed (9)`, `Tests 165 passed (165)`; `@edmate/harness:test` → `Test Files 63 passed (63)`, `Tests 2918 passed (2918)` |
| `packages/content/src/pilotLanguages.ts` coverage | `pilotLanguages.test.ts` (6 tests): exactly `['en']` passes; `['en', 'hi']` rejected with a message naming both the required and the given list; `['hi']`, `[]` and `['hi', 'en']` all rejected; `PILOT_LANGUAGES` itself is `['en']`. Coverage row: `pilotLanguages.ts \| 100 \| 100 \| 100 \| 100` |
| Content-validation path | Grepped `AgentConfigSchema` across `packages/content`, `packages/db`, `apps/cli` first (task instruction): the only real construction site with live `languages` data is `packages/db/src/seed.ts`'s `AgentConfigSchema.parse(...)`; `edmate content validate` (`apps/cli`) validates course/style-card/package/licence files only — there is no teacher-authored `languages` field yet. `seed.ts` now calls `checkPilotLanguages(agentConfig.languages)` right after parsing and throws a clear message on failure (unreachable today, since the seed's `languages` is the hardcoded `['en']` — forward defence, not a gap the 80%-threshold db package needs covered) |
| Harness clamp (defence in depth) | `compose.test.ts`: `replyLanguage` clamps to `'en'` for `['en', 'hi']`, `['hi']` and `[]` regardless of the requested language, and leaves `['en']` alone; `composeSystemPrompt(...).languageClamped` is `true` only for a non-pilot agent. `decide.test.ts`: `decide.run` reports a `PilotLanguageClamped` (name only, fixed text) to the background log when the agent isn't pinned to English only, and reports nothing for an English-only agent |
| Snapshots unchanged | `compose.snapshot.test.ts` untouched and still green: every case requests `lang: 'en'`, which the clamp resolves to `'en'` either way, so no `.snap` file changed |
| `packages/harness/src/pedagogy/**` is a risk-paths group (safety-reviewer) | `.claude/skills/merge-gate/risk-paths.txt` — `compose.ts` lives under this group; flagged `risk: high` below and in the PR body |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0, no output |

### Changes

- `packages/content/src/pilotLanguages.ts` (new): `PILOT_LANGUAGES` (`['en']`) and `checkPilotLanguages(languages)`, returning plain-words issues in the same shape as a `ContentRule`.
- `packages/content/src/pilotLanguages.test.ts` (new): the cases above.
- `packages/content/src/index.ts`: exports `checkPilotLanguages`, `PILOT_LANGUAGES`.
- `packages/db/src/seed.ts`: imports `checkPilotLanguages`; `buildDemoSeed` throws a clear error if the built `agentConfig.languages` ever fails the pilot check.
- `packages/harness/src/pedagogy/compose.ts`: adds `PILOT_LANGUAGES` (the harness's own copy — it cannot import `@edmate/content`) and `isPilotLanguages`; `replyLanguage` now clamps to `'en'` whenever `agent.languages` isn't exactly `['en']`; `Composed` gains `languageClamped: boolean`.
- `packages/harness/src/pedagogy/index.ts`: exports `PILOT_LANGUAGES`.
- `packages/harness/src/pipeline/errors.ts`: new `PilotLanguageClamped extends HarnessError` (fixed, content-free message).
- `packages/harness/src/pipeline/index.ts`: exports `PilotLanguageClamped`.
- `packages/harness/src/pipeline/steps/decide.ts`: reports `PilotLanguageClamped` via `env.report` when `composeSystemPrompt(...).languageClamped` is true.
- `packages/harness/src/pedagogy/compose.test.ts`, `packages/harness/src/pipeline/steps/decide.test.ts`, `packages/harness/src/pipeline/turn.integration.test.ts`: updated/added cases (see Decisions).

### Deviations from the plan

None (small task, no planner).

## Decisions

### 19 Oct 2026 · 3.11a Persona-template file layout: no front-matter-name/file-name match check · decided by tdd-guide · risk: low
Decided: `readPersonaTemplateDir` validates `<id>@<semver>.yaml` (id is a free file-naming slug) and the persona's YAML body, but never checks the id against the persona's own `name` field, unlike `promptPacks.ts`'s pack-name/file-name check.
Why: the persona's `name` is a role name shown to the model ("Interviewer"), not an identifier matching the file (`job-interview`); the two are different things by design (task scope: "Role names only"), so there is nothing correct to compare them against.
Alternatives: add a separate `id`-style metadata field matching the filename (contracts' `Persona.id` already exists for this and is left as-is, not re-purposed as a file-name key); require the filename's slug to kebab-case-match `name` (would force role names like "job-interview" instead of "Interviewer").
Reversible: yes — a match check can be added later without changing the schema shape.

### 19 Oct 2026 · 3.11a `packages/content/src/personaTemplates.ts` added to the safety-reviewer risk-paths group · decided by tdd-guide, per the 3.11 plan's lead answers · risk: high
Decided: `.claude/skills/merge-gate/risk-paths.txt` now lists `packages/content/src/personaTemplates.ts` under the same safety-reviewer block as `packages/content/src/promptPacks.ts` (3.6 precedent), so this PR and every future edit to the persona-template loader needs safety-reviewer sign-off.
Why: build plan rule 6 (risky paths need a named reviewer); the loader governs what shape of persona content can ever reach the composer's `persona` section, which is safety-reviewed content behaviour.
Alternatives: leave it out of risk-paths.txt and rely on `packages/content/src/promptPacks.ts`'s existing coverage of the directory it reads from (doesn't cover this new file).
Reversible: yes (a later task could narrow or remove the line), but not without a fresh safety-reviewer judgment.

### 19 Oct 2026 · 3.11a No real pack or persona prose in this PR · decided by tdd-guide, per the 3.11 plan's split · risk: low
Decided: this PR ships only the loader, schema, fixtures (under `packages/content/test/fixtures/`) and tests; `content/prompt-packs/` and `content/skills/` stay empty until 3.11b, and `noFixtureProse.test.ts` passes trivially until then.
Why: the task brief and the 3.11 plan's "Lead answers and plan revisions" section split 3.11 into code (3.11a, this PR) and content (3.11b, `pedagogy-author` on opus, safety-reviewer first, then human sign-off per row).
Alternatives: none — this was given, not decided.
Reversible: n/a.

### 19 Oct 2026 · 3.11b Prompt packs v1.0.0 content (English) · decided by team lead · risk: high
Decided: the real v1.0.0 frame, safety preamble, 6 skill packs, 5 mode packs and 2 persona templates ship, drafted by pedagogy-author from the safety-reviewed plan, fixed after two safety-reviewer passes, and signed per row by the human. They are not pinned for real-model turns until the 4.x guards merge and the full suite passes.
Why: the model's instructions are the last line of defence when a guard misses.
Alternatives: keep the fixture packs; ship without a human signature.
Reversible: yes (a new pack version).

### 19 Oct 2026 · 3.11b Conversation-side markers removed · decided by team lead (safety review) · risk: medium
Decided: the teacher-label, generic-disclaimer, no-helplines and empty-turn sections carry no `[[…]]` marker, because their text reaches the conversation or is passed on. The teacher note reads "(Platform note: the teacher wrote this reply.)". System-prompt section markers stay.
Why: a marker in conversation text teaches the model to write `[[`, which the jailbreak cases forbid, and lets a student forge the teacher's voice.
Alternatives: keep every marker.
Reversible: yes.

### 19 Oct 2026 · 3.11c Pilot-policy validation lives in `packages/content`, called from the one real construction site · decided by tdd-guide · risk: medium
Decided: `checkPilotLanguages`/`PILOT_LANGUAGES` (18 Oct 2026 English-only decision) are added to `@edmate/content`, not to `packages/contracts` (a contracts change needs an ADR, and `AgentConfigSchema.languages` must stay general per the task). The content package's own `validateContentDir`/CONTENT_RULES are untouched because no content-tree file carries `languages` yet (no agent config field exists in the teacher content layout; it is built only by `packages/db/src/seed.ts`, the one real `AgentConfigSchema.parse` call with live `languages` data today). `seed.ts` calls `checkPilotLanguages(agentConfig.languages)` right after parsing and throws a clear message if it ever fails; it cannot fail today because the seed's `languages` is a hardcoded `['en']`, so this is forward defence, not a reachable branch (db's coverage threshold is 80%, not 100%, so this is allowed).
Why: grepping `AgentConfigSchema` across `packages/content`, `packages/db` and `apps/cli` (task instruction) found no teacher-facing publish path with a `languages` field yet — `edmate content validate` validates course/style-card/package/licence files only. Putting the check where the real data flows, and exporting it from content so a future studio/publish path (and apps/cli) can reuse the same function, seemed better than inventing an unused content-tree field.
Alternatives: add a no-op `ContentRule` for a `languages` field that doesn't exist yet (speculative); put the function directly in `packages/db` (then a future `apps/cli`/content publish path would need to depend on `@edmate/db` to reuse it, the wrong dependency direction).
Reversible: yes — the function can move or be called from new sites without changing its shape.

### 19 Oct 2026 · 3.11c The harness clamp lives in `replyLanguage`/`composeSystemPrompt`; the warning is reported from `decide`, not from `compose.ts` · decided by tdd-guide · risk: high
Decided: `compose.ts` gains its own `PILOT_LANGUAGES` constant (the harness may import only contracts, zod, mathjs and its own modules, so it cannot import `@edmate/content`'s copy) and clamps `replyLanguage` to `'en'` whenever `agent.languages` is not exactly `['en']`, regardless of the student's requested language or what the agent config otherwise claims to allow. `composeSystemPrompt` stays pure and now also returns `languageClamped: boolean` on `Composed`. `decide.ts` (which already holds a `StepEnv` with `.report`) reports a `PilotLanguageClamped` (a `HarnessError` with fixed, content-free text) to `finished.background` when `languageClamped` is true, exactly like every other background-only failure in the pipeline (ids and error name only, never agent or student text). This touches `packages/harness/src/pedagogy/**`, a risk-paths group requiring safety-reviewer sign-off.
Why: the task calls for "a narrow input clamp... where the language is picked" plus a background-only warning; `replyLanguage` is literally where the language is picked, and `decide` is the first place downstream that already has a reporting channel, so no new plumbing (a new `BackgroundTask` variant, a logger param on `compose.ts`) was needed to keep `compose.ts` pure.
Alternatives: thread a logger or callback into `composeSystemPrompt` itself (breaks purity, a `prompt-pack behaviour is frozen` file the task said to touch narrowly); add a new `BackgroundTask` union member for this (unneeded — the existing default `'runner'` task plus the error's own `name` already identifies it uniquely in the background log).
Reversible: yes, but only with safety-reviewer sign-off (risk-paths rule).

### 19 Oct 2026 · 3.11c Existing demoAgentConfig-based tests updated for the new clamp, not left to describe stale behaviour · decided by tdd-guide · risk: low
Decided: `compose.test.ts`'s locale-pack test, `decide.test.ts`'s "uses the input language" test, and `turn.integration.test.ts`'s turn-config loader were updated: the fixture `demoAgentConfig` carries `languages: ['en', 'hi']` (the contracts fixture is general on purpose and was not touched), so turns built from it are now clamped to English; the integration test's loader was given `languages: ['en']` instead, since that test is about turn flow, not language policy, and its `expect(result.background).toEqual([])` assertion predates this task.
Why: task instruction 3 ("the harness clamp falls back to en") is a behaviour change from the pre-task state, so the old assertions (`replyLanguage('hi', {...})` returning `'hi'`) described exactly the gap this task closes; updating them in place (TDD red→green) rather than leaving them failing or weakening the clamp was the only option that keeps both the policy and the test suite honest.
Alternatives: give `compose.snapshot.test.ts`'s `demoAgentConfig`-based cases a non-pilot-compliant agent too (unnecessary — every snapshot case requests `lang: 'en'`, which the clamp also resolves to `'en'`, so no snapshot changed).
Reversible: yes.

## Notes for 3.11b

- Point `promptPacks.snapshot.test.ts`'s `DIR` constant at `content/prompt-packs` (currently `../test/fixtures/prompt-packs/v1`) and `PERSONA_DIR` at `content/skills/mock_interview` (currently `../test/fixtures/skills/mock_interview/valid`); re-run and update the `.snap` file — it is a reviewable diff of the real prose.
- Keep the marker tokens and the two jailbreak-asserted fragments from the fixture (plan, "How jailbreak and leak cases tie in"); `noFixtureProse.test.ts` will fail on any leftover "Fixture ..." placeholder text.
- The two real persona templates must set `reviewed_by: pending` until the human signs the review sheet (pedagogy-author's own rule); `job-interview@1.0.0.yaml` and `viva@1.0.0.yaml` are the expected file names (matching the plan's "Files to create").
