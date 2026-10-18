# Task 3.6: Prompt-pack loader and composer

Board: `board.py show 3.6` · M3 · deps 2.6, 3.1, M0 (done) · branch `m3/3.6-prompt-composer` · board risk: risky · planner: opus.
Related: 3.5 (teaching policy, done), 3.4 (buildContext + help state, **running**), 3.7 (orchestrator: uses the model request), 3.8 (commit: saves `next`), 3.10 (locale packs), 3.11 (real prompt packs v1.0.0, pedagogy-author).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Prompt-pack loader and composer with `promptPackVersion`, style card, locale pack and sources"
Accept: "snapshot tests of composed prompts per skill."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Snapshot per skill | `pedagogy/compose.snapshot.test.ts`: one file snapshot (`__snapshots__/compose.snapshot.test.ts.snap`) per `SkillSchema.options` entry (explain, coach, practice, feedback, mock_interview with a persona, revision, study_plan → the `redirect` mode), plus one per mode: `locked`, `ask_teacher`, `redirect` (off_topic), `distress`, `fallback`, and coach at rungs 0–4. Each composes from the fixture pack set and a fixture `TurnContext`. A test asserts the snapshot list covers every skill and every mode, so a new skill without a snapshot fails. |
| Composition order | `compose.test.ts`: section markers appear in the spec order: safety preamble → skill/mode pack → style card → locale → decision block → retrieved material with sources → learner summary (build plan § Teaching engine › Prompt packs). Optional sections (persona, material, summary) are left out when empty, with no empty headings. |
| `promptPackVersion` | `compose.test.ts` + `decide.test.ts`: the set used is exactly `ctx.agent.promptPackVersion`; an unknown version makes `decide.run` and `decide.fallback` both throw (the turn ends `provider_error`, nothing reaches the gateway); two sets loaded side by side compose differently by version. The result reports `{ set, packs: { name → semver } }` and it reaches `CommitRecord.promptPack` (see Q1 for the trace). |
| Style card | The style card text and `mistakeTags` sit in the style section; a style-card text containing `{{do_not_say}}` or a section marker is inserted literally (single-pass rendering; data is never re-expanded). |
| Locale pack | Reply language = `input.lang` when it is in `agent.languages`, else `agent.languages[0]`; currency code and format come from the pack; every helpline is listed (name, number, kind); an empty helpline list uses the pack's no-helpline text (contact local emergency services and a trusted person, locale-context rule 4); `regulatedDisclaimers[agent.regulatedSubject]` is included when set, and the frame's generic disclaimer when the market has none. No currency symbol, helpline or country name appears in harness code (grep test over `src/pedagogy/compose*.ts`). |
| Sources and citations | Retrieved chunks are numbered `[1]..[n]` in `ctx.retrieved` order (teacher notes first, from 3.4); each shows title, locator and kind; the result's `sources: SourceRef[]` lines up with the numbers (for 3.7's `sources` event). `locked`, `redirect`, `distress` and `fallback` carry no material; `ask_teacher` keeps the below-threshold chunks so it can "help with any part that is covered". |
| Locked text never included (ADR-0003) | `compose.test.ts`: a context (cast past `TurnContextSchema`) with an allowed chunk, a chunk from a locked module and a chunk from another teacher, each with a unique canary string → `composeSystemPrompt` throws `LockedMaterialError` and no returned value or error message contains a canary. `decide.test.ts`: the same context → `decide.run` rejects and `decide.fallback`'s prompt has no canary and no material. `runner.test.ts`: buildContext returns a locked-module chunk with a canary and `lockedHit: true` → the turn runs, and the canary is absent from every `ModelRequest` the scripted gateway received, from `CommitRecord.decision.systemPrompt` and from the trace JSON. A second runner case: `lockedHit: true`, no allowed retrieval → move `locked`, the locked pack is used and no locked module id or title appears. |
| Distress wording | `compose.test.ts` / `decide.test.ts`: `reason: 'distress'` (from `decidePolicy` and from `fallbackPolicy`) uses the `distress` mode pack and lists the helplines; `off_topic`, `misuse`, `meta` and `skill_not_built` use the `redirect` pack; a test asserts the two outputs differ and that the distress prompt contains no `redirect` pack text and no teaching question instruction. |
| decide wired into the runner | `decide.test.ts` + `runner.test.ts`: `decide.run` = `decidePolicy` + composer → a `PedagogyDecision` that parses; `decide.fallback` = `fallbackPolicy` + composer (move `ask`, or `redirect` for distress); the help state from 3.4's `BuiltContext.helpState` reaches the policy; `next` (rung + help state) lands on `CommitRecord.next` for 3.8; `next` and the answer key never appear in any `TurnEvent` or the trace. |
| Loader | `packages/content/src/promptPacks.test.ts`: the fixture directory loads into a library deep-equal to `fixturePromptPackSet` from `@edmate/harness/testing` (one source of truth for the snapshots); broken fixtures each give one named issue: missing pack for a skill or mode, file name and front-matter version disagree, unknown placeholder, missing required placeholder, bad semver, duplicate set version, a manifest pointing at a missing file, a file outside the layout. |
| Purity and determinism | The composer and decide import only contracts, zod and harness modules (purity lint); the same input twice gives byte-identical output; `Date.now`/`Math.random` spies never called; deep-frozen inputs pass. |
| Gates | `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/content...` green (pedagogy keeps its 100% coverage threshold); `python3 .githooks/secret-scan.py --all` clean. |

