# 5.7 handoff: feedback skill

**Status:** DONE
DONE: Phase A (as amended by ADR 0012), the Phase A review follow-ups and Phase B (the feedback eval suite and its mechanism test).
Live evidence: not yet run, needs a key. The 70% agreement number comes from a live `edmate eval evals/suites/feedback --record` run, which the lead raises to the human after merge (plan, Lead answer 2).

- Branch: `m5/5.7-feedback-skill`. Phase A was built on a local `work-5.7a`, Phase B on `work-5.7b`; both were pushed to it.
- Worktrees: Phase A `.claude/worktrees/agent-a925fbcafd5c3601c`, Phase B `.claude/worktrees/agent-afe1735a23a4122e3`

## Phase B files
- `evals/suites/feedback/feedback-ra-<id>.yaml` × 32: one per rubric sample in `content/demo-teacher/rubric-answers/*.yaml` (7 values-variables, 6 loops, 7 conditions, 6 lists-dicts, 6 functions). Each case has `package: paid` (the package with the feedback skill), `reviewed_by: lead`, `source: <rubric file>#<sample id>` and one English `skill: feedback` turn. The student text is the sample's question and answer, word for word.
  - `must_not_contain`: `/4`, `out of 4`, `I ran`, `I tested`, `I executed` on every case. Partial and low cases also ban the fix or right value that sample tempts (for example `range(1, 11)` and `prints 9` for ra-lo-04, `return total` for ra-fn-05). No ban matches the student's own work or the question, so quoting them back is safe.
  - `judge`: three lines. (1) The band, from the gold score: high, the work meets the rubric with no fix named; partial, it partly meets it, crediting one line and naming one it misses; low, it doesn't meet it yet and nothing is called right. (2) The sample's own rubric points, phrased loosely and never asking the reply to say what code prints. (3) No score, no "ran it" claim, no corrected work.
  - Bands: 13 high (4/4), 11 partial (1 to 3 of 4), 8 low (0/4).
- `packages/evals/src/feedbackFixtures.test.ts`: the mechanism test, on fixtures with no model calls (36 tests):
  - Each case is tied to its sample: the student turn holds the question and answer, and the first judge line opens with the band the gold score falls in. There is exactly one case per sample (≥ 30), all five modules are covered, every case is signed `lead` on `paid`, and `paid` includes feedback.
  - Routing: `decidePolicy` sends each case's turn (`message` and `skill_action`) to skill feedback, move `hint`, rung 0, no tools, no prompt keys.
  - The composed prompt from the real on-disk set 1.2.0 (feedback 1.1.0) contains the no-execution clause ("Never run, execute, trace or step through it") and `[[MOVE-FEEDBACK]]`, and not `[[MOVE-HINT-1]]` (ADR 0012, Consequences). Red check: on set 1.1.0 all 32 per-case tests fail.
  - The static checks aren't circular: a clean reply for the band passes every case. A hand-written bad reply per case (a score, a "ran it" claim, a corrected line or the right value) fails it. A score alone and a "ran it" claim alone each fail every case. Quoting the student's answer or the question back never trips a check.
  - `suites.test.ts` (the existing `validateSuites` check over every real suite, with reviewed cases required) passes with the new suite.
- Not touched: `packages/evals/src/runner.ts`, `schema.ts`, `suites.ts`, `content/demo-teacher/**`, other suites.

