# 5.9 · Revision skill

Board: `python3 .claude/skills/board/board.py show 5.9` · Milestone M5 · deps: 5.4, M3 (both done) ·
branch `m5/5.9-revision-skill` · risk: not flagged on the board; checked against risk-paths.txt below
(none touched).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Revision skill"
Accept: "notes and flashcards cite sources and cover only allowed modules."

### How it will be shown
A CI-only mechanism proof, same pattern as 4.7/5.7's fixtures tests (rule 4: no live model in
tests) — no live-quality number is named in this accept line (unlike 5.6/5.7's percentage bars), so
nothing here needs a `--record` step or a post-merge live evidence entry. The suite and its fixtures
test prove: (a) `decidePolicy` routes a `revision` turn to `move: 'explain'`, `skill: 'revision'`;
(b) `composeSystemPrompt` renders the revision pack's citation clause and `move-explain`'s "citing
[n]" line, and only ever includes chunks from the entitlement's allowed modules (`checkScope`'s
`LockedMaterialError`, already built, fires on a locked chunk — a mutation case proves this); (c) a
stubbed good reply (cites every point, no locked-module content) passes each case's checks, a stubbed
bad reply (uncited or naming a locked module) fails them.

## Design (what already exists vs. what this task adds)

Already built, reused unchanged:
- `packages/harness/src/pedagogy/skills.ts`'s `case 'revision'` already returns `move: 'explain'`,
  `skill: 'revision'` (`stepFor`, line 165-166) — no change.
- `content/prompt-packs/revision@1.0.0.md` already exists, **already reviewed** (`reviewed_by:
  sid2305`, a named human, not `pending`) and already says "source [n] on every point or card,"
  "never put anything from the do-not-say list," "about eight points or cards." No gap like 5.7's
  no-execution clause — **this task does not touch any prompt pack or the pack set**.
- `content/prompt-packs/set@1.1.0.yaml` already pins `revision: 1.0.0`; untouched by this task, so
  **no race with 5.7's `set@1.2.0.yaml`** (5.7 bumps `feedback` and `frame`; neither task edits the
  same file; 5.9 can build and merge independently of 5.7's state).
- `packages/harness/src/pedagogy/compose.ts`'s `checkScope` already throws `LockedMaterialError` if
  a retrieved chunk is outside the entitlement (ADR-0003, access filter by construction); `moveSection`
  already maps `move: 'explain'` to `move-explain`, which already says "cite [n]." No pedagogy code
  change needed.
- `packages/harness/src/access/**` (5.4, done) already filters retrieval to allowed modules, with its
  own property test (random entitlements → results ⊆ allowed modules). This task does not re-prove
  that; it only proves the revision skill doesn't bypass the composer's own defence-in-depth check.
- `content/demo-teacher/modules/*/notes.md` (5 modules) and `content/demo-teacher/packages/paid.yaml`
  (the only demo package with `revision` in its `skills` list) are reused unchanged, same as
  `groundingFixtures.test.ts`'s per-section chunk map — no new demo-teacher fixture file.

What this task adds:
1. `evals/suites/revision/*.yaml` — one case per module in `paid.yaml` (5) covering notes, plus
   2 flashcard-format cases, plus 3 edge cases (uncited reply, a reply naming a locked-module topic,
   an empty-material redirect) — **10 cases total**. `suite: revision`, `package: paid`,
   `reviewed_by: lead` (MVP-first lead sign-off, matches the 5.7 lead answer), `source:
   content/demo-teacher/modules/<module>/notes.md`.
2. `packages/evals/src/revisionFixtures.test.ts` (new) — modelled on `groundingFixtures.test.ts`'s
   chunk-map setup but mechanism-only (stubbed doubles, like 5.7 Phase B's planned
   `feedbackFixtures.test.ts`, not a full `runTurn`): builds the same per-section chunk map from the
   5 modules' notes, calls the real `decidePolicy`/`composeSystemPrompt` (both already exported from
   `@edmate/harness`) directly — no pedagogy file edits — and asserts:
   - a `revision`-skill turn composes with `move-explain` and the revision pack's "source [n]"
     clause present in the system prompt;
   - with only allowed-module chunks, the composed material block lists exactly those chunks,
     numbered, and a stubbed "good" reply (every point marked `[n]`, nothing from `do-not-say`)
     passes each case's `must_cite_source`/`must_contain` checks;
   - a stubbed "bad" reply (a flashcard or note with no `[n]`, or naming a topic from a module not
     in the chunk map) fails the case's checks;
   - **mutation**: a chunk from outside `paid.yaml`'s modules injected into the retrieved list makes
     `composeSystemPrompt` throw `LockedMaterialError` — proves revision doesn't bypass the access
     filter's defence-in-depth, without re-running 5.4's own property test.

## ADR and prompt-pack-set question (asked by the lead's brief)
- **No ADR needed.** Rule 2 requires an ADR only for a `packages/contracts` change or a prompt-pack
  **behaviour** change; this task edits neither `packages/contracts/**` nor any file under
  `content/prompt-packs/**` (revision@1.0.0 is already signed and unchanged) nor
  `packages/harness/src/pedagogy/**` (reused as-is). It is eval-content authoring plus one new test
  file in `packages/evals/src`, same shape as 5.7 Phase B.
