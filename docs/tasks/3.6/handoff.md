# 3.6 handoff: prompt-pack loader and composer; decide wired into the runner

**Status:** DONE
**Branch:** `m3/3.6-prompt-composer`
**Worktree:** `.claude/worktrees/agent-af12f57bcd1566c8d`

## Acceptance evidence

| Item | Evidence |
|---|---|
| Gates (root, all packages, after merging origin/main at `9e4b428`) | `corepack pnpm turbo run typecheck lint test` → `Tasks: 40 successful, 40 total`. Under heavy machine load (load average 25–36, other sessions running) two earlier runs timed out in tests this task does not touch (`access/property.test.ts`, `apps/web` auth tests: "Test timed out in 5000ms"); each passes alone (property test 271 ms) and the whole gate passed once the load dropped. |
| harness test | `Tests 2095 passed (2095)` (2000 before) · `All files 99.47 / 97.68 / 100 / 100`; every `src/pedagogy/**` file 100 / 100 / 100 / 100 (threshold holds) |
| content test | `Tests 119 passed (119)` (93 before) · `promptPacks.ts 99 / 90 / 100 / 100` |
| Agent harness tests | `python3 -m unittest discover .claude/tests` → `Ran 122 tests … OK` |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0 |
| Snapshot per skill and mode | `pedagogy/compose.snapshot.test.ts`, one `.snap` file: every `SkillSchema.options` skill (study_plan → redirect), coach at rungs 0–4, and modes locked, ask_teacher, redirect (off_topic), distress, fallback (34 snapshots). A test fails if a skill or mode has no case, and checks the rung cases reach 0–4. |
| Composition order | `compose.test.ts`: markers in order safety → skill pack → persona → style → locale → disclaimer → decision → do-not-say → tools → material → learner; empty optional sections are left out (no `\n\n\n`, no leftover `{{`). |
| `promptPackVersion` | `compose.test.ts`: a set that is not the agent's throws `PromptPackMismatchError`; two sets compose differently; the result reports `{ set, packs }`. `decide.test.ts`: the library picks the pinned set; an unknown version makes `run` reject and `fallback` throw. `runner.test.ts`: unknown version → `provider_error`, the gateway gets no request, decide `failed`; on a normal turn `CommitRecord.promptPack = { set: '0.1.0-fixture', packs: { safety, coach, frame } }`. |
| Style card | text inside `<<<`/`>>>`, mistake tags listed; a style card holding `{{do_not_say}}`, `{{move}}` and `[[DECISION]]` is inserted literally (single-pass render); `renderTemplate` keeps `{{y}}` and `$&` patterns in data literal. |
| Locale pack | reply language = input lang if the agent allows it, else `languages[0]`; currency code and format from the pack; every helpline listed; no helplines → the pack's no-helplines text; regulated subject → market disclaimer, else the frame's generic one; none when not regulated. Grep test over `src/pedagogy/compose*.ts` (Vite raw glob): no currency symbols or codes, country names or helpline numbers. |
| Sources | chunks numbered `[1]..[n]` in `ctx.retrieved` order with title · locator · kind; `sources` matches (copied, not aliased); locked, redirect, distress and fallback show no material and return `[]`; ask_teacher keeps it. A title with a newline cannot start a new line. |
| Locked text never included | `compose.test.ts`: a context (past `TurnContextSchema`) with an allowed, a locked-module and an other-teacher chunk, each with a canary → `LockedMaterialError`, no return value, no canary in message or stack; checked in modes that show no material too. `decide.test.ts`: `run` rejects with no canary; `fallback`'s result JSON has no canary and no material. `runner.test.ts`: a locked-module chunk with a canary and `lockedHit: true` → the turn completes; no canary in any `ModelRequest`, `CommitRecord.decision` or the events/trace; `lockedHit` with no allowed retrieval → move `locked`, the locked pack used, no locked module id. |
| Distress wording | `reason: 'distress'` from `decidePolicy` and from `fallbackPolicy` → distress pack + `move-distress` line + helplines; off_topic, misuse, meta, skill_not_built → redirect pack; the two differ; the distress prompt has no redirect pack text, no `move-redirect`, no ask/check/hint line, no style card, learner summary or disclaimer. |
| decide in the runner | `decide.test.ts`: `run` = `decidePolicy` + composer (deep-equal to composing by hand), result parses with `DecideResultSchema`; the help state reaches the policy (stuckTurns 1 climbs); `fallback` = `fallbackPolicy` + composer (`ask`, or `redirect` for distress). `runner.test.ts`: stored help state (rung 1, stuckTurns 1, answer key) → hint at rung 2; `CommitRecord.next = { rung: 2, help: { …, answerKey } }`; the answer key and `stuckTurns` appear in no event and not in the trace; a fallback returning `redirect` outside distress → `provider_error`. |
| `buildModelRequest` | `modelRequest.test.ts`: tier main, system = decision prompt, history student→user, agent→assistant, teacher→assistant with the frame label, then the input; no-text turn → the frame's empty-turn line; `cacheKey` = agent:version:package:version:promptPackVersion:styleCardVersion with no student id; parses with `ModelRequestSchema`. |
| Loader | `content/src/promptPacks.test.ts`: `test/fixtures/prompt-packs/valid/` loads deep-equal to `fixturePromptPackLibrary` from `@edmate/harness/testing`; 19 broken variants each give exactly one named issue (missing skill pack, missing mode pack, version and name disagreements, unknown placeholder, missing required placeholder, bad semver in pack and set file names, duplicate set version, manifest/file-name version mismatch, manifest pointing at a missing file, file outside the layout, file in a subdirectory, no/unclosed front matter, non-mapping front matter, invalid YAML, wrong manifest shape, wrong kind); empty directory, missing directory, issues sorted; README, hidden files and unreferenced older packs allowed; two sets side by side. |
| Purity and determinism | harness lint (purity rule) passes; new harness files import only `@edmate/contracts`, `zod` and harness modules; same input twice → byte-identical JSON; `Date.now`/`Math.random` spies never called; deep-frozen inputs pass (compose and decide). |

