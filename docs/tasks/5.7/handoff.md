# 5.7 handoff: feedback skill

## Status
PARTIAL: Phase A is done, as amended by ADR 0012. Phase B (the feedback eval suite and the live 70% run) is left.

- Branch: `m5/5.7-feedback-skill` (built on a local `work-5.7a` and pushed to it)
- Worktree: `.claude/worktrees/agent-a925fbcafd5c3601c`

## Files
- `docs/adr/0012-feedback-pack.md`: the architect's ADR, saved word for word.
- `content/prompt-packs/feedback@1.1.0.md`: the pedagogy-author draft, plus the ADR's Decision 4 line ("Never give a score, mark, grade or points total, even when the rubric has points. Give the verdict in words.") after the three-band verdict line, and the Decision 5 line ("Name a fix only for a rubric line the work misses; if it misses one line, name one fix.") after the "two or three fixes" line. It keeps the no-execution clause. `reviewed_by: pending`.
- `content/prompt-packs/frame@1.1.0.md`: `frame@1.0.0` unchanged except its header (`version: 1.1.0`, `reviewed_by: pending`), plus `## move-feedback` with the exact text from ADR Decision 1.
- `content/prompt-packs/set@1.2.0.yaml`: `set@1.1.0` with `feedback: 1.1.0` and `frame: 1.1.0`. `reviewed_by: pending`. Sets 1.0.0 and 1.1.0 are unchanged.
- `packages/harness/src/pedagogy/promptPacks.ts`: `move-feedback` joins `FRAME_SECTIONS` (no slots). New `OPTIONAL_FRAME_SECTIONS = ['move-feedback']`, which `parseFrame` skips in its missing-section check. A frame that has the section gets the same checks as any other section: empty, duplicate and unknown-placeholder. `PromptPackSet['frame']` makes that key optional.
- `packages/harness/src/pedagogy/compose.ts`: new `moveInstruction`. It returns `move-feedback` when `skill === 'feedback'`, `move === 'hint'` and the frame has the section. Otherwise it returns the same `moveSection` line as before.
- `packages/harness/src/pedagogy/index.ts`: exports `OPTIONAL_FRAME_SECTIONS` and `OptionalFrameSection`.
- Tests: `promptPacks.test.ts`, `compose.test.ts`, `packages/content/src/promptPacks.snapshot.test.ts` and its `.snap`.
- Not touched: `skills.ts`, `packages/contracts`, `packages/db` (the seed stays on 1.1.0), `apps/**` and evals.

## Tests
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

## Left to do (Phase B and follow-ups)
- Phase B: the feedback eval suite, including the mechanism test that the composed feedback prompt has the no-execution clause and `[[MOVE-FEEDBACK]]`, and the three-band judge statements.
- A named human signs `feedback@1.1.0`, `frame@1.1.0` and `set@1.2.0`. No agent fills in a name.
- A follow-up `packages/db` task moves the seed to 1.2.0 after the sign-off (ADR Decision 6).
- Wire `edmate eval --record` and `edmate chat` to set 1.2.0 (ADR Consequences).

## Deviations
None from the ADR. One detail: the ADR quotes the Decision 4 and 5 lines but doesn't say where they go in the pack. Each one sits right after the line it refines (see Decisions).

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
