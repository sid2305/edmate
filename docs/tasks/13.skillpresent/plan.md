# 13.skillpresent plan: feedback and mock-interview present() hooks -> structured skill events -> 9.5 screens

## Acceptance (verbatim, from board)
> registry appends the feedback and role-play tools; skill events carry progress; code-reviewer
> on the pedagogy path; harness and web tests green.

## How it will be shown
- A new unit test on the harness's `decide`/`generate` steps: a mock-interview turn's policy
  result (`PolicyResult.rolePlay`, already computed by `rolePlayStep`/ADR-0013) reaches a `type:
  'skill', skill: 'mock_interview'` `TurnEvent` whose payload matches the phase (question/total,
  pause, resume, debrief, stopped, ended) with no model tool call involved.
- A new unit test: a feedback turn (`policy.skill === 'feedback'`, move `hint`) emits a `type:
  'skill', skill: 'feedback'` event (a confirmation marker, since feedback has no harness-computed
  band) so the web client no longer has to guess which reply was the feedback verdict.
- `packages/harness` typecheck/lint/test green, imports stay contracts + zod + mathjs + own files
  (no new dependency).
- `apps/web`: `ChatView.test.tsx` and `apps/web/e2e/skills.spec.ts` show the mock-interview
  progress (e.g. "Question 3 of 6", paused, debrief, stopped, ended) and the feedback marker
  rendered from the new `skill` events instead of client-side guesses.
- `python3 .githooks/secret-scan.py --all` clean on every phase.

