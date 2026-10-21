# ADR-0012: Feedback pack 1.1.0: its own move line, no execution, no score

## Status

Proposed.

## Date

2026-10-21

## Context

Task 5.7 builds the feedback skill: "rubric feedback on answers, essays and code (no execution)". It is accepted at ≥ 70% agreement with the demo teacher's rubric scores on its 30 samples (task 1.8). The build plan's rule for the skill is "never rewrites the student's work for them; points to the rubric line" (§ Teaching engine › Skills). The PRD's help limit is "never the final answer to graded work". Prompt-pack behaviour changes only with an ADR (build plan rule 2, CLAUDE.md non-negotiable 2).

What exists today:
- `feedback@1.0.0` (signed off, in sets 1.0.0 and 1.1.0) tells the model to describe each fix in words and cite the rubric line [n]. It says nothing about running code.
- `skills.ts` sends every feedback turn to `move: hint`, rung 0. `compose.ts` (`moveSection`) turns a hint below rung 2 into the frame's `move-hint-1` line: "Give one nudge ... Don't name the idea that solves it or any result." The frame's decision block adds "Carry it out exactly." So the model is told to describe the fix and also not to name it. Whichever it follows, it breaks the other. If it follows hint-1, the feedback turns vague, and the partial-band judge statements in the 5.7 suite fail.
- All prose comes from packs; code renders only data (headers of `compose.ts` and `promptPacks.ts`). Every frame section is required and an unknown one is an error (`parseFrame`). So sets 1.0.0 and 1.1.0, which use `frame@1.0.0`, would stop loading if a required section were added.
- The demo seed pins set 1.1.0 (`packages/db/src/seed.ts:95`, `packages/db/test/seed.test.ts:32`). Another task is working in `packages/db` now.
- No tool runs code. The feedback skill is offered no tools, and the calculator is coach-only. A code runner is P1 (PRD).
- The 5.7 Phase A drafts (`feedback@1.1.0`, `set@1.2.0`, NOTES.md) left four points open: the hint-1 clash, the seed, scores, and "one next step".

## Decision

1. **Feedback gets its own move line (no contracts change).**
   - New `frame@1.1.0`: `frame@1.0.0` unchanged, plus one section with no placeholders:
     `## move-feedback`
     `[[MOVE-FEEDBACK]] Give feedback on the work the student sent, as the feedback skill above says: for each point, name the rubric line [n] it meets or misses, and describe any fix in words. Never write the corrected work or any piece of it, and never give the right answer, a right value or a model answer. End with one question.`
   - `promptPacks.ts`: `move-feedback` joins `FRAME_SECTIONS` (no slots) as the only optional section (`OPTIONAL_FRAME_SECTIONS`). A frame may leave it out. If a frame has it, it is checked like every other section: not empty, no placeholders. In `PromptPackSet['frame']` it is optional (`'move-feedback'?: string`); every other section stays required.
   - `compose.ts`: the decision block's move line is `move-feedback` when `policy.skill === 'feedback'`, `policy.move === 'hint'` and the set's frame has the section. Every other case is unchanged. So sets 1.0.0 and 1.1.0 compose exactly as today, and turns traced with them still replay.
   - `skills.ts` is unchanged: feedback stays fixed at `move: hint`, rung 0, with the help state carried over unchanged.
2. **Graded and locked work stay safe.** Feedback never shows a model answer, a corrected version or a right value for any submission, whatever the package's `finalAnswers`. So the harness never needs to know which work is graded. The rule is in the pack and again in the move line. Feedback never reaches the `solution` move, so `keysFor` never releases a key: a held practice key or carried key stays in `mustNotReveal`, and the stream gate and postGuard still guard it. Locked work is handled before the skill runs, and none of this changes:
   - the entitlement check (`skill_not_entitled` → locked);
   - the coverage gate (locked or `ask_teacher`);
   - `checkScope` in the composer;
   - the locked-leak check on replies.
   `hint` stays in grounding's judged and delivering sets and in `holdsReply`'s teaching moves. The output budget stays 500 tokens (`SKILL_OUTPUT_TOKENS.feedback`).
3. **No execution.** `feedback@1.1.0` judges code only by reading it against the rubric. It never runs, executes, traces or steps through code, and never says or predicts what the code prints, returns or holds, or whether it errors, even if the material states the output. It never claims it ran or tested the code. It may point out that a line breaks a rule from the material, citing [n]. If the student reports what the code printed, the reply may refer to that as what they saw, without confirming it. This matches the code-output clause in `practice@1.1.0`. At the platform level nothing can run code: no tool does, and adding one (the P1 code runner) takes a new ADR.
4. **No score or points total (C).** `feedback@1.1.0` adds: "Never give a score, mark, grade or points total, even when the rubric has points. Give the verdict in words." The verdict is one of three: meets the rubric, partly meets it, or doesn't meet it yet. A model-written total is a numeric claim about a rubric. The arithmetic recompute in `numbers.ts` can't check it, and it reads like an official grade. When the feedback screen (9.5) or the mastery model needs a number, it comes from a structured scorer, never from reply prose, under its own ADR (possibly a contracts change).
5. **Two or three fixes; the student picks one (D).** The 1.0.0 lines stay word for word: "pick the two or three most important fixes" and "End by asking which fix they'll try first". The student's choice is the one next step. `feedback@1.1.0` adds: "Name a fix only for a rubric line the work misses; if it misses one line, name one fix." Together with the full-marks line (no fix, one "why does it work" question), this means no fix is ever made up.
6. **Set and seed (A).**
   - `set@1.2.0.yaml` is `set@1.1.0` with `feedback: 1.1.0` and `frame: 1.1.0`. The 5.7 plan's "bump only feedback" is amended to "feedback and frame". `set@1.0.0` and `set@1.1.0` stay byte-for-byte the same.
   - `feedback@1.1.0`, `frame@1.1.0` and `set@1.2.0` carry `reviewed_by: pending` until a named human signs them. No agent fills in a name.
   - The demo seed moves to 1.2.0 in a small `packages/db` follow-up task: `seed.ts:95` and its comment, and `seed.test.ts:32`. It lands after the named sign-off and after the current `packages/db` task merges, and before the live 70% run is recorded and the M5 exit demo. Until then the web demo stays on set 1.1.0. That set is safe: its clash makes the model say less, not more.