## Design

### What exists
- 3.5 `decidePolicy(i) → PolicyResult { move, rung, skill, mustNotReveal, tools, maxOutputTokens, next, reason }` and `fallbackPolicy(ctx, help)`; both pure. `skill` is null for locked, ask_teacher, redirect and the fallback. `reason` tells `distress` apart from `off_topic | misuse | meta | skill_not_built`.
- 3.1 runner calls `steps.decide.run(env, ctx)` and `steps.decide.fallback(ctx)` and requires the fallback's move to be `ask`.
- 3.4 (on its branch) adds `BuiltContext.helpState: HelpState`, `parseSessionHelp` / `serializeSessionHelp` in `pedagogy/helpState.ts`, and strips `helpState` before `TurnContextSchema.safeParse`; it leaves the decide signature to this task.
- `@edmate/content` already reads teacher content with `node:fs` and `js-yaml`; `edmate content validate` wraps it.

### The pack set (file layout, used by the fixtures now and by 3.11 in `content/prompt-packs/`)
```
set@<semver>.yaml        manifest: version, reviewed_by, packs: { <name>: <semver>, ... }
<name>@<semver>.md       YAML front matter (name, version, kind, reviewed_by) + markdown body
```
- The set's version is `promptPackVersion`; each pack keeps its own semver, so a set bump can change one pack (Q2).
- Required packs: `safety` (preamble); one skill pack per MVP skill (explain, coach, practice, feedback, mock_interview, revision); modes `locked`, `ask_teacher`, `redirect`, `distress`, `fallback`; `frame` (named `## sections`: style, locale, decision, material, learner, persona, teacher-message label, no-helplines text, generic regulated disclaimer, and one line per move, hint split into rung 1 nudge and rung 2 conceptual). `study_plan` (P1) needs no pack: 3.5 sends it to `redirect`.
- **All prose comes from packs.** Code renders only data (helpline lines, numbered sources, the do-not-say list, ids such as the move and rung) into `{{placeholder}}` slots. Each section has a fixed placeholder allowlist; an unknown or missing required placeholder is a load-time error, never a turn-time one. Rendering is single-pass, so data that contains `{{...}}` stays literal.

### Harness (pure)
- `pedagogy/promptPacks.ts`: `PromptPackSetSchema` (zod), `parsePromptPackSet(raw: unknown)`, `createPromptPackLibrary(sets)` (a frozen `ReadonlyMap<semver, PromptPackSet>`; a duplicate version throws), `renderTemplate` (single pass, allowlisted names).
- `pedagogy/compose.ts`: `composeSystemPrompt({ ctx, policy, lang, set }) → { systemPrompt, sources, packs }`. Section choice: `reason === 'distress'` → `distress`; move `redirect` → `redirect`; `locked` → `locked` (with `pkg.lockedReply`; only public titles, never module content); `ask_teacher` → `ask_teacher`; `reason === 'fallback'` → `fallback`; otherwise the skill pack. Persona section only for `mock_interview` with `ctx.persona`. Entitled skills are listed (ADR-0003 point 5); tools come from the policy. Before rendering, every chunk is checked against `entitlement.allowedModuleIds` and `entitlement.teacherId`; any mismatch throws `LockedMaterialError` (no chunk text in the message). Material and style text sit inside fixed delimiters, labelled as reference text, not instructions.
- `pedagogy/modelRequest.ts`: `buildModelRequest({ ctx, decision, input }) → ModelRequest` for 3.7: tier `main`, `system = decision.systemPrompt`, history mapped student→`user`, agent→`assistant`, teacher→`assistant` with the frame's teacher label, then the current input; `maxOutputTokens` from the decision; `cacheKey` = `agentId:agentVersion:packageId:packageVersion:promptPackVersion:styleCardVersion` (keyed by package version, ADR-0003 point 6; no student id). 3.7 decides whether to use it as is.
- `pipeline/steps/decide.ts` replaces the stub: `run(env, { ctx, help })` → `DecideResult { decision: PedagogyDecision, next, reason, promptPack: { set, packs }, sources }`; `fallback(env, { ctx, help })` does the same with `fallbackPolicy`. The library comes from `deps.promptPacks`.
- `pipeline/types.ts`: `PipelineDeps.promptPacks: PromptPackLibrary`; new `Steps['decide']` signature; `DecideResult`; `CommitRecord` gains `next?: SessionHelp` (3.8 saves it through `SessionStateStore`) and `promptPack?`. `pipeline/results.ts`: `DecideResultSchema` (decision via `PedagogyDecisionSchema`).
- `pipeline/runner.ts`: keeps 3.4's parsed help state and passes it to decide; the fallback check allows `ask`, or `redirect` only when `ctx.intent === 'distress'` (matches 3.5's fallback); `CommitRecord` gets `next` and `promptPack`; the trace gets `move` as today.
- `testing/promptPackFixtures.ts`: `FIXTURE_PROMPT_PACK_VERSION = '0.1.0-fixture'`, `fixturePromptPackSet`, `fixturePromptPackLibrary`; short synthetic text with a visible marker per section (no real pedagogy content, which is 3.11). `testDeps` defaults `promptPacks` to it, so `access/property.test.ts` (risky path) needs no edit.