## Phase A review follow-ups (all fixed)
1. [MEDIUM] `promptPacks.snapshot.test.ts`: composed snapshots now cover set 1.1.0 (the seed's) and set 1.2.0. Set 1.1.0 keeps its old suite name, so its 46 entries are byte for byte main's: the snapshot diff against `origin/main` is `1574 insertions(+)`, no deletions. Set 1.2.0's entries sit under `on-disk prompt-pack set 1.2.0: composed-prompt snapshots` and equal Phase A's regenerated ones. A new check says a feedback turn on set 1.1.0 is still rung 0 with hint-1.
2. [LOW] `compose.ts` `moveInstruction`: `move-feedback` now also needs `p.rung === 0`. `compose.test.ts` checks that a feedback hint at rung 1 or 2 composes byte for byte as without the section (see Decisions).
3. [LOW] `promptPacks.ts`: the frame is cast to `PromptPackSet['frame']`.
4. [LOW] `promptPacks.ts` exports `RequiredFrameSection` (also from `pedagogy/index.ts`), and `compose.ts` `moveSection` returns it.
5. `docs/adr/0012-feedback-pack.md` Status: "Accepted (lead, 21 Oct 2026; architect, security-reviewer and typescript-reviewer approved)."

## Tests (Phase B, final)
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/content... --filter=@edmate/evals...` → `Tasks: 17 successful, 17 total` (harness 5010 passed, content 407, evals 971).
- The eval suite schema check is `packages/evals/src/suites.test.ts` (`validateSuites` over `evals/suites`, reviewed cases required); it passes. The repo has no separate script for it.
- `python3 .githooks/secret-scan.py --all` → clean.

## Phase A files
- `docs/adr/0012-feedback-pack.md`: the architect's ADR, saved word for word.
- `content/prompt-packs/feedback@1.1.0.md`: the pedagogy-author draft, plus the ADR's Decision 4 line ("Never give a score, mark, grade or points total, even when the rubric has points. Give the verdict in words.") after the three-band verdict line, and the Decision 5 line ("Name a fix only for a rubric line the work misses; if it misses one line, name one fix.") after the "two or three fixes" line. It keeps the no-execution clause. `reviewed_by: pending`.
- `content/prompt-packs/frame@1.1.0.md`: `frame@1.0.0` unchanged except its header (`version: 1.1.0`, `reviewed_by: pending`), plus `## move-feedback` with the exact text from ADR Decision 1.
- `content/prompt-packs/set@1.2.0.yaml`: `set@1.1.0` with `feedback: 1.1.0` and `frame: 1.1.0`. `reviewed_by: pending`. Sets 1.0.0 and 1.1.0 are unchanged.
- `packages/harness/src/pedagogy/promptPacks.ts`: `move-feedback` joins `FRAME_SECTIONS` (no slots). New `OPTIONAL_FRAME_SECTIONS = ['move-feedback']`, which `parseFrame` skips in its missing-section check. A frame that has the section gets the same checks as any other section: empty, duplicate and unknown-placeholder. `PromptPackSet['frame']` makes that key optional.
- `packages/harness/src/pedagogy/compose.ts`: new `moveInstruction`. It returns `move-feedback` when `skill === 'feedback'`, `move === 'hint'` and the frame has the section. Otherwise it returns the same `moveSection` line as before.
- `packages/harness/src/pedagogy/index.ts`: exports `OPTIONAL_FRAME_SECTIONS` and `OptionalFrameSection`.
- Tests: `promptPacks.test.ts`, `compose.test.ts`, `packages/content/src/promptPacks.snapshot.test.ts` and its `.snap`.
- Not touched: `skills.ts`, `packages/contracts`, `packages/db` (the seed stays on 1.1.0), `apps/**` and evals.

## Tests (Phase A)
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/content...` → `Tasks: 14 successful, 14 total` (harness 5010 passed, content 379, contracts 348, config 42).
- `corepack pnpm turbo run typecheck --filter=...@edmate/harness` (everything that depends on harness) → `18 successful, 18 total`.
- `corepack pnpm turbo run test --filter=@edmate/evals --filter=@edmate/db --filter=@edmate/cli` → evals 935 passed, db 422 passed / 371 skipped, cli 83 passed.
- `python3 -m unittest discover -s docs/adr -p 'test_*.py'` → OK. `python3 docs/adr/check-headings.py` → no output, exit 0.
- `python3 .githooks/secret-scan.py --all` → clean.
- New harness tests:
  - `promptPacks.test.ts`:
    - `move-feedback` is the only optional section.
    - A frame without it loads, and the frame has no such key.
    - A frame with it loads, trimmed.
    - An empty section, one with a placeholder, or a duplicate fails.
    - Every other section stays required.
    - The fixture-keys check (old line 81) is now "required sections only".
  - `compose.test.ts`:
    - With the section, a feedback hint turn shows `[[MOVE-FEEDBACK]]` and not `[[MOVE-HINT-1]]`.
    - Without it, the prompt still uses hint-1, and it matches the with-section prompt except for the move line.
    - A coach hint at rung 1 or 2, a practice hint, a feedback turn on any other move, and the fallback all give byte-identical prompts with or without the section. A coach hint at rung 1 still gets hint-1.
- Content snapshot test:
  - `SET_VERSION` is 1.2.0. In the regenerated `.snap`, only the `skill feedback` case changes: the new pack lines, and the move line `[[MOVE-FEEDBACK]]` replaces hint-1.
  - New checks:
    - Every real set whose feedback pack is newer than 1.0.0 has `move-feedback`, and 1.2.0 is one of them.
    - The feedback turn on 1.2.0 has `[[MOVE-FEEDBACK]]`, no hint-1, and the no-execution clause.
    - Sets 1.0.0 and 1.1.0 still have feedback 1.0.0 and no `move-feedback`.

## Left to do (outside 5.7)
- The live `edmate eval evals/suites/feedback --record` run for the 70% figure. Live evidence: not yet run, needs a key. It also waits on the seed and `--record` moving to set 1.2.0 (below).
- A named human signs `feedback@1.1.0`, `frame@1.1.0` and `set@1.2.0`. No agent fills in a name.
- A follow-up `packages/db` task moves the seed to 1.2.0 after the sign-off (ADR Decision 6).
- Wire `edmate eval --record` and `edmate chat` to set 1.2.0 (ADR Consequences).

## Deviations
- Phase B has 32 cases, not 30: the demo teacher has 32 rubric samples, and the plan asks for one case per sample (see Decisions).
- Phase A: none from the ADR. One detail: the ADR quotes the Decision 4 and 5 lines but doesn't say where they go in the pack. Each one sits right after the line it refines (see Decisions).

## Decisions

### 21 Oct 2026 · 5.7 Phase A feedback pack 1.1.0 + frame move-feedback (ADR 0012) · decided by lead · risk: high
- Decided:
  - Feedback turns get their own frame move line, `move-feedback`, in a new `frame@1.1.0`. It is the only optional frame section. When present it gets the same checks as the other sections (not empty, no placeholders, no duplicates).
  - The composer uses it only when the skill is feedback, the move is hint and the frame has the section. Every other turn, and every turn on sets 1.0.0 and 1.1.0, composes exactly as before. `skills.ts` and `packages/contracts` don't change.
  - `feedback@1.1.0`:
    - never runs, traces or predicts the output of code;
    - never gives a score, mark, grade or points total, and gives the verdict in words in three bands (meets, partly meets, doesn't meet yet);
    - names a fix only for a rubric line the work misses.
  - `set@1.2.0` = set 1.1.0 with feedback 1.1.0 and frame 1.1.0. All three new files say `reviewed_by: pending` until a named human signs them.
  - The demo seed stays on 1.1.0 until a `packages/db` follow-up.
- Why:
  - The hint-1 line ("don't name the idea that solves it") clashed with the feedback pack ("describe the fix in words"). A separate, versioned move line removes the clash without a contracts change and without changing old sets, which traces and the seed still name.
  - Prose stays in the packs.
  - A model-written score is a numeric claim nothing can check, and it reads like an official grade.
  - Nothing on the platform can run code.
- Where the two new lines go: the ADR quotes them but doesn't place them in the pack. The builder put the Decision 5 line right after "pick the two or three most important fixes", and the Decision 4 line right after the three-band verdict line.
- risk: high (prompt-pack behaviour change: `content/prompt-packs/**` and `packages/harness/src/pedagogy/**`, under ADR 0012).

### 21 Oct 2026 · 5.7 Phase B feedback suite: 32 cases and the 3/4 band · decided by builder · risk: low
- Decided:
  - One case per rubric sample, so 32 cases, not 30. Task 1.8 asked for at least 30 and wrote 32; dropping two would drop real gold data.
  - A 3/4 sample is partial, not high. The plan's ranges overlap at 0.75 (high ≥ 0.75, partial 0.25 to 0.75). Each 3/4 sample's rubric notes name a missed line, and `feedback@1.1.0` names a fix for any missed line. So a "meets, no fix" judge line would mark the pack's correct reply as disagreeing. 1/4 (0.25) is partial, as the plan's "low < 0.25" says.
  - Judge lines never ask the reply to say what code prints or whether it errors (the no-execution rule). They ask for the rubric rule the work breaks instead.
- Why: the plan's mapping, kept consistent with the pack's behaviour.
- Reversible: yes. The band is the first judge line of each case.

### 21 Oct 2026 · 5.7 move-feedback only at rung 0 · decided by builder · risk: low
- Decided: `compose.ts` uses `move-feedback` only when skill is feedback, move is hint, rung is 0 and the frame has the section. A feedback hint at any other rung keeps the ladder line.
- Why: review follow-up 2. Of the two options (guard or a pinning test), the guard is the safer default. `skills.ts` always gives feedback rung 0, so no prompt changes today. A test covers rungs 1 and 2.
- Reversible: yes.

### 21 Oct 2026 · 5.7 snapshots kept for sets 1.1.0 and 1.2.0 · decided by builder · risk: low
- Decided: the content snapshot test composes every case on both sets. Set 1.1.0 keeps the original suite name, so its snapshot entries are unchanged from main; set 1.2.0 has its own suite name.
- Why: review follow-up 1. The seed pins 1.1.0, so its prompts must stay pinned until the seed moves.
- Reversible: yes.
