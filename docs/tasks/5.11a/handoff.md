# 5.11a handoff: drafters classify the real gateway's errors

Status: DONE

## Acceptance evidence

`turbo run typecheck lint test --filter=@edmate/ingest...` (trimmed):

```
@edmate/ingest:test:  ✓ test/outline/draftOutline.test.ts (8 tests)
@edmate/ingest:test:  ✓ test/styleCard/draftStyleCard.test.ts (6 tests)
@edmate/ingest:test:  ✓ test/gatewayFailure.test.ts (6 tests)
@edmate/ingest:test:  Test Files  21 passed (21)
@edmate/ingest:test:       Tests  343 passed (343)
@edmate/ingest:test:  All files          |     100 |    97.94 |     100 |     100 |
@edmate/ingest:test:   ...wayFailure.ts |     100 |      100 |     100 |     100 |
@edmate/ingest:test:   draftOutline.ts  |     100 |      100 |     100 |     100 |
@edmate/ingest:test:   ...tStyleCard.ts |     100 |      100 |     100 |     100 |
 Tasks:    14 successful, 14 total
```

`python3 .githooks/secret-scan.py --all` — clean, no output.

Acceptance scenarios from the plan, both covered by new tests:
- a real-gateway-shaped `{ name: 'GatewayError', code: 'validation', retryable: false }` throw from
  each drafter's `generateObject` surfaces as `IngestError('validation', false)`.
- a real-gateway-shaped `{ code: 'rate_limited', retryable: true }` throw stays
  `provider_error`/`retryable: true`.

## Changes

- `packages/ingest/src/gatewayFailure.ts` (new): `classifyGatewayFailure(e: unknown)` duck-types a
  thrown value into `{ code: 'validation' | 'provider_error', retryable: boolean }`:
  - `ZodError` (the `ScriptedGateway` path) → `validation`, not retryable.
  - an `Error` with a `code` that parses under `@edmate/contracts`'s `ErrorCodeSchema` and a
    boolean `retryable` (the real gateway's `GatewayError` shape, duck-typed — `@edmate/gateway` is
    not imported) → `code === 'validation'` maps to the same `validation`/not-retryable result; any
    other code maps to `provider_error`, keeping that error's own `retryable`.
  - anything else (unrecognised shape, non-`Error` throw) → `provider_error`, retryable (unchanged
    default behaviour).
- `packages/ingest/src/outline/draftOutline.ts`:
  - `draftModule`'s catch now calls `classifyGatewayFailure` via a small `toIngestError` helper
    instead of branching on `instanceof ZodError` directly, so a real-gateway validation failure
    also surfaces as `validation`/not-retryable.
  - `draftOutline` now drafts all modules with `Promise.all(modules.map(...))` instead of a
    sequential `for` loop; output order always equals input `modules` order regardless of which
    call settles first (new test proves this with a stub gateway where the second module resolves
    before the first).
- `packages/ingest/src/styleCard/draftStyleCard.ts`: same `toIngestError`/`classifyGatewayFailure`
  swap in `draftStyleCard`'s catch; `draftStyleCard` already makes a single call, so no parallelism
  change was needed there.
- Tests: `packages/ingest/test/gatewayFailure.test.ts` (new, unit cases for `ZodError`, each
  `GatewayError`-shaped code, an unknown code string, and non-`Error` throws); new cases added to
  `packages/ingest/test/outline/draftOutline.test.ts` and
  `packages/ingest/test/styleCard/draftStyleCard.test.ts` for the real-gateway validation and
  rate-limited shapes, plus the outline's parallel-order test. All new gateway stubs are
  hand-written `{ generateObject }` objects or `ScriptedGateway`; no real model or `@edmate/gateway`
  import.

## Deviations

- The plan's distinct-fixed-messages item ("the gateway failed" vs "the reply did not match the
  draft schema") was already satisfied by 5.11's existing `draftFailed()`/`schemaFailed()` pair in
  each drafter; this task kept those two fixed messages (now looked up from a
  `Record<DraftFailureCode, string>` keyed by `classifyGatewayFailure`'s code) rather than adding a
  third message, since the plan's scope section did not ask for a new message and the two
  fixed-message rule was already in place.
- The 5.11 review's LOW item ("`draftFailed()` gives one message for every cause") stays deferred:
  5.11a only had to fix the HIGH (real-gateway validation misclassified) and the MEDIUM (outline
  parallelism); the fixed-message set itself is unchanged from 5.11.

## Decisions

### 20 Oct 2026 · 5.11a duck-typed GatewayError shape · decided by tdd-guide
Decided: `classifyGatewayFailure` checks `e instanceof Error && 'code' in e && 'retryable' in e &&
typeof e.retryable === 'boolean'`, then validates `code` with `ErrorCodeSchema.safeParse`, rather
than checking `e.name === 'GatewayError'`.
Why: the plan says duck-type the shape and explicitly forbids importing `@edmate/gateway`, so there
is no type to import and compare `name` against; checking the two fields the classifier actually
uses (a schema-valid `code`, a boolean `retryable`) is the narrowest shape check that still accepts
a real `GatewayError` and rejects an unrelated error with a stray `code` string.
risk: low

### 20 Oct 2026 · 5.11a kept outline's two fixed messages · decided by tdd-guide
Decided: outline and style-card drafters keep their existing two fixed messages (`draftFailed`/
`schemaFailed` text), now selected via `classifyGatewayFailure`'s returned code, instead of adding a
third message for the real-gateway's non-validation, non-rate_limited codes.
Why: the plan's "distinct fixed messages" item asks for exactly the pair 5.11 already wrote (gateway
failure vs. schema-failed-validation); every non-validation code the real gateway can throw already
maps to the same `provider_error` fixed message as the "gateway failed" case, so a third message
would say the same thing twice.
risk: low
