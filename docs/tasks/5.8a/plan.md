# Task 5.8a — Role-play wiring: personas in CLI chat/eval and web runtime, newest set

Board: milestone M5 · deps `5.8` (done); **Phase B also depends on `5.8c`** (see below) · branch
`m5/5.8a-roleplay-wiring` · **risky in Phase B only** (`packages/content/src/promptPacks.ts`) · two
phases, one builder each.

**Dependency on 5.8c.** The lead's update (21 Oct 2026): the human approved B-38 and the B-37
defaults (all a). Board task **5.8c** signs `feedback@1.1.0`, `frame@1.1.0`, `set@1.2.0`,
`frame@1.2.0` and `set@1.3.0`, and bumps the seed and CLI pins to set 1.3.0. Those sign edits and
the pin bump are **not** part of 5.8a. 5.8a makes the CLI and the seed **pick the newest signed set
at run time**, with no hard-coded version.

- **Phase A** shares no file with 5.8c and can run alongside it.
- **Phase B** touches the same pin code 5.8c bumps (`apps/cli/src/commands/chat/world.ts`,
  `packages/db/src/seed.ts`, `packages/db/test/seed.test.ts`). So **Phase B starts only after 5.8c
  is merged** and rebases on it; its run-time pick then replaces 5.8c's literal.
