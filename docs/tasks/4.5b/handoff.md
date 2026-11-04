# Handoff: 4.5b

Status: PARTIAL (Phase A, packages/harness, done and green; Phase B, packages/evals / evals/suites/leak, left for the next builder — see Left to do)

## Summary

Added a paraphrase-detecting judge to the `answerLeak` post-guard (packages/harness only, per the
Phase A split). The regex/number/base64 matcher (`compileAnswerKeys`) still runs first and still
decides word, number and code leaks that quote or clearly restate the key. New: when that matcher
finds nothing and the turn's `mustNotReveal` holds a non-numeric (word or code) key
(`hasNonNumericKey`, `pipeline/generate/answerKey.ts`), a small-tier judge call checks whether the
reply paraphrases the key closely enough that a student would know the answer without it being
quoted. The judge's own request is fenced the same way `grounding.ts` fences its input (now a
shared `fencedToken()` helper in `pedagogy/modelRequest.ts`, with grounding switched to call it
too, byte-identical behaviour) with the turn's per-request random token, so neither the hidden key
nor a crafted reply can forge the closing marker and smuggle an instruction out of its own block.
A rewrite is re-checked by the same judge before it is accepted (mirrors adviceGuard's
rewrite-then-reverify); no answer from the judge at all — a timeout, a thrown error, or oversized/
malformed text — fails closed to `ANSWER_LEAK_SAFE_HINT`, never passing an unverified reply.
`postGuard.ts` wires a `leakJudge` into `PostGuardCtx` (the `judgeFor`/`leftOf('answerLeak')`
idiom, same as adviceGuard's judge and rewrite) and boosts `answerLeak`'s time-share weight
(`ANSWER_LEAK_JUDGE_WEIGHT = 5`) only on a turn whose `mustNotReveal` holds a non-numeric key, so
the extra judge call (and the rewrite's re-verify) have room in the guard's slice.

A non-circular fake judge, `paraphraseJudge` (`testing/leakJudge.ts`), decides its verdict purely
from the request's own fenced key/reply blocks (word overlap plus a small confirmation-marker
table, English and the same Hinglish/Devanagari list `answerKey.ts`'s own confirmation check
uses) — never from any test's or eval case's own expectation. `leakJudgeGateway` wraps a
`ModelGateway`, answering only the fixed-rubric judge request, passing everything else through.

Three pre-existing harness tests (`postGuard.test.ts`'s own-code-quote case,
`postGuard.advice.test.ts`'s mutual-fund-advice case) used a non-numeric `mustNotReveal` key with
no judge wired at the gateway level; they now trip the new judge path and failed against the bare
scripted gateway. Fixed by layering a clean-verdict `leakJudgeGateway` into their setup, the same
pattern `postGuard.grounding.test.ts` already uses for adviceGuard's judge — neither test is about
the paraphrase judge itself, so this is setup, not an assertion change.

## Decisions

### 4 Nov 2026 · 4.5b judge fallback only on a non-numeric-key regex miss · decided by builder · risk: low
- Decided: the judge is asked only when the matcher found no leak and `mustNotReveal` holds at
  least one key that is not a number, a number word or a label (`hasNonNumericKey`). An all-numeric
  turn, or any turn the matcher already caught, never calls the judge.
- Why: the plan's Q1 (no cheaper pre-filter exists yet for a paraphrase) and the existing numeric
  matcher already covers numbers reliably and cheaply; adding a judge call on every turn would cost
  latency and budget for no gain on the cases the regex already decides.
- Alternatives: judge every turn (rejected: wasteful, and widens the fail-closed surface for no
  reason); a cheaper heuristic pre-filter before the judge (rejected for now — no such heuristic
  exists yet; left as a possible later optimisation, not blocking this task).
- Reversible: yes — `hasNonNumericKey` is a pure, swappable predicate.

### 4 Nov 2026 · 4.5b judge outage fails closed, stricter than adviceGuard · decided by builder · risk: low
- Decided: when the judge gives no answer at all (times out, throws, or is unavailable) on the
  initial check, the guard returns `ANSWER_LEAK_SAFE_HINT` with reason `judge_unavailable`
  immediately — it never falls through to the rewrite path, and never passes the draft unchanged.
- Why: this guard protects the answer itself, the one thing the whole decision depends on
  `mustNotReveal` to withhold; adviceGuard's weaker exception (pass unchanged on a weak-signal-only
  outage) is reasonable there because advice is a softer harm than handing over the graded answer.
  The plan's lead review item 4 asks for "the stricter of the two existing patterns"; this is that.
- Cost applied (lead review item 4): an outage on a genuinely clean paraphrase now costs a real,
  always-safe tutoring turn (the hint instead of the actual reply) — accepted, because the
  alternative risk (a paraphrase the judge would have caught, passed straight through) is the
  answer leaking, which `mustNotReveal` exists specifically to prevent.
- Alternatives: adviceGuard's weak-signal exception (rejected: this guard has no "weak signal"
  tier — a non-numeric key either triggers the judge or it does not; there is no softer case to
  exempt); retry the judge once before failing closed (rejected: adds latency inside an already
  tight guard slice, deferred to a fix round if timeouts show up in practice).