## Key finding from reading the code (decides the design)
- `TurnEvent`'s `skill` variant is `z.strictObject({ type: z.literal('skill'), skill:
  SkillSchema, payload: z.unknown() })` (`packages/contracts/src/turn.ts`). `payload` is already
  `unknown` — **no `packages/contracts` change, no ADR needed** to carry progress data.
- Today a `skill` event is only ever produced by `skillEvent()`
  (`packages/harness/src/pipeline/generate/skillEvent.ts`), called from
  `pipeline/steps/generate.ts`'s `onToolOutput`, which only fires after the **model calls a
  registered tool** (`tools/registry.ts`'s `defaultToolRegistry`, today just `calculator` and
  `practice.next_item`). Neither feedback nor mock-interview has a model-callable tool: both are
  pure prompt-pack/compose turns (5.7, ADR-0012; 5.8, ADR-0013). `tools/registry.ts`'s own header
  comment says "5.7/5.8 append the feedback and role-play tools here" — written before ADR-0013
  moved role-play state server-side, out of model control.
- The mock-interview progress already exists, computed and clamped by the harness:
  `PolicyResult.rolePlay?: RolePlay` (`pedagogy/policy.ts`), a tagged union with `phase` +
  `question`/`total`/`answered` (`pedagogy/roleplay.ts`). But `pipeline/steps/decide.ts`'s
  `decided()` builds `DecideResult.decision` as the **contracts** type `PedagogyDecision`
  (`import type { PedagogyDecision } from '@edmate/contracts'` in both `decide.ts` and
  `generate.ts`) and only copies `move, rung, mustNotReveal, systemPrompt, tools,
  maxOutputTokens` onto it — `policy.rolePlay` and `policy.skill` are dropped there today
  (the policy.ts comment: "Harness-internal: never in `DecideResultSchema`"). `DecideResult`
  itself, though, is a **harness-internal** interface (`pipeline/types.ts`), not a contracts
  schema — it already carries extra sibling fields (`next`, `reason`, `promptPack`, `sources`)
  alongside `decision`. So `rolePlay` and `skill` can ride as new optional fields on
  `DecideResult` (and on `generate`'s input object in `Steps['generate']`), not inside `decision`,
  and `packages/contracts` never changes.
- Feedback has no equivalent computed state: the model writes the verdict in prose
  (`content/prompt-packs/feedback@1.1.0.md`); nothing in the harness scores the band. So its event
  is a confirmation marker only (see Question 2).

## Recommended design (see Question 1 before building)
Compute both events **inside the harness pipeline from state the policy already derived**, never
from a new model-callable tool:
1. `pedagogy/policy.ts` — no change (`rolePlay` and `skill` already on `PolicyResult`).
2. `pipeline/types.ts` — add `skill?: Skill | null` and `rolePlay?: RolePlay` to `DecideResult`
   (not to `decision: PedagogyDecision` — that stays byte-identical) and to the object type
   `generate` takes as its second argument in `Steps['generate']`.
3. `pipeline/steps/decide.ts` — `decided()` additionally returns `skill: policy.skill` and
   (conditional spread) `rolePlay: policy.rolePlay` alongside the existing `decision` object.
4. `pipeline/runner.ts` — forward the two new `DecideResult` fields into the object it builds for
   `generate`'s call (read the file first to find the exact call site; this is additive plumbing,
   not a behaviour change to anything already forwarded).
5. New `pipeline/generate/skillProgress.ts` — two small pure, fail-closed helpers in the style of
   `skillEvent.ts` (never throw; check `ctx.entitlement.skills.includes(skill)`; check
   `jsonSafe(payload).json.length <= LIMITS.skillPayloadMaxJsonLength`; return the event or
   `undefined`):
   - `rolePlaySkillEvent(rolePlay, ctx)` -> `{ type: 'skill', skill: 'mock_interview', payload:
     rolePlay }` when entitled and small enough.
   - `feedbackSkillEvent(skill, move, ctx)` -> `{ type: 'skill', skill: 'feedback', payload: {} }`
     when `skill === 'feedback'` and `move === 'hint'` (per ADR-0012) and entitled.
   - No answer-key or locked check: this payload is 100% harness-computed metadata, never model
     output, so nothing here can leak a locked chunk or an answer key. Say so in a comment (a
     future reviewer should not assume it needs the same checks as a tool's output).
6. `pipeline/steps/generate.ts` — right after the existing `if (HINT_MOVES.has(decision.move))
   emit({ type: 'hint_rung', ... })` line (before `runToolLoop`, so it never depends on whether a
   tool ran this attempt), call the two helpers on the new `rolePlay`/`skill` inputs and `emit()`
   whichever event comes back. Update the file's top comment (it documents the event order:
   `hint_rung? → (token | skill)* in stream order → sources? → locked?`) to say a progress `skill`
   event for feedback/mock-interview is now also possible, emitted before the first token, in
   addition to a tool's.
7. Known, accepted limitation (same as every existing practice-tool skill event): this event is
   emitted before postGuard/grounding runs. If grounding later replaces the draft (ADR-0013's
   persona-debrief grounding case, already in the 5.8 handoff's "Questions for the human"), the
   already-emitted progress event and the final shown text can describe different things for that
   one turn. This is the existing architecture's behaviour for `practice.next_item` too (not a new
   risk this task introduces) — note it in the handoff rather than trying to retract an event.
8. Exports: add the two helpers (and their types) to `pipeline/generate/index.ts`.

Nothing in this design touches `content/prompt-packs/**`, `content/skills/**`,
`packages/harness/src/pedagogy/**` or `packages/contracts` — it reads values those layers already
compute. No ADR.

## Files

### Phase A — packages/harness (new skill-progress events)
Create/modify only:
- `packages/harness/src/pipeline/types.ts` (add the two optional fields, additive)
- `packages/harness/src/pipeline/steps/decide.ts`
- `packages/harness/src/pipeline/runner.ts` (plumbing only — read before touching; this file is
  large and shared, so keep the diff to passing the two new fields through)
- `packages/harness/src/pipeline/generate/skillProgress.ts` (new)
- `packages/harness/src/pipeline/generate/index.ts` (export)
- `packages/harness/src/pipeline/steps/generate.ts`
- Tests: `skillProgress.test.ts` (new), `decide.test.ts`, `generate.test.ts` (or
  `pipeline/turn.integration.test.ts` if that is the suite that already runs a full mock-interview
  turn end to end — check `roleplay.integration.test.ts` under `harness` for the pattern 5.8 used),
  plus a feedback-turn fixture test (reuse `packages/evals/src/feedbackFixtures.test.ts`'s fixture
  reading if it already sets up a feedback turn, or add a harness-level one).

### Phase B — apps/web (show the new events on the 9.5 screens)
Create/modify only:
- `apps/web/src/chat/ChatView.tsx` — read and render the new `skill: 'mock_interview'` and `skill:
  'feedback'` events (zod `safeParse` the payload before using it, per the UI-state lesson below);
  revisit the `activeSkill` reset logic that 9.5b built specifically around "mock_interview never
  emits a skill TurnEvent" (Q2 there) — now it can, so the reset point should likely use the
  event's `phase` (`stopped`/`ended`) as well as the existing Stop button, not either/or (see
  Question 3).
- `apps/web/src/chat/MockInterviewControls.tsx` — show progress (e.g. "Question 3 of 6", "Paused",
  interview-over) from the event payload instead of (or alongside) parsing model text.
- `apps/web/src/chat/SkillLauncher.tsx` — only if the feedback marker changes how the "Get
  feedback" toggle's one-shot `feedbackPending` flag is reconciled with the confirmed server
  event (likely: keep the toggle, but confirm/clear it from the event instead of guessing from
  "the next assistant turn").
- `apps/web/src/chat/chat.css` — minor additions only if a new progress element needs styling.
- `apps/web/messages/en.json` — additive only (new `chat.mockInterview.progress.*` /
  `chat.feedback.given` style keys), per the English-only pilot.
- Tests: `ChatView.test.tsx`, `MockInterviewControls.test.tsx`, `SkillLauncher.test.tsx` (new
  cases only), `apps/web/e2e/skills.spec.ts` (extend the existing feedback and mock-interview
  cases to assert the structured progress text, don't rewrite them).

## Files out of bounds (parallel work: 9.3h, 8.6e)
- `apps/web/app/staff/**`, anything `packages/db/**` (9.3h, apps/web staff pages + packages/db).
- `packages/gateway/**` (8.6e).
- `content/prompt-packs/**`, `content/skills/**`, `packages/harness/src/pedagogy/**`,
  `packages/contracts/**` — out of scope for this design; touching any of these means the design
  changed and the plan needs a human check first (see Question 1).
- `apps/web/src/chat/**` is **not** touched by 9.3h or 8.6e — safe for this task, but Phase B
  should still do a final `git status`/diff check before pushing in case the board has moved.

## Tests first (both phases)
- Phase A: write `skillProgress.test.ts` red first (no helpers exist yet) — one case per `RolePlay`
  phase, an un-entitled skill (dropped, no throw), an oversized payload (dropped, no throw; mirror
  `skillEvent.test.ts`'s pattern), and the feedback marker on `move: 'hint'`/`skill: 'feedback'`
  only. Then wire `decide.ts`/`generate.ts`/`runner.ts` and watch `generate.test.ts` go red before
  green on the new emission. Run the real `roleplay.integration.test.ts`-style fixture (5.8's
  pattern) to show one whole mock-interview sequence now also carries `skill` events with no
  change to the shown text.
- Phase B: write the new `ChatView.test.tsx`/`e2e` cases against a scripted `skill` event fixture
  first (red: UI ignores it today), then wire the rendering.

## Risky paths touched
Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- **Phase A** (`packages/harness/src/pipeline/**`): none of `pipeline/types.ts`,
  `pipeline/steps/decide.ts`, `pipeline/runner.ts`, `pipeline/generate/**`,
  `pipeline/steps/generate.ts` match any glob in risk-paths.txt (only `pedagogy/**` and
  `guardrails/**` are listed under harness, and this design does not touch either).
- **Phase B** (`apps/web/src/chat/**`, `apps/web/messages/en.json`): no match (the web risk group
  is `apps/web/app/api/auth/**`, `apps/web/app/api/staff/**`, `apps/web/src/auth/**`,
  `apps/web/app/api/webhooks/**` — chat screens are none of these).
- None (checked against risk-paths.txt) for both phases.
- The board task still carries `risk: high` on its own (tasks.yaml), independent of a path match —
  that is the board author's judgement that a change to what the student is shown during a
  mock-interview/feedback turn deserves a logged decision. The handoff logs a `risk: high`
  decision for the merge regardless of the risk-paths.txt result above, and code-reviewer (which
  runs on every PR) covers the acceptance's "code-reviewer on the pedagogy path" line even though
  no `pedagogy/**` file is actually touched by this design.

## Questions (each with a recommendation)

### Q1 — "registry appends the feedback and role-play tools" vs. harness-computed events
The board's accept text says the tool **registry** gains feedback and role-play tools; this plan
instead computes both events from state the harness already derives (`PolicyResult.rolePlay`,
`PolicyResult.skill`) and never offers a new tool to the model.
- **Recommendation: harness-computed, no new model-callable tool.** Role-play's whole point
  (ADR-0013) was moving progress out of model control into clamped, server-computed state,
  specifically because the model cannot be trusted to self-report or count correctly; a new tool
  the model calls to report its own progress (or its own feedback band) would reopen exactly that
  risk, and would need a prompt-pack change (a new move instructing the model to call it) which is
  an ADR-sized change under `pedagogy/**`/`content/prompt-packs/**` — not "MVP first". The
  registry's own header comment predates ADR-0013. Read the accept line's "tools" loosely as "the
  skill-event machinery now covers these two skills."
- If the architect disagrees and wants literal `RegisteredTool` entries in `tools/registry.ts`
  (e.g. present-only entries never offered to the model, just to reuse `skillEvent()`'s shape),
  that is a smaller alternative worth a quick architect check before Phase A starts, since it
  changes which files Phase A touches (`tools/registry.ts`, a new file under `tools/`) but not the
  no-ADR conclusion.

### Q2 — What does a "feedback" skill event's payload carry?
Feedback has no harness-computed score; the model writes the verdict in prose, and ADR-0012
explicitly bans a numeric score.
- **Recommendation:** an empty/marker payload (`{}` or `{ given: true }`) — a confirmed signal that
  this reply is the feedback verdict, replacing the web client's current one-shot
  `feedbackPending` guess (9.5b). Do not try to extract a band from the model's text; that would
  need a judge call or text parsing, out of scope and risky to get wrong.

### Q3 — Does a mock-interview skill event change the 9.5b `activeSkill` reset rule?
9.5b built `ChatView`'s reset logic around "mock_interview never emits a `skill` TurnEvent" (its
own Q2); this task makes that false.
- **Recommendation:** keep the Stop button as one explicit reset point (students must always be
  able to leave), and additionally clear `activeSkill` when an incoming event's `payload.phase` is
  `'stopped'` or `'ended'` — both are already terminal, harness-decided states, so this tightens
  correctness (e.g. a `stop` typed as plain text, not the button) without removing the existing
  path. Needs its own test for "the turn right after the phase flips to ended/stopped", per the
  UI-state lesson (`docs/lessons.md`).

## Budget
Budget: 150 tool calls (2 phases, packages/harness + apps/web)
- Phase A (harness): ~85 tool calls.
- Phase B (apps/web): ~65 tool calls.

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (`corepack pnpm turbo run typecheck lint test --filter=...`,
`python3 .githooks/secret-scan.py --all`, vitest/playwright runs — no other shell use).

## Exit conditions
- Phase A `Status: DONE` once: the new `skillProgress.ts` helpers are tested in isolation, a
  whole mock-interview sequence (fixture-driven, no model call) shows the right `skill` event per
  phase with unchanged shown text, a feedback turn shows the marker event, `@edmate/harness`
  typecheck/lint/test is green, and the secret scan is clean. `Status: PARTIAL` past ~95 tool
  calls, or if `runner.ts`'s call site needs a change wider than passing two extra fields through
  (stop and hand back rather than guessing at runner.ts's broader shape).
- Phase B `Status: DONE` once: `ChatView`/`MockInterviewControls`/`SkillLauncher` render the new
  events (safeParse'd, with a fallback view, per the UI-state lesson), the reset-point tests from
  Q3 pass, `@edmate/web` typecheck/lint/test is green, `e2e/skills.spec.ts` is extended (running it
  against a live compose Postgres is the lead's job after handoff, same as 9.5b), and the secret
  scan is clean. `Status: PARTIAL` past ~75 tool calls, or if Phase A's actual payload shape
  differs from what this plan assumed (read Phase A's handoff first, not this plan, for the exact
  `RolePlay`/feedback payload shape).

## Lead answers (25 Oct 2026)
- Q1: agreed: harness-computed events, no new model-callable tool and no registry entry. The accept line's "registry appends the feedback and role-play tools" is read as "the skill-event machinery covers these two skills". Log this as `### 25 Oct 2026 · 13.skillpresent skill progress is harness-computed, not a registry tool · decided by lead · risk: low` in the Phase A handoff (Decided: / Why: from Q1 above). No architect check: no contracts, ADR or prompt-pack change.
- Q2: agreed: a marker payload for feedback (`{ given: true }` or the plan's equivalent), no score and no text parsing.
- Q3: agreed: keep the Stop button and also clear `activeSkill` on `payload.phase` `stopped` or `ended`, with its own next-turn test.
- One fresh builder per phase. Phase A (packages/harness) first: budget 85, stop at 100. Phase B (apps/web) starts after Phase A merges, with the Phase A handoff.
- Reviewers: code-reviewer and typescript-reviewer per phase (no risky path). The board's `risk: high` tag still gets a lead `risk: high` decision at merge.
