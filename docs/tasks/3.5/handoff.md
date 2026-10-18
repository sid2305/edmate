# Task 3.5 handoff: Teaching policy

Status: DONE
Branch: `m3/3.5-teaching-policy`
Worktree: `.claude/worktrees/agent-af1218dd0beaed5f6`
Builder: tdd-guide

## Acceptance evidence

| Item | Evidence |
|---|---|
| Every ladder transition | `pedagogy/ladder.test.ts` › "help ladder transitions": one named `it.each` row per transition. New problem → 0 `ask`. `hint_request`, `answer_seeking`, second turn with attempt wrong and with attempt none, each from rungs 0–2 → n+1 with that rung's move. Partial → same rung `ask` (it also beats a hint request). Correct → 0 `check`, state reset. 3 → 4 `solution` for `allowed`, for `after_attempt` with an attempt this turn, with one logged earlier, and on a `check_answer` turn. 3 stays 3 `ask` (`solution_gated`) for `after_attempt` with no attempt. Turn after `solution` → 0 `check`. First no-progress turn stays put with `stuckTurns 1`; the second climbs. |
| `helpCeiling 4` with `finalAnswers never` | Named rows: effective ceiling 3; from rung 3 with `hint_request` + attempt logged, `answer_seeking` + attempt, or a second stuck turn → stays 3 `worked_example`, never `solution`; a stored `helpRung 4` is clamped to 3. Through `decidePolicy`, `mustNotReveal` equals the answer key. |
| Exhaustive grid | `ladder.test.ts` › "exhaustive grid": helpCeiling (1–4) × finalAnswers (3) × from-rung (0–4) × trigger (6) × attempt-logged (2) × stuckTurns (2) = 1440 cases. Each checks: rung ≤ effective ceiling; rung ≤ clamped from + 1; `solution` only at ceiling 4 with the gate open; never `solution` under `never`; correct → 0 `check`; partial → `ask`. |
| `locked` vs `ask_teacher` | `pedagogy/coverage.test.ts`: lockedHit × retrieved (empty; all below; exactly at threshold; above; unscored; teacher_note above) → `locked` / `ask_teacher` / teaching move. Also covered: the buildContext fallback context → `ask_teacher`; a `skill_action` outside `entitlement.skills` → `locked`; an empty entitlement → `locked`; an injected threshold; NaN covers nothing; an uncovered turn leaves the ladder state unchanged. |
| Skill rules | `pedagogy/skills.test.ts`: one row per skill (explain, coach, practice, feedback, mock_interview, revision, study_plan), plus skill selection for `message` turns, explain → next turn `check`, the practice cap of 3 and clamping, practice correct resets, mock_interview without a persona → coach, and non-ladder skills keeping the ladder state. |
| Intents | `policy.test.ts` › intents: off_topic, misuse, meta, distress → `redirect` with no tools; on_task and answer_seeking → ladder. Distress wins over a missing entitlement and over coverage. |
| `maxOutputTokens` per move | `budgets.test.ts`: every `PedagogyDecisionSchema.shape.move.options` entry has a positive integer budget, the key set equals the move enum, and inline snapshots pin the move table and the skill overrides. |
| Tools | `policy.test.ts` › tools: only tools for the turn's skill, and only if that skill is entitled; deduplicated; none when the list is omitted; none for `locked`, `ask_teacher`, `redirect`. |
| Pure and deterministic | `policy.test.ts`: deep-frozen inputs pass without throwing and the results are fresh objects; the same input twice gives deep-equal output; `Date.now` and `Math.random` spies are never called; no `PipelineDeps` argument exists; results plus a test-only prompt parse with `PedagogyDecisionSchema`, and `next.help` parses with `HelpStateSchema`. The purity lint passes. |

Commands (trimmed):

```
packages/harness$ pnpm exec vitest run src/pedagogy
 Test Files  5 passed (5)
      Tests  1589 passed (1589)

packages/harness$ pnpm exec vitest run --coverage
 Test Files  22 passed (22)
      Tests  1897 passed (1897)
All files | 99.37 | 97.19 | 100 | 100     (src/pedagogy/** at 100%: hidden from the report as full; the 100% threshold passes)

root$ pnpm turbo run typecheck lint test
 Tasks:    35 successful, 35 total

root$ python3 .githooks/secret-scan.py --all
(no output, exit 0)

root$ git fetch origin; git log HEAD..origin/main
(empty: already up to date, no lockfile change)
```

## Changes

- New `packages/harness/src/pedagogy/`: `budgets.ts`, `helpState.ts`, `ladder.ts`, `coverage.ts`, `skills.ts`, `policy.ts`, `index.ts`, the test-only `testing.ts` builder, and five test files.
- `packages/harness/src/index.ts`: exports `./pedagogy/index.js`.
- `packages/harness/vitest.config.ts`: 100% threshold for `src/pedagogy/**`; `src/pedagogy/testing.ts` excluded from coverage (test-only).
- Deleted `packages/harness/src/pedagogy/.gitkeep`.
- Untouched: `packages/contracts/**`, `content/**`, `steps/decide.ts` (still the stub; 3.6 wires it), `apps/web`, `packages/db`.