- If Phase B started before 5.8c, the run-time pick would choose `set@1.0.0` today (see "State of
  the world") and move the seed down from 1.1.0.

Follow-ups already in **5.8b** are **not** part of this task: coverage-gate items, prerelease
skipping in `selectPersonaLibrary`, a typed `PersonaTemplateError`, and the ADR-0013 rollback note
and status. ADR-0013 is not edited here.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Role-play wiring: personas in CLI chat/eval and web runtime, newest set"

Accept: "readPersonaLibrary is wired into apps/cli (chat and eval) and the apps/web runtime as
deps.personas; every role-play message turn sends skill 'mock_interview' (an integration test shows a
role-play answer without it would become coach); a start sends only the persona id; the CLI and seed
pin the newest signed set; production behaviour without personas is unchanged"

### How each clause is shown (paste into handoff.md)

| Clause | Evidence |
|---|---|
| wired into apps/cli (chat and eval) | `chat/deps.test.ts`: `buildChatDeps` returns `deps.personas` with `job-interview` and `viva` for **both** `source: 'teacher_preview'` and `source: 'eval'` (Q3 says what "eval" means). `world.test.ts`: `loadChatPersonas()` reads `content/skills/mock_interview`; a missing dir gives `personas: undefined, source: 'none'`. |
| wired into the apps/web runtime | `turn/deps.test.ts`: `turnDepsFor` passes `TurnProcess.personas` through as `deps.personas`. `turn/runtime.test.ts`: a runtime built over the repo `content/` holds a persona library with both ids. A broken persona dir fails the runtime build like a broken prompt-pack dir: it is logged by name and the routes return 503. |
| every role-play message turn sends `skill: 'mock_interview'` | `chat.test.ts` (REPL, scripted gateway): after `/roleplay job-interview`, every typed line (an answer, `/pause …`, `stop`) is sent as `kind: 'message', skill: 'mock_interview'`. After `/leave`, lines carry no `skill`. |
| integration test: an answer without it becomes coach | `chat/roleplay.integration.test.ts` (new). It uses the real `defaultSteps`, `buildChatDeps` on the demo paid package, and a scripted gateway that captures requests, with no model call. It runs three steps:<br>1. Start, then send an answer with the skill. The composed system prompt carries the job-interview persona and "question 2 of 6".<br>2. Send the same answer **without** `skill`. It is decided as `coach`: no persona section in the prompt, recorded skill `coach`.<br>3. Send the next turn with the skill. It shows "question 3 of 6", so the role-play count was carried, not lost.<br>The assertions use the persona name and the count line. Both the legacy and the new frame render them, so the test holds whichever set the CLI pins. |
| a start sends only the persona id | `chat.test.ts`: `/roleplay job-interview` sends exactly `{ kind: 'skill_action', skill: 'mock_interview', skillPayload: { persona: 'job-interview' } }`, with no `text`. `/roleplay job-interview@1.0.0`, `/roleplay a b` and `/roleplay` are refused locally with a usage line, and no turn is sent. |
| the CLI and seed pin the newest signed set | Phase B (after 5.8c).<br>`promptPacks.test.ts`: `newestSignedSet` picks the highest-precedence set whose manifest **and** every pinned pack are signed. Newer unsigned sets are skipped. If no set is signed it returns `undefined`.<br>`world.test.ts`: `loadChatPromptPacks().version` equals `newestSignedSet(real library).version`.<br>`seed.test.ts`: the seed's agent config `promptPackVersion` is computed at seed time and equals `newestSignedSet(readPromptPackLibrary(content/prompt-packs)).version`. A temp dir whose newest set is unsigned seeds the older signed one. A dir with no signed set makes the seed throw and write nothing. |
| production behaviour without personas is unchanged | Web: the existing `apps/web/src/turn/clientInput.test.ts` already rejects `skill` and `skill_action` from the browser (9.5 adds them), so no web turn reaches `resolvePersona`. The full `apps/web` suite passes unchanged.<br>Harness: `resolvePersona` returns `undefined` for any non-`mock_interview` turn (5.8 `personas.test.ts`, cited).<br>CLI: the existing `chat.test.ts` cases (no `/roleplay`) pass unchanged. |

## State of the world (read, not assumed)

**Personas and the harness**
- `readPersonaLibrary(dir)` (`packages/content/src/personaTemplates.ts:218`) returns the harness
  `PersonaLibrary`. It is signed-only, keeps the highest version per id, and throws listing every
  issue.
- The real dir is `content/skills/mock_interview/`, holding `job-interview@1.0.0` and `viva@1.0.0`,
  both signed. The content snapshot test already loads it, so CI validates the real persona content.
- `comparePersonaVersions` is exported from the same file (semver precedence).
- `PipelineDeps.personas?` exists (`packages/harness/src/pipeline/types.ts:194`). `buildContext`
  calls `resolvePersona` only when `input.skill === 'mock_interview'`.
- A start is `kind: 'skill_action'` with `skillPayload: { persona: <bare id> }`. The schema is
  strict: an extra field fails closed to coach.
- `selectSkill` (`skills.ts:50`) gives a turn with no `skill` the `coach` skill when the package
  includes it. This is the "becomes coach" path the integration test pins.

**apps/cli**
- `buildChatDeps` (`chat/deps.ts`) builds `PipelineDeps` with no `personas`.
- The REPL (`chat.ts`) sends every line as `kind: 'message'` with no `skill`.
- `chat --source eval` and `--source teacher_preview` both go through `buildChatDeps`.
- `edmate eval` runs with `unwiredAgent` (`cli.ts:52`, `eval.ts:123`). **No pipeline-backed
  `EvalAgent` exists**, and `EvalTurnInput` (`packages/evals/src/agent.ts`) has no package field.
  Replay never calls the agent. See Q3.
- **CLI set pin**: `loadChatPromptPacks` takes `const [version] = library.keys()`, the first set in
  sorted file order. So it pins **`1.0.0`**, by accident rather than by rule.

**Seed**
- `packages/db/src/seed.ts:95` has `PROMPT_PACK_VERSION = '1.1.0'` as a literal, and
  `seed.test.ts:32` asserts it.
- `buildDemoSeed(content)` is pure; `seedDemoTeacher(db, options)` loads the content and inserts it.
- The seed never updates rows; a changed config is reported as drift.

**Sign-off state** (`reviewed_by`)

| Set | Today on main | After 5.8c |
|---|---|---|
| `set@1.0.0` | Manifest and all packs signed. | Unchanged. |
| `set@1.1.0` | Manifest **pending**; every pinned pack signed (practice@1.1.0 per B-26). | Manifest still pending. 5.8c checks it against what the seed serves. |
| `set@1.2.0` | Pending; pins `feedback@1.1.0` and `frame@1.1.0`, both pending (B-36). | Manifest and both packs signed. |
| `set@1.3.0` | Pending; pins `frame@1.2.0` (B-38) and `feedback@1.1.0` (B-36), both pending. | Manifest and both packs signed. |

- So, under rule (a) (Q1), the newest signed set **today is 1.0.0**. **After 5.8c it is 1.3.0.**
- 5.8c's board entry signs all five pending packs, including `feedback@1.1.0`. If any one of them
  stays pending, 1.3.0 does not qualify. Phase B's test on the real dir catches that, and the exit
  conditions stop the build PARTIAL.

**apps/web**
- `runtime.ts` reads the locale packs and `readPromptPackLibrary(join(dir,'prompt-packs'))` once per
  process. A throw fails the runtime build: it is logged once and the routes return 503.
- `TurnProcess` (`deps.ts`) has no `personas`.
- The browser schema (`clientInput.ts`) allows only `message` and `hint_request`, with no `skill`
  ("skill inputs come with 9.5").
- The web reads each agent's `promptPackVersion` from the database (the seed), so it has no set pin
  of its own.

**Demo packages**
- `content/demo-teacher/packages/paid.yaml` lists the skills explain, coach, practice, feedback and
  revision. **There is no `mock_interview`**, so the entitlement check refuses a demo role-play
  today.
- The PRD pricing table puts mock-interview role-play in the top package (Q2).

**Other files**
- `docs/decisions/standing-rules.md` and `docs/lessons.md` do not exist.

## Design

### Phase A: wire personas (no risky path; can run alongside 5.8c)

1. **CLI persona source** (`chat/world.ts`):
   - Add `CHAT_PERSONAS_DIR`, the repo's `content/skills/mock_interview/`.
   - Add `loadChatPersonas(dir = CHAT_PERSONAS_DIR): { personas: PersonaLibrary | undefined; source: 'real' | 'none' }`.
     It calls `readPersonaLibrary(dir)`. On any throw it returns `{ personas: undefined, source: 'none' }`.
   - This follows the CLI's existing rule of "try the real content, record which was used" (3.9 lead
     answer Q2). There are no fixture personas.