- Reversible: yes — the fail-closed branch is a single early return.

### 4 Nov 2026 · 4.5b shared fencing extracted from grounding.ts, not duplicated · decided by builder · risk: low
- Decided: grounding.ts's private `fence()` helper is now the shared, exported `fencedToken()` in
  `pedagogy/modelRequest.ts` (where `breakFenceRuns()` already lives); `grounding.ts` calls it
  instead of its own now-deleted copy; `answerLeak.ts`'s judge request uses the same helper.
- Why: the plan's lead review item 3 asks for the same per-request random fence token grounding.ts
  already uses, reused rather than re-implemented, so a crafted key or reply can never forge the
  closing marker in either guard. `modelRequest.ts` already owns `breakFenceRuns()` and already
  imports `DATA_OPEN`/`DATA_CLOSE` from `compose.ts`; putting the shared function in `dataText.ts`
  instead would need `dataText.ts` to import from `modelRequest.ts`, creating a cycle
  (`dataText.ts` → `modelRequest.ts` → `compose.ts` → `dataText.ts`).
- Alternatives: a second, separately-written fencing function for answerLeak (rejected: duplicates
  logic the plan explicitly asked not to duplicate, and two copies drift over time).
- Reversible: yes — grounding.ts's own tests (byte-identical behaviour, unchanged) are the guard
  against a silent regression if this is ever un-shared.