## Changes

- `harness/src/pedagogy/promptPacks.ts`: pack names (safety, 6 skill packs, 5 mode packs, frame), `FRAME_SECTIONS` with each section's required/optional placeholders, `parsePromptPackSet` (collects every issue, sorted by path; frozen result), `createPromptPackLibrary` (read-only map, duplicate versions throw), `resolvePromptPackSet`, `renderTemplate` (single pass), `placeholdersOf`.
- `harness/src/pedagogy/compose.ts`: `composeSystemPrompt`, `composeMode`, `replyLanguage`, `LockedMaterialError`, `PromptPackMismatchError`.
- `harness/src/pedagogy/modelRequest.ts`: `buildModelRequest`, `promptCacheKey` (for 3.7).
- `harness/src/pipeline/steps/decide.ts`: the real step (stub removed).
- `harness/src/pipeline/types.ts`: `PipelineDeps.promptPacks`; `DecideInput`, `DecideResult`; `Steps['decide']` is now `run(env, { ctx, help })` / `fallback(env, { ctx, help })`; generate gets `sources`; `CommitRecord.next` and `.promptPack`. `results.ts`: `DecideResultSchema` (reason enum built from a `Record<PolicyReason, true>`, so a new reason fails the compile).
- `harness/src/pipeline/runner.ts`: keeps the BuiltContext used (or the fallback one) and passes its help state to decide; fallback move rule `ask`, or `redirect` only when the context's intent is distress; `next` and `promptPack` on the CommitRecord; sources passed to generate.
- `harness/src/testing/promptPackFixtures.ts`: `FIXTURE_PROMPT_PACK_VERSION = '0.1.0-fixture'`, raw set, parsed set, library; `testDeps` defaults `promptPacks` to it (so `access/property.test.ts` needs no edit); `testDecideResult` helper; `decide.fallback` log entries now carry the virtual time.
- Tests adjusted for the new decide signature: `policies.test.ts`, `runner.test.ts` (decide removed from the "every stub throws" list).
- `content/src/promptPacks.ts`: `readPromptPackDir`, `readPromptPackLibrary`, `validatePromptPackDir`; `content` now depends on `@edmate/harness` (workspace; lockfile +3 lines).
- `content/test/fixtures/prompt-packs/valid/`: the fixture set as files (generated from the harness fixture).
- `.claude/skills/merge-gate/risk-paths.txt`: `packages/harness/src/pedagogy/**` and `packages/content/src/promptPacks.ts` added to the safety group (stricter only).

## Deviations

