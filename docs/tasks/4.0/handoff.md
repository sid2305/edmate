# 4.0 handoff — seed eval suites

**Status:** 4.0b DONE (PR #29); 4.0a in review
**Branches:** `m4/4.0b-suites`, `m4/4.0a-safety-suites`

## 4.0b — leak, advice, persona, grounding + the suite validator

### Acceptance evidence

| Command | Result |
|---|---|
| `corepack pnpm turbo run test --filter=@edmate/evals --force` | `Test Files 10 passed (10)` · `Tests 118 passed | 5 skipped (123)` (the 5 skipped are 4.0a's guard folders, not yet seeded) |
| `EDMATE_REQUIRE_REVIEWED=1 vitest run src/suites.test.ts` (typescript-reviewer) | 15 passed, 5 skipped, 0 failed |
| `python3 -c` yaml.safe_load over `evals/suites/**` | 128 parse ok |
| `python3 .githooks/secret-scan.py --all` | exit 0 |

### Changes
- `packages/evals/src/suites.ts` + `suites.test.ts`: validate every case under `evals/suites/` against `EvalCaseSchema`, and enforce file name = id, suite = top folder, id prefix, a known demo package, unique ids, ≥ 30 per guard folder, and (opt-in) no `reviewed_by: pending`.
- `evals/suites/{leak,advice,persona,grounding}/`: 32 cases each (16 en / 10 Hinglish / 6 Devanagari), `reviewed_by: sid2305` after the human signed `review-sheet.md`.

## Decisions

### 18 Oct 2026 · 4.0 One human sign-off per suite, recorded on every case · decided by team lead (plan answer) · risk: medium
Decided: the human signs a one-row-per-suite review sheet (`docs/tasks/4.0/review-sheet.md`) instead of each case; cases say `reviewed_by: pending` until then and the lead sets the reviewer's handle on every case after sign-off. sid2305 signed 4.0b's four suites on 18 Oct 2026.
Why: 280+ files are too many to sign one by one; the accept line needs a reviewer per case.
Alternatives: sign each case; a reviewer field per folder.
Reversible: yes.

### 18 Oct 2026 · 4.0 A grounding suite of its own, and leak forms applied to the demo course · decided by team lead (plan answers Q1, Q3) · risk: low
Decided: `evals/suites/grounding/` is added for guard 4.7, separate from the per-agent `accuracy` suite (5.10/7.2). Leak cases apply the safety review's test forms (words, translation, base64, role-play, Devanagari digits) to the demo course's own answers rather than reusing an archived number.
Why: one folder per guard; the demo course is the fixture every test uses.
Alternatives: fold grounding into accuracy; reuse the archived course's numbers.
Reversible: yes.

### 18 Oct 2026 · 4.0 The reviewer and all-guards rules are opt-in until 4.0a lands · decided by builder (tdd-guide) · risk: low
Decided: `EDMATE_REQUIRE_REVIEWED=1` makes a pending reviewer fail and `EDMATE_REQUIRE_SUITES=1` makes an unseeded guard folder fail; by default both are off, so 4.0b could land before 4.0a. Turning the reviewer rule on by default is a follow-up in 4.0a.
Why: the two halves of 4.0 land in separate PRs.
Alternatives: one PR for all nine guards.
Reversible: yes.

### 18 Oct 2026 · 4.0 Content-review fixes: the real demo teacher name and narrower must-not-contain phrases · decided by team lead (code-reviewer's LOWs) · risk: low
Decided: persona cases name "Demo Teacher" (the seeded fixture) instead of an invented name; four advice cases use narrower `must_not_contain` phrases ("give them 500mg", "you should take this medicine", "you should take these diet pills") so a correct disclaiming reply can't fail them.
Why: the cases should match the real fixture and not fail a compliant agent.
Alternatives: leave them until the guards land (4.5–4.9).
Reversible: yes.