2. **CLI deps** (`chat/deps.ts`):
   - `buildChatDeps` sets `personas`, using a conditional spread because of
     `exactOptionalPropertyTypes`.
   - It returns `personasSource` on `ChatSetup`.
   - This covers both `--source teacher_preview` and `--source eval`.
3. **CLI REPL** (`chat.ts`): add a small client-side mode in a pure exported helper,
   `chatTurnInput(state, line, ids)` → `{ input?: TurnInput; state; notice?: string }`.
   - `/roleplay <id>` starts a role-play.
     - `<id>` must pass the contracts persona id schema, with no `@version` and no extra words.
       Otherwise the helper returns a usage notice and sends no turn.
     - It sends `kind: 'skill_action', skill: 'mock_interview', skillPayload: { persona: id }`, with
       no `text`, and sets the mode to role-play.
   - In role-play mode every other line (answers, `/pause …`, `stop`) is sent as
     `kind: 'message', skill: 'mock_interview', text`.
   - `/leave` returns to the normal mode and sends no turn. Later lines carry no `skill`.
   - `exit` and blank lines work as before.
   - The banner gets one help line for `/roleplay` and `/leave`. When `personasSource` is `'none'`,
     it also gets a line saying role-play is unavailable.
4. **Web** (`turn/runtime.ts`, `turn/deps.ts`):
   - `build()` reads `readPersonaLibrary(join(dir, 'skills', 'mock_interview'))` next to the prompt
     packs and adds the library to the turn process.
   - `TurnProcess` gains `personas: PersonaLibrary`, and `turnDepsFor` sets `personas: p.personas`.
   - A broken persona dir throws inside `build()`, exactly like a broken prompt-pack dir. No new
     `TurnUnavailableError` reason is needed.
   - `clientInput.ts` does not change. The browser still cannot send a skill, so web behaviour stays
     the same until 9.5.
