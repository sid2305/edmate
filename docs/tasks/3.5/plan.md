# Task 3.5: Teaching policy

Board: `board.py show 3.5` · M3 · deps 2.6, 3.1, M0 (all done) · branch `m3/3.5-teaching-policy` · not risky (see Risky paths touched). Planner: opus.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Teaching policy: help ladder with effective ceiling and `attempt`, skill rules, `locked` and `ask_teacher` moves, `maxOutputTokens` per move"
Accept: "table-driven tests cover every transition, including `helpCeiling 4` with `finalAnswers never`."

Spec it must honour:
- Build plan § Turn pipeline spec, step 7 `decide`: "Teaching policy picks move, rung, `mustNotReveal`, prompt, tools allowed by the entitlement, `maxOutputTokens`", rules only (no model), 50 ms, "Fall back to `ask`".
- § Access filter 3: "`decide` picks `locked` when `lockedHit` is true and allowed retrieval found nothing above threshold; otherwise an uncovered question goes to `ask_teacher`." § Access filter 5: tools only for skills in the entitlement.
- § Teaching engine › Help ladder (the transition table), effective ceiling `finalAnswers === 'never' ? min(helpCeiling, 3) : helpCeiling` (also the `PackageConfigSchema` comment), "an attempt is logged" = `attempt` is not `none`, or a `check_answer` turn.
- § Teaching engine › Skills (default move per skill) and § Staying true to the teacher / § Ask the teacher (teacher's material only; never general knowledge). Decision log 17 Oct 2026 · Product (ask the teacher).
- `edmate-pedagogy` skill: rung 1 nudge, 2 conceptual hint, 3 worked example of a similar problem, 4 solution then `check`; solved resets to 0 with one transfer question; with `finalAnswers: never`, `mustNotReveal` holds the answer; coaching < 80 words; explain ≤ 150 words.
- Contracts (frozen, read only): `TurnContext` (`helpRung` 0–4, `lockedHit`, `retrieved[].score?`, `intent`, `attempt`), `PedagogyDecision` (move enum, rung, `mustNotReveal`, `systemPrompt`, `tools`, `maxOutputTokens`), `PackageConfig` (`helpCeiling` 1–4, `finalAnswers`, `skills`, `lockedReply`), `Entitlement.skills`, `TurnInput.kind/skill`, `LIMITS.helpRungMin/Max`.
- Rule 3 (harness purity: contracts, zod, mathjs, own modules), rule 4 (no model calls). Prompt-pack behaviour is frozen: this task writes no pack and no prompt text.

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Every ladder transition | `pedagogy/ladder.test.ts`: a `it.each` table, one named row per transition in § Help ladder (new problem → 0 `ask`; each trigger from rungs 0–3 → n+1 with the rung's move; partial → same rung `ask`; correct → 0 `check`; 3 → 4 `solution` for `allowed`, for `after_attempt` with an attempt this turn, with one logged earlier, with a `check_answer` turn; 3 stays 3 for `after_attempt` with none; turn after `solution` → 0 `check`; second no-progress turn climbs, first does not). |
| `helpCeiling 4` with `finalAnswers never` | named rows: ceiling 3; from rung 3 with `hint_request`, `answer_seeking`, attempt logged → stays 3, move ≠ `solution`; stored `helpRung 4` is clamped to 3; `mustNotReveal` = the answer key. |
| Exhaustive grid | `ladder.test.ts` generates every `helpCeiling` (1–4) × `finalAnswers` (3) × from-rung (0–4) × trigger (hint_request, answer_seeking, stuck, partial, correct, none) × attempt-logged (2) and asserts invariants: rung ≤ effective ceiling; `solution` only when rung 4 is reachable and gated; `finalAnswers never` never yields `solution`; rung moves by at most +1. |
| `locked` vs `ask_teacher` | `pedagogy/coverage.test.ts` table: lockedHit × retrieved (empty; all below threshold; one exactly at threshold; one above; one with no score; a teacher_note above) → `locked` / `ask_teacher` / teaching move. Plus: the buildContext fallback context (`retrieved []`, `lockedHit false`) → `ask_teacher`; a `skill_action` for a skill not in `entitlement.skills` → `locked`; an entitlement with no skills → `locked`. |
| Skill rules | `pedagogy/skills.test.ts` table, one row per MVP skill (explain, coach, practice, feedback, mock_interview, revision) and `study_plan`: default move, skill chosen for `message` turns, `explain` → next turn `check`, practice ladder cap, mock_interview without a persona. |
| Intents | `policy.test.ts` rows: off_topic, misuse, meta → `redirect`; on_task / answer_seeking → ladder; distress → `redirect` (unreachable; see Q6). |
| `maxOutputTokens` per move | `budgets.test.ts`: every move in `PedagogyDecisionSchema.shape.move.options` has a positive budget (the test fails if a move is added without one); the table is pinned by an inline snapshot. |
| Tools | rows: tools offered only when the tool's skill is in `entitlement.skills` and is the turn's skill; `locked`, `ask_teacher`, `redirect` get no tools. |
| Pure and deterministic | `policy.test.ts`: deep-frozen inputs (mutation throws); same input twice → deep-equal output; the module never touches `Date`, `Math.random` or a port (no `PipelineDeps` argument exists); the purity lint (0.1 rule) passes. A result plus a test-only `systemPrompt` parses with `PedagogyDecisionSchema`. |
| Gates | `turbo run typecheck lint test --filter=@edmate/harness...` green; `src/pedagogy/**` at 100% lines/branches (vitest threshold, as for the router in 2.3); `packages/contracts/**`, `content/**` untouched. |

## Design

All new code lives in `packages/harness/src/pedagogy/` (the repo layout's "modes, help ladder" folder). It is synchronous, imports only `@edmate/contracts`, `zod` and its own files, and has no ports.

### API (`pedagogy/policy.ts`)
```ts
export interface PolicyInput {
  ctx: TurnContext;                         // as the runner assembled it (already schema-checked)
  turn: Pick<TurnInput, 'kind' | 'skill'>;  // never reads text: route already classified it
  help: HelpState;                          // per-session state beyond helpRung (below)
  tools?: readonly { name: ToolName; skill: Skill }[]; // the registry's list (5.4/5.5); default []
}
export interface PolicyResult {
  move: PedagogyDecision['move'];
  rung: TurnContext['helpRung'];
  skill: Skill | null;      // for the 3.6 composer's skill pack; null for locked/ask_teacher/redirect
  mustNotReveal: string[];
  tools: ToolName[];
  maxOutputTokens: number;
  next: { helpRung: TurnContext['helpRung']; help: HelpState }; // for commit (3.8) to persist
  reason: PolicyReason;     // a fixed enum for the trace and tests, never free text
}
export function decidePolicy(i: PolicyInput, opts?: PolicyOptions): PolicyResult;
export function fallbackPolicy(ctx: TurnContext): PolicyResult; // move 'ask', rung clamped, no tools
```
`PolicyOptions = { coverageThreshold: number }`, default `DEFAULT_COVERAGE_THRESHOLD` (Q2).

### Help state (`pedagogy/helpState.ts`)
`HelpStateSchema = z.strictObject({ stuckTurns: 0 | 1, attemptLogged: boolean, pendingCheck: boolean, answerKey: string[] })`, `INITIAL_HELP_STATE`. This is the shape of `sessions.help_state`, which 1.2 left `unknown` for 3.5 to own. `helpRung` stays in `TurnContext` (one source of truth). Loading it (3.4) and saving `next` (3.8) are not this task (Q1).

### Order of rules (first match wins)
1. **Distress** (defence in depth; the runner escalates before decide) → `redirect`, no tools.
2. **Skill selection.** `skill_action` uses `turn.skill`; other turns use `coach` if entitled, else `explain`, else the first entitled skill. Not in `entitlement.skills`, or none entitled → `locked` (the skill is outside the package).
3. **off_topic, misuse, meta** → `redirect`.
4. **Coverage.** Covered = some `retrieved` chunk with `score ≥ threshold`; a chunk with no score counts as not covered (fail toward `ask_teacher`). Not covered: `lockedHit` → `locked`, else `ask_teacher`. Both get no tools, `skill: null`, and leave the ladder state unchanged.
5. **Skill default move** (§ Skills): `explain` → `explain`, sets `pendingCheck`; `coach` → ladder; `practice` → `check`, but a `hint_request` climbs the ladder with a skill cap of 3; `feedback` → `hint` (Q4); `mock_interview` → `ask` (5.8 owns `/pause`, end conditions and the debrief), falling back to `coach` when `ctx.persona` is missing; `revision` → `explain`; `study_plan` (P1) → `redirect`.
6. **Ladder** (`pedagogy/ladder.ts`, coach and practice):
   - `effectiveCeiling(pkg, skill) = min(helpCeiling, finalAnswers === 'never' ? 3 : 4, SKILL_CAP[skill])`; the stored rung is clamped to it first (the teacher may have lowered the ceiling).
   - `attemptLogged' = help.attemptLogged || attempt !== 'none' || kind === 'check_answer'`.
   - `pendingCheck` (after `solution` or `explain`) → `check`, rung 0, state reset.
   - `correct` → rung 0, `check` (one transfer question), state reset (Q3).
   - `partial` → same rung, `ask` (next step, specific praise), `stuckTurns` 0.
   - Trigger = `hint_request`, `answer_seeking`, or a second turn in a row with attempt `none`/`wrong`: target = min(n+1, ceiling). From 3 to 4, also needs `allowed`, or `after_attempt` with `attemptLogged'`. Otherwise the rung stays 3 and the move is `ask`, inviting an attempt (Q5).
   - First no-progress turn → same rung, `stuckTurns` 1, the rung's move. Rung 0 with nothing else going on → `ask`.
   - Rung → move: 0 `ask`, 1 `hint` (nudge), 2 `hint` (conceptual), 3 `worked_example`, 4 `solution` (sets `pendingCheck`).
7. **mustNotReveal** = `help.answerKey` for every move except `solution`, and always when `finalAnswers` is `never`. (5.6 fills the answer key; it is empty until then.)
8. **Tools** = `tools` filtered to the turn's skill ∩ `entitlement.skills`; none for `locked`, `ask_teacher` and `redirect`.

### Budgets (`pedagogy/budgets.ts`, provisional until 7.6 cost data; decision low)
`MAX_OUTPUT_TOKENS: Record<Move, number>` (frozen): ask 200, hint 250, check 250, redirect 150, locked 150, ask_teacher 250, explain 400, worked_example 600, solution 700. Override per skill: revision 700, feedback 500. Based on: under 80 words for coaching, ≤ 150 words for explain plus example and citation, and room for a covered part in `ask_teacher`.

### Not in this task
`steps/decide.ts` stays a stub. `systemPrompt` needs the 3.6 composer, so 3.6 wires `decide.run = compose(decidePolicy(...))` and `decide.fallback = compose(fallbackPolicy(ctx))`. A `PedagogyDecision` with an empty prompt would be a silent failure (Q1).

## Files
Create:
- `packages/harness/src/pedagogy/helpState.ts`
- `packages/harness/src/pedagogy/ladder.ts`
- `packages/harness/src/pedagogy/coverage.ts`
- `packages/harness/src/pedagogy/skills.ts`
- `packages/harness/src/pedagogy/budgets.ts`
- `packages/harness/src/pedagogy/policy.ts`
- `packages/harness/src/pedagogy/index.ts`
- tests: `ladder.test.ts`, `coverage.test.ts`, `skills.test.ts`, `budgets.test.ts`, `policy.test.ts` in the same folder, plus a `pedagogy/testing.ts` context builder from the 2.6 fixtures (`demoChunk`, the demo package).

Modify:
- `packages/harness/src/index.ts`: add `export * from './pedagogy/index.js'`.
- `packages/harness/vitest.config.ts`: add a 100% threshold for `src/pedagogy/**`.
- Delete `packages/harness/src/pedagogy/.gitkeep`.

Out of bounds:
- `packages/contracts/**`, `content/**` (prompt packs, skills, locales)
- `packages/harness/src/pipeline/**`: the runner, `types.ts`, `steps/decide.ts`
- `packages/harness/src/guardrails/**`, `packages/harness/src/access/**`, `packages/db/**`, `evals/**`, `.claude/**`

## Tests first (tdd-guide order)
1. `budgets.test.ts`, then `budgets.ts`.
2. `ladder.test.ts`: named rows, then the exhaustive grid. Then `ladder.ts` with `effectiveCeiling` and `nextRung`.
3. `coverage.test.ts`, then `coverage.ts`.
4. `skills.test.ts`, then `skills.ts`.
5. `policy.test.ts`: order of rules, intents, tools, mustNotReveal, determinism and freeze, fallbackPolicy, and the schema round trip. Then `policy.ts`.
6. Exports, coverage threshold, full gate run.

## Risky paths touched
None (checked against risk-paths.txt). `packages/harness/src/pedagogy/**`, `src/index.ts` and `vitest.config.ts` match no glob, and no guardrails, access, contracts, content or ADR path is touched.
Recommended reviewers: `typescript-reviewer` and `code-reviewer`, plus `safety-reviewer` as an advisory reviewer (not required by the gate). This task decides how locked, uncovered, off-topic and distress-adjacent turns are answered, and it sets the `mustNotReveal` rule. No `risk: high` entry is required; log the decisions below as low or medium.

## Open questions (recommendations)
- **Q1 Wiring.** Who threads `HelpState` and wires `decide`? Recommend: 3.6 wires `decide` (policy + composer). 3.4 adds `helpState` to `BuiltContext` and the runner passes it to `decide.run` (a harness-internal signature change, no ADR). 3.8 persists `next` to `sessions.help_state`. Until then `INITIAL_HELP_STATE` applies, so the "2 turns stuck" trigger cannot fire in live turns yet.
- **Q2 Threshold.** The retrieval score scale is not defined until 5.3. Recommend an injected `coverageThreshold` with a provisional default of 0.5 on a 0–1 scale; a chunk with no score counts as not covered; 5.3 calibrates it on the demo Q&A set (decision medium). 3.4 must build the retrieval query from the active problem plus the latest message, so that a student's bare answer ("42") still retrieves; otherwise it would wrongly go to `ask_teacher`.
- **Q3 Solved vs step.** `route` gives one `correct` and cannot tell "solved" from "a correct step". Recommend: `correct` = problem solved (rung 0, `check`); `partial` = correct step (same rung, `ask`). 3.3's labels must follow this.
- **Q4 feedback move.** Recommend `hint` (point to the rubric line and the fix), not `explain`.
- **Q5 Gated at rung 3.** With `after_attempt` and no attempt, recommend `ask` at rung 3 (invite an attempt) rather than repeating `worked_example`. At a ceiling below 4, repeat that rung's move.
- **Q6 Distress reaching decide.** It is unreachable (the runner escalates first). Recommend `redirect` with no tools, not a throw: a throw would fall back to `ask`, a teaching question. Safety-reviewer to confirm.
- **Q7 Skill caps.** Recommend coach 4 and practice 3 (answer keys stay server-side); the other skills do not use the ladder.

## Lead answers (18 Oct 2026)

- Q1–Q7: accepted as recommended. Log Q2 (coverage threshold 0.5; unscored chunk = not covered), Q6 (distress reaching decide → `redirect`, never a throw) and Q7 (ladder caps coach 4, practice 3) as decisions (risk: medium).
- Reviewers: typescript-reviewer, code-reviewer, and safety-reviewer (opus) because the policy decides locked, uncovered and distress replies.
- Before your final push: merge origin/main, regenerate the lockfile if it conflicts, re-run gates.
