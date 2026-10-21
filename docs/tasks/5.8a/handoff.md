# Task 5.8a handoff: role-play wiring

Status: PARTIAL (Phase A DONE; Phase B waits for 5.8c, per the lead's answers of 21 Oct 2026)
Branch: `m5/5.8a-roleplay-wiring`
Worktree: `.claude/worktrees/agent-afce831dbd36a526c` (builder's auto worktree)

## Phase A

### Summary
- Personas are wired. `readPersonaLibrary` feeds `deps.personas` in `buildChatDeps` (both
  `--source teacher_preview` and `--source eval`) and in the web turn runtime (`TurnProcess.personas`
  → `turnDepsFor`).
- The CLI REPL has a role-play mode, set by the pure helper `chatTurnInput`. `/roleplay <id>` sends
  only `{ persona: id }`. Every line after it carries `skill: 'mock_interview'` until `/leave`.
- The demo paid package now lists `mock_interview` (Q2).
- **State after Phase A:** personas are wired. The CLI still pins the first prompt-pack set by file
  order (`1.0.0`, legacy frame). The seed is untouched (`packages/db` has no diff).

### Files
- `apps/cli/src/commands/chat/world.ts`: `CHAT_PERSONAS_DIR` and `loadChatPersonas()`. A load
  failure gives `{ personas: undefined, source: 'none' }`.
- `apps/cli/src/commands/chat/deps.ts`: `deps.personas` (conditional spread), `ChatSetup.personasSource`,
  and `worldSessionStateStore(world)` (see Deviations).
- `apps/cli/src/commands/chat.ts`: `ChatMode`, `chatTurnInput`, the REPL loop, banner and usage
  lines, and a "Role-play is unavailable" banner line when `personasSource` is `'none'`.
- `apps/web/src/turn/runtime.ts`: `build()` reads `skills/mock_interview` next to the prompt packs.
- `apps/web/src/turn/deps.ts`: `TurnProcess.personas`, which `turnDepsFor` passes through.
- `content/demo-teacher/packages/paid.yaml`: adds `mock_interview`.
- Tests:
  - `apps/cli/src/commands/chat/roleplay.integration.test.ts` (new);
  - `chat.test.ts`, `chat/deps.test.ts` and `chat/world.test.ts`;
  - `chat/sameTopic.test.ts` (header comment only);
  - `apps/web/src/turn/deps.test.ts` and `runtime.test.ts`.

### Deviations
1. **The CLI's help state now carries between turns** (new `worldSessionStateStore` in
   `chat/deps.ts`).
   - Before, `buildChatDeps` used `memorySessionStateStore()`. It recorded saves, but
     `memoryTurnConfigStore(world)` reads `world.sessions[].helpState`, which nothing updated. This
     is the 3.9a finding that `sameTopic.test.ts` worked around.
   - Without the fix, every CLI turn started from an empty help state. A role-play could never get
     past question 1, and an answer turn had no stored `personaId`, so it became coach.
   - The new store writes the saved state onto the world's session row. It also keeps a `saved`
     list (the `MemorySessionStateStore` shape), so `sameTopic.test.ts` passes unchanged; its
     reload wrapper is now a no-op.
   - The plan didn't list this, but it stays in a Phase A file (`chat/deps.ts`).
2. The integration and REPL tests script replies **without** a `[n]` citation.
   - A role-play start has no text, so it retrieves no material. A cited reply is then rewritten
     by grounding, and the replacement keeps the loaded persona count (3.11e), so the start would
     not count.
   - The existing chat tests keep their cited reply; `scriptedChatGateway` got an optional
     `reply` argument.
3. The unknown-persona start does not literally reach the coach prompt. `stepFor` falls back to
   the coach ladder, but with no text and no material it routes to `ask_teacher`.
   - So the test asserts the fail-closed part: no `mock_interview` skill section, no
     `[[PERSONA]]` section and no persona name.

### Tests (acceptance evidence)

| Clause | Evidence |
|---|---|
| wired into apps/cli (chat and eval) | `chat/deps.test.ts` "wires the real persona library as deps.personas for --source teacher_preview / eval": ids `['job-interview','viva']`, `personasSource: 'real'`. `chat/world.test.ts`: `loadChatPersonas()` reads `content/skills/mock_interview`; `/no/such/dir` gives `{ personas: undefined, source: 'none' }`. |
| wired into the apps/web runtime | `turn/deps.test.ts`: `turnDepsFor(p).personas` is `p.personas`. `turn/runtime.test.ts`: a runtime over the repo `content/` gives `depsFor(scope).personas` with both ids. A temp copy with a broken `job-interview@1.0.0.yaml` rejects, is logged once as `turn.runtime_unavailable`, and opens no database. |
| every role-play message turn sends `skill: 'mock_interview'` | `chat.test.ts` `chatTurnInput` table: an answer, `/pause need help`, `stop` and a plain line all give `kind: 'message', skill: 'mock_interview'`. After `/leave`, lines have no `skill`. REPL test (scripted gateway plus spy): start, answer, `/pause`, `stop` → 4 main requests with the mock-interview skill and `[[PERSONA]]`. After `/leave` the 5th has neither. |
| integration test: an answer without it becomes coach | `chat/roleplay.integration.test.ts` uses real `defaultSteps` and `buildChatDeps` on the paid package. Start → "question 1 of 6". Answer with the skill → "Interviewer", "question 2 of 6". The same answer without the skill → "Skill: coach.", with no `[[PERSONA]]` and no persona name. The next answer with the skill → "question 3 of 6", so the count was carried. An unknown id fails closed. |
| a start sends only the persona id | `chat.test.ts`: `/roleplay job-interview` gives exactly `{ agentId, sessionId, studentId, lang, clientTs, kind: 'skill_action', skill: 'mock_interview', skillPayload: { persona: 'job-interview' } }`, with no `text`. `/roleplay`, `/roleplay   `, `/roleplay a b`, `/roleplay job-interview@1.0.0` and `/roleplay ../x` each give the usage notice and no turn, in both modes. |
| the CLI and seed pin the newest signed set | Phase B (after 5.8c); not in this run. |
| production behaviour without personas is unchanged | Web: `clientInput.ts` is untouched and the full `apps/web` suite passes (807 passed, 4 skipped). Harness: `resolvePersona` returns `undefined` for non-`mock_interview` turns (5.8 `personas.test.ts`, unchanged). CLI: the existing `chat.test.ts` cases pass unchanged. |

Commands:
- `corepack pnpm turbo run typecheck lint test --continue --filter=@edmate/cli... --filter=@edmate/web...`
  → `Tasks: 40 successful, 41 total`. `@edmate/cli` has 104 tests passed; `@edmate/web` has 807
  passed and 4 skipped.
  - The one failure is `@edmate/queue#test`: its coverage gate (100%) misses because its 14 Redis
    integration tests are skipped with no local Redis (`vitest run` alone: 62 passed, 14 skipped).
  - This task doesn't touch `packages/queue`. CI runs those tests against its Redis service.
- `git diff origin/main -- packages/harness packages/contracts content/prompt-packs content/skills docs/adr packages/db packages/evals`
  → empty.
- `python3 .githooks/secret-scan.py --all` → clean (run before the push).

## Left to do (Phase B, after 5.8c merges)
- Rebase on 5.8c.
- `isSignedSet` / `newestSignedSet` in `packages/content/src/promptPacks.ts`.
- The CLI pin in `loadChatPromptPacks`.
- The seed's run-time pick and its `promptPacksDir` option.
- Tests 6–8 and the `@edmate/content...` / `@edmate/db...` gate.

## Decisions

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
- Phase A has landed the first two points. The run-time pick is Phase B.

### CLI personas fall back to none; web personas fail closed · risk: low
- In the CLI, a persona-dir failure means no role-play (coach), with a banner line, like the
  prompt-pack fixture fallback.
- On the web, a persona-dir failure fails the runtime build, like the prompt-pack dir.
- The content snapshot test checks the real dir in CI.

### The CLI's help state now persists between turns · risk: low
- `buildChatDeps` writes each saved help state onto the in-memory world's session row
  (`worldSessionStateStore`), which `memoryTurnConfigStore` hands to the next turn.
- Without it, the role-play count and stored persona id were lost every turn (the 3.9a gap).
- Side effect: the CLI help ladder now climbs across turns, as it does on the web.

### Demo paid package gets `mock_interview` (per Q2) · risk: low
- This matches the PRD's skills for the top package. Already-seeded databases report it as drift
  and need a re-seed.

### ADR-0013 rollback stays free until 9.5 · risk: low
- No web turn can carry `skill: 'mock_interview'` until 9.5, and CLI sessions live in memory. So no
  stored help state gains `personaPhase` from this task.
- Recorded here; 5.8b writes the ADR note.

Tool calls used: 47