### Content (file IO, adapter side)
- `packages/content/src/promptPacks.ts`: `readPromptPackLibrary(dir)` reads every `set@*.yaml` and its packs (sorted paths, `js-yaml` front matter), checks file name vs front matter, then calls the harness `parsePromptPackSet` and `createPromptPackLibrary`; `validatePromptPackDir(dir) → { ok, issues }` collects every issue, like `validateContentDir`. Adds `@edmate/harness` as a dependency of `@edmate/content` (db, gateway, evals and cli already depend on it; harness never depends on content).
- The composition root (CLI 3.9, web, worker) loads the library once at start-up and passes it as `deps.promptPacks`. No composition root is built here.

## Files

Create:
- `packages/harness/src/pedagogy/promptPacks.ts`, `promptPacks.test.ts`
- `packages/harness/src/pedagogy/compose.ts`, `compose.test.ts`, `compose.snapshot.test.ts`, `__snapshots__/compose.snapshot.test.ts.snap`
- `packages/harness/src/pedagogy/modelRequest.ts`, `modelRequest.test.ts`
- `packages/harness/src/pipeline/steps/decide.test.ts`
- `packages/harness/src/testing/promptPackFixtures.ts`
- `packages/content/src/promptPacks.ts`, `promptPacks.test.ts`
- `packages/content/test/fixtures/prompt-packs/valid/**` (mirrors `fixturePromptPackSet`), `packages/content/test/fixtures/prompt-packs/broken-*/**`

Modify:
- `packages/harness/src/pipeline/steps/decide.ts` (replace the stub)
- `packages/harness/src/pipeline/types.ts`, `results.ts`, `runner.ts`, `runner.test.ts`, `index.ts`
- `packages/harness/src/pedagogy/index.ts`; `packages/harness/src/testing/testSteps.ts`, `testing/index.ts`
- `packages/harness/vitest.config.ts` only if the fixtures file needs a coverage exclusion
- `packages/content/package.json`, `src/index.ts`; `pnpm-lock.yaml` (workspace dependency only)
- Only if Q5 is accepted: `.claude/skills/merge-gate/risk-paths.txt` (text from architect)

Out of bounds:
- `content/prompt-packs/**` (real packs: 3.11, pedagogy-author), `content/locales/**` (3.10), `content/skills/**`
- `packages/contracts/**`, `docs/adr/**` (unless Q1 option B is chosen)
- `packages/harness/src/access/**`, `guardrails/**`; `pipeline/steps/generate.ts` (3.7), `commit.ts` and the `saveHelpState` write (3.8), `buildContext.ts` (3.4)
- `apps/**` (CLI validate wiring for prompt packs goes with 3.11), `evals/**`

## Tests first (tdd-guide order)
1. `promptPacks.test.ts` (schema, placeholder allowlist, single-pass render, duplicate versions), then `promptPacks.ts` and `testing/promptPackFixtures.ts`.
2. `compose.test.ts` (order, each section, locked canaries, distress vs redirect, literal data, determinism), then `compose.ts`.
3. `compose.snapshot.test.ts` (every skill and mode; coverage-of-snapshots check).
4. `modelRequest.test.ts`, then `modelRequest.ts`.
5. `decide.test.ts`, then the `types.ts` / `results.ts` / `decide.ts` changes.
6. After 3.4 merges (Q3): rebase, then the `runner.test.ts` cases (help state in, `next` and `promptPack` out, fallback move rule, locked canary end to end, unknown pack version), then `runner.ts` and `testSteps.ts`.
7. `packages/content` loader tests and fixtures, then `promptPacks.ts`.
8. Full gates and the secret scan.

