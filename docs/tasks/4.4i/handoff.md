# Handoff: 4.4i — distress prefetch uses the guard's configured timeout

Status: DONE

## What changed

- `packages/harness/src/guardrails/distressDetect.ts`
  - New exported type `DistressDetectGuard = Guard<PreGuardCtx> & { readonly classifierTimeoutMs: number }`.
  - `createDistressDetectGuard` now returns `DistressDetectGuard` and sets `classifierTimeoutMs` to
    the resolved value (`opts.classifierTimeoutMs ?? DISTRESS_CLASSIFIER_TIMEOUT_MS`) on the
    returned guard object. No behaviour change to `run`.
- `packages/harness/src/pipeline/steps/preGuard.ts`
  - `prefetchDistress` takes a new `classifierTimeoutMs` parameter instead of reading
    `DISTRESS_CLASSIFIER_TIMEOUT_MS` directly.
  - New `distressPrefetchTimeoutMs(registry)` looks up the registered `distressDetect` guard (via
    `registry.ordered()`, matched by `name`) and returns its `classifierTimeoutMs` when it is a
    finite number above 0, else `DISTRESS_CLASSIFIER_TIMEOUT_MS`.
  - `createPreGuardStep(registry)` resolves this once, at step-creation time (outside the returned
    per-turn function), and passes it into `prefetchDistress`. A registry with no distress guard
    falls through to the same default as before.
  - No other change: fail-closed behaviour, call counts, chain order, and the moderation/jailbreak
    prefetches are untouched.
- `packages/harness/src/pipeline/steps/preGuard.test.ts`
  - New unit tests (`createDistressDetectGuard (task 4.4i): the resolved classifierTimeoutMs`):
    `createDistressDetectGuard({ classifierTimeoutMs: 50 }).classifierTimeoutMs === 50`, and
    `createDistressDetectGuard().classifierTimeoutMs === DISTRESS_CLASSIFIER_TIMEOUT_MS`.
  - New integration test (`task 4.4i: a registry built with a non-default classifierTimeoutMs
    prefetches with it, not DISTRESS_CLASSIFIER_TIMEOUT_MS`): builds a registry with
    `createDistressDetectGuard({ classifierTimeoutMs: 50 })` plus the default moderationIn and
    jailbreak guards, a classifier delayed 100 ms, and a soft-distress message ("nothing matters
    anymore"). Confirmed red against the pre-fix code (got `result: 'ok'`, since the old hard-coded
    230 ms deadline let the 100 ms call through); green after the fix (`result: 'escalate'`, the
    50 ms deadline times out and the soft keyword still escalates).
  - Default-timeout coverage: the existing test `'a benign turn: well under the 400 ms step
    budget, not the ~450 ms sequential sum'` (uses `preGuard`, built from
    `defaultPreGuardRegistry()`, with a 150 ms classifier delay) already exercises
    `defaultPreGuardRegistry()` going through `DISTRESS_CLASSIFIER_TIMEOUT_MS`'s path unchanged.

## Tests

- Confirmed red first: ran `corepack pnpm turbo run test --filter=...@edmate/harness` before the
  implementation edits landed — all 3 new assertions failed exactly as expected (2 unit tests saw
  `classifierTimeoutMs` as `undefined`; the integration test got `result: 'ok'` instead of
  `'escalate'`).
- After the implementation: `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --filter=@edmate/evals`
  — **green**, exit 0, `Tasks: 38 successful, 38 total`.
  - `@edmate/harness` tests: `Test Files 134 passed (134)`, `Tests 6155 passed (6155)`.
  - `@edmate/evals` tests: `Test Files 33 passed (33)`, `Tests 2004 passed (2004)`.
- `corepack pnpm --filter @edmate/evals test` (explicit, as the plan's gate requires), run on its
  own: **green** — `Test Files 33 passed (33)`, `Tests 2004 passed (2004)`.
- `python3 .githooks/secret-scan.py --all`: exit 0, no findings.

## Left to do

None. Everything in the plan's gate is confirmed green.

## Decisions

This touches `packages/harness/src/guardrails/distressDetect.ts`, which is under
`packages/harness/src/guardrails/**` (the student-safety risk group). Per the plan, the review
(code-reviewer) and the `risk: high` merge decision are the lead's job at merge time, not mine.

No new decisions beyond the plan: the implementation follows the plan's design exactly (resolved
value on the guard, looked up once at step-creation time, default fallback for a registry with no
distress guard).

- **4.4i distress prefetch respects the guard's configured timeout (lead, risk: high).** Decided:
  merge as planned. Why: `distressDetect.ts` is a student-safety risk path; pre-pilot-gate the
  required reviewer there is `code-reviewer` only (`safety-reviewer` waived until task 13.3,
  per `risk-paths.txt`). Reviewed by code-reviewer: zero code-level findings (type change is a pure
  additive intersection, the timeout lookup happens once at step-creation not per-turn, fallback is
  correctly guarded, chain order and other prefetches are untouched, gate independently re-run
  green). The reviewer's one CRITICAL finding was procedural, not code: `plan.md`'s 4 Nov hold on
  new risky-path work had not been logged as lifted anywhere durable. It was lifted out-of-band by
  the human earlier the same session ("the hold is lifted ... build 4.4i"); that answer is now
  logged in `.claude/blockers.md`'s B-64 entry (moved to Resolved) ahead of this merge, closing the
  gap the reviewer flagged.
