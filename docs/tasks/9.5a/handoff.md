# 9.5a handoff: skill-input plumbing and the practice screen

## Summary

Widened the client turn schema to accept `check_answer` and `skill_action` plus optional
`skill`/`skillPayload`, and built the practice skill's screen in `apps/web`:

- `apps/web/src/turn/clientInput.ts`: `ClientTurnSchema`'s `kind` enum now includes `check_answer`
  and `skill_action`, with optional `skill` (contracts `SkillSchema`) and `skillPayload`
  (the contracts JSON-size check), reusing `TurnInputSchema.shape`; `skill_action` without a
  `skill` is rejected, mirroring the contracts schema's own refinement.
- `apps/web/src/chat/PracticeCard.tsx`: renders the real `practice.next_item` output shape
  (`{id, kind, level, prompt, options?}`, a local type -- no import of `packages/harness`), a
  kind-appropriate answer form for `numeric`/`short` (mcq/code_output show the prompt and options
  with no form, since the demo bank never serves them), disabled while blank or while `disabled`
  is true (the caller passes the global streaming flag, same pattern as `Composer`).
- `apps/web/src/chat/SkillLauncher.tsx`: one "Practice" button (feedback and mock-interview
  launchers are 9.5b, same file).
- `apps/web/src/chat/ChatView.tsx`: widened `TurnRequest` to
  `Pick<ClientTurn, 'kind'|'text'|'skill'|'skillPayload'>`; added `activeSkill: Skill | null`
  state, set from the last final turn's own `skills` array (last one wins) via a `useEffect` on
  `[active, turn]`; `submit` attaches `activeSkill` to every request that doesn't name its own
  `skill`; `TurnExtras` now renders `PracticeCard` instead of the generic `SkillCard` when a
  skill event's payload is a well-shaped practice item (`asPracticeCard`, a safe runtime guard --
  a malformed/legacy payload like the existing `ChatView.test.tsx` fixture `{q: ...}` still falls
  back to `SkillCard`, so that pre-existing test needed no behaviour change, only a `strong`
  selector fix once the launcher button also says "Practice"); mounted `SkillLauncher` between
  `HintButton` and `Composer`.
- `apps/web/messages/en.json`: added `chat.practice.{start,answerLabel,submit}` and
  `chat.skills.launcher.practice` (additive only).
- `apps/web/e2e/skills.spec.ts` (new): the practice case -- start, item shown, numeric answer
  submitted as `check_answer`, a fresh item on the next fixture. No fixture helper was needed;
  `fixtures.ts`'s existing `sseBody`/`mockTurns` cover a `skill` event fine.

## Exact exported names for Phase B

- `apps/web/src/chat/ChatView.tsx`: `activeSkill` (state, type `Skill | null`), the widened
  `TurnRequest` type (`Pick<ClientTurn, 'kind'|'text'|'skill'|'skillPayload'>`, module-private,
  not exported -- Phase B extends the same file so it's in scope), `SkillLauncher` (imported and
  mounted), `submit(request, shown)` (merges `activeSkill` in when `request.skill` is undefined).
- `apps/web/src/chat/SkillLauncher.tsx`: `SkillLauncher({ disabled, onStartPractice })` -- Phase B
  adds a feedback toggle and persona picker to this same component/file per the plan.
- `apps/web/src/chat/PracticeCard.tsx`: `PracticeCard`, `PracticeCardData` (local type).

## Files

- Modified: `apps/web/src/turn/clientInput.ts`, `apps/web/src/turn/clientInput.test.ts`,
  `apps/web/src/chat/ChatView.tsx`, `apps/web/src/chat/ChatView.test.tsx`,
  `apps/web/messages/en.json`.
- Created: `apps/web/src/chat/PracticeCard.tsx`, `apps/web/src/chat/PracticeCard.test.tsx`,
  `apps/web/src/chat/SkillLauncher.tsx`, `apps/web/src/chat/SkillLauncher.test.tsx`,
  `apps/web/e2e/skills.spec.ts`.
- `apps/web/src/chat/SkillCard.tsx`, `chat.css`: untouched (kept as the fallback card; no CSS
  added this phase -- the plan assigns launcher/practice/interview styling to Phase B's file
  list).

## Tests

- `corepack pnpm --filter @edmate/web exec vitest run src/turn/clientInput.test.ts
  src/chat/PracticeCard.test.tsx src/chat/SkillLauncher.test.tsx src/chat/ChatView.test.tsx` ->
  4 files, 45 tests passed.
