# 13.skillpresent handoff — Phase A (packages/harness)

**Status:** DONE

## What changed
Harness-computed `skill` progress events for mock-interview and feedback, with **no new
model-callable tool and no registry entry** (lead answer Q1):
- `packages/harness/src/pipeline/types.ts`: added `skill?: Skill | null` and `rolePlay?: RolePlay`
  to `DecideResult` (not inside `decision: PedagogyDecision`, which stays byte-identical) and to
  the object type `Steps['generate']` takes as its second argument.
- `packages/harness/src/pipeline/results.ts` (not in the plan's Files list; see Decisions): added
  a `RolePlaySchema` and extended `DecideResultSchema` (a `z.strictObject`) with `skill`/
  `rolePlay`, both `exactOptional`. Without this, the runner's `check(..., DecideResultSchema)`
  would strip/reject the two new fields on every decide step, silently dropping them before
  generate ever saw them.
- `packages/harness/src/pipeline/steps/decide.ts`: `decided()` now also returns `skill:
  policy.skill` and (conditional spread) `rolePlay: policy.rolePlay`.
- `packages/harness/src/pipeline/generate/skillProgress.ts` (new): `rolePlaySkillEvent` and
  `feedbackSkillEvent`, pure, fail-closed, never throw. `rolePlaySkillEvent` checks
  `ctx.entitlement.skills.includes('mock_interview')` and the JSON size limit, then returns
  `{ type: 'skill', skill: 'mock_interview', payload: rolePlay }`. `feedbackSkillEvent` fires only
  on `skill === 'feedback' && move === 'hint'`, checks entitlement and size, and returns
  `{ type: 'skill', skill: 'feedback', payload: { given: true } }` — a confirmation marker only
  (lead answer Q2: no score, no text parsing). Both are explicitly documented as needing no
  answer-key or locked check: the payload is 100% harness-computed metadata, never model output.
- `packages/harness/src/pipeline/generate/index.ts`: exported the two new helpers.
- `packages/harness/src/pipeline/steps/generate.ts`: emits the progress event (at most one of the
  two) right after the existing `hint_rung` emit, before `runToolLoop`, so it never depends on
  whether a tool ran this attempt. Updated the file's header comment with the new event-order line
  and the known, accepted limitation (the event fires before postGuard/grounding, same as every
  existing practice-tool skill event).
- `packages/harness/src/pipeline/runner.ts`: threaded `decided.skill` / `decided.rolePlay` through
  the private `generate()` method (two new positional parameters) into the object passed to
  `this.steps.generate`. Added `Skill` (contracts) and `RolePlay` (pedagogy, type-only) imports.
- Tests: `pipeline/generate/skillProgress.test.ts` (new), `pipeline/steps/decide.test.ts` (updated
  the one assertion the new fields touch), `pipeline/generate/generate.test.ts` (3 new cases),
  `pipeline/roleplay.integration.test.ts` (3 new cases, full pipeline, no model tool call).

## Evidence
Plan's "How it will be shown" items, Phase A:
- Mock-interview turn's `PolicyResult.rolePlay` reaches a `type: 'skill', skill: 'mock_interview'`
  `TurnEvent` whose payload matches the phase, no model tool call involved:
  - `generate.test.ts > generate: events in order > a mock-interview turn emits the
    harness-computed progress skill event first, before hint_rung and any tool skill event`
  - `roleplay.integration.test.ts > 13.skillpresent: the harness-computed progress skill event
    through the real pipeline > start, two answers, /pause, resume, stop, then ended: each turn
    carries the right phase, with the shown text unchanged`
  - same describe block: `the last answer gets the debrief phase`; `an un-entitled student (no
    mock_interview skill) gets no progress event, never a throw`
- Feedback turn (`policy.skill === 'feedback'`, move `hint`) emits a `type: 'skill', skill:
  'feedback'` confirmation marker:
  - `generate.test.ts > generate: events in order > a feedback hint turn emits the confirmation
    marker, no score and no model text parsing`
  - `generate.test.ts > generate: events in order > a feedback turn whose move is not hint emits
    no marker`
  - `skillProgress.test.ts > feedbackSkillEvent` (6 cases: not-feedback, not-hint, entitled
    marker, un-entitled, null/undefined skill)
- `skillProgress.test.ts > rolePlaySkillEvent`: one case per `RolePlay` phase (question, pause,
  resume, debrief, stopped, ended), an un-entitled skill (dropped, no throw) and an oversized
  payload (dropped, no throw), mirroring `skillEvent.test.ts`'s pattern.

Gate (all commands run from this worktree):
```
export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH
corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --concurrency=1
  → @edmate/config, @edmate/contracts, @edmate/harness: all typecheck/lint/test green
  → Test Files 123 passed; Tests ~5581 passed; coverage report printed, no new uncovered lines
    introduced by this change (skillProgress.ts: 93.75%/94.44%/100%/100%, well over the 80% bar)
python3 .githooks/secret-scan.py --all
  → clean (no output, exit 0)
```
(Checked `...@edmate/harness` (dependents) too, out of curiosity: `@edmate/harness` itself stays
green there; the one failure, `@edmate/gateway#lint: eslint: command not found`, is a pre-existing
environment gap in that package unrelated to this change — not touched by this task, left as-is.)

## Decisions

### 25 Oct 2026 · 13.skillpresent skill progress is harness-computed, not a registry tool · decided by lead · risk: low
- Decided: harness-computed events, no new model-callable tool and no registry entry. The accept
  line's "registry appends the feedback and role-play tools" is read as "the skill-event machinery
  covers these two skills".
- Why: role-play's whole point (ADR-0013) was moving progress out of model control into clamped,
  server-computed state, specifically because the model cannot be trusted to self-report or count
  correctly; a new tool the model calls to report its own progress (or its own feedback band)
  would reopen exactly that risk, and would need a prompt-pack change (an ADR-sized change under
  `pedagogy/**`/`content/prompt-packs/**`) — not "MVP first". No contracts, ADR or prompt-pack
  change; no architect check needed.

### 25 Oct 2026 · 13.skillpresent `results.ts` and its `DecideResultSchema` needed updating too · decided by builder · risk: low
- Decided: added `packages/harness/src/pipeline/results.ts` to the Phase A diff, even though the
  plan's Files list did not name it, and extended `DecideResultSchema` (plus a new local
  `RolePlaySchema`) with the two new optional fields.
