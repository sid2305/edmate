# Handoff: 3.3a — Route follow-ups from the 3.3 review

Status: DONE

## Summary

Phase A — shared cancel/timeout/validate helper:
- `packages/harness/src/pipeline/guardedModelCall.ts` (new): `callGuarded<T>` races a call
  against a timeout on the injected clock, cancellable via the step's cancel token, validates
  the result against a zod schema, and maps each failure through a caller-supplied
  `GuardedCallErrors` so each caller keeps its own error classes and messages.
- `packages/harness/src/pipeline/guardedModelCall.test.ts` (new): direct unit tests for
  already-cancelled, mid-call cancel, timeout, rethrown call error, invalid-schema and the
  happy path.
- `packages/harness/src/routing/modelFallback.ts`: `askIntentModel` now calls `callGuarded`
  instead of repeating the race/validate wiring inline.
- `packages/harness/src/guardrails/safetyClassifier.ts`: `askClassifier` now calls
  `callGuarded` the same way, keeping the `guard` name in its error messages.
- Pinning check: `modelFallback.test.ts` and `safetyClassifier.test.ts` confirmed green before
  the refactor and pass unedited afterwards (same error types, same messages, same
  cancel-already-set short-circuit).

Phase B — classify.ts dedup, index.ts dead code, labelled-set additions:
- `packages/harness/src/routing/classify.ts`: `partMatched` now takes a `usedNums: Set<number>`
  of already-credited student-number indices; `classifyAttempt` threads one shared set across
  all key parts, so a duplicate answer-key part (e.g. `['3', '3']`) with only one matching
  student number counts once, not twice.
- `packages/harness/src/routing/classify.test.ts`: added the duplicate-part case
  (`answerKey: ['3', '3']`, student text `'3'`) asserting `'partial'`.
- `packages/harness/src/routing/index.ts`: `classifyTurn` drops the unreachable
  `|| text === undefined` clause (`classifyIntentByRules` already returns `confident: true` for
  empty/undefined text), rewritten as explicit branches (an early return for `rule.confident`,
  then an unreachable-but-type-satisfying `text === undefined` guard, then the model-fallback
  call) so the type checker accepts the narrower `text: string` without a non-null assertion.
- `packages/harness/src/routing/labelledTurns.ts`: added 5 new `distress` rows (English only,
  no helpline/contact/personal-data text), each individually checked against
  `classifyIntentByRules` (via a scratch test, removed before commit) before being added:
  - 2 soft rows (`route-201`, `route-202`): one soft keyword phrase each ("hopeless", "tired of
    everything... pointless"), no hard phrase, no combination-rule match — confirmed
    `distressKeywordLevel` returns `'soft'` and the rule returns `{ intent: 'on_task',
    confident: false }`.
  - 3 indirect rows (`route-203`–`route-205`): no keyword-table hit at all
    (`distressKeywordLevel` returns `'none'`) and no accidental MISUSE/ANSWER_SEEKING/META/
    OFF_TOPIC/ON_TASK match — confirmed the rule falls through to `{ intent: 'on_task',
    confident: false }`.
  - Updated the file's own bookkeeping comments (header count 200 → 205; category 8 comment
    15 → 20).
- `route.accuracy.test.ts`: re-run unedited after the additions — 96.9% English, overall ≥ 90%
  (see Gate below).

## Decisions

### 25 Oct 2026 · 3.3a index.ts narrowing without a non-null assertion · decided by builder · risk: low
- Decided: Rewrote `classifyTurn`'s intent ternary as explicit branches (an early return for
  `rule.confident`, then an `if (text === undefined)` guard kept only to satisfy the type
  checker, then the model-fallback call) instead of a `text!` non-null assertion or a `satisfies`
  cast.
- Why: the plan allowed either "a local narrowing check or an explicit non-null assertion with a
  one-line comment"; no behaviour change either way since the guard branch is unreachable
  (`classifyIntentByRules` returns `confident: true` for undefined text), but the explicit branch
  reads clearer than a bare assertion and needs no suppression comment.

### 25 Oct 2026 · 3.3a new distress rows' wording · decided by builder · risk: low
- Decided: Picked plain, generic distress phrasing ("I feel so hopeless about everything these
  days", "nothing I do matters anymore, I give up trying", etc.) with no helpline numbers,
  contacts or personal details, verified individually against `classifyIntentByRules` via a
  scratch test (written, run, then deleted before commit) rather than assumed.
- Why: the plan required each row to genuinely exercise the model-fallback path (soft or
  no-hit), not just read as plausible; checking against the real rule function was the only way
  to confirm that without a real model call (rule 4).

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` → green (125 test
  files, 5608 tests passed; typecheck and lint clean). One unrelated flaky timing assertion in
  `src/pedagogy/modelRequest.test.ts` ("runs in linear time on long hostile input") was observed
  once under a combined `typecheck lint test` run and confirmed to pass reliably when the file
  runs alone — pre-existing, not touched by this task.
- `corepack pnpm turbo run test --filter=@edmate/harness -- pipeline/steps/route.accuracy` →
  green: "is ≥ 90% overall and ≥ 90% on the English subset" passes, English 96.9%.
- `corepack pnpm exec prettier --check` on all files changed in this task → clean (ran
  `--write` once to fix two formatting issues, then confirmed clean).
- `python3 .githooks/secret-scan.py --all` → clean (no output).

## Budget

Tool calls used: 49

## Left to do

None — both phases are complete and the exit conditions (duplicate-part scoring, shared helper,
dead-code removal, labelled-set additions, ≥ 90% accuracy) are all met.
