# @edmate/payments

What every `Payments` adapter shares (ADR-0015), and the registry callers use to pick one.

- `PaymentsError` with the ADR-0015 §7 codes (`PAYMENTS_ERROR_CODES`, `PaymentsErrorCode`). Fixed
  words only; no `cause`, body, key, secret, header or URL.
- `checkPortInput(op, input)`: the one input check every adapter calls first (idempotency key,
  https return URL, offer, refs, refund amount). Any failure is `validation`.
- `src/webhook/`: timing-safe HMAC-SHA256 checks with secret rotation and a signed-timestamp
  tolerance of at most 300 s, the 1 MiB body cap, header lookup and a strict JSON read.
- `createPaymentsRegistry({ adapters, locales })`: `paymentsFor(market)` reads
  `LocalePack.payments.provider`; `forProvider(id)` serves the webhook route. `tbd`, an unknown
  market or a provider with no adapter throws `unsupported`, so there is no checkout.
- `Secret`: a local copy of the gateway's redacting wrapper (no dependency on `@edmate/gateway`).

## Testing

`@edmate/payments/testing` exports `createFakePayments`, an in-memory adapter with an injected
clock, a configurable provider id, signature style (`timestamped` or `body-only`) and status
words. `emit(...)` produces correctly signed raw webhook bodies; `failNext(...)` injects failures,
including a timeout after the work was done. The web app does not use it.

`test/contract/suite.ts` is the provider-neutral contract suite; every adapter runs it unchanged.
Tests never reach a network (`test/setup/no-network.ts`). `test:live` runs provider sandbox tests
by hand only, with keys from the environment; there are none until a real adapter lands (10.1c).