- Why: `DecideResultSchema` is a `z.strictObject`, and `runner.ts`'s `decide()` runs every decide
  result through it via `check(..., DecideResultSchema)` before using the value. Without this
  change the new `skill`/`rolePlay` fields would fail strict validation on every turn that sets
  them, silently falling the turn back to `decide.fallback` (an `ask`/`redirect` move) instead of
  reaching generate — the opposite of fail-closed-but-visible: it would look like the feature
  simply never fires, with no test able to catch it except one that exercises the real runner
  (which `roleplay.integration.test.ts`'s new cases do). `results.ts` sits in the same `pipeline/`
  directory as the files the plan did list and validates the exact `DecideResult` interface
  `types.ts` (a listed file) defines; it does not touch `pedagogy/**`, `content/**` or
  `packages/contracts`.

### 25 Oct 2026 · 13.skillpresent Phase A merge: harness skill-progress events · decided by lead · risk: high
- Decided: merge Phase A of 13.skillpresent (packages/harness/src/pipeline: decide, generate and runner thread the active skill and role-play state; generate emits harness-computed skill-progress events, with the feedback marker payload `{ given: true }`) after code-reviewer and typescript-reviewer (Sonnet) approved with no CRITICAL, HIGH or MEDIUM findings; Phase B (apps/web) follows on its own branch.
- Why: the board tags the task risk: high because it changes what the harness emits every turn; the reviewers confirmed the event helpers are pure and fail closed (entitlement and size checks, never throw), the new fields are not dropped by the strict DecideResultSchema, the harness import boundary holds, and the integration test drives start, pause, resume, stop and end through the real pipeline.

### 25 Oct 2026 · 13.skillpresent oversized-note test cast kept · decided by lead · risk: low
- Decided: keep the `as unknown as RolePlay` cast in packages/harness/src/pipeline/generate/skillProgress.test.ts (wontfix the typescript-reviewer's LOW).
- Why: the test deliberately builds an impossible oversized value to prove the fail-closed size check; a cast in a test is the only way to reach that branch, and no production code casts.

### 25 Oct 2026 · 13.skillpresent terminal mock-interview line moves from the controls into the thread · decided by builder · risk: low
- Decided: while the interview is live (`question`/`pause`/`resume`/`debrief`), the progress line
  ("Question 3 of 6", "Paused — question 3 of 6", "Interview complete — N questions asked") shows
  next to the Pause/Stop controls (`MockInterviewControls`, via the new `progress` prop and
  `parseRolePlayProgress`). Once the harness marks a turn terminal (`stopped`/`ended`) the
  `activeSkill` effect clears, so Pause/Stop (and the controls' progress line with them) disappear
  on that same render; the terminal line ("Interview stopped — N question(s) answered" /
  "Interview ended") is instead rendered by `TurnExtras` as a thread note on that final turn, so
  the student still sees it once the controls are gone.
- Why: the plan's Q3 only asked where the reset point lives, not where the terminal progress text
  shows; discovered by a first failing test draft (the control disappears in the same render the
  terminal phase arrives, so a progress line attached to it can never be seen) -- fixing it needed
  one of (a) delay the reset by a render, (b) keep the controls mounted a turn longer, or (c) show
  the terminal line somewhere that survives the reset. (c) is simplest and matches the existing
  "feedback given" marker pattern already added for the feedback skill event, so it was chosen.

### 25 Oct 2026 · 13.skillpresent debrief is not a terminal phase, per the plan's own Q3 wording · decided by builder · risk: low
- Decided: `ChatView`'s reset effect clears `activeSkill` only on `payload.phase` `'stopped'` or
  `'ended'`, matching the plan's Q3 recommendation verbatim; `'debrief'` keeps Pause/Stop visible
  (a student can still explicitly Stop after the debrief, or the harness can later emit `'ended'`
  on the next turn).
- Why: an early test draft asserted debrief also clears Pause/Stop; it failed, and rereading Q3
  confirmed only `stopped`/`ended` are named there -- `RolePlay`'s own `ROLEPLAY_PHASES` lists
  `debrief` and `ended` as two separate, later phases, not one. Kept the test (now named for the
  `ended` case) as the regression check for this distinction.

### 25 Oct 2026 · 13.skillpresent SkillLauncher left untouched · decided by builder · risk: low
- Decided: `apps/web/src/chat/SkillLauncher.tsx` was not changed. The feedback marker event is
  rendered as a "Feedback given" note on the reply itself (`ChatView`'s `TurnExtras`, new
  `chat.feedback.given` key); the toggle's one-shot `feedbackPending` flag still clears
  synchronously on submit (9.5b's original design), since it is consumed by the request the
  student is sending, not by the server's eventual reply -- there is nothing in `SkillLauncher`
  for the new event to reconcile.
- Why: the plan listed this file as "only if the feedback marker changes how the toggle's flag is
  reconciled"; on inspection the toggle's flag and the marker event answer two different questions
  (what the *next outgoing* turn is tagged, vs. confirming what a *past* reply was), so there was
  nothing to change here within Phase B's scope.

---

## Phase B (apps/web)

### What changed
Renders the Phase A harness-computed `skill` progress events on the 9.5 screens, replacing the
old client-side guesses (plan Q2/Q3, lead answers 25 Oct 2026):
- `apps/web/src/chat/MockInterviewControls.tsx`: added `rolePlayProgressSchema` (a zod union
  mirroring `RolePlay` in `packages/harness/src/pedagogy/roleplay.ts`, duplicated rather than
  imported -- this is a client component and the harness is a server-only package) and
  `parseRolePlayProgress(payload)` (`safeParse`, returns `null` on any mismatch, never throws).
  The component takes a new `progress: RolePlayProgress | null` prop and renders a progress line
  ("Question 3 of 6", "Paused — question 3 of 6", "Interview complete — N questions asked") next
  to Pause/Stop while the interview is live.
- `apps/web/src/chat/ChatView.tsx`:
  - `TurnExtras` no longer renders the generic "Mock interview — Coming soon" `SkillCard` for a
    `skill: 'mock_interview'` card (progress now shows next to the controls instead); for a
    terminal phase (`stopped`/`ended`) it renders the terminal progress line as a thread note
    instead, since the controls (and their progress line) disappear from the same render once
    `activeSkill` clears (see Decisions).
  - `TurnExtras` renders a "Feedback given" note for a `skill: 'feedback'` card instead of the
    generic `SkillCard`, using the new `chat.feedback.given` message key.
  - A new `rolePlayProgress` value, derived from the latest `turn.skills` card named
    `mock_interview` (`safeParse`'d), passed into `MockInterviewControls`.
  - The `activeSkill` reset effect (Q3): now also clears `activeSkill` when the latest skill
    card's `phase` is `'stopped'` or `'ended'`, alongside the existing Stop button and locked-reply
    paths; `'debrief'` is deliberately not terminal (see Decisions).
- `apps/web/messages/en.json`: additive only -- `chat.mockInterview.progress.{question,paused,
  debrief,stopped,ended}` and `chat.feedback.given`.
- `apps/web/src/chat/chat.css`: minor additions -- `.chat-mock-interview-progress`,
  `.chat-feedback-given`.
- `apps/web/src/chat/SkillLauncher.tsx`: unchanged (see Decisions).
- Tests: `MockInterviewControls.test.tsx` (progress rendering per phase, `null`-payload fallback,
  `parseRolePlayProgress` unit cases), `ChatView.test.tsx` (6 new cases: live progress through
  question/pause/resume, an unparseable payload shows no progress line, plain-text "stop" clears
  `activeSkill` once the event's phase reaches `stopped`, debrief keeps Pause/Stop and a later
  `ended` clears it, the feedback marker), `apps/web/e2e/skills.spec.ts` (extended, not rewritten:
  the feedback case's fixture now includes the marker event and asserts "Feedback given"; the
  mock-interview case's fixtures now include the progress events and assert "Question 1 of 3",
  "Question 2 of 3", "Paused — question 2 of 3" and "Interview stopped — 1 question(s) answered"
  alongside the existing token-text assertions).

### Evidence
Plan's "How it will be shown" item for Phase B:
- `apps/web`: `ChatView.test.tsx` and `e2e/skills.spec.ts` show the mock-interview progress and the
  feedback marker rendered from the new `skill` events instead of client-side guesses -- see the
  new test names above.

Gate (run from this worktree):
```
export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH
corepack pnpm turbo run typecheck lint test --filter=@edmate/web
  → Tasks: 10 successful, 10 total
  → @edmate/web test: Test Files 153 passed | 4 skipped (157); no new uncovered lines of concern
    (MockInterviewControls.tsx and ChatView.tsx's new branches covered by the new test cases)
python3 .githooks/secret-scan.py --all
  → clean (no output, exit 0)
```
`e2e/skills.spec.ts` is extended per the plan but not run locally (CI's job, and the lead's job
against a live compose Postgres, same as 9.5b's own handoff note).

### Decisions
See the entries dated 25 Oct 2026 above (added by this phase's builder, inline with Phase A's so
the file reads as one running decision list for the task).

## Budget
Tool calls used: 101 (harness count, Phase A)
Phase B tool calls used: 44
Phase B fix round tool calls used: 18

## Fix round (Phase B)
Findings fixed from review:
1. [HIGH] `activeSkill` no longer persists `'feedback'`. `ChatView.tsx`'s turn-sync effect now
   clears `activeSkill` whenever the turn's last skill card names `'feedback'` (before falling
   through to the general "named skill persists" branch), so a feedback turn never leaves a later
   bare Hint click (or any other follow-up) tagged with `skill: 'feedback'`. Only ladder skills
   (`practice`, `mock_interview`) still persist. Updated the Phase A regression test near
   `ChatView.test.tsx:396` so its fixture now pushes the harness-computed `feedbackSkill` event
   (previously missing), and added a new test, "a feedback turn never leaves activeSkill tagged:
   a later Hint click carries no skill", that submits feedback then clicks Hint and asserts the
   `hint_request` carries no `skill`.
2. [MEDIUM] `MockInterviewControls.tsx`'s progress `<p>` now has `role="status"` so screen readers
   get the question/pause/debrief/stopped/ended line without it needing the thread's own
   aria-live region. Added a test asserting `screen.getByRole('status')` shows the progress text.
3. [LOW] `en.json`'s `chat.skills.mockInterview.progress.debrief` key now uses an ICU plural
   (`{total, plural, one {# question} other {# questions}}`), matching the style of
   `moderation.openCount`. Added a `total: 1` case to `MockInterviewControls.test.tsx`'s
   `it.each` table ("1 question asked") and fixed the stale expectation in
   `ChatView.test.tsx` (was asserting "1 questions asked" for a one-question debrief).

Evidence:
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/web
  → typecheck, lint pass; test: 1 failed (src/auth/index.test.ts, 20s timeout under load) out of
    157 files / 2522 tests. Re-ran that file alone:
corepack pnpm --filter @edmate/web vitest run src/auth/index.test.ts
  → 27/27 passed (noted per the brief: this file times out under load, re-run once)
corepack pnpm --filter @edmate/web vitest run src/chat/MockInterviewControls.test.tsx src/chat/ChatView.test.tsx
  → 2 files passed, 45/45 tests passed

python3 .githooks/secret-scan.py --all
  → clean (no output, exit 0)
```
`e2e/skills.spec.ts` was checked for the old debrief text (`"questions asked"`); it does not
assert that string, so no update was needed there. Not run locally, per the brief.