### 4 Nov 2026 · 4.5b rewrite's time budget: the dynamic leftOf('answerLeak') idiom, not a fixed share · decided by builder · risk: low
- Decided: `rewrite` and the new `leakJudge` both draw their budget from `leftOf('answerLeak')`
  (what is actually left of the guard's slice after time already spent), the same idiom
  `adviceRewrite`/`adviceJudge` use, replacing the old fixed `share('answerLeak', REWRITE_SHARE)`.
- Why: up to two judge calls (the initial check, and the rewrite's re-verify) plus one rewrite can
  now run in one guard pass; a fixed fraction sized for one call alone would starve whichever call
  runs last. `REWRITE_SHARE` stays exported (re-exported from `pipeline/index.ts`) for anyone else
  still using it, but is no longer used in this guard's own budget computation.
- Alternatives: give the judge its own separate fixed share alongside `REWRITE_SHARE` (rejected:
  two fixed shares cannot both flex to however much of the slice the rewrite actually used).
- Reversible: yes — the budget functions are isolated to `postGuard.ts`'s `weightsFor`/`leftOf`.

## Red -> green evidence

Implementation and tests were written together rather than strictly test-first in every case
(deviation from the brief's step 3): the judge plumbing in `answerLeak.ts`/`postGuard.ts` was
drafted first because the rewrite-then-reverify and budget-sharing logic needed a concrete shape
before the test doubles (`testing/leakJudge.ts`) could be designed against it. Every test in
`answerLeak.test.ts`'s new `describe('answerLeak: the paraphrase judge (4.5b)', ...)` block,
`testing/leakJudge.test.ts`, the `hasNonNumericKey` block in `answerKey.test.ts`, and the new
`postGuard.leakJudge.test.ts` was run and failed (red) before the implementation was corrected to
make it pass (green) — several genuine bugs were caught this way, not just scaffolding:
- `answerLeak.ts`'s `if (!leaking) return OK;` discarded the judge's own usage on a clean verdict
  (`a clean judge verdict is ok, with its usage` failed, expected `[usageSmall]`, got `[]`) —
  fixed to return the accumulated usage.
- Two test cases used a reply that literally contained the single-word key ("warm"), so the
  existing regex matcher caught it before the judge ever ran (`reason: 'answer_key'` instead of
  `'paraphrase'`) — fixed by using a two-word key with its words apart and reordered in the reply,
  so the regex's contiguous-phrase match misses while the judge's own word-overlap rule still
  catches it (the real case this guard is for: a paraphrase, not a literal quote).
- `postGuard.test.ts`'s and `postGuard.advice.test.ts`'s pre-existing non-numeric-key cases failed
  against the bare scripted gateway once wired to the real `judgeFor(...)`; fixed by layering a
  clean-verdict `leakJudgeGateway` into their setup (not an assertion change).

## Gate

- `tsc --noEmit -p packages/harness/tsconfig.json`: clean.
- `eslint` on every touched/created file: clean (one `consistent-type-imports` fix applied along
  the way).
- `vitest run` (`@edmate/harness`): 134 files, 6140 tests, all passed.
- `vitest run --coverage` (`@edmate/harness`): exit 0; `src/guardrails/**` at 100%
  statements/branches/functions/lines (two tests added for `leakVerdictClean`'s oversized- and
  malformed-text branches, the only lines the new code had missed).
- `prettier --write` applied to the two new/changed test files that `--check` flagged; re-ran
  their tests after, still green.
- `python3 .githooks/secret-scan.py --all`: clean.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --filter=@edmate/evals`:
  `@edmate/harness` passes in full (typecheck, lint, test+coverage). `@edmate/evals` fails: 126
  tests in `packages/evals/src/leakFixtures.test.ts` now get the safe hint on cases that were
  clean before. Root cause: that suite's `runCase` helper (via `testDeps({ script: { stream:
  [...] } } })`) scripts exactly one small-tier stream response (`Fine: ${keys}`) for the
  rewrite call; the new `leakJudge` also sends a small-tier request (its initial paraphrase
  check), so it consumes that scripted slot first, gets non-JSON text back, reads as "not clean",
  and the case takes the rewrite path it should not take. This is the same class of fix already
  applied in this PR to `postGuard.test.ts`/`postGuard.advice.test.ts` (layer a clean-verdict
  `leakJudgeGateway` into the gateway chain before the scripted one), but `leakFixtures.test.ts`
  is `packages/evals`, out of this Phase's files-to-touch — left for Phase B below.
- Not run (needs a local DB, none running in this worktree; CI runs it): the `@edmate/cli`
  `chatDbRetrieval` integration test. Not touched by this change; named per the brief, not a new
  issue.

## Left to do (Phase B, packages/evals / evals/suites/leak — a separate builder)

1. **Blocking, found by this Phase A's own gate run**: `packages/evals/src/leakFixtures.test.ts`'s
   `runCase` helper needs a clean-verdict `leakJudgeGateway` (or `paraphraseJudge`, exported from
   `@edmate/harness`'s `testing/` barrel) layered into its gateway chain, the same way this PR
   layered one into `postGuard.test.ts` and `postGuard.advice.test.ts` — otherwise the new judge's
   small-tier call steals the scripted response meant for answerLeak's rewrite, and 126 previously
   clean cases get the safe hint instead. This must land before or alongside any new Phase B cases,
   or the whole suite stays red.
2. New eval cases (evals/suites/leak) that exercise a genuine word/code-key paraphrase: a leak that
   the regex matcher misses (no literal quote) but a real model would recognise as confirming the
   answer — these are the cases Phase A's judge exists for and the current suite has none of (its
   150 cases all route through the regex/number/base64 matcher or the mutation harness).
3. A judge-outage case (fails closed to the hint, `reason: 'judge_unavailable'`) and a
   judge-catches-a-paraphrase-the-rewrite-still-fails case, at the eval-suite level (the unit tests
   in this PR cover the guard's own logic; the suite should cover it end to end too, per the plan's
   own scope for Phase B).
4. Decide, and log as its own decision entry (append to this file's `## Decisions`, do not
   duplicate Phase A's four above), how the non-circular fake judge used by the eval runner
   (`paraphraseJudge` or a Phase-B-specific equivalent) should differ, if at all, from the unit
   test fake — Phase A's `paraphraseJudge` is tuned for synthetic unit-test replies and may need
   wider Hinglish/Devanagari coverage for realistic eval cases.

## Budget

Tool calls used: 61
