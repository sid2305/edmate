# Task 5.8d — Pipeline-backed `edmate eval` agent: turns through the real pipeline with personas

Board: milestone M13 · deps `5.8a` (done) · one phase, one builder, no risky path.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Pipeline-backed `edmate eval` agent (5.8a plan Q3): `edmate eval` runs cases through the
real pipeline with personas and the newest signed set, not only `chat --source eval`"

Accept: "edmate eval runs a role-play case through the pipeline with the scripted gateway; evals
tests pass"

### How each clause is shown

| Clause | Evidence |
|---|---|
| `edmate eval` runs a role-play case through the pipeline with the scripted gateway | New tests in `apps/cli/src/commands/eval/liveAgent.test.ts`: (1) turn 0 of a persona case sends a `skill_action` start carrying only the bare persona id, proven by the composed system prompt (persona name, "question 1 of 6") the same way `chat/roleplay.integration.test.ts` already does; (2) a second `reply()` call for the **same** `caseId` continues the count ("question 2 of 6"), proving the agent now keeps one session per case instead of a fresh one per call; (3) one real case from `evals/suites/persona/` (`persona-roleplay-restart-en`) runs end to end through `runSuite` with `buildLiveEvalAgent` and a scripted `ModelGateway`, no real model call, and comes back with `failed: 0`. |
| evals tests pass | No file under `packages/evals/**` changes (its runner already forwards `turn.skill` and `evalCase.persona` to `agent.reply`, task 3.11e); the existing `packages/evals` suite and `rolePlayFixtures.test.ts` are untouched and stay green. The gate also runs the existing `apps/cli` suite (104+ tests today) unchanged except the new ones. |
| picks personas and the newest signed set | Already true since 5.8a/5.8c: `buildChatDeps` wires `deps.personas` for `source: 'eval'` (`apps/cli/src/commands/chat/deps.ts:200`, unconditional on source) and `loadChatPromptPacks` already picks `newestSignedSet` (5.8a Phase B). This task does not touch either; it only fixes how the eval agent maps a case's `skill`/`persona` fields onto a `TurnInput`, and keeps one case's turns in one session so that wiring actually takes effect past turn 0. |

## State of the world (read, not assumed)

