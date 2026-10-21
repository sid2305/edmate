# 5.11a plan: drafters classify the real gateway's errors

Status: READY (written by the lead; small, well-specified follow-up from the 5.11 review)

## Goal
`draftOutline` and `draftStyleCard` (packages/ingest) must report a deterministic schema failure from the
**real** gateway as `IngestError('validation', retryable: false)`. Today they check `instanceof ZodError`,
which only `ScriptedGateway` throws. The real gateway (`packages/gateway/src/adapters/errors.ts`,
`mapProviderError`) throws `GatewayError` with `code: 'validation', retryable: false` for AI SDK
`NoObjectGeneratedError` / `TypeValidationError` / `JSONParseError`.

## Scope (packages/ingest only)
1. One small helper in packages/ingest (e.g. `src/gatewayFailure.ts`) that classifies a thrown value:
   - a `ZodError` → validation, not retryable (ScriptedGateway path, kept);
   - an `Error` with a `code` that parses under `ErrorCodeSchema` (from `@edmate/contracts`) and a boolean
     `retryable` → `code === 'validation'` maps to validation, not retryable; any other code maps to
     `provider_error` and keeps the error's own `retryable`;
   - anything else → `provider_error`, retryable (as today).
   Duck-type the shape. **Do not import `@edmate/gateway`** (ingest does not depend on it) and do not
   change packages/contracts, packages/harness or packages/gateway.
2. Use it in both drafters' catch blocks. Messages stay fixed text: no model output, no teacher text.
3. `draftOutline`: draft independent modules in parallel (`Promise.all`), keeping output order equal to
   input module order. Check that ScriptedGateway matching still works; if parallel calls make the
   scripted queue order-dependent in a way the tests can't express, keep sequential and log a decision.
4. Distinct fixed messages for "the gateway failed" and "the reply did not match the draft schema".

## Tests (TDD)
- Each drafter: a gateway that throws an Error shaped `{ name: 'GatewayError', code: 'validation',
  retryable: false }` → `IngestError` validation / false.
- Each drafter: `{ code: 'rate_limited', retryable: true }` → provider_error / true; `{ code:
  'provider_error', retryable: false }` → provider_error / false.
- The helper: unit cases for ZodError, a shaped error, an unknown code string, a non-Error throw.
- The outline: modules come back in input order when drafted in parallel.
- Use ScriptedGateway, or a tiny hand-written ModelGateway stub that throws, for the error shapes.
  No real model calls.

## Risky paths
None (packages/ingest only). Reviewers: code-reviewer, typescript-reviewer (sonnet).

## Acceptance
A real-gateway-shaped validation error surfaces as validation, retryable false; a provider outage stays
provider_error, retryable true. `turbo run typecheck lint test --filter=@edmate/ingest...` is green.

## Lead answers
- Duck-typing over importing @edmate/gateway: yes. The ingest package must not depend on the gateway.
- Keep the error's own `retryable` for non-validation codes rather than forcing true.
