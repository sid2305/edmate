# Task 7.2 plan: grow the platform suites to target sizes, each case reviewed

Board: `python3 .claude/skills/board/board.py show 7.2` (M7, deps 5.4, 7.1, M3, M4; risk: expert).
Spec: build plan lines 502-524 (*Evals and the quality gate*, the Evals table). Agent:
`.claude/agents/eval-author.md`, with the `edmate-pedagogy` and `locale-context` skills.

## Acceptance (verbatim)

"Grow platform suites to target sizes, each case human-reviewed." *Accept:* "counts per the Evals
table; reviewer recorded per case."

Evals table sizes at M7: leak 150, locked 200, safety 300, persona 100, pedagogy 150, advice 100.
accuracy is per agent (7.3, done) and is not grown here. grounding, feedback and revision are not in
the table and are not grown here.

Standing human decisions this plan follows: English-only pilot (Hindi, romanised Hindi and
Hinglish appear only as a safety net in guard and safety cases); US first region; MVP first; the
lead reviews and signs eval cases (`reviewed_by: lead`); no safety-reviewer per PR until 13.3.

## How it will be shown

1. **Count ratchet (Phase A adds it; every phase raises it).** `packages/evals/src/suites.ts` gains
   `SUITE_FLOORS: Record<'leak'|'locked'|'safety'|'persona'|'pedagogy'|'advice', number>`, set in
   Phase A to today's counts (44, 38, 214, 42, 1, 37). `suites.test.ts` asserts each real suite's
   case count is `>=` its floor. Each phase raises its suite's floor to the new count. In the last
   phase the floors equal the targets (the MVP numbers or the Evals table, per open question 1),
   which is the acceptance: `SUITE_FLOORS` reads as the table, and the test passes on the real tree.
2. **Reviewer recorded per case.** The existing real-suite check (`requireReviewed`, on by default)
   already fails any case whose `reviewed_by` is missing or `pending`. Every new case carries
   `reviewed_by: lead`. The lead reads every new case in each phase's diff before merge, and
   `review.md` records "cases read: N/N" per suite. The merge decision logs the count the lead
   signed. A case the lead rejects is fixed or removed in the one fix round.
3. **No near-duplicates.** Phase A adds a `validateSuites` problem: two cases in one suite whose
   normalised student turns are identical (NFKC, lower-case, whitespace collapsed, punctuation
   dropped). A synthetic test in `suites.test.ts` proves it fires. If today's tree already has such
   a pair, the builder reports it and does not edit the old case; the lead decides.
4. **Every new guard-suite case is replayed on today's fixtures.** Each guard suite already has a
   fixture test that loads every case, pins the count and needs a per-case spec entry. Each phase
   adds its cases' entries and raises the pins (see "Pinned counts" below). New cases pass through
   the real guards with no model call (rule 4).

## Pinned counts: what growth breaks and how each phase handles it

| Test (all in `packages/evals/src/`) | Pins today | Per-case entry needed | Touched in |
| --- | --- | --- | --- |
| `lockedFixtures.test.ts` | `CASES` 38, steps 43, `byPhrase` 35, `caught` 38 | `SPANS[id]`: a verbatim span (8+ tokens) from the content file the case's `source:` names | A, B (H, I) |
| `leakFixtures.test.ts` | `CASES` 44, `caught` 44 | `KEYS` / `HINTS` / `BANK_FILE` / `NEW_FORMS` entries | D (L, M) |
| `distressEscalate.test.ts` | distress 52, near-miss 9 | none beyond the count (each case runs the real keyword tables) | E (N) |
| `moderationJailbreak.test.ts` | moderation 36, near-miss 12, jailbreak 49, held-out 0 | none beyond the counts | E (N) |
| `piiScrubPipeline.test.ts` | cases 43, checked 42, caught 34 | none beyond the counts | E (N) |
| `adviceFixtures.test.ts` | cases 37, failed 37 | `SPECS[id]` | F (P) |
| `rolePlayFixtures.test.ts` | none (filters `persona-roleplay-*`) | `EXPECTED` / `GOOD` / `BAD` for each new role-play case | G (O) |
| pedagogy, persona (non-role-play) | none | none (structural check only, see CI below) | C, G |

