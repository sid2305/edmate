# Plan: 3.3a — Route follow-ups from the 3.3 review

## Acceptance (verbatim)
"a duplicate-part key with one matching number scores partial; both callers use the shared
helper; route accuracy stays at or above 90%"

Title (follow-ups list): count each student number once when matching answer-key parts
(duplicate parts); share one cancel/timeout/validate helper between
`routing/modelFallback.ts` and `guardrails/safetyClassifier.ts`; drop the redundant
`text === undefined` clause in `routing/index.ts`; add soft and indirect distress rows to the
labelled set.

## How it will be shown
No UI. Shown by green tests: a new `classify.test.ts` case for a duplicate-part key
(`['3','3']`, one student number) asserting `partial`, not `correct`; a new unit test for the
shared helper exercising cancel/timeout/invalid once, from one place; the existing
`modelFallback.test.ts` and `safetyClassifier.test.ts` cancel/timeout/invalid cases passing
unchanged after the refactor (same error types, same messages); `route.accuracy.test.ts`
(`packages/harness/src/pipeline/steps/route.accuracy.test.ts`) still ≥ 90% overall and ≥ 90%
English after the labelled-set additions; full `turbo run typecheck lint test
--filter=@edmate/harness...` green.

## Source
`docs/tasks/3.3/review.md` findings (all `[deferred 3.3a]`):
- classify.ts:249 — duplicate answer-key parts can double-match one student number.
- modelFallback.ts:65 — `askIntentModel` repeats `safetyClassifier.ts`'s cancel/timeout/validate
  idiom.
- index.ts:33 — `|| text === undefined` is redundant.
- plus the board title's labelled-set item (not a numbered review finding).

## Shared helper: where it lives
New file `packages/harness/src/pipeline/guardedModelCall.ts` (+ `guardedModelCall.test.ts`).
Both current callers (`routing/modelFallback.ts`, `guardrails/safetyClassifier.ts`) already
import from `../pipeline/timeout.js` and `../pipeline/clock.js`, so `pipeline/` is the existing
common ground and satisfies the harness purity rule (contracts, zod, mathjs, own modules only;
no new cross-import outside the harness). `pipeline/**` is not a risk-paths.txt group, so the
new file itself is not risky.

Shape (generic, so each caller keeps its own error classes, messages and guard-name arguments
— behaviour identical, not merely similar):
```
export interface GuardedCallErrors {
  cancelled(): Error;
  timedOut(ms: number): Error;
  invalid(): Error;
}
export async function callGuarded<T>(
  cancel: CancelToken,
  clock: Clock,
  call: () => Promise<unknown>,
  schema: z.ZodType<T>,
  timeoutMs: number,
  errors: GuardedCallErrors,
): Promise<T>
```
- Checks `cancel.cancelled` up front, races `call()` against `runWithTimeout` with
  `cancel.onCancel` rejecting into the same race (exact current wiring in both files), maps
  `timeout` → `errors.timedOut(timeoutMs)`, rethrows `error` as-is, `safeParse`-validates the
  value and maps a bad parse → `errors.invalid()`.
- `askIntentModel` calls it with `errors: { cancelled: () => new RouteCancelledError(), timedOut:
  (ms) => new RouteModelTimeoutError(ms), invalid: () => new RouteModelInvalidError() }` and
  `call: () => env.gateway.generateObject(req, RouteIntentVerdictSchema)`.
- `askClassifier` calls it with `errors` built from its existing `SafetyGuardCancelledError(guard)`
  / `SafetyClassifierTimeoutError(guard, ms)` / `SafetyClassifierInvalidError(guard)`, keeping the
  `guard` name in the message exactly as today, and `call: () => ctx.gateway.generateObject(req,
  schema)`.
- No behaviour change for either caller: same timeouts (300 ms / 250 ms), same error types, same
  messages, same cancel-already-set short-circuit.