## Risky paths touched
- Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`: **none of them matches a glob**. `content/prompt-packs/**` is not touched (fixtures live under `packages/*/test` and `src/testing`). `packages/harness/src/access/**` is not touched (`testDeps` gives the default).
- The board marks 3.6 risky, and the composer decides what reaches the model (ADR-0003) and how distress turns are worded (build plan rule 6). So the lead treats it as the safety group: **safety-reviewer (opus, mandatory) with `safety-review.md`**, plus **security-reviewer** (locked text kept out of the prompt), **typescript-reviewer** and **code-reviewer**.
- If Q5 is accepted, the change to `.claude/skills/merge-gate/risk-paths.txt` matches `.claude/**` → security-reviewer (already listed). If Q1 option B is chosen, `packages/contracts/**` and `docs/adr/**` → architect, security-reviewer, typescript-reviewer (opus), plus ADR-0006.
- The handoff's `## Decisions` must include a **`risk: high`** entry ("3.6 Composer: locked text kept out, distress wording, prompt-pack layout"), so the merge reaches the human's skim list.

## Open questions (recommendations)
- **Q1 Pack versions in the trace.** `TurnTraceSchema` is strict and has no prompt-pack field, so putting versions in the trace means changing contracts. **Recommend A:** no contract change. The trace's `agentVersion` already pins `promptPackVersion` (the agent row at that version), and the set manifest gives each pack's version. Also put `promptPack: { set, packs }` on `CommitRecord` for 3.8 to store with the message. B: ADR-0006 adds an optional `promptPack: { set, packs }` to `TurnTraceSchema` (the lead can approve a contracts change; review by architect, security-reviewer and an opus typescript-reviewer).
- **Q2 Versions per pack vs one version for the set.** The spec has "one semver pins the whole set" and also files named `coach@1.0.0.md`. **Recommend** a manifest per set (`set@<v>.yaml` lists each pack's version), so a bump that changes one pack does not have to copy every file. Log it, risk: medium; 3.11 follows the same layout.
- **Q3 Running at the same time as 3.4.** 3.4 is still running and changes `runner.ts`, `types.ts`, `policies.ts` and `testSteps.ts`. **Recommend** building steps 1–5 and 7 right away, then rebasing on main after 3.4 merges and only then doing the runner wiring (step 6). An alternative is to wait for 3.4 to merge before starting 3.6 at all.
- **Q4 The do-not-say list puts the answer key in the system prompt.** The spec puts it in the decision block, and the model needs the answer to coach anyway. **Recommend** following the spec, with a frame line saying the answer must never be stated or confirmed. Safety-reviewer should confirm this; postGuard (4.x) is the check that enforces it.
- **Q5 Gate the new files.** `pedagogy/**` and the content loader set prompt behaviour but are not risky paths. **Recommend** that architect adds `packages/harness/src/pedagogy/**` and `packages/content/src/promptPacks.ts` to the safety group in `risk-paths.txt`, either in this PR or right after it.
- **Q6 Small defaults (decided here; log them, risk: low).** Teacher messages go to `assistant` with a label from the pack. When a regulated market has no disclaimer, the frame's generic disclaimer is used (3.10's validation should require market disclaimers). `ask_teacher` keeps the below-threshold material. `locked` with `name_package` gets only the student's own package name, because naming the package that unlocks the material needs data that 3.7/5.x will supply.

## Lead answers (18 Oct 2026)

- Q1: no contract change; record pack-set and per-pack versions on CommitRecord (agentVersion pins the set); log it.
- Q2: one manifest per set (`<set>@<semver>.yaml`) listing each pack's own semver.
- Q3: the build starts after 3.4 (PR #25) merges; branch from that main.
- Q4: follow the spec (answer key in the composer's do-not-say list), but safety-reviewer must explicitly judge the leak risk of putting the answer in the prompt and whether postGuard/lockedLeak covers it; their call decides.
- Q5: add `packages/harness/src/pedagogy/**` and the prompt-pack loader path to risk-paths.txt under the safety group (stricter, not looser); this PR then also touches .claude/** → security-reviewer.
- Reviewers: safety-reviewer (opus, with safety-review.md), security-reviewer, typescript-reviewer, code-reviewer; risk: high entry.