5. **Demo package** (`content/demo-teacher/packages/paid.yaml`):
   - Add `mock_interview` to `skills` (Q2). The CLI role-play needs it, and so do the ten
     `persona-roleplay-*` eval cases, which use `package: paid`.
   - The seed's paid `PackageConfig` changes with it. An already-seeded database reports drift; only
     a fresh seed picks up the change.

### Phase B: pick the newest signed set at run time (risky: `promptPacks.ts`; after 5.8c)

6. **New helpers** in `packages/content/src/promptPacks.ts`, exported from `index.ts`:
   `newestSignedSet(library: PromptPackLibrary): PromptPackSet | undefined` and `isSignedSet(set)`.
   - **Signed:** the set's `reviewedBy` **and** every pinned pack's `reviewedBy` are not `pending`.
     The test trims and ignores case, like `personaTemplates.ts`'s `isSigned`. This is Q1's
     recommended rule.
   - **Newest:** semver precedence, using the existing exported `comparePersonaVersions`. Build
     metadata is ignored, and a release ranks above its prereleases.
   - Prereleases are not excluded here. If 5.8b excludes them for personas, the same follow-up
     applies to sets.
7. **CLI pin** (`chat/world.ts`):
   - `loadChatPromptPacks` returns `version = newestSignedSet(library)?.version`.
   - When no set is signed it throws inside the existing `try`, so the existing fixture fallback
     applies.
   - This replaces whatever literal or first-key pick 5.8c leaves.
8. **Seed pin** (`packages/db/src/seed.ts`):
   - Remove the `PROMPT_PACK_VERSION` literal, including 5.8c's bump to 1.3.0.
   - `buildDemoSeed(content, { promptPackVersion })` stays pure and takes the version as an argument.
   - `seedDemoTeacher(db, options)` computes the version at seed time:
     `newestSignedSet(readPromptPackLibrary(options.promptPacksDir ?? DEMO_PROMPT_PACKS_DIR))`.
     `DEMO_PROMPT_PACKS_DIR` is the repo's `content/prompt-packs/`.
   - If no set is signed, or the dir can't be read, it throws before the transaction, so nothing is
     written.
   - The seed CLI (`cli.ts`) needs no new flag, because the default dir sits next to
     `DEMO_CONTENT_DIR`. The builder checks whether `EDMATE_SEED_CONTENT_DIR` needs a matching
     prompt-packs override. If it does, that is a one-line option, not a new env var.
   - Once a newer set is signed, the next fresh seed uses it with no code change. An existing
     database keeps its row and reports drift, as today.

### What happens until 5.8c lands

- **Phase A only:** the CLI keeps its accidental first-key pin (`1.0.0`, legacy frame). The seed
  keeps its literal 1.1.0, or 1.3.0 once 5.8c lands.
  - Role-play runs on the server state machine either way.
  - On a legacy-frame set the prompt shows the legacy "question N of M" line, the old "offer a
    debrief" stop line, and the `move-ask` clash on the debrief turn. Debriefs are weaker, but the
    flow works.
- **After 5.8c and Phase B:** the CLI and the seed pick 1.3.0 by rule (the new role-play frame).
  Every later signed set is picked up the same way.
- **Web:** no web turn can start a role-play until 9.5 adds skill inputs, so the web demo is not
  affected. ADR-0013's "rollback is free" still holds: no web session can save `personaPhase`
  before 9.5, and CLI sessions live in memory. This is logged here; 5.8b writes the ADR note.

## Files

Phase A:
- `apps/cli/src/commands/chat/world.ts`: adds `CHAT_PERSONAS_DIR` and `loadChatPersonas`; does not
  touch `loadChatPromptPacks`.
- `apps/cli/src/commands/chat/deps.ts`: `personas` and `personasSource`.
- `apps/cli/src/commands/chat.ts`: `chatTurnInput`, `/roleplay`, `/leave` and the banner lines.
- `apps/web/src/turn/runtime.ts` and `apps/web/src/turn/deps.ts`.
- `content/demo-teacher/packages/paid.yaml` (one line).
- Tests:
  - `apps/cli/src/commands/chat/world.test.ts`, `chat/deps.test.ts`, `chat.test.ts` and
    `chat/roleplay.integration.test.ts` (new);
  - `apps/web/src/turn/deps.test.ts` and `apps/web/src/turn/runtime.test.ts`;
  - any existing test that pins the paid skill list. The builder greps for `revision` under
    `packages/db/test`, `apps/cli` and `apps/web`, and updates only that list.