- **Does not need to wait for 5.7.** 5.7 bumps `set@1.2.0.yaml` (feedback + frame); 5.9 touches no
  prompt pack and no set file at all, so there is no file overlap and no version race. 5.9 can be
  built, reviewed and merged in any order relative to 5.7.

## Budget (single phase)
~60 tool calls, two groups: `evals/suites/revision/**` (10 new YAML files, content authoring) and
`packages/evals/src/revisionFixtures.test.ts` (one new test file). Well under the ~130-call phase cap
and under 8 files total — no phase split needed.

### Allowed tools
Read, Grep, Glob, Edit, Write, Bash (`corepack pnpm turbo run typecheck lint test
--filter=@edmate/evals... --filter=@edmate/harness...`, `python3 .githooks/secret-scan.py --all`).

### Files to create/modify
- `evals/suites/revision/revision-<module>-notes.yaml` × 5 (one per `paid.yaml` module).
- `evals/suites/revision/revision-<module>-flashcards.yaml` × 2.
- `evals/suites/revision/revision-uncited-bad-en.yaml`, `revision-locked-module-bad-en.yaml`,
  `revision-empty-material-en.yaml` (edge cases) — 3.
- `packages/evals/src/revisionFixtures.test.ts` (new).

### Files out of bounds
- `content/prompt-packs/**`, `content/skills/**` — no version bump, no new pack; reused unchanged.
- `packages/harness/src/pedagogy/**`, `packages/harness/src/access/**` — read-only; no edits (both
  reused as-is per Design).
- `content/demo-teacher/**` — read-only fixture source; never edited.
- `packages/evals/src/runner.ts`, `schema.ts`, `suites.ts` — reused unchanged, same as 5.7's rule;
  stop and flag if a real need to touch one of these turns up.
- `packages/db/**`, `apps/web/**`, `packages/contracts/**`, `docs/adr/**` — untouched.

### Tests first
1. Write 2 representative cases (one notes, one flashcards) and the fixtures test's compose/citation
   assertions against them; confirm red (no cases/test yet).
2. Fill in the remaining 8 cases.
3. Green: `typecheck lint test --filter=@edmate/evals... --filter=@edmate/harness...`; secret scan
   clean.

### Exit conditions
- Done: 10 cases exist and validate (`loadCasesFromDir`/`validateSuites` rules); `revisionFixtures
  .test.ts` green, including the `LockedMaterialError` mutation case.
- Stop and write `Status: PARTIAL`: past ~60 calls, or if fewer than 10 cases can be written cleanly
  (commit what's done, note the remaining count).

## Risky paths touched
Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
**None.** `evals/suites/revision/**` is not a listed guard folder (only `evals/suites/safety/**` and
`evals/suites/locked/**` are), and `packages/evals/src/revisionFixtures.test.ts` is a new file under
`packages/evals`, which isn't in risk-paths.txt at all. No edits planned to
`packages/harness/src/pedagogy/**`, `content/prompt-packs/**`, `content/skills/**`,
`packages/harness/src/access/**`, `packages/contracts/**`, `docs/adr/**`, `.claude/**`, `.github/**`,
or `.githooks/**`. No `risk: high` decision entry is planned.

## Decisions (to copy into the handoff `## Decisions`)
- **5.9 no new prompt-pack version.** planner · risk: low. Why: `revision@1.0.0` already covers the
  accept criterion's wording ("cite sources," "cover only allowed modules" — the latter via the
  already-built access filter and composer's `checkScope`), unlike 5.7's "(no execution)" gap.
  Reversible: yes, a future task can still bump `revision` if a gap turns up.
- **5.9 cases carry `reviewed_by: lead`.** planner · risk: low. Why: matches the 5.7 lead answer
  (MVP-first, 20 Oct 2026) that the lead signs eval cases; `revision@1.0.0` itself is already signed
  by a named human, so there is no pending-pack sign-off to raise in blockers this time.

## Open questions (lead can decide; recommendations below so neither blocks the build)
1. **Only `paid.yaml` demonstrates "allowed modules."** No demo package mixes `revision` with a
   locked module (`free.yaml` has no `revision` skill at all), so "covers only allowed modules" is
   proven by (a) 5.4's own already-passing property test (reused, not rebuilt) and (b) this task's
   `LockedMaterialError` mutation case with a synthetic out-of-package chunk, not by a real
   locked-module eval case. Recommendation: accept this as sufficient for MVP; flag a possible future
   demo-teacher package (two tiers, one with `revision` and a locked module) as a nice-to-have, not a
   blocker.
2. **Case count (10).** The accept line names no number (unlike 5.6/5.7's 30-sample ties to 1.8's
   fixture data). Recommendation: 10 cases (5 modules × notes, 2 flashcards, 3 edge cases) is enough
   to exercise every module and both output shapes under MVP-first; can grow later without a
   contracts or pack change.

## Lead answers
(none yet — plan is READY to build on the recommendations above if the lead doesn't weigh in)

## Lead answers (21 Oct 2026)
1. Accepted for MVP: "allowed modules only" is proven by 5.4's property test plus a new LockedMaterialError mutation case. No real locked-module eval case.
2. 10 cases, as recommended, with `reviewed_by: lead`.
3. Build after 5.7 Phase B finishes, because both touch packages/evals.
