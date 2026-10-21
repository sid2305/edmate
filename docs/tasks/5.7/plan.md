# 5.7 · Feedback skill: rubric feedback on answers, essays and code (no execution)

Board: `python3 .claude/skills/board/board.py show 5.7` · Milestone M5 · deps: 1.8, 5.5, M3 (all done) ·
branch `m5/5.7-feedback-skill` · risk: not flagged on the board, but touches a risk-paths.txt group (see below).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Feedback skill: rubric feedback on answers, essays and code (no execution)"
Accept: "≥ 70% agreement with the demo teacher's rubric scores on its 30 samples."

### How it will be shown
Same pattern as 4.7's "≥ 95% of uncovered questions go to `ask_teacher`" bar (see
`packages/evals/src/groundingFixtures.test.ts`'s header comment): the **mechanism** — skill
routing, the no-execution prompt clause, never-rewrite behaviour — is proved in CI on fixtures
(no live model calls, rule 4). The **70% number itself** needs a live model and is recorded in the
handoff as `edmate eval evals/suites/feedback --record --report <path>` run behind `--live`
against the pilot's two providers, with the resulting pass rate pasted into the handoff — exactly
how 4.7's 95% bar is handled, not a new CI-enforced threshold. This is logged as a Decision below,
not an open question, since it follows an existing precedent in this codebase.

## Design (what already exists vs. what this task adds)

Already built, reused unchanged:
- `packages/harness/src/pedagogy/skills.ts`'s `case 'feedback'` already routes every feedback-skill
  turn to `move: 'hint'`, never `finalAnswer`.
- `content/prompt-packs/feedback@1.0.0.md` already exists, reviewed, and says "never rewrite...
  point to the rubric line; don't do." It does **not** yet say anything about not running the
  student's code — the gap this task's "(no execution)" title closes.
- `content/demo-teacher/rubric-answers/*.yaml` (task 1.8, 30 samples across 5 modules) is the gold
  fixture data for the 70% check — 1.8's plan says explicitly "this task does not implement the
  feedback skill or its ≥70% agreement check," i.e. this is 5.7's to build.
- `packages/evals` (3.12): `runSuite`/`runCase` already return `{ passed, failed }` per suite,
  cases already support a `skill` field and `judge: [...]` yes/no statements
  (`packages/evals/src/schema.ts`), `suites.ts` auto-discovers any new suite folder with no
  registration needed. **No changes to `packages/evals/src/runner.ts`, `schema.ts` or `suites.ts`.**
- The numeric-claim recompute in replies (`packages/harness/src/pipeline/generate/numbers.ts`,
  already built for grounding, 4.7) already runs on every reply, feedback included — no new
  numeric-check code needed for "no execution".

What this task adds:
1. **Phase A** — close the no-execution gap in the feedback prompt pack (bump to 1.1.0, matching
   how `practice@1.1.0` added its own "never run the item's code, trace it aloud" clause for
   code-output items) and the compose/snapshot tests that pin pack versions.
2. **Phase B** — 30 `evals/suites/feedback/*.yaml` cases, one per rubric-answer sample, each
   posing the sample's `studentAnswer` as a `skill: feedback` turn with a `judge` statement
   translating the gold `score`/`maxScore`/`rubricNotes` into an observable agreement claim
   (banding scheme below), plus a fixtures test proving the mechanism (not the 70% number) in CI.

### Banding scheme (open question 1 below has the full write-up)
Recommendation: three bands by `score / maxScore` — **high** (≥ 0.75): judge statement says the
reply treats the answer as meeting the rubric with no fix named; **partial** (0.25–0.75): judge
statement says the reply names at least one specific unmet rubric point while crediting what's
right; **low** (< 0.25): judge statement says the reply identifies the answer as not meeting the
rubric and never implies it's correct. Each `rubricNotes` string already names the specific
mistake tag/fix (see `content/demo-teacher/rubric-answers/loops.yaml`), which the judge statement
should reference loosely (not quote verbatim, so the judge checks understanding, not keyword echo).

## Phase A — prompt pack: close the no-execution gap

### Budget
~55 tool calls, one package pair: `content/prompt-packs/**` and the two snapshot tests that pin
pack versions (`packages/harness/src/pedagogy/compose.snapshot.test.ts`,
`packages/content/src/__snapshots__/promptPacks.snapshot.test.ts.snap`). No new guards, no
contracts change.