7. **No `packages/contracts` change.** `PedagogyDecision.move`, `TurnContext`, `TurnEvent` and the trace are untouched.

## Alternatives

- **Pack-only override ("these lines take precedence over the move line").** Not chosen: the decision block still says "Carry it out exactly", so the model still gets two orders that disagree. It would also teach the model that skill text can override the decision block, which carries the safety rules for the other moves.
- **Rung 2 (`move-hint-2`).** A one-line change in `skills.ts`. Not chosen:
  - its "without applying it to their problem" still clashes with "say what falls short";
  - rung 2 can exceed a teacher's `helpCeiling` of 1;
  - the student would see hint rung 2 on every feedback reply;
  - it silently changes prompts for sets 1.0.0 and 1.1.0.
- **Route feedback to `explain`.** A one-line change. Not chosen:
  - `move-explain` invites teaching the idea and has no "never give the answer" rule, which is weaker for graded work;
  - it ends with a comprehension check, not "which fix first";
  - the trace would label feedback turns as explain;
  - it silently changes prompts for old sets.
- **The instruction in `skills.ts` or `compose.ts`, or an empty move line for feedback.** Not chosen: prose lives only in versioned packs. An empty line would leave "move hint" with no guidance, drop the decision block's restatement of the never-answer rule, and change old sets.
- **A new `feedback` move in contracts.** This would add `'feedback'` to `PedagogyDecisionSchema.move` (`packages/contracts/src/turn.ts:200`), which flows into the trace (`trace.ts:19`). It would also need:
  - a `MAX_OUTPUT_TOKENS` entry;
  - updates to `HINT_MOVES` and `TEACHING_MOVES` (generate) and to `JUDGED` and `DELIVERS` (grounding);
  - a review of `CLOSED_MOVES` and the web client.
  Not chosen: a contracts change across many readers for one line of text. Revisit if feedback needs a different budget, guard path or UI event.
- **A required `move-feedback` section.** Not chosen: sets 1.0.0 and 1.1.0 would stop loading, but traces name them and the seed pins 1.1.0.
- **Show a points total (C).** Not chosen for now (Decision 4).
- **Exactly one fix (D).** Not chosen: it hides other unmet rubric lines, which lowers agreement in the partial band, and it means changing a signed 1.0.0 line.
- **Bump the seed inside 5.7 (A).** Not chosen: `packages/db` is out of the plan's bounds and in use by another task, and the seed must not pin packs that aren't signed yet.

## Consequences

- Phase A now also touches `packages/harness/src/pedagogy/promptPacks.ts` and `compose.ts`, plus their tests:
  - `promptPacks.test.ts`: a frame without `move-feedback` loads; an empty one, or one with a placeholder, fails. The frame-keys check at line 81 becomes "required sections, plus `move-feedback` when present".
  - `compose.test.ts`: with the section, a feedback turn shows `[[MOVE-FEEDBACK]]` and not `[[MOVE-HINT-1]]`. Without it, the prompt is the same as today. A coach hint at rung 1 still gets hint-1.
  - `packages/content` snapshot test: `SET_VERSION` becomes 1.2.0 and the `.snap` is regenerated. A new check says every real set whose feedback pack is newer than 1.0.0 has `move-feedback`, so the fallback can never hide a missing line in a new set.
  - Re-run the pedagogy, leak and locked suites (build plan § Prompt packs). Phase B's mechanism test checks the composed feedback prompt for both the no-execution clause and `[[MOVE-FEEDBACK]]`.
- Feedback turns still go out as `move: hint`, so generate still sends `hint_rung` with rung 0 (`generate.ts:174`), and the chat stores it (`turnState.ts:81`). Low-priority follow-up: send `hint_rung` only for rung > 0, or have the 9.5 screen ignore rung 0.
- With no score in replies, feedback turns give the mastery model (build plan § Learner model, "scored evidence ... rubric feedback") no number until a structured scorer exists.
- Two things outside 5.7 block the live 70% run:
  - `edmate eval --record` has no agent to test (`unwiredAgent`, `apps/cli/src/commands/eval.ts:123`);
  - `edmate chat` uses the alphabetically first set, which is 1.0.0 (`apps/cli/src/commands/chat/world.ts:94`).
  Whichever task wires the eval agent must pin set 1.2.0, or the highest version.
- Changing any of this takes a new pack or frame version, a new set and an ADR that supersedes this one.

## Reviewers

architect, security-reviewer, typescript-reviewer. code-reviewer for the prompt-pack and pedagogy paths (MVP-first, human decision 20 Oct 2026). A named human signs `feedback@1.1.0`, `frame@1.1.0` and `set@1.2.0` before the seed moves (the lead raises this in blockers). Logged risk: high.