- `packages/evals/src/runner.ts:104-119` (`runTurns`) already builds `EvalTurnInput` with
  `skill: turn.skill` and `persona: evalCase.persona` **on every turn of the case**, not only turn
  0 (`evalCase.persona` is a case-level field, spread onto every turn's input per
  `schema.ts:81-82`). The eval agent, not the runner, must tell the start from an answer by
  `turnIndex === 0` — already the documented convention in
  `packages/evals/src/rolePlayFixtures.test.ts:8-13` ("turn 0 of a persona case is the start, sent
  as a `skill_action` turn ... the runner hands the agent the `turnIndex`, so an eval agent tells
  the start from an answer by `turnIndex === 0`").
- `apps/cli/src/commands/eval/liveAgent.ts` (task 7.6 Phase A) is the pipeline-backed `EvalAgent`
  `edmate eval --record` and the `--models` sweep already use (`apps/cli/src/cli.ts:56-69`,
  `apps/cli/src/commands/eval.ts`'s `deps.liveAgentFor`). Today every `reply()` call builds a
  **fresh** `ChatSetup` (`buildChatDeps`), i.e. a fresh session, and seeds `input.priorTurns` as
  plain transcript text (`seedPriorTurns`, no live replay — a deliberate task-7.6 choice to avoid
  re-running every prior turn live). `input.skill`/`input.persona` are read nowhere; every turn is
  sent as a plain `kind: 'message'` with no `skill`. The file's own doc comment calls this out as a
  known gap for 5.8d (line ~117-123).
- A fresh session per call is fine for a plain multi-turn teaching case (grounding only needs the
  transcript text), but it breaks role-play: the role-play count and the stored `personaId` live
  in the session's **help state** (`sessions.help_state`/`worldSessionStateStore`,
  `apps/cli/src/commands/chat/deps.ts:121-133`), which a fresh session always starts empty.
  `resolvePersona` (`packages/harness/src/pedagogy/personas.ts:70-86`) reads the stored
  `personaId` on every non-start turn; with a fresh session, turn 1's `skill: mock_interview`
  message would see no stored id and get no persona, however the turn is tagged.
- `PersonaStartPayloadSchema` (`packages/harness/src/pedagogy/personas.ts:19`, exported from
  `@edmate/harness`) is the strict `{ persona: <bare id> }` shape a start turn's `skillPayload`
  must be. `apps/cli/src/commands/chat.ts:63-70` (`chatTurnInput`'s `/roleplay <id>` handling) is
  the existing convention for building one: a bare id only, no version, no extra fields.
- Eval case `persona` refs carry a version, e.g. `job-interview@1.0.0`
  (`evals/suites/persona/persona-roleplay-restart-en.yaml:5`); the agent must take the part before
  `@` to get the bare id `PersonaStartPayloadSchema` accepts.
- `apps/cli/src/commands/chat/roleplay.integration.test.ts` (5.8a) is the model for testing this
  without a real model call: a `ScriptedGateway` wrapped in `spyGateway`, read back for the
  composed system prompt. It names the real content's exact strings this task's tests reuse:
  `PERSONA_NAME = 'Interviewer'`, the role-play tag `'Skill: mock interview'`, and
  `/question 1 of 6/` (job-interview's `endAfterQuestions` is 6).
- `evals/fixtures/` holds only a `.gitkeep` today — no committed fixture was ever recorded with the
  old fresh-session-per-call behaviour, so changing it carries no risk of silently invalidating a
  real recorded fixture.

## Design

1. **`apps/cli/src/commands/eval/liveAgent.ts`** (the only source file this task changes):
   - Add `PersonaStartPayloadSchema` to the existing `@edmate/harness` import, and `type ChatSetup`
     to the existing `../chat/deps.js` import.
   - Add a private `startPayloadFor(personaRef: string): { persona: string }`: takes the part of
     `personaRef` before `@` (or the whole string if there is no `@`), validates it with
     `PersonaStartPayloadSchema`, and throws a clear `Error` naming the bad ref if it fails. This
     is a loud failure on a malformed case, not a silent fallback to a plain message (lesson: "a
     silent no-op is easy to miss").
   - `buildLiveEvalAgent` keeps a `Map<string, ChatSetup>` closed over the returned `reply`
     function (one map per agent instance, matching the existing "fresh agent per `--models`
     sweep pairing" design — no change needed there).
   - A private `setupFor(caseId, priorTurns)` returns the cached `ChatSetup` for that `caseId` if
     one exists; otherwise it does exactly what `reply()` does today (`buildChatDeps` +
     `seedPriorTurns`), caches the result, and returns it. **`priorTurns` is only used the first
     time a `caseId` is seen** — a cache hit ignores it, because the session already holds that
     history for real (the agent itself produced it on the earlier live turn), which is more
     accurate than re-seeding synthetic text.
   - `reply(input)`:
     - Calls `setupFor(input.caseId, input.priorTurns)` instead of `buildChatDeps` directly.
     - Keeps the existing `input.teacher` → `transcripts.append(...)` step unchanged (runs on
       every call, cache hit or not).
     - Builds the `TurnInput`:
       - `input.turnIndex === 0 && input.persona !== undefined`: a start —
         `{ ...base, kind: 'skill_action', skill: 'mock_interview', skillPayload: startPayloadFor(input.persona) }`,
         with **no** `text` field (omitted, not `undefined`, for `exactOptionalPropertyTypes`),
         matching `chatTurnInput`'s `/roleplay` turn.
       - Otherwise: the existing plain-message shape, plus
         `...(input.skill === undefined ? {} : { skill: input.skill })`.
     - `base` (`agentId`, `sessionId`, `studentId`, `lang: 'en'`, `clientTs`) comes from the cached
       `setup`, unchanged from today.
     - The rest of `reply()` (`runTurn`, `collectReply`, `run.finished`) is unchanged.
   - Update the file's doc comments: the top-of-file comment and the `buildLiveEvalAgent` doc
     comment no longer say "one case = one fresh session" or describe `skill`/`persona` as an
     unaddressed gap; they describe the new mapping and the one-session-per-case cache instead.

2. **No other source file changes.** In particular:
   - `packages/evals/**` is untouched: the runner already forwards `skill` and `persona`
     correctly (see "State of the world"); this task only fixes the consumer.
   - `apps/cli/src/commands/chat/deps.ts`, `world.ts`, `eval.ts` and `apps/cli/src/cli.ts` are
     untouched: `buildChatDeps` already wires personas and the newest signed set for
     `source: 'eval'` (5.8a/5.8c), and `buildLiveEvalAgent`'s call sites don't change shape.
   - `content/**` is untouched: the demo paid package already lists `mock_interview` (5.8a).

## Files

- `apps/cli/src/commands/eval/liveAgent.ts` (modify, as above).
- `apps/cli/src/commands/eval/liveAgent.test.ts` (modify: add one new `describe` block; see Tests
  first). No new test file — the budget favours extending the existing one over splitting it.

## Files out of bounds

- `packages/evals/**` (runner, schema, checks, fixtures) — nothing here needs to change; if the
  builder finds it does, that's a signal to stop and hand back PARTIAL, not to edit it.
- `packages/harness/**` (`resolvePersona`, `PersonaStartPayloadSchema`, role-play state) — read
  only, per the purity rule; nothing here needs a change for this task.
- `apps/cli/src/commands/chat/**`, `apps/cli/src/cli.ts`, `apps/cli/src/commands/eval.ts` —
  unchanged; `edmate eval`'s CLI surface (flags, usage text) does not change.
- `content/**`, `packages/content/**`, `packages/db/**` — unchanged.
- `evals/suites/**`, `evals/fixtures/**` — the builder reads a real persona case for its test but
  writes nothing there.

## Tests first

Write each test red first (the old `liveAgent.ts` fails every one of these), then make it green.
All in `apps/cli/src/commands/eval/liveAgent.test.ts`, reusing the file's existing
`scriptedChatGateway`/`classifierDown` helpers; add `spyGateway` to the existing `@edmate/harness/testing`
import.

New `describe('persona role-play cases (task 5.8d)', ...)` block:

1. **Turn 0 sends a `skill_action` start carrying only the bare id.** Wrap
   `scriptedChatGateway(1)` in `spyGateway`. Call
   `agent.reply({ caseId: 'rp-1', turnIndex: 0, student: "Let's start.", skill: 'mock_interview', persona: 'job-interview@1.0.0', priorTurns: [] })`.
   Assert the captured main-tier request's `system` text contains `'Interviewer'` and matches
   `/question 1 of 6/`, same strings as `chat/roleplay.integration.test.ts`.
2. **A later call for the same `caseId` continues the count (the session is reused).** Same
   agent/spy as test 1 (or a fresh one repeating the turn-0 call), then
   `agent.reply({ caseId: 'rp-1', turnIndex: 1, student: 'A variable is a name that points to a value.', skill: 'mock_interview', persona: 'job-interview@1.0.0', priorTurns: [{ student: "Let's start.", reply: <turn 0's reply.text> }] })`.
   Assert the request after it matches `/question 2 of 6/` and still contains `'Interviewer'` —
   proving the help state carried across two separate `reply()` calls, not just within one.
3. **A different `caseId` gets its own fresh session.** Turn 0 for `caseId: 'rp-2'` on the same
   agent instance used in test 2 does **not** see `'rp-1'`'s state: its system prompt matches
   `/question 1 of 6/`, not `/question 2 of 6/`.
4. **A malformed persona ref throws instead of silently sending a plain message.** `persona: 'job interview@1.0.0'` (a space, invalid id) on a `turnIndex: 0` call: `agent.reply(...)` rejects with
   an error naming the bad ref; no turn is sent (the scripted gateway's request count stays 0).
5. **End to end: one real persona case through `runSuite`.** Load
   `evals/suites/persona/persona-roleplay-restart-en.yaml` via
   `loadCasesFromDir(fileURLToPath(new URL('../../../../../evals/suites/persona/', import.meta.url)))`
   (same repo-root depth as `chat/world.ts`'s `CHAT_PERSONAS_DIR`), find the case by id. Build
   `buildLiveEvalAgent({ env: {}, gateway: scriptedChatGateway(3, 'Here is your next question.'), clock: slackClock(10) })`
   and a stub judge `ModelGateway` whose `generateObject` always resolves
   `{ pass: true, reason: 'stub' }` (the judge rubric text itself is `rolePlayFixtures.test.ts`'s
   job, not this test's). Run
   `runSuite([case], { agent, judgeGateway: stubJudge, judgeModel: { provider: 'anthropic', model: 'stub' }, recorder: memoryRecorder('record') })`.
   Assert `failed === 0` and `results[0].turns.length === 3` (the case's three turns all ran, none
   threw, and the `must_not_contain` checks on its last turn passed against the chosen scripted
   reply text).
6. **Existing tests stay green with no edits**, proving the cache doesn't change non-persona
   behaviour: the file's current 7 tests (`plain reply`, `grounded reply`, `blocked`, `plain-2`,
   `escalated`, `classifier outage`, `seeds a prior turn`) are untouched.

Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/cli...`
(no other package changes, so no wider filter is needed), then
`python3 .githooks/secret-scan.py --all`.

## Risky paths touched

None (checked against `.claude/skills/merge-gate/risk-paths.txt`): the only changed files are
`apps/cli/src/commands/eval/liveAgent.ts` and its test; `apps/cli/**` is not listed under any
group, and no change touches `packages/harness/src/pedagogy/**`, `packages/content/**`,
`packages/evals/**` (not listed either, but also untouched), `content/**` or
`packages/db/src/repositories/**`. No `risk: high` decision is required for this task; the handoff
still logs its decisions at whatever risk the lead judges (expect `risk: low`).

## Budget

Budget: 45 tool calls (1 phase, apps/cli only)

## Allowed tools

Read, Grep, Glob, Edit, Write, and Bash for: `corepack pnpm turbo run typecheck lint test
--filter=@edmate/cli...`, `git`, and `python3 .githooks/secret-scan.py --all`. No network, and no
real model or payment calls (test 5 and the file's existing tests use the scripted gateway only).

## Exit conditions

- **DONE** when: tests 1-6 are green; the gate is green for `@edmate/cli...`; the secret scan is
  clean; `git diff origin/main` touches only `apps/cli/src/commands/eval/liveAgent.ts` and
  `apps/cli/src/commands/eval/liveAgent.test.ts`.
- **PARTIAL:** stop, commit the green work and hand back if any of these happens:
  - past about 55 tool calls;
  - a change seems needed outside the two files above (especially `packages/evals/**` or
    `packages/harness/**` — that's a sign the plan's reading of the runner/schema was wrong, not a
    reason to edit them without checking back);
  - the real `evals/suites/persona/persona-roleplay-restart-en.yaml` case no longer matches what
    this plan assumes (id, turn count, `must_not_contain` strings) — re-read it and either adjust
    the test to the real file or hand back.

## Questions

- **Q1 (lead; doesn't block). Should the one-session-per-case cache apply to every eval case, or
  only to ones naming a persona?**
  - **Recommend: every case** (what the design above does — no `if (hasPersona)` branch). It's
    simpler code, it matches production's real session semantics more closely than the old
    fresh-session-per-turn behaviour (hint rung, locked-stop and other help-state fields now also
    carry turn to turn within a case, which is arguably a bug fix), and no committed fixture under
    `evals/fixtures/` (today just a `.gitkeep`) can be invalidated by the change.
  - Cost if accepted: a future real `--record` run of a non-persona multi-turn case may produce a
    different transcript/reply than it would have under the old fresh-session model (e.g. the help
    ladder climbing across turns instead of resetting). No eval suite depends on the old behaviour
    today (no fixtures recorded).
- **Q2 (lead; doesn't block). Is `evals/suites/persona/persona-roleplay-restart-en.yaml` the right
  case for the end-to-end test (test 5)?**
  - **Recommend yes.** It's short (3 turns), already read in full for this plan, and its last
    turn's `must_not_contain` ("question 1 of", "here is your first question") is easy to satisfy
    with a generic scripted reply, so the test doesn't need to fake a realistic debrief.

## Lead answers (24 Oct 2026)

1. Q1: yes, one session per case for every eval case, as designed.
2. Q2: yes, use `evals/suites/persona/persona-roleplay-restart-en.yaml` for the end-to-end test.