### Allowed tools
Read, Grep, Glob, Edit, Write, Bash (`corepack pnpm turbo run typecheck lint test
--filter=@edmate/harness... --filter=@edmate/content...`, `python3 .githooks/secret-scan.py --all`).

### Files to create/modify
- `content/prompt-packs/feedback@1.1.0.md` (new) — adds an explicit clause: never run, execute,
  trace, or predict the output of submitted code; judge code only by reading it against the
  rubric, same as the existing essay/answer rule. Keep every existing 1.0.0 line. `reviewed_by:
  pending` (matches `PENDING_REVIEWER` in `packages/evals/src/suites.ts` and `set@1.1.0.yaml`'s
  own `reviewed_by: pending` — an established placeholder in this repo, not a new convention).
- `content/prompt-packs/set@1.2.0.yaml` (new) — copies `set@1.1.0.yaml`, bumps only `feedback:
  1.1.0`; `reviewed_by: pending`.
- `packages/harness/src/pedagogy/compose.snapshot.test.ts` — update/regenerate the snapshot(s)
  that compose the feedback pack or reference the pack set version, if any pin `1.1.0`/`1.2.0`.
- `packages/content/src/__snapshots__/promptPacks.snapshot.test.ts.snap` — regenerate if it
  snapshots `feedback@*.md`'s parsed content.
- `packages/content/src/promptPacks.test.ts` / `packages/harness/src/pedagogy/promptPacks.test.ts`
  — read first; update only if they pin a specific feedback/set version number.

### Files out of bounds
- `content/prompt-packs/feedback@1.0.0.md` itself — left in place (old version), never edited.
- `packages/contracts/**`, `packages/db/**`, `apps/web/**` — untouched.
- `packages/harness/src/pedagogy/skills.ts`'s `selectSkill`/`skillStep` logic — unchanged; the
  existing `case 'feedback'` routing already fits (see Design).
- `evals/**` — Phase B's job.

### Tests first
1. Read `packages/harness/src/pedagogy/compose.snapshot.test.ts` and
   `packages/content/src/promptPacks.test.ts` to find every place `feedback` or the pack `set`
   version is pinned.