## Tests first (pin behaviour before the refactor)
`modelFallback.test.ts` and `safetyClassifier.test.ts` already pin cancel (already-cancelled and
mid-call), timeout and invalid-answer behaviour for their callers (confirmed by reading both
files). Before editing either production file: run
`corepack pnpm turbo run test --filter=@edmate/harness -- routing/modelFallback
guardrails/safetyClassifier` and confirm green at the current head, so any later diff is caught.
Then write `guardedModelCall.test.ts` (new, direct unit tests: already-cancelled throws
`errors.cancelled()` with no call made; mid-call cancel throws `errors.cancelled()`; timeout
throws `errors.timedOut(ms)`; a thrown/rejected call rethrows as-is; a schema-failing value
throws `errors.invalid()`; a good value returns parsed data) before wiring either caller to it.
After the refactor, re-run the same two caller test files unchanged and confirm they still pass
with no edits to their assertions (only import-path edits if the error classes' construction
site moves, which it doesn't here — the classes stay where they are).

## Files to create
- `packages/harness/src/pipeline/guardedModelCall.ts`
- `packages/harness/src/pipeline/guardedModelCall.test.ts`

## Files to modify
- `packages/harness/src/routing/modelFallback.ts` — `askIntentModel` calls the shared helper.
- `packages/harness/src/guardrails/safetyClassifier.ts` — `askClassifier` calls the shared
  helper. **Risky path** (`packages/harness/src/guardrails/**`).
- `packages/harness/src/routing/classify.ts` — `classifyAttempt`/`partMatched`: consume each
  matched student number once (track used `nums` indices or values so a second answer-key part
  cannot re-match a number already credited to an earlier part); label and word parts unchanged.
- `packages/harness/src/routing/classify.test.ts` — add the duplicate-part case
  (`answerKey: ['3','3']`, student text with one `3`) asserting `partial`; keep existing cases
  green.
- `packages/harness/src/routing/index.ts` — `classifyTurn`: drop `|| text === undefined` from
  the intent ternary (rules already return `confident: true` for empty/undefined text per
  `classify.ts`'s own early return, so the clause is unreachable); adjust the type so
  `askIntentModel`'s `text: string` parameter still type-checks on the now-narrower branch
  (e.g. a local narrowing check or an explicit non-null assertion with a one-line comment citing
  `classify.ts`'s invariant — no behaviour change, type-only).
- `packages/harness/src/routing/labelledTurns.ts` — add a small number of new rows (English
  only, per the pilot's English-only rule; no helpline or contact text is invented, since these
  rows only exercise routing, not reply text):
  - 2-3 **soft** distress rows: a single soft keyword phrase with no hard phrase and no
    combination-rule match, so `classifyIntentByRules` returns `{ intent: 'on_task', confident:
    false }` (the `level === 'soft'` branch) and the row is labelled `'distress'` so the test
    checks the model-fallback path lands on `distress` once reached.
  - 2-3 **indirect** distress rows: phrasing that implies distress with no keyword-table hit at
    all (so `distressKeywordLevel` returns `'none'`) and that must not accidentally match
    `MISUSE`/`ANSWER_SEEKING`/`META`/`OFF_TOPIC`/`ON_TASK` either, so the rule falls through to
    the final `{ intent: 'on_task', confident: false }` and only the model fallback catches it;
    labelled `'distress'`.
  - Builder must check each new row's rule-only classification (not just assume) before adding
    it, e.g. by running `classifyIntentByRules` against the exact text in a scratch test or via
    `classify.test.ts`, so it genuinely exercises the fallback path instead of silently passing
    on a rule hit.
  - Update the category comment counts at the top of the file (e.g. "category 8: distress —
    15" becomes "15 + N") so the file's own bookkeeping stays accurate.
- `packages/harness/src/pipeline/steps/route.accuracy.test.ts` — no edit expected; re-run after
  Phase B to confirm ≥ 90% overall and ≥ 90% English with the new rows included.

## Files out of bounds
Everything else: no contracts change, no prompt-pack change, no change to
`distressKeywords.ts`'s tables themselves (the new rows use existing keyword levels, they don't
add new keywords), no change to `moderationPatterns.ts`/`jailbreakPatterns.ts`, no change to
`route.ts`'s step wiring beyond `index.ts`'s re-export surface, no `evals/suites/**` change (the
labelled set lives in `packages/harness/src/routing/labelledTurns.ts`, not under
`evals/suites/locked/**` or any other eval suite — confirmed by reading the file; it is not a
risk-paths.txt entry).

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/harness/src/guardrails/safetyClassifier.ts` and
  `packages/harness/src/guardrails/safetyClassifier.test.ts` match `packages/harness/src/guardrails/**`
  → required reviewer per the file's current `# reviewers:` line: **code-reviewer** (the MVP-era
  line; 13.3 is noted in the file's own comment as the task that will restore
  `safety-reviewer` here, but the file on disk today still lists only code-reviewer for this
  group — if 13.3 has landed that change by build time, the builder follows whatever the file
  says then, not this plan). **typescript-reviewer** is also required, per standing practice,
  on every PR regardless of risk path.
- `packages/harness/src/routing/**` (classify.ts, classify.test.ts, modelFallback.ts,
  modelFallback.test.ts, index.ts, labelledTurns.ts) is **not** a risk-paths.txt entry.
- `packages/harness/src/pipeline/**` (the new shared helper) is **not** a risk-paths.txt entry.
- This PR needs a `risk: high` decision logged at merge (one risky group touched).

## Tests (full list)
- `classify.test.ts`: new duplicate-part-key case; existing cases unchanged and green.
- `guardedModelCall.test.ts`: new, cancel/timeout/error-rethrow/invalid/ok cases.
- `modelFallback.test.ts`, `safetyClassifier.test.ts`: unchanged, green after the refactor.
- `route.accuracy.test.ts`: green, ≥ 90% overall and ≥ 90% English, after the labelled-set
  additions (Phase B).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` green at the end of
  each phase.

## Open questions
None blocking. One note: if task 13.3 has already amended risk-paths.txt's guardrails group to
require `safety-reviewer` by the time this builds, the lead adds that reviewer to `review.md`
instead of code-reviewer-only; this doesn't change the plan's scope.

## Phase A — shared helper (routing + guardrails)
Files: `pipeline/guardedModelCall.ts` (new), `pipeline/guardedModelCall.test.ts` (new),
`routing/modelFallback.ts` (edit), `guardrails/safetyClassifier.ts` (edit, risky). Confirms
`modelFallback.test.ts` and `safetyClassifier.test.ts` stay green unedited.
Green commit: helper extracted, both callers wired, all four test files green, typecheck/lint
green for `@edmate/harness`.
State after this phase: the LOW finding (duplicated idiom) is closed; the MEDIUM (duplicate-part
scoring) and the labelled-set item are still open for Phase B.

## Phase B — classify.ts dedup, index.ts dead code, labelled-set additions
Reads Phase A's handoff first. Files: `routing/classify.ts` (edit), `routing/classify.test.ts`
(edit), `routing/index.ts` (edit), `routing/labelledTurns.ts` (edit).
Green commit: duplicate-part key scores `partial` (new test green), `index.ts`'s dead branch
gone, 4-6 new soft/indirect distress rows added and individually checked against
`classifyIntentByRules` before being labelled, `route.accuracy.test.ts` ≥ 90% overall and ≥ 90%
English, full harness suite green.
State after this phase: all four 3.3 review follow-ups closed; task done.

## Budget
Budget: 85 tool calls (2 phases, packages/harness)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test only; no network, no payment or
real-model calls — scripted gateway and fixtures only, per rule 4)

## Exit conditions
Status: DONE when both phases' green commits land, all tests above pass, and
`route.accuracy.test.ts` holds ≥ 90% overall / ≥ 90% English with the new rows included. A
builder stops at Status: PARTIAL if past ~45 tool calls in a single phase with the phase's tests
still red, or if a change outside this plan's file list looks necessary (e.g. a distress-table
edit, a contracts change, or an eval-suite change) — that goes back to the lead as a new
decision, not into this plan's scope.