## Deviations

- `fallbackPolicy(ctx, help = INITIAL_HELP_STATE)` takes an optional help state, so the fallback can keep the answer key in `mustNotReveal`. Same call shape as the plan when it is omitted.
- Skill selection uses `turn.skill` whenever it is set, not only on `skill_action` turns, so a practice `hint_request` stays in practice (the plan's practice rule needs that). A `skill_action` with no skill fails closed to `locked`.
- Exported `attemptLoggedAfter`, `nextRung`, `coverageGate`, `selectSkill` and the reason types alongside `decidePolicy`.
- Root `pnpm format:check` flags `.github/workflows/ci.yml`. That file is already like that on main and this task does not touch it.

## Decisions

### 18 Oct 2026 · 3.5 Coverage threshold 0.5 and an unscored chunk counts as not covered · decided by team lead (plan Q2) · risk: medium
Decided: a turn is covered when some retrieved chunk has `score ≥ coverageThreshold`. The threshold is injected through `PolicyOptions`, with a provisional default of 0.5 on a 0–1 scale. A chunk with no score, or a NaN threshold, counts as not covered. Not covered goes to `locked` if `lockedHit`, otherwise to `ask_teacher`.
Why: the retrieval score scale is not defined until 5.3, and failing toward `ask_teacher` keeps the agent from answering from general knowledge.
Alternatives: treat any retrieved chunk as covered; hard-code a threshold.
Reversible: yes; 5.3 calibrates the default on the demo Q&A set.

### 18 Oct 2026 · 3.5 Distress reaching decide returns redirect, never a throw · decided by team lead (plan Q6) · risk: medium
Decided: `decidePolicy` checks distress first, before the entitlement and coverage, and returns `redirect` with no tools and no skill.
Why: the runner escalates distress before decide, so this is defence in depth. A throw would fall back to `ask`, which is a teaching question. Safety-reviewer to confirm.
Alternatives: throw; return `ask`.
Reversible: yes.

### 18 Oct 2026 · 3.5 Ladder caps: coach 4, practice 3 · decided by team lead (plan Q7) · risk: medium
Decided: `effectiveCeiling = min(helpCeiling, finalAnswers never ? 3 : 4, SKILL_CAP[skill])` with coach 4 and practice 3. The stored rung is clamped to it before any transition. Only coach (and mock_interview without a persona, which falls back to coach) and practice hint requests use the ladder.
Why: practice answer keys stay server-side, so practice never reaches a solution.
Alternatives: practice capped at 2; one cap for all skills.
Reversible: yes.

### 18 Oct 2026 · 3.5 Solved vs step, gated rung 3, feedback move · decided by team lead (plan Q3, Q4, Q5) · risk: low
Decided: `correct` = problem solved (rung 0, `check`, state reset); `partial` = a correct step (same rung, `ask`). At rung 3 with `after_attempt` and no attempt, the move is `ask` (invite an attempt). The same gate applies to a stored rung 4 without a pending check. At a ceiling below 4, the rung repeats its move. `feedback` → `hint`.
Why: `route` gives one `correct` label; asking for an attempt gets further than repeating the worked example.
Alternatives: repeat `worked_example` when gated; `feedback` → `explain`.
Reversible: yes.

### 18 Oct 2026 · 3.5 Non-ladder moves report rung 0 and keep the ladder state · decided by builder (tdd-guide) · risk: low
Decided: `locked`, `ask_teacher`, `redirect`, and the feedback, revision, mock_interview (with persona), explain and study_plan moves report `rung: 0` in the decision, and leave `next.helpRung` and the help state as they were. The one exception: explain sets or clears `pendingCheck`. A practice item turn reports its clamped rung and resets to 0 on a correct answer.
Why: the spec gives no rung for non-ladder moves, and a detour into another skill should not lose the student's place on the ladder.
Alternatives: report the stored rung on every move.
Reversible: yes.

### 18 Oct 2026 · 3.5 mustNotReveal and help state ownership · decided by builder (tdd-guide) on the plan · risk: low
Decided: `mustNotReveal` is a copy of `help.answerKey` for every move except `solution` (and always under `finalAnswers never`), including locked, ask_teacher, redirect and the fallback. `HelpStateSchema` = `{ stuckTurns 0|1, attemptLogged, pendingCheck, answerKey }` is the shape of `sessions.help_state`. A solved problem or a consumed check resets it, including the answer key. Results never alias the input state.
Why: plan § Help state and rule 7. Keeping the key on non-teaching replies costs nothing and blocks a leak.
Alternatives: an empty `mustNotReveal` on non-teaching moves.
Reversible: yes.

### 18 Oct 2026 · 3.5 Provisional maxOutputTokens table · decided by builder (tdd-guide) on the plan · risk: low
Decided: ask 200, hint 250, check 250, redirect 150, locked 150, ask_teacher 250, explain 400, worked_example 600, solution 700. Skill overrides: revision 700, feedback 500. Pinned by an inline snapshot.
Why: coaching stays under 80 words; explain is ≤ 150 words plus an example and a citation.
Alternatives: one budget for all moves.
Reversible: yes; 7.6 tunes the numbers on cost data.