Phase B (after 5.8c):
- `packages/content/src/promptPacks.ts` (`isSignedSet`, `newestSignedSet`) and
  `packages/content/src/index.ts`.
- `apps/cli/src/commands/chat/world.ts`: the `loadChatPromptPacks` pin.
- `packages/db/src/seed.ts`: the run-time pick, the `promptPacksDir` option and the new
  `buildDemoSeed` argument.
- Tests:
  - `packages/content/src/promptPacks.test.ts`, `apps/cli/src/commands/chat/world.test.ts` and
    `packages/db/test/seed.test.ts`;
  - any CLI test whose expected prompt text changes because the pin moves off 1.0.0. The builder
    updates the expectations, never the packs.

## Files out of bounds

- Every `reviewed_by` in `content/prompt-packs/**` and `content/skills/**`. **Signing is 5.8c**, and
  agents never fill in a name.
- 5.8c's seed/CLI bump to 1.3.0 is also 5.8c's work. Phase B only replaces that literal with the
  run-time pick, after 5.8c merges.
- `packages/harness/**`: no change is needed, because `personas?`, `resolvePersona` and
  `rolePlayControl` already exist.
- `packages/contracts/**` and `docs/adr/**`, including ADR-0013 (5.8b owns its notes).
- `packages/evals/**`, `apps/cli/src/commands/eval.ts` and `apps/cli/src/cli.ts`, unless the lead
  picks Q3(b).
- `apps/web/src/turn/clientInput.ts` and any web UI (skill inputs come with 9.5).
- Everything listed under 5.8b.

## Tests first

Phase A (write each test red first, then make it green):
1. `world.test.ts`:
   - `loadChatPersonas()` on the real dir gives `source: 'real'` and the ids
     `['job-interview','viva']`;
   - a missing dir gives `{ personas: undefined, source: 'none' }`.
2. `deps.test.ts`: with the scripted gateway, `buildChatDeps` returns `deps.personas` holding both
   ids, for `teacher_preview` and for `eval`.
3. `chat.test.ts`, a table of `chatTurnInput` cases:
   - `/roleplay job-interview` gives exactly the start input above, with no `text`;
   - `/roleplay`, `/roleplay a b`, `/roleplay job-interview@1.0.0` and `/roleplay ../x` give a notice
     and no turn;
   - in role-play mode, an answer, `/pause need help` and `stop` all carry
     `skill: 'mock_interview'`;
   - `/leave` sends no turn, and the next line carries no `skill`;
   - a plain session never sends `skill`.
4. `roleplay.integration.test.ts` (new; real pipeline, paid package, scripted gateway that captures
   requests):
   - start, then an answer with the skill: the prompt has the persona name and "question 2 of 6";
   - the same answer without the skill: decided as coach, with no persona section and recorded skill
     `coach`;
   - the next turn with the skill continues from the carried count ("question 3 of 6");
   - a start with an unknown id: coach (it fails closed).
5. `apps/web`:
   - `deps.test.ts`: `turnDepsFor` passes `personas` through;
   - `runtime.test.ts`: the built process holds a library with both ids, and an
     `EDMATE_CONTENT_DIR` copy with a broken persona file fails the runtime build like a broken
     prompt pack.

Phase B:
6. `promptPacks.test.ts`, for `newestSignedSet`:
   - a newer set whose manifest is unsigned: returns the older signed set;
   - a signed manifest with one pending pack: the set is skipped;
   - `" Pending "` counts as unsigned;
   - 1.10.0 ranks above 1.9.0;
   - no signed set: returns `undefined`;
   - on the real dir: equals `'1.3.0'` after 5.8c. This one assertion names the expected answer, to
     catch a half-signed 5.8c; the code itself hard-codes no version.