- Full gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` -> 34/34 tasks
  successful (typecheck, lint and test all green for `@edmate/web` and its deps); web test suite
  85 files / 1198 tests passed, 1 skipped file / 4 skipped tests (pre-existing skips, unrelated).
- `python3 .githooks/secret-scan.py --all` -> clean, no output.
- `apps/web/e2e/skills.spec.ts` was written per the plan's practice case but **not run**: no
  Postgres is listening on the compose port this suite needs (`TEST_DATABASE_URL`,
  `127.0.0.1:55432`) in this environment, and the brief's own "Gate until clean" list names only
  `typecheck lint test` and the secret scan, not the e2e run. Left to do below.

## Decisions

### 22 Oct 2026 · 9.5a A malformed/legacy skill payload falls back to the generic SkillCard · decided by builder · risk: low
- Decided: `ChatView` only renders `PracticeCard` when a `skill: 'practice'` event's payload has
  the exact shape `practice.next_item` produces (string `id`/`prompt`, a known `kind`, level
  1-3); anything else (including the pre-existing `ChatView.test.tsx` fixture payload `{q: ...}`)
  renders the generic `SkillCard`, unchanged.
- Why: keeps the dedicated card strictly tied to the real tool output per the plan ("the real
  `practice.next_item` output shape... renders"), without a schema import from
  `packages/harness`, and avoids a crash or blank card on a payload that doesn't match (fail
  closed to the existing, harmless fallback) rather than trusting `unknown` at render time.
- risk: low

### 22 Oct 2026 · 9.5a activeSkill updates only on a final turn, not per streamed skill event · decided by builder · risk: low
- Decided: `activeSkill` is set from `turn.skills.at(-1)` only once a turn reaches `status ===
  'final'` (a `useEffect` on `[active, turn]`), not as each `skill` event streams in.
- Why: the composer/hint button/launcher are already disabled while a turn streams, so no
  submit can race ahead of the final skill name; waiting for `final` keeps the effect simple
  (one state transition per turn, matching the reducer's own "nothing changes after done" rule)
  rather than re-deriving it from in-flight events.
- risk: low

### 22 Oct 2026 · 9.5a The active skill carries only onto hints and answer checks, and clears after a turn with no skill cards · decided by builder · risk: low
- Decided: `activeSkill` is reset to null when a final turn has no skill cards. It is carried
  onto a `hint_request` or `check_answer` that names no skill of its own, never onto a plain
  `message`.
- Why: a typed message after a practice item is the student leaving practice, so tagging it
  `skill: 'practice'` would silently keep every later turn on the practice ladder
  (typescript-reviewer HIGH). A hint during practice still needs the tag.
- risk: low

## Fix round

Fixes the two typescript-reviewer HIGH findings in `apps/web/src/chat/ChatView.tsx`.

- **Sticky `activeSkill`:** the final-turn effect now sets `turn.skills.at(-1)?.skill ?? null`,
  so a final turn with no skill cards clears it; `submit` skips the carry when
  `request.kind === 'message'`.
- **`asPracticeCard` cast:** replaced by a local zod schema (`id`, `kind` enum, `level` 1|2|3,
  `prompt`, `options: z.array(z.string()).optional()`) with `safeParse` and no cast. A failed
  parse still falls back to the generic SkillCard.

New tests in `ChatView.test.tsx` (written first and seen failing, 3 failed / 17 passed):
- after a practice item, a plain Composer message carries no `skill`;
- after a final turn with no skill cards, a hint carries no `skill`;
- a practice payload with `options: [1, {}, null]` renders the generic SkillCard, not a PracticeCard.
The existing "hint asked while a practice item is active carries skill: practice" test still passes.

Evidence:
- `corepack pnpm vitest run src/chat/ChatView.test.tsx` → `Tests  20 passed (20)`
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → exit 0,
  `Tasks: 34 successful, 34 total`; web coverage `All files | 97.93 | 96.66 | 95.03 | 98.79`
- `python3 .githooks/secret-scan.py --all` → clean (no output)

Fix-round tool calls used: 17

## Left to do

- Run `apps/web/e2e/skills.spec.ts` against a live compose stack once one is available in this
  worktree/session (`corepack pnpm --filter @edmate/web e2e`); the spec itself is complete and
  follows the existing `chat.spec.ts` pattern (signed-in cookie, `page.route` SSE fixtures, no
  real model call).
- Phase B (9.5b): feedback submission + mock interview, reading `activeSkill`, the widened
  `TurnRequest` and `SkillLauncher` as named above; starts only after this branch merges to
  `main` per the plan's build order.

Status: DONE
Tool calls used: 44