- Broken loader fixtures are built at test time (a temp copy of `valid/` with one edit) instead of committed `broken-*/` directories: one source of truth, and each case shows its one change.
- `buildModelRequest` also takes the pack `set` (the plan's signature had none): the teacher label and the empty-turn line come from the frame pack.
- `decide.fallback` now receives `env` (the plan's signature; the runner passes a fresh env) and stays synchronous.
- The gate timeouts above come from machine load, not this change (see the gates row).

## Notes for 3.7 / 3.8 / 3.11

- 3.7: generate receives `sources` (in `[n]` order) for the `sources` event; `buildModelRequest` is ready to use; tools are not in the request yet (the registry's descriptions come with 5.x).
- 3.8: `CommitRecord.next` is a `SessionHelp`; save it with `serializeSessionHelp`. `CommitRecord.promptPack` holds the set and per-pack versions for the message row.
- 3.11: follow the layout in `content/src/promptPacks.ts`; the frame needs every `FRAME_SECTIONS` section; update the 3.6 snapshots (they use the fixture set, so they change only if 3.11 changes the composer).

## Decisions

### 18 Oct 2026 · 3.6 Composer: locked text kept out, distress wording, prompt-pack layout · decided by builder (tdd-guide), lead answers Q1–Q5 · risk: high
Decided: the composer checks every retrieved chunk against the entitlement (teacher and allowed modules) before rendering, on every call and in every mode, and throws `LockedMaterialError` naming only an index; `decide.fallback` composes with no retrieved chunks, so a leaky context still gets a material-free `ask` prompt. Distress is chosen by `reason`, not by move: the distress pack plus its own `move-distress` line, with no style card, learner summary, disclaimer or teaching-question line. Packs are a flat directory of `set@<semver>.yaml` manifests and `<name>@<semver>.md` files; all prose comes from packs and code fills only fixed, allow-listed placeholders, checked at load time.
Why: ADR-0003 (locked material never reaches a model, built in), build plan rule 6 (distress replies never teach), lead answers Q2 and Q5.
Alternatives: check only in modes that show material; reuse the redirect pack for distress; one version for the whole set with no manifest.
Reversible: yes for layout and wording (new pack set version); the scope check should stay.

### 18 Oct 2026 · 3.6 The answer key goes into the system prompt's do-not-say list · decided by lead (Q4), safety-reviewer to judge · risk: high
Decided: `mustNotReveal` (the help state's answer key) is rendered as a quoted list in the frame's do-not-say section and nowhere else in the prompt; it is also on `PedagogyDecision.mustNotReveal` and `CommitRecord.next` (server-side), never in events or the trace.
Why: the spec puts the "do not say" list in the decision block, and the model needs the answer to coach.
Alternatives: keep the answer out of the prompt and rely on postGuard alone.
Reversible: yes. Safety-reviewer must judge the leak risk and whether postGuard/lockedLeak (4.x) covers it.

### 18 Oct 2026 · 3.6 Pack versions on CommitRecord, no contract change · decided by lead (Q1) · risk: medium
Decided: `CommitRecord.promptPack = { set, packs: { name → semver } }` lists the set and the packs this prompt used (safety, the skill or mode pack, frame); the trace is unchanged (its `agentVersion` pins `promptPackVersion`).
Why: `TurnTraceSchema` is strict and frozen; 3.8 can store the versions with the message.
Alternatives: ADR-0006 adding a trace field; listing every pack in the set.
Reversible: yes.

### 18 Oct 2026 · 3.6 One manifest per set, each pack with its own semver · decided by lead (Q2) · risk: medium
Decided: `set@<v>.yaml` lists `name: semver` per pack; unreferenced older pack files may stay; a README and hidden files are ignored; anything else in the directory is an issue; YAML is read with the failsafe schema so versions stay strings.
Why: a set bump can change one pack without copying every file.
Alternatives: one directory per set version.
Reversible: yes.

### 18 Oct 2026 · 3.6 Data blocks are fenced and cannot close their fence · decided by builder (tdd-guide) · risk: low
Decided: material, style card text and the learner summary sit between `<<<` and `>>>`; any run of three or more `<` or `>` in data is spaced out; one-line data (titles, locators, helpline fields, package and persona names) has whitespace collapsed; do-not-say items are JSON-quoted.
Why: teacher and student-derived text must not fake a section or instruction (the pack labels these blocks as reference text).
Alternatives: no fences; random per-turn fences (not deterministic).
Reversible: yes.

### 18 Oct 2026 · 3.6 Small composer defaults · decided by builder (tdd-guide), plan Q6 · risk: low
Decided: teacher messages go to `assistant` prefixed by the frame's teacher label; a regulated subject with no market disclaimer uses the frame's generic one; ask_teacher keeps the below-threshold material; `locked` with `name_package` names only the student's own package; a `hint` at rung 0 or 1 uses the nudge line, rung 2 the conceptual line; an agent with no languages replies in the input language; a turn with no text gets the frame's empty-turn line in the model request.
Why: plan Q6, and the spec's rung 1/2 split; the rest are edge cases the spec does not cover.
Alternatives: as listed in the plan.
Reversible: yes.

### 18 Oct 2026 · 3.6 Set versions that differ only in build metadata are duplicates · decided by builder (tdd-guide) · risk: low
Decided: `createPromptPackLibrary` rejects two sets whose versions match after removing `+…`; lookup stays an exact match on `promptPackVersion`.
Why: semver precedence ignores build metadata; two such sets would be ambiguous to a reviewer.
Alternatives: exact-string duplicates only.
Reversible: yes.

### 18 Oct 2026 · 3.6 Step signatures: decide takes the help state, generate gets sources · decided by builder (tdd-guide) · risk: low
Decided: `decide.run(env, { ctx, help })` and `decide.fallback(env, { ctx, help })` return a `DecideResult`; generate's argument gains `sources`; the runner's fallback check allows `redirect` only for a distress context.
Why: the help state must reach the policy without entering TurnContext (ADR-0005); 3.7 needs the numbered sources.
Alternatives: put sources on `PedagogyDecision` (contracts change).
Reversible: yes (harness-internal types).

### 18 Oct 2026 · 3.6 Broken loader fixtures built at test time · decided by builder (tdd-guide) · risk: low
Decided: each broken case copies `valid/` to a temp directory and applies one edit, instead of committed `broken-*/` directories.
Why: one source of truth; each case shows exactly what is broken.
Alternatives: committed broken directories (the plan's layout).
Reversible: yes.