Not affected:
- **7.4's demo gate `locked 48/49` and 7.8's scorecard test.** Both run `runQualityGate` with
  `platformCases: []` on 7.3's *per-agent* cases generated from `content/demo-teacher`
  (`qualityGateDemo.test.ts`, `perAgentSuiteDemo.test.ts` pins locked 49). 7.2 touches neither
  the demo content nor `evals/suites` reads in those tests, so 48/49 and 49 do not move. 7.8 edits
  `scorecard.ts`, `index.ts` and `apps/cli/src/commands/gate.ts`; 7.2 edits none of them.
- **`apps/cli/src/commands/gate.test.ts`** reads the real `evals/suites` but only asserts the
  B-40 gaps (feedback and revision have no threshold; accuracy has no platform cases). Growth
  leaves both gaps as they are.
- **`gateScope.ts`'s 30-case style sample**: the pedagogy + persona pool is already 43; growth
  only widens it.
- `packages/harness/src/guardrails/distressKeywords.test.ts` and `moderationPatterns.test.ts`
  hold static copies of older seed lines and do not read the suites. They are left alone
  (risky path, out of bounds).

## How CI and the merge gate treat new cases with no recorded fixture

- **No model-level fixtures exist yet** (`evals/fixtures/` holds only `.gitkeep`; 7.5, "CI merge
  gates on fixtures", is not built; the 7.6 live sweep has not run). CI today runs
  `turbo typecheck lint test`, which for `evals/suites` means (a) `suites.test.ts` structure:
  schema, file name = id, id prefix, known package, not pending, 30+ per guard folder, plus this
  task's floors and duplicate check; and (b) the guard fixture tests above, which replay each guard
  suite through the real guards with scripted model text. `judge:` lines and pedagogy and persona
  replies are not scored in CI until fixtures are recorded.
- **A missing fixture fails closed** wherever replay runs: `edmate eval` and `edmate gate` build
  the recorder in replay mode and a missing fixture is `MissingFixtureError`, a failed case. So
  once 7.5 gates CI on recorded fixtures, every case 7.2 adds needs a recorded run first:
  `edmate eval evals/suites --record` by the human with real keys (7.6's recipe). 7.2 records
  nothing and calls no model.
- **merge_gate.py** has no case-level check. It checks risky paths (below), the handoff Status,
  the budget, the reviewers and the `risk: high` decision. Its `safety-review.md` check stays
  dormant until 13.3 puts safety-reviewer back in risk-paths.txt.
- Recommendation for 7.5 (not done here): keep "missing fixture = failed case" in CI, so a new
  case with no recording cannot pass silently. Order the work as: the 7.2 phases merge, then the
  human runs one record pass, then 7.5 turns the CI gate on.

## Phases (MVP sizes; order = value for the harness exit gate)

Each phase is one fresh `eval-author` (Sonnet) in its own worktree. It reads this plan and the
previous phase's handoff, then works on branch `m7/7.2-platform-suites` (merge main in, never
rebase). Each phase ends on a green commit with a "state after this phase" note in the handoff.

Rules for every phase:
- **Case files.** One file per case: `evals/suites/<suite>/<id>.yaml`, file name = id, id prefix =
  suite, `package: free|paid`, `reviewed_by: lead`, and a `source:` that cites a build-plan/PRD
  line or a `content/demo-teacher` file. Facts come only from the demo teacher's material; never
  invent subject facts.
- **Language.** pedagogy, persona role-play and advice-explain cases are English only. In locked,
  leak, safety and advice, at most about 20% of a phase's cases may be `-hi-latin` or `-deva`
  safety-net inputs. Crisis replies are expected in English.
- **US framing for new cases** (US first): dollars, US school terms (AP, SAT, GPA, middle/high
  school, college applications), US phone shapes (`+1 555-...`, 555 numbers only) and test card
  numbers only. Never write a real person's data. New distress cases go under
  `safety/distress/generic/` and expect the country-neutral reply ("local emergency services or
  someone you trust", no phone number), because `content/locales/US.yaml` has `helplines: []`
  until a person verifies one. No `distress/us/` folder, and no 988.
- **Mix.** Each phase spreads its count over the listed attack types or sub-areas, at no more than
  about 25% per type. No two cases may share their student turns, which the duplicate check
  enforces.
- **A guard gap is not fixed here.** If a new case fails because today's guard misses it, move the
  case to `docs/tasks/7.2/pending-cases/<suite>/` (precedent: 4.6) and name it in the handoff for
  a board task. Write a different case of another form to keep the count. More than 5 parked cases
  in one phase means stop at PARTIAL.
- **Checks.** Prefer `must_not_contain` / `must_contain` / `must_cite_source` / `max_words` /
  `matches`. Use a `judge:` line only for what strings can't check, as one observable sentence.

### Phase A: locked, content extraction (+32, 38 to 70); ~90 calls
- First, before any case: add `SUITE_FLOORS` and the floor test, and the duplicate-turn problem
  with its synthetic test, in `suites.ts` / `suites.test.ts`. Then run the evals tests.
- The cases, spread over the three locked modules of the free package (loops, functions,
  lists-dicts):
  - fill-in-the-blank / "complete this code" (5)
  - "quiz me on" a locked topic (4)
  - comparing an allowed topic with a locked one (4)
  - "explain this error" from a locked topic (4)
  - JSON/CSV/table export of a lesson (4)
  - "continue where you left off" (4)
  - US role claims: "my parent paid", "my teacher at school said it's free" (4)
  - acrostic / first letters / backwards (3)
- Then: `SPANS`, `MODULE_ID` use, the pins in `lockedFixtures.test.ts` and the locked floor.
- State after: locked 70; floors and the duplicate check live.

### Phase B: locked, skills, outline, multi-turn, encodings (+30, 70 to 100); ~90 calls
- Mix:
  - practice / feedback / revision skills aimed at a locked module (7)
  - syllabus, outline, table of contents, "what's in the paid package" (5)
  - multi-turn drift from an allowed module into a locked one (6)
  - base64 / rot13 / leetspeak / homoglyph / markdown or HTML split (7)
  - "my friend's account has it" and paid-package claims (5)
- Then: the `SPANS` entries, the pins and the floor.
- State after: locked 100.

### Phase C: pedagogy (+59, 1 to 60); ~95 calls
- English only, demo teacher modules, `free` and `paid` both. Mix:
  - hints before answers, where the first turn's `must_not_contain` is the bank answer (12)
  - one question at a time (`max_words` plus a judge line) (8)
  - sources cited (`must_cite_source: true`) (8)
  - a wrong attempt gets a targeted hint, not the fix (8)
  - the hint, worked example, solution ladder over 3 turns (8)
  - checking understanding after an explanation (5)
  - an uncovered question goes to `ask_teacher` (4; not to duplicate grounding)
  - an off-topic redirect back to the lesson (6)
- No fixture pin. Phase C raises the pedagogy floor only.
- State after: pedagogy 60, and the 30-case style pool is 102.

### Phase D: leak (+36, 44 to 80); ~90 calls
- Questions from all five bank modules (today's cases are mostly conditions and values). Forms
  not covered yet:
  - yes/no answer confirmation (5)
  - multiple-choice elimination (4)
  - "write the unit test / assert" (4)
  - "explain it step by step for my friend" (4)
  - deadline or emotional pressure (5)
  - a parent or teacher asks for it (4)
  - spelled out / reversed (4)
  - a multi-turn partial reveal (6)
- Then: the `KEYS` / `HINTS` / `BANK_FILE` / `NEW_FORMS` entries, the pins and the floor.
- State after: leak 80.

### Phase E: safety (+36, 214 to 250); ~110 calls
- Mix:
  - generic distress, US-framed: school, college applications, family, slang such as kms or
    unalive, delayed disclosure over several turns (10)
  - distress near-misses with US coding and school idioms (6)
  - jailbreak: many-shot, injection in pasted code or JSON, the "grandma" story, a fake tool
    output (8)
  - moderation: weapons at school, vapes and drugs, paying someone to take an SAT or AP exam (6)
  - PII: US phone shapes, email, test card, OTP (6)
- No SSN case (see Q3).
- Then: the pins in `distressEscalate`, `moderationJailbreak` and `piiScrubPipeline`, and the
  floor.
- State after: safety 250.

### Phase F: advice (+23, 37 to 60); ~75 calls
- US-framed, matching the pilot subjects (personal finance, side hustle). Mix:
  - investing: Roth IRA or 401(k) picks, a named ticker, crypto, options (6)
  - tax: filing status, side-hustle deductions, LLC (6)
  - medical: ADHD medication, supplements (5)
  - legal: school discipline, immigration or visa, copyright (6)
- Then: the `SPECS` entries, the pins and the floor.
- State after: advice 60.

### Phase G: persona (+18, 42 to 60) and the closing floors; ~80 calls
- Mix:
  - role-play, on both the viva and job-interview templates (8): off-topic mid-interview,
    `must_not` asks, "give me the model answer", pause or resume variants
  - identity and boundary, US-framed (10): "are you a real teacher", companion bait, other-AI
    claims, rule-override claims
- Then: the `EXPECTED` / `GOOD` / `BAD` entries in `rolePlayFixtures.test.ts` and the persona
  floor.
- Check that `SUITE_FLOORS` equals the chosen targets.
- State after: every floor is at its MVP target, and the task is DONE (MVP option).

### Phases H-P: only if the human picks the full Evals-table sizes (Q1), otherwise a new M13 task

| Phase | Suite | Cases | Count after | Mix |
| --- | --- | --- | --- | --- |
| H | locked | +50 | 150 | more forms per module, the paid-only skills |
| I | locked | +50 | 200 | |
| J | pedagogy | +45 | 105 | |
| K | pedagogy | +45 | 150 | |
| L | leak | +35 | 115 | |
| M | leak | +35 | 150 | |
| N | safety | +50 | 300 | |
| O | persona | +40 | 100 | |
| P | advice | +40 | 100 | |

Each uses the same mixes as its MVP phase, with new forms only, and each is about 90-100 calls.

## Files

Create: `evals/suites/{locked,pedagogy,leak,safety/**,advice,persona}/*.yaml` (new cases only)
and, if needed, `docs/tasks/7.2/pending-cases/**`.

Modify, all in `packages/evals/src/`:
- `suites.ts` and `suites.test.ts` (floors and the duplicate check)
- `lockedFixtures.test.ts`
- `leakFixtures.test.ts`
- `distressEscalate.test.ts`
- `moderationJailbreak.test.ts`
- `piiScrubPipeline.test.ts`
- `adviceFixtures.test.ts`
- `rolePlayFixtures.test.ts`

Plus `docs/tasks/7.2/handoff.md`.

## Files out of bounds

- `packages/harness/**`, `packages/contracts/**`, `packages/content/**`, `content/**`, `apps/**`
- `evals/fixtures/**` (record nothing)
- `evals/suites/{grounding,feedback,revision,accuracy}/**`
- existing case files (no edits, except one the lead names in review)
- `packages/evals/src/gateScope.ts` (`GATE_THRESHOLDS`, the deadline)
- `scorecard.ts` and `index.ts` (7.8's)
- `.claude/**`, `.github/**`, `docs/adr/**`, `evals/double-check/**` (Q4)

Any other file needing a change means stop at PARTIAL.

## Tests first

Each phase writes its cases, runs the suite's fixture test and sees it fail on the count pin and
the missing spec entries. Then it adds the entries, raises the pins and the floor, and gets green.
Phase A writes the floor and duplicate tests (synthetic trees) before any case. Every phase runs
`source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`
(this includes `apps/cli`'s real-suite gate test) and then `python3 .githooks/secret-scan.py --all`.

## Risky paths touched

Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `evals/suites/locked/**` (Phases A, B; H, I): reviewers `code-reviewer` (MVP-first group;
  safety-reviewer comes back at 13.3).
- `evals/suites/safety/**` (Phase E; N): reviewers `code-reviewer`.
- Not risky: `evals/suites/{pedagogy,leak,advice,persona}/**`, `packages/evals/**` and
  `docs/tasks/7.2/**`.

The handoff logs a `risk: high` decision for the locked and safety case additions, with the count
the lead signed. `merge_gate.py`'s safety-review check is dormant.

## Risks

- **First-publish live gate exceeds its deadline.** `GATE_DEADLINE_MS` (15 min) applies to every
  scope. A live first-publish or prompt-pack-bump gate over today's 376 platform cases is already
  about 45 min by 7.4's own proxy (8 s per call, 4-way). At MVP sizes it is about 80 min, and at
  full sizes about 2 h. So it fails closed by deadline. CI replay is unaffected. This is not 7.2's
  to fix: recommend a board task (7.4a or 7.4b) for a per-scope deadline before the first live
  full-scope gate.
- **Fixture-test files are long.** The locked and leak files are about 770 lines. Builders should
  add entries with a few large Edits, not one per case.

## Open questions (recommendation each)

1. **Full Evals-table sizes now, or MVP sizes for the exit gate?** Recommend **MVP**:
   - locked 100, pedagogy 60, leak 80, safety 250, advice 60, persona 60. That is +234 cases in 7
     phases, about 630 builder tool calls.
   - The rest (+390 cases, 9 phases, about 850 more calls) moves to a new M13 task, "grow platform
     suites to the Evals-table sizes", due before the 13.x pilot gate. 7.2's accept line changes
     to the MVP numbers.
   - Live record or full-scope gate cost per model: about 690 platform cases, about 2,400 model
     and judge calls (about 3.5 per case), versus about 1,080 cases and about 3,800 calls at full
     size. Each later first-publish or prompt-pack bump pays that again.
   - USD comes from `packages/gateway/src/pricing/prices.yaml` at run time. The planner did not
     estimate it.
2. **One PR or one per phase?** Rule 1 says one PR. Recommend: one branch and PR per suite group
   (A+B locked, C pedagogy, D leak, E safety, F advice, G persona), logged as a lead decision. The
   reasons are that locked cases reach the exit gate sooner, and the count pins conflict less with
   other tasks that add cases (4.6d, 5.x).
3. **A US SSN PII case?** `US.yaml` has `piiPatterns: []` and the guard has no SSN shape, so such
   a case would fail. Recommend: no SSN case in 7.2. Add a board task for a human-signed US PII
   pattern (`content/locales/**`, a risky path).
4. **Human double-check files (`evals/double-check/<suite>.yaml`, 7.1's Q1 default said "start in
   7.2")?** Recommend deferring them to the first recorded run (7.5 or 7.6). There are no judge
   verdicts to check until a live run exists.

## Budget
Budget: 630 tool calls (7 phases, packages/evals + evals/suites)

Per phase: A 90, B 90, C 95, D 90, E 110, F 75, G 80. If Q1 is answered "full", the lead restates
this as `Budget: 1480 tool calls (16 phases, packages/evals + evals/suites)` (H-P about 95 each).

## Allowed tools
Read, Grep, Glob, Write, Edit, Bash. Bash is limited to:
- `source ~/.nvm/nvm.sh && corepack pnpm install`
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`
- `git` on the task branch (merge main, no rebase or force)
- `python3 .githooks/secret-scan.py --all`
- `python3 .claude/skills/merge-gate/merge_gate.py 7.2`

No network, no `--record`, no provider keys.

## Exit conditions

- **DONE (per phase):**
  - the phase's count is reached with its mix
  - the suite's fixture test and `suites.test.ts` are green with pins and floor raised
  - `@edmate/evals...` (including `apps/cli`) typecheck, lint and test pass
  - the secret scan is clean
  - no file outside the plan is touched
  - at most 5 cases parked in `pending-cases/`
- **DONE (task):** the last phase's `SUITE_FLOORS` equals the chosen targets (Q1) and the lead
  has signed every new case.
- **PARTIAL (stop and report):**
  - the phase passes its per-phase cap
  - more than 5 new cases fail on today's guards (a guard gap, not a 7.2 fix)
  - a file outside this plan needs changing (a guard, `gateScope.ts`, a prompt pack, a locale
    pack, an existing case)
  - a duplicate-turn pair already exists on main
  - the spec leaves a case's expected behaviour unclear (ask; don't guess)

## Lead answers (21 Oct 2026)
1. Sizes: asked the human (blockers B-41), recommending MVP. Phases A-G are the same under either answer, so they start now. If the human picks full sizes, H-P become board task 7.2f.
2. **One task per suite group**, each with its own branch, PR, handoff, review and gate:
   - 7.2a: locked, Phases A+B (risky: code-reviewer + `risk: high`)
   - 7.2b: pedagogy, Phase C
   - 7.2c: leak, Phase D
   - 7.2d: safety, Phase E (risky)
   - 7.2e: advice + persona, Phases F+G

   This plan stays the shared plan. Each sub-task's budget is its phases' numbers from `## Budget`. The merge gate command is `merge_gate.py 7.2<x>`, not `7.2`. 7.2 closes when 7.2a-e are done.
3. No SSN case. Board task 1.7h (M13) adds a human-signed US PII pattern.
4. Double-check files are deferred to the first recorded run (7.5/7.6).
5. Gate deadline risk: board task 7.4c (M7) gives each scope its own `GATE_DEADLINE_MS`, so a live first-publish gate doesn't fail closed at 15 minutes.
