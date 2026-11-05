# Task 7.3a handoff: Hindi/Hinglish variants for the per-agent suite generator's locked templates

Branch: `m13/7.3a-locked-template-languages`. Plan: `docs/tasks/7.3a/plan.md`.

## What changed

- `packages/evals/src/perAgentSuite.ts`: added `LOCKED_LANGUAGES`/`LockedLanguage` (`'en' |
  'deva' | 'hi-latin' | 'hinglish'`); restructured `MODULE_MESSAGES` from `template -> fn` to
  `template -> language -> fn`; the locked-case generation loop now emits all four language forms
  for every non-`direct` template x locked module, suffixing the case id with `-deva` /
  `-hi-latin` / `-hinglish` (English keeps its existing unsuffixed id). `direct` cases are
  untouched, per Design §3 (out of scope). `lockedExpect` (the shared `Checks` object) is reused
  unchanged across all four languages.
- `packages/evals/src/index.ts`: exports `LOCKED_LANGUAGES` and `type LockedLanguage` alongside
  the existing `perAgentSuite.js` exports.
- `packages/evals/src/perAgentSuite.test.ts` (tests written first, watched red, then implemented
  green): added the `LOCKED_LANGUAGES` list test; updated the 2-module/2-package world's locked-id
  lists (13-id and 27-id exact lists) to include the three new suffixed ids per template; added
  "writes each module-level template message in Devanagari, romanised Hindi and Hinglish, each
  distinct and matching its script" (summary/beta, four ids: `deva` matches `/[ऀ-ॿ]/`, `hi-latin`
  and `hinglish` don't, all four texts pairwise distinct, all four contain `beta`); added "keeps
  the same checks across all four language variants of a locked case" (outline/beta,
  `turns[0].expect` deep-equal across all four ids).
- `packages/evals/src/perAgentSuiteDemo.test.ts`: inline snapshot's `locked` count updated
  49 → 76 (40 `direct`, unchanged, + 3 templates x 3 locked modules x 4 languages = 36); added
  "includes locked cases in Devanagari, romanised Hindi and Hinglish" asserting all three suffixes
  appear among the demo teacher's generated locked ids — this is the task's acceptance line.

### Sibling test files (outside the plan's 4-file list, fixed with nucleus's go-ahead)

The plan scoped this task to 4 files, but didn't account for other `packages/evals/src/*.test.ts`
files that also call `generatePerAgentSuite` (on the demo content or a toy world) and hardcode the
resulting locked-case count. Changing that count from 49 to 76 (demo content) broke them. I
stopped and reported this to the lead before touching anything outside the 4-file list; the lead
authorized propagating the same, already-approved count change into these literals (not a new
design decision). Fixed:

- `packages/evals/src/qualityGateDemo.test.ts`: demo-content locked totals 49 → 76 at lines 67, 85,
  97 (and the derived `48/49` → `75/76`, `0/49` → `0/76`); `failedCaseIds` length 155 → 182 (line
  68, total cases = accuracy 106 + locked 76); the `stats` inline snapshot (lines 100-114)
  recomputed via `vitest -u` rather than by hand (agentCalls/cases/judgeCalls 155 → 182, totalCalls
  310 → 364, criticalPathCalls 80 → 93, estimatedSeconds 640 → 744 — these depend on the gate's own
  concurrency/critical-path math, not on arithmetic I should be deriving by hand).
- `packages/evals/src/scorecard.test.ts`: demo-content `locked_content` totals 49 → 76 and
  48 → 75 at lines 248-285 (including the test title and the `(48/49)*100` → `(75/76)*100` percent
  calc).
- `packages/evals/src/qualityGate.test.ts` (line 111-137, found only once the full suite was run,
  not just the two files the lead named): a toy 2-module world where a package locks both modules
  — "2 direct + 3 module templates" (5) becomes "2 direct + 3 module templates x 4 languages" (14).
  Updated the comment and the literal.
- `packages/evals/src/gateAdapters.test.ts` (line 88-103, same discovery): "feeds the generator end
  to end" asserted a 5-id locked list for one template set; added the three suffixed ids per
  template (summary/already-paid/outline), same pattern as the other id-list updates.

No other sibling file needed a change — `gateScope.test.ts`, `report.test.ts` and `suites.test.ts`
also reference `'locked'` but not a template-derived count, confirmed by running the full
`packages/evals` suite (2008 tests) to green with no other failures.

Nothing under `evals/suites/**` changed. No file outside `packages/evals/src/` touched.

## Test output summary

- `packages/evals` full suite: **33 test files passed (33), 2008 tests passed (2008)**.
- `perAgentSuite.ts` coverage: 100% statements/branches/functions/lines.
- Tests were written first and confirmed red (missing `LOCKED_LANGUAGES` export, old locked-id
  lists) before the implementation made them green.

## Gate command output

```
$ source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...
...
 Tasks:    18 successful, 18 total
Cached:    15 cached, 18 total
  Time:    4m27.252s
```
Exit code 0. PASS.

```
$ python3 .githooks/secret-scan.py --all
(no output)
```
Exit code 0. Clean.

## Decisions

1. Three new locked-template language forms (`deva`, `hi-latin`, `hinglish`) are defined precisely
   for this generator (Design §1), narrower than some existing hand-authored `-hi-latin` files'
   looser usage, so the generator's own three forms are mechanically distinct from each other.
   Planner, risk: low.
2. `direct` locked-template cases are not given language variants: their text is the answerable
   item's own question, not a generator template, and inventing or translating question text is
   out of scope. Planner, risk: low.
3. The locked-case `Checks` object (`must_cite_source`, `must_contain`, `judge`) is shared,
   unlocalized, across all four language variants of a case — only the student-facing message
   changes. Planner, risk: low.
4. English locked-template case ids keep their existing unsuffixed form; the three new forms
   append `-deva` / `-hi-latin` / `-hinglish`. Planner, risk: low.
5. The plan's Design §2 template wording (Design §2) was used verbatim, with no wording changes —
   checked the three real house-style files cited in the plan (`locked-functions-summary-deva.yaml`,
   `-hi-latin.yaml`, `leak-forged-note-hinglish.yaml`) and found the drafted strings already matched
   that register, so no refinement was needed. Builder, risk: low.
6. The plan's "Files to create / modify" list (4 files) missed that
   `packages/evals/src/qualityGateDemo.test.ts`, `scorecard.test.ts`, `qualityGate.test.ts` and
   `gateAdapters.test.ts` also hardcode locked-case counts derived from `generatePerAgentSuite`
   (on the demo content or a toy world), and broke once the locked count changed. Stopped and
   reported this to the lead rather than widening scope silently; lead authorized propagating the
   already-approved count change (49→76 demo content; 5→14 and 5-id→14-id toy-world cases) into
   those literals, as a mechanical consequence of the same approved change, not a new design
   decision. Builder, risk: low, lead-approved.