2. Write the new prompt pack and set file; run the snapshot tests — they fail (old snapshot).
3. Regenerate snapshots deliberately (read the diff, don't blind-accept) until green.
4. `edmate content validate` (if it covers `content/prompt-packs/**`) still passes.

### Exit conditions
- Done: `feedback@1.1.0.md` and `set@1.2.0.yaml` exist with the no-execution clause;
  `typecheck lint test --filter=@edmate/harness... --filter=@edmate/content...` green; secret scan
  clean; handoff shows the new file and the regenerated snapshot diff.
- Stop and write `Status: PARTIAL`: past ~55 calls, or if more than the two snapshot files above
  need changes.

## Phase B — 30-case feedback eval suite + mechanism test

### Budget
~85 tool calls, one package: `evals/suites/feedback/**` (30 new YAML files, content-authoring, not
code) plus one new test file in `packages/evals/src`. No changes to `packages/evals/src/runner.ts`,
`schema.ts` or `suites.ts` (all reused as-is, confirmed in Design above).

### Allowed tools
Read, Grep, Glob, Edit, Write, Bash (`corepack pnpm turbo run typecheck lint test
--filter=@edmate/evals... --filter=@edmate/harness...`, and, only for the live evidence step,
`edmate eval evals/suites/feedback --record --report <path>` behind `--live` with a real key —
never in the automated test suite).

### Files to create/modify
- `evals/suites/feedback/feedback-<rubric-answer-id>.yaml` × 30 — one per entry across
  `content/demo-teacher/rubric-answers/{variables,loops,lists-dicts,functions,conditions}.yaml`.
  Each: `id: feedback-<ra-id>`, `suite: feedback`, `package:` one of the demo teacher's packages
  that includes the `feedback` skill (check `content/demo-teacher/packages/paid.yaml`'s `skills`),
  `reviewed_by: pending`, `source: content/demo-teacher/rubric-answers/<module>.yaml#<ra-id>`, one
  turn: `skill: feedback`, `student: <the sample's studentAnswer, framed as "Here's my answer to
  <question text from question-bank>: <studentAnswer>">`, `expect.judge: [<banded statement, see
  Design>]`, and (for the low/zero-score, full-rewrite-temptation samples especially)
  `expect.must_not_contain` phrases that would mean the reply wrote the corrected code/answer for
  them (mirrors `feedback@1.1.0`'s "never rewrite" rule, same style as leak/locked suites' checks).
- `packages/evals/src/feedbackFixtures.test.ts` (new) — modelled on
  `packages/evals/src/groundingFixtures.test.ts` / `adviceFixtures.test.ts`: loads all 30 cases
  with `loadCasesFromDir`, proves the **mechanism** on stubbed doubles (not a live judge) —
  `skillStep`/`selectSkill` picks `feedback` + `move: 'hint'` for each case's turn; the composed
  system prompt for a `feedback`-skill turn contains the no-execution clause (string check); a
  stubbed "good" reply (points to rubric, no rewrite) passes every case's static checks, a stubbed
  "bad" reply (a full rewritten/corrected version) fails them. Does **not** assert the 70% number
  (see Acceptance's "How it will be shown" — that's a live, recorded run, not a CI gate).
- `docs/tasks/5.7/handoff.md` (builder) — pastes the `edmate eval evals/suites/feedback --record`
  pass-rate evidence per the Acceptance section.

### Files out of bounds
- `content/demo-teacher/rubric-answers/**` — read-only fixture source; never edited by this task.
- `evals/suites/{safety,locked,leak,grounding,advice,persona}/**` — other suites, untouched.
- `packages/evals/src/runner.ts`, `schema.ts`, `suites.ts` — reused unchanged (Design above);
  if the builder finds a real need to touch one of these, stop and flag it (scope creep beyond
  this plan, likely needs a quick architect check).
- `packages/db/**`, `apps/web/**` — out of scope per the lead's brief; if content authoring turns
  out to need a DB seed or a web screen, stop and say so rather than touching those packages.

### Tests first
1. Write 2-3 representative cases (one high, one partial, one low score) and
   `feedbackFixtures.test.ts`'s mechanism assertions against them; confirm red (no clause yet if
   Phase A hasn't merged, or no cases yet).
2. Fill in the remaining 27 cases, covering all 5 modules and a spread of scores.
3. Green: `typecheck lint test --filter=@edmate/evals... --filter=@edmate/harness...`.
4. Live evidence step (not part of the automated gate): run `edmate eval
   evals/suites/feedback --record --report docs/tasks/5.7/live-report.json` behind `--live`,
   paste the pass rate into the handoff.

### Exit conditions
- Done: 30 cases exist and validate (`loadCasesFromDir`/`validateSuites` rules: file name =
  id.yaml, id starts with `feedback-`, package allowed, `reviewed_by` present);
  `feedbackFixtures.test.ts` green; the live pass-rate evidence is in the handoff (even if a
  human has to run the live step afterwards — flag that clearly if the builder has no live key).
- Stop and write `Status: PARTIAL`: past ~85 calls, or if fewer than 30 cases can be written
  cleanly within budget (commit what's done, note the remaining count).

## Risky paths touched

Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- **Phase A**: `content/prompt-packs/**` and `packages/harness/src/pedagogy/**` (the snapshot
  test file lives under `pedagogy/`) → both fall under the "Student safety and teaching behaviour"
  group → **reviewers: code-reviewer** (MVP-first exception, human decision 20 Oct 2026; full
  `safety-reviewer` waits for the pilot gate, task 13.3). Plans a `### 5.7 Phase A ... risk: high`
  decision entry in the handoff, per rule 6.
- **Phase B**: `evals/suites/feedback/**` and `packages/evals/src/feedbackFixtures.test.ts` — not
  listed in risk-paths.txt (only `evals/suites/safety/**` and `evals/suites/locked/**` are). **None**
  for Phase B.
- `packages/contracts/**`, `docs/adr/**` — untouched; no ADR needed (the `Skill` enum already
  includes `'feedback'`; nothing added to any frozen contract).
- `packages/harness/src/access/**`, `packages/payments/**`, `apps/web/**`, `packages/db/**`,
  `.claude/**`, `.github/**`, `.githooks/**` — untouched by either phase.

## Decisions (to copy into each phase's handoff `## Decisions`)

- **5.7 The 70% bar is shown live, not CI-gated** · planner · risk: low. Why: matches the existing
  precedent in `groundingFixtures.test.ts`'s header comment for 4.7's "≥95%" bar — a live-model
  quality number is recorded as evidence at a gate, not reproduced deterministically in CI (rule
  4: no real model calls in tests). Reversible: yes, once M7's quality gate (7.4) exists, this
  suite could be wired into it the same way other suites are.
- **5.7 Phase A bumps only `feedback`, not the whole pack set, to 1.1.0** · planner · risk: low.
  Why: matches how `practice@1.1.0` was introduced in 5.6 — a new `set@1.2.0.yaml` with one pack
  bumped, not a rewrite of unrelated packs. Reversible: yes.

## Open questions (lead can decide; recommendations below so neither blocks the build)

1. **Judge-statement banding scheme for the 30 cases.** No spec gives an exact mapping from a
   `{score, maxScore}` pair to an observable judge statement. Recommendation: the three-band
   scheme in Design above (≥0.75 high / 0.25–0.75 partial / <0.25 low), written by eval-author,
   each case's `reviewed_by: pending` until a named human signs off (never filled in by a builder
   or planner, per CLAUDE.local.md). This is content authoring, not a contracts or architecture
   decision, so no architect phase is planned; flag here only because the scheme shapes what
   "agreement" means.
2. **Who runs the live `--record` evidence step, and when.** The builder may have no live
   provider key in its worktree. Recommendation: the builder writes the suite and the mechanism
   test, and hands off with "live evidence: not yet run, needs a key" if so; the lead (or a
   follow-up task) runs the recorded pass-rate check before M5's exit gate, same as other
   live-dependent accept criteria in this build plan (e.g. 3.3's "reviewed by a named human",
   4.7's own 95% bar). Not a hard blocker for merging Phase A/B's mechanism work.

## Lead answers
(none yet — plan is READY to build on the recommendations above if the lead doesn't weigh in)

## Lead answers (21 Oct 2026)
1. **Banding and sign-off.** Use the recommended 3-band scheme. Under MVP-first (human, 20 Oct 2026) the lead signs eval cases, so the 30 cases carry `reviewed_by: lead`, not `pending`. The prompt pack `feedback@1.1.0` still needs a named human: it stays unsigned in the build, and the lead raises the sign-off in blockers once Phase A is reviewed. Never fill in a reviewer name.
2. **Live agreement number.** CI proves the mechanism on fixtures (rule 4). The live `--record` run that shows the 70% figure needs a real key, so the lead raises it to the human after merge, as with B-24. It doesn't block the merge.
3. **Phase A author.** Phase A is a prompt-pack change, so `pedagogy-author` (opus) writes the pack and the set; a builder updates the pinned snapshots in the same phase.

## ADR 0012 amends Phase A (21 Oct 2026, lead)
The architect's ADR 0012 resolves the hint-1 clash and the open points A–D. Phase A now covers:
- `docs/adr/0012-feedback-pack.md`: the architect's text, saved word for word (the lead hands over the draft).
- `content/prompt-packs/`:
  - `feedback@1.1.0.md`: the pedagogy-author draft, plus the C line (no score; verdict in words) and the D line (a fix only for a missed rubric line).
  - new `frame@1.1.0.md`: `frame@1.0.0` plus an optional `## move-feedback` section.
  - `set@1.2.0.yaml`: bumps feedback **and** frame.
  - All three carry `reviewed_by: pending`.
- `packages/harness/src/pedagogy/`: `promptPacks.ts` (`move-feedback` is the only optional frame section), `compose.ts` (feedback + hint + a frame with the section → that move line; otherwise unchanged) and their tests. `skills.ts` doesn't change.
- `packages/content/src/promptPacks.snapshot.test.ts`: `SET_VERSION` 1.2.0, the `.snap` regenerated, and a check that every set with feedback newer than 1.0.0 has `move-feedback`.
- Out of scope: the seed bump in `packages/db` (a follow-up after the named human sign-off), and wiring `edmate eval --record` / `chat` to set 1.2.0.
- Reviewers: architect, security-reviewer, an opus typescript-reviewer and code-reviewer. risk: high.
