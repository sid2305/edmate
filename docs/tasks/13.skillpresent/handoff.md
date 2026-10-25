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

## Budget
Tool calls used: 59
