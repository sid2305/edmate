# 9.5 plan: Skill screens — practice, feedback submission, mock interview

Board: milestone M9 · deps `1.3`, `1.7`, `9.1` (all done; 9.4/9.4b, which built the chat this task
extends, are also done). One package touched: `apps/web`. Two phases, same builder lineage, in
order (B reads A's handoff; A must merge first). MVP scope: US pilot, English only (standing
rules). No contracts change, no harness change: every TurnEvent/TurnInput field this task uses
already exists (`docs/edmate-prd.md` §"Skills a teacher can switch on"; `packages/contracts/src/turn.ts`'s
`skill`, `skillPayload`, `check_answer`, `skill_action`, and the `type: 'skill'` event — comment:
"Practice items, interview state: structured, not tokens").

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Skill screens: practice, feedback submission, mock interview (from `skill` events)"
Accept: "e2e per skill."

### How it is shown (paste into Phase B's handoff)

| Item | Evidence |
|---|---|
| e2e per skill | `apps/web/e2e/skills.spec.ts` (Playwright, the 9.4d pattern: real `next dev`, real Postgres, `page.route` intercepts `**/api/sessions/*/turns` with scripted SSE fixtures — no real model call): one case per skill — practice (item shown, numeric/short answer submitted as `check_answer`, a fresh item on a correct attempt), feedback (submission tagged `skill: 'feedback'`, the verdict text renders in the thread), mock interview (persona picked, `skill_action` start, an answer turn, `/pause`, `stop`, each rendered; the `locked` notice already built in 9.4 renders when a fixture returns a `locked` event for an unentitled skill — one shared case, not per skill). |
| Practice from the real `skill` event | `apps/web/src/chat/PracticeCard.test.tsx`: the real `practice.next_item` output shape (`{id, kind, level, prompt, options?}`, from `packages/harness/src/tools/practice.ts`) renders prompt + options (mcq, though the demo bank never serves one yet) and a kind-appropriate answer input (`numeric`, `short`); the answer key itself never reaches this component (it never reaches the client at all, ADR-0010). |
| Feedback and mock interview, honestly scoped | Neither `feedback` (5.7) nor `mock_interview` (5.8) tool-wires a `present()` hook today (`packages/harness/src/tools/registry.ts`'s own comment: "5.7/5.8 append the feedback and role-play tools here" — not done; grep of `packages/harness/src` confirms no `skill: 'feedback'` or `skill: 'mock_interview'` tool exists). Their replies are plain chat text (`token`/`replace`/`done`, already rendered since 9.4). This task does not add a harness `present()` hook (that is a `packages/harness/src/pedagogy/**`-adjacent change, a risky path, and its own task — Q2 below); it builds the submission/launcher UI around the existing text flow. |
| No contracts change | `git diff origin/main -- packages/contracts docs/adr` is empty. |

## What `skill` events actually carry today (read before building)

- `practice`: the only skill with a real client payload. `practiceNextItemTool`'s `present: (out) =>
  ({ skill: 'practice', payload: out })` (`packages/harness/src/tools/practice.ts:180`), payload
  `{ id, kind: 'numeric'|'mcq'|'short'|'code_output', level: 1|2|3, prompt, options? }` (only
  `numeric`/`short` are ever served, `SERVABLE_KINDS`). The answer key stays server-side
  (`answerKeyFor`); the client never sees it, by design.
- `feedback`: `skillStep`'s `feedback` case is `fixed('hint', 'feedback', 'feedback')` — a plain hint
  move, no tool call, no `skill` event (`packages/harness/src/pedagogy/skills.ts:164-166`).
- `mock_interview`: `skillStep` returns `rolePlay` (phase, question, total) on `SkillStep`, used
  internally by `compose.ts` to pick the prompt-pack section; it is never turned into a `skill`
  TurnEvent (`packages/harness/src/pedagogy/roleplay.ts`, `skills.ts`). The move is always `ask`;
  the reply is plain text in character. The client has no structured question-count/persona-name
  signal — see Q2.
- Starting mock interview: `kind: 'skill_action'`, `skill: 'mock_interview'`,
  `skillPayload: { persona: '<id>' }` (`PersonaStartPayloadSchema`, strict, bare id only —
  `packages/harness/src/pedagogy/personas.ts:19`). The only two signed personas today are
  `job-interview` and `viva` (`content/skills/mock_interview/*.yaml`); there is no package-level
  list of which personas a package offers — see Q1.
- `selectSkill` (`packages/harness/src/pedagogy/skills.ts:50-60`): a turn that names `skill`
  explicitly uses it if entitled, else the whole turn is **locked** (not silently reassigned); a
  turn with no `skill` falls back to coach/explain/first-entitled. So every practice `check_answer`
  and every mock-interview turn (including answers after the start) must carry `skill` explicitly —
  the stored persona id alone does not make a skill-less turn resume the interview.
- An unentitled skill is not a client-side decision: asking for a skill outside the student's
  package surfaces as the existing `locked` TurnEvent (`packages/harness/src/pipeline/steps/generate.ts`'s
  `lockedEvent`, already rendered by 9.4's `LockedNotice`). This task does not fetch or pass
  `entitlement.skills` to the client — the launcher buttons are always offered, and "not in this
  package" is handled by the guard that already exists (PRD "locked means locked").

## Files out of bounds

`packages/contracts/**`, `packages/harness/**`, `packages/db/**`, `docs/adr/**`, `content/**`,
`apps/web/src/auth/**`, `apps/web/app/api/webhooks/**`, `apps/web/app/api/auth/**` (risky, no
reason to touch them), `apps/web/app/teachers/**`, `apps/web/app/packages/**`, `apps/web/app/teacher/**`
(other in-flight tasks). A builder that finds it needs any of these stops at `Status: PARTIAL`.

## Phase A: plumbing + the practice screen (budget 100)

Tests first:
- `apps/web/src/turn/clientInput.test.ts`: `ClientTurnSchema` now accepts `kind: 'check_answer'`
  and `kind: 'skill_action'`, plus optional `skill` (the contracts `SkillSchema`) and `skillPayload`
  (JSON-size-checked, reusing the contracts limit) fields; every existing `message`/`hint_request`
  case stays green; `toTurnInput` round-trips the new fields through `TurnInputSchema`; a body with
  both `studentId`/`sessionId` is still rejected (unchanged).
- `apps/web/src/chat/PracticeCard.test.tsx`: renders `{id, kind, level, prompt}` and, for `mcq`,
  `options`; a `numeric`/`short` item shows a text input and a submit button that calls `onAnswer`
  with the trimmed text, disabled while blank or while the turn streams; `jest-axe` zero violations.
- `apps/web/src/chat/SkillLauncher.test.tsx` (or folded into `ChatView.test.tsx`): a "Practice"
  button sends a `message` turn tagged `skill: 'practice'` with a fixed opening line
  (`chat.practice.start`), and the next skill card (once a `skill` event with `skill: 'practice'`
  arrives) renders as `PracticeCard`, not the generic `SkillCard`.
- `apps/web/src/chat/ChatView.test.tsx` (extended): a practice item's `check_answer` carries
  `skill: 'practice'` and the typed answer as `text`; a correct-attempt fixture (per 5.6's
  `ctx.attempt`) shows a fresh item card, not the old one; the hint button, while a practice item is
  active, also carries `skill: 'practice'` (so a hint during practice stays on the practice ladder,
  not the coach fallback — the existing gap `skills.ts`'s own comment calls out: "a practice hint
  request stays in practice").
- `apps/web/e2e/skills.spec.ts` (new, Playwright): the practice case from the acceptance table.

Files:
- Modify `apps/web/src/turn/clientInput.ts` (+ test): extend `ClientTurnSchema`'s `kind` enum and
  add `skill`/`skillPayload`, update the file's own "skill inputs come with 9.5" comment.
- Create `apps/web/src/chat/PracticeCard.tsx` (+ test): payload-typed (`PracticeCardData` mirrors
  `practice.ts`'s output shape, duplicated as a local type — no cross-package import of
  `packages/harness`'s internal tool types), an `onAnswer(text: string)` prop.
- Create `apps/web/src/chat/SkillLauncher.tsx` (+ test): for now, one "Practice" button (feedback
  and mock-interview launchers are Phase B, same file).
- Modify `apps/web/src/chat/ChatView.tsx`: generalise `TurnRequest` to
  `Pick<ClientTurn, 'kind'|'text'|'skill'|'skillPayload'>`; add `activeSkill: Skill | null` state,
  set when a final turn's `skills` array names one (last one wins), attached to every subsequent
  `submit`/hint call unless the call names its own `skill`; render `PracticeCard` instead of the
  generic `SkillCard` when `s.skill === 'practice'` inside `TurnExtras`; mount `SkillLauncher`.
- Modify `apps/web/src/chat/SkillCard.tsx`: keep as the fallback for any skill with no dedicated
  component (today: `feedback`, `mock_interview`, `revision`, `coach`, `explain`, `study_plan`), per
  its own existing comment.
- Modify `apps/web/messages/en.json`: new `chat.practice.*`, `chat.skills.launcher.*` keys (additive
  only — see "Shared files" below).
- Modify `apps/web/e2e/fixtures.ts` (if needed): a small helper building a practice `skill` event
  fixture, reusing `sseBody`'s per-event `TurnEventSchema` check.
- Create `apps/web/e2e/skills.spec.ts` (practice case only this phase).
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`;
  `corepack pnpm --filter @edmate/web e2e` (compose stack up); `python3 .githooks/secret-scan.py --all`.

State after Phase A: a student can start practice, answer, and get a fresh item on a correct
attempt, through a dedicated card and answer form; the client schema and `ChatView` plumbing
(`activeSkill`, the widened `TurnRequest`) are in place for Phase B to build on.

## Phase B: feedback submission + mock interview (budget 90)

Reads Phase A's handoff (exact names: `activeSkill`, the widened `TurnRequest`, `SkillLauncher`).
Tests first:
- `apps/web/src/chat/SkillLauncher.test.tsx` (extended): a "Get feedback" toggle that tags the next
  Composer send with `skill: 'feedback'` (one-shot: it does not persist `activeSkill` the way
  practice/mock-interview do, since 5.7's feedback pack is a single verdict, not a ladder); a
  "Start mock interview" control offering the two hardcoded personas (`chat.mockInterview.personas.*`
  labels for `job-interview`/`viva`, Q1), sending `skill_action` + `skillPayload: {persona: id}`.
- `apps/web/src/chat/MockInterviewControls.test.tsx` (new): while `activeSkill === 'mock_interview'`,
  shows "Pause"/"Stop" buttons sending plain `message` turns with the literal text `/pause` and
  `stop` (`rolePlayControl`'s own parsing, unchanged — these are ordinary chat text, not a new kind);
  `Stop` clears `activeSkill` back to null on send (so the next message is an ordinary turn).
- `apps/web/src/chat/ChatView.test.tsx` (extended): a feedback submission's message carries
  `skill: 'feedback'` once, then the next plain message has no `skill`; a mock-interview answer
  turn (typed in the ordinary Composer while `activeSkill === 'mock_interview'`) carries
  `skill: 'mock_interview'` with no `skillPayload` (the stored persona id is server-side, per
  `resolvePersona`); `jest-axe` zero violations on the new controls.
- `apps/web/e2e/skills.spec.ts` (extended): the feedback and mock-interview cases from the
  acceptance table (persona pick, an answer, `/pause`, `stop`).

Files:
- Modify `apps/web/src/chat/SkillLauncher.tsx` (+ test): add the feedback toggle and the mock-
  interview persona picker.
- Create `apps/web/src/chat/MockInterviewControls.tsx` (+ test): Pause/Stop, shown only while
  `activeSkill === 'mock_interview'`.
- Modify `apps/web/src/chat/ChatView.tsx`: wire the feedback one-shot tag and the mock-interview
  start/pause/stop into `activeSkill` and `submit`.
- Modify `apps/web/src/chat/chat.css`: styles for the launcher, practice answer form and interview
  controls (mobile-first, 360 px base, per 9.1's own rules — no new framework).
- Modify `apps/web/messages/en.json`: new `chat.feedback.*`, `chat.mockInterview.*` keys (additive).
- Modify `apps/web/e2e/skills.spec.ts` (feedback + mock-interview cases).
- Gate: same as Phase A.

State after Phase B (task done): all three skills named in the title have a screen; `e2e per skill`
evidence is in the handoff; no contracts or harness change; `apps/web` typecheck/lint/test/e2e green.

## Shared files (the lead orders the builds)

- `apps/web/messages/en.json`: 9.2 Phases B/C, 8.5/8.8/8.9 studio pages and 9.3b may also be adding
  keys around this time (same pattern 9.2 flagged); each task adds only its own top-level/nested
  keys. Whoever merges last should rebase before pushing.
- `apps/web/src/chat/ChatView.tsx`, `chat.css`, `SkillCard.tsx`: owned by 9.4/9.4b, continued here;
  no other in-flight task should be mid-edit on these when Phase A or B starts.
- `apps/web/src/turn/clientInput.ts`, `routes.ts`: only Phase A edits `clientInput.ts`; `routes.ts`
  itself needs no change (it is already schema-generic — confirmed by reading it before writing
  this plan), so leave it untouched unless a test surfaces a real need.
- `apps/web/e2e/fixtures.ts`, `playwright.config.ts`: owned by 9.4d; this task only adds one new
  spec file and, if needed, one small fixture helper — no config change expected.

## Risky paths touched

None (checked against `.claude/skills/merge-gate/risk-paths.txt`): `apps/web/src/chat/**`,
`apps/web/src/turn/**`, `apps/web/e2e/**` and `apps/web/messages/en.json` match no glob in the file
(only `apps/web/src/auth/**`, `apps/web/app/api/webhooks/**` and `apps/web/app/api/auth/**` are
risky under `apps/web`, and this task touches none of them). No `risk: high` decision is needed for
either phase.

## Open questions (each with a recommendation; none blocks the build)

- **Q1. Mock-interview persona list is hardcoded in `apps/web`.** No package config or entitlement
  field names which persona(s) a package offers; only two signed templates exist at all
  (`job-interview`, `viva`). Recommend: ship both as fixed buttons for the pilot (English labels
  from `en.json`, not from `content/skills/mock_interview/*.yaml`'s `name` field, which this task's
  files never read — `apps/web` has no reason to import `@edmate/content`). File a follow-up for a
  package-level persona list once more than two personas or per-teacher choice exists.
- **Q2. No `skill` event for interview progress.** A richer mock-interview screen (question N of M,
  persona name, a debrief banner) needs a `present()`-style hook wiring `rolePlay` into a
  `skill: 'mock_interview'` TurnEvent — a `packages/harness/src/pedagogy/**`-adjacent change (risky
  path, `code-reviewer` required) and its own task, not this one. Recommend: ship text-only for the
  pilot (the model's own words say "question 2" etc., per the persona's style text) and file that
  follow-up near 5.8's board entry.
- **Q3. Unentitled-skill handling relies on the existing `locked` event, not a client-side skills
  list.** Confirmed by reading `generate.ts`'s `lockedEvent` and 9.4's `LockedNotice`: already
  fail-closed and already rendered. Recommend: do not add an entitlement-to-client read for this;
  it would be new surface for no behaviour change.

## Budget

Budget: 190 tool calls (2 phases: A 100, B 90; apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test/build, `docker compose`,
Playwright e2e against the compose stack, the secret scan). No network beyond localhost, no real
model or payment calls.

## Exit conditions

A phase ends `Status: DONE` when its own tests above, its gate (`typecheck lint test` filtered to
`@edmate/web`) and `python3 .githooks/secret-scan.py --all` are green and its "state after" line is
true; Phase B's handoff also carries the full `e2e per skill` acceptance table. A builder stops at
`Status: PARTIAL` past its phase budget (A 100, B 90), if a file under "Files out of bounds" needs a
change, if Phase B starts without Phase A merged on `main`, or if a question above turns out to
block more than the one skill it names (then raise it as a blocker instead of guessing).

## Status

READY

## Lead answers (22 Oct 2026)
- Q1: accept the hard-coded English persona list (job interview, viva) for the pilot; package-level persona config is a later follow-up.
- Q2: ship mock-interview progress as text only. The missing feedback and mock-interview `present()` hooks in the harness are board task 13.skillpresent (risky path, own task).
- Q3: keep unentitled skill requests on the existing `locked` event and LockedNotice; no entitlement fetch to the client.
- Build order: Phase A after 8.5e and 9.2b push (shared en.json), and merges origin/main before pushing; Phase B after Phase A merges.