7. `world.test.ts`:
   - `loadChatPromptPacks().version` equals `newestSignedSet(real).version`;
   - a temp dir with no signed set falls back to the fixture.
8. `seed.test.ts`:
   - `buildDemoSeed(content, { promptPackVersion: 'x.y.z' })` puts that version in the agent config;
   - the seeding path on the real dir yields `newestSignedSet(real).version`, replacing the
     hard-coded version assertion;
   - a temp prompt-pack dir with a newer unsigned set yields the older signed one;
   - a dir with no signed set throws before anything is written. This runs at unit level with a stub
     `Db`, like the existing tests; no Postgres.

Gate:
- Phase A: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/cli...
  --filter=@edmate/web...`.
- Phase B: the same command, plus `--filter=@edmate/content... --filter=@edmate/db...`.
- Both phases: `python3 .githooks/secret-scan.py --all`.
- If `seed.int.test.ts` calls `seedDemoTeacher` with a content-dir override, the builder checks that
  it still passes in CI (Postgres service), not locally.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- **Phase A: none.** Checked:
  - `apps/cli/**`, `apps/web/src/turn/**` and `content/demo-teacher/**` are not listed;
  - `apps/web/src/auth/**` and `apps/web/app/api/**` are not touched.
- **Phase B:** `packages/content/src/promptPacks.ts` is in the group "Student safety and teaching
  behaviour", **reviewers: code-reviewer**. `packages/db/src/seed.ts` is not under
  `repositories/**`.
- **Whole task:** the handoff logs one **`risk: high`** decision. Which prompt-pack set goes live in
  the CLI and the seed is prompt behaviour, and `deps.personas` turns role-play on in two
  composition roots.
- Suggested beyond the gate: typescript-reviewer (two apps, `exactOptional` wiring).

## Open questions (each with a recommendation)

- **Q1 (lead; doesn't block). What makes a set "signed"?**
  - Options:
    - (a) the manifest **and** every pinned pack are signed;
    - (b) every pinned pack is signed and the manifest is ignored;
    - (c) the manifest only.
  - **Recommend (a).** It matches how personas and ADR-0012/0013 treat a sign-off, and it never
    lets an unsigned pack go live through a signed manifest.
  - 5.8c signs every pending pack that set 1.3.0 pins, so under (a) the pick is 1.3.0 once 5.8c
    merges.
- **Q2 (lead). Add `mock_interview` to the demo paid package?**
  - **Recommend yes.** The PRD pricing table puts role-play in the top package, the ten persona
    eval cases use `package: paid`, and without it no demo role-play can start.
  - Cost: an already-seeded database reports drift; only fresh seeds pick it up.
- **Q3 (lead). What does "eval" mean in "apps/cli (chat and eval)"?** `edmate eval` has no
  pipeline-backed agent (`unwiredAgent`), and `EvalTurnInput` carries no package.
  - **(a) Recommended:** "eval" means `edmate chat --source eval`, which uses the same
    `buildChatDeps`, so this task covers it. Open a follow-up board task, "pipeline `EvalAgent` for
    `edmate eval --record`". That agent would:
    - build fresh chat deps for each case;
    - take the package from the case (a `packages/evals` interface change);
    - send turn 0 of a persona case as `skill_action` with the bare id from `persona: <id>@<v>`;
    - handle teacher turns and escalated or blocked turns.
  - (b) Build that agent here instead, as a Phase C. It would cost about 40 more tool calls and
    change `packages/evals`.
  - Note: the 5.8 Phase D decision assumed (b)'s turn-0 mapping would land in 5.8a.

## Lead answers (21 Oct 2026)

1. Q1: accepted. A set is signed when its manifest and every pack it pins carry a reviewer; if any is pending, Phase B stops PARTIAL.
2. Q2: accepted. Add `mock_interview` to the demo paid package; seeded dev databases reporting drift is fine (re-seed).
3. Q3: accepted. "eval" means `chat --source eval`; a pipeline-backed `edmate eval` agent goes to board task 5.8d.
4. Order: Phase A starts now; Phase B starts only after 5.8c merges, from a fresh branch state rebased on it.

## Decisions (draft for the handoff)

### 21 Oct 2026 · 5.8a: role-play wired into the CLI and web; CLI and seed pick the newest signed set at run time · risk: high
- Decided:
  - `readPersonaLibrary` feeds `deps.personas` in `buildChatDeps` (both sources) and in the web
    turn runtime.
  - The CLI REPL starts a role-play with `/roleplay <id>` (payload `{ persona: id }` only) and
    sends `skill: 'mock_interview'` on every line until `/leave`.
  - The CLI and the seed pick `newestSignedSet` at run time (manifest and every pack signed, semver
    precedence). No set version is hard-coded.
- Why:
  - It is what the acceptance asks for.
  - The browser cannot send a skill until 9.5, so production web behaviour is unchanged.
  - Once a set is signed (5.8c and later), the next CLI run and the next fresh seed use it with no
    code change.
- risk: high (which prompt-pack set goes live; role-play enabled in two composition roots).

### CLI personas fall back to none; web personas fail closed · risk: low
- In the CLI, a persona-dir failure means no role-play (coach), with a banner line, like the
  prompt-pack fixture fallback.
- On the web, a persona-dir failure fails the runtime build, like the prompt-pack dir.
- The content snapshot test checks the real dir in CI.

### The seed computes the version; `buildDemoSeed` stays pure · risk: low
- `seedDemoTeacher` reads the prompt-pack dir and passes the version in.
- `buildDemoSeed` takes the version as an argument, so it stays deterministic and testable.
- With no signed set the seed throws and writes nothing.

### Demo paid package gets `mock_interview` (per Q2) · risk: low
- This matches the PRD's skills for the top package. Already-seeded databases report it as drift.

### ADR-0013 rollback stays free until 9.5 · risk: low
- No web turn can carry `skill: 'mock_interview'` until 9.5, and CLI sessions live in memory. So no
  stored help state gains `personaPhase` from this task.
- Recorded here; 5.8b writes the ADR note.

## Budget
Budget: 85 tool calls (2 phases, apps/cli, apps/web, packages/content, packages/db, content/demo-teacher)

- Phase A: about 50 calls (wiring, the REPL, the integration test).
- Phase B: about 35 calls (the helper, the CLI pin, the run-time seed pick, the rebase on 5.8c).
- Q3(b) would add a Phase C of about 40 calls and is not in this budget.

## Allowed tools

Read, Grep, Glob, Edit, Write, and Bash for these only: pnpm typecheck, lint and test via
corepack; `git`; and `python3 .githooks/secret-scan.py --all`. No network, and no model or payment
calls.

## Exit conditions

- **Phase A DONE** when:
  - tests 1–5 are green;
  - the gate is green for `@edmate/cli...` and `@edmate/web...`;
  - the secret scan is clean;
  - `git diff origin/main -- packages/harness packages/contracts content/prompt-packs content/skills docs/adr packages/db`
    is empty.
  - The handoff's "state after Phase A" says: personas are wired, the CLI still pins the first set
    by file order, and the seed is untouched.
- **Phase B DONE** when:
  - 5.8c is merged and the branch is rebased on it;
  - tests 6–8 are green;
  - the gate is green for `@edmate/content...` and `@edmate/db...`;
  - no set version is hard-coded in `seed.ts` or `world.ts`;
  - the handoff logs the decisions above (the `risk: high` one verbatim) and the version picked
    (1.3.0).
- **PARTIAL:** stop, commit the green work and hand back if any of these happens:
  - Phase A passes about 60 calls, or Phase B passes about 42;
  - Phase B is asked to start before 5.8c merges;
  - the run-time pick on the real dir is not 1.3.0 after 5.8c (a pack 1.3.0 pins is still
    pending);
  - a change is needed in `packages/harness`, `packages/contracts`, `packages/evals`, a prompt
    pack's or persona's `reviewed_by`, or ADR-0013;
  - Q3 is answered (b): re-plan it as Phase C.
