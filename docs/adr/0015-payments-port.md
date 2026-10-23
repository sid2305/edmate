# ADR-0015: Payments port

## Status

Accepted (22 Oct 2026). Task 10.1 Phase A (board 10.1a). Reviewed by architect, security-reviewer and typescript-reviewer (one fix round, re-verified by all three); the lead approved it with a `risk: high` decision.

## Date

2026-10-22

## Context

- M10 adds paid packages. The build plan (§ Payments and subscriptions) wants one provider per market behind one `Payments` port. It also wants provider subscriptions, prorated upgrades now, downgrades and cancels at period end, pause that stops renewal and access, and webhooks that are signature-verified, idempotent and order-independent.
- The human chose a merchant of record (MoR: Paddle or Lemon Squeezy, decision B-53 pending) for the US, which is the first region, and Razorpay for India (parked). Task 10.1's acceptance requires that a second provider can be added without changing callers. Razorpay is the known second provider, so the port is checked against it as well as the MoR.
- B-44: downgrade and cancel move to period end in 10.3. B-49: a takedown pauses the subscription at once and stops billing until the agent is restored. The refund policy (18 Oct 2026) gives a full refund in the first 7 days.
- No port exists yet. ADR-0002 puts every port in `packages/contracts/src/ports.ts`. Data that crosses a process boundary (webhook route to worker queue, in 10.2) is a Zod schema.
- The repo is public, and card data must never touch Edmate. Provider webhook bodies contain buyer email, name, address and card brand and last digits.
- The lead decided (22 Oct 2026, Q3) that this one ADR covers the whole M10 port surface, so 10.2 to 10.8 need no further contracts ADR.

## Decision

1. **Where it lives.** `Payments` is a type-only interface in `ports.ts`. `PaymentOffer`, `ProviderSubscription` and `PaymentEvent` (with its `PaymentFact` union) are strict Zod schemas in a new `packages/contracts/src/payments.ts`. `ProviderSubscription.status` reuses the `Entitlement.status` enum by reference. The Core contracts block gets this section, identical to `spec-types.ts`:

```ts
// ---- Payments (ADR-0015) ----
type ProviderId = string;           // ^[a-z][a-z0-9_-]{1,31}$; equals LocalePack.payments.provider; 'tbd' never names an adapter
type ProviderRef = string;          // a provider's own id: ^[A-Za-z0-9_.:-]{1,128}$, at least one letter or digit
interface PaymentOffer {            // built server-side from the package version; never from the client
  packageVersionId: string; name: string; price: Money; interval: 'month'; trialDays?: number;
}                                   // price.amountMinor > 0; name 1..120 chars, one line (no Cc, Cf, Zl or Zp), a letter or digit; trialDays 1..90
interface ProviderSubscription {    // the provider's view; 10.3's state machine decides the entitlement
  provider: ProviderId; providerRef: ProviderRef;
  subscriptionId: string;           // Edmate's subscriptions.id, carried as provider metadata; required
  status: 'trial' | 'active' | 'past_due' | 'paused' | 'ended';   // = Entitlement['status']
  packageVersionId: string;
  periodEnd: string;                // trial end in trial; end of the last paid period when paused or ended
  scheduled?: { change: 'plan' | 'cancel' | 'pause' | 'resume'; at: string; packageVersionId?: string };   // packageVersionId exactly when change = 'plan'
}
type PaymentFact =
  | { type: 'subscription'; subscription: ProviderSubscription }   // a full snapshot
  | { type: 'payment_succeeded'; paymentRef: ProviderRef; providerRef: ProviderRef; subscriptionId: string;
      amount: Money; tax: Money; fee: Money; net?: Money }         // amount, tax, fee: one currency; tax, fee <= amount; net may be the payout currency
  | { type: 'payment_failed'; paymentRef: ProviderRef; providerRef: ProviderRef; subscriptionId: string }
  | { type: 'refund'; refundRef: ProviderRef; paymentRef: ProviderRef; subscriptionId: string;
      amount: Money; status: 'pending' | 'succeeded' | 'failed' };   // amount.amountMinor > 0
interface PaymentEvent {            // one verified webhook delivery
  provider: ProviderId; eventId: ProviderRef;   // (provider, eventId) is 10.2's idempotency key
  providerType: string;             // the provider's event name, 1..64 chars; never payload text
  occurredAt: string;
  facts: PaymentFact[];             // 0..4; empty = verified, nothing Edmate uses
}
interface Payments {                // one provider; callers get it only from paymentsFor(market) or forProvider(id)
  readonly provider: ProviderId;
  startCheckout(x: { subscriptionId: string; offer: PaymentOffer; returnUrl: string; idempotencyKey: string }):
    Promise<{ checkoutRef: ProviderRef; url: string; providerRef?: ProviderRef }>;   // url: the provider's hosted https page
  changePlan(x: { providerRef: ProviderRef; offer: PaymentOffer; idempotencyKey: string }
    & ({ when: 'now'; proration: 'prorate' | 'none' } | { when: 'period_end' })): Promise<ProviderSubscription>;
  pause(x: { providerRef: ProviderRef; when: 'now' | 'period_end'; idempotencyKey: string }): Promise<ProviderSubscription>;
  resume(x: { providerRef: ProviderRef; idempotencyKey: string }): Promise<ProviderSubscription>;
  cancel(x: { providerRef: ProviderRef; when: 'now' | 'period_end'; idempotencyKey: string }): Promise<ProviderSubscription>;
  clearScheduled(x: { providerRef: ProviderRef; idempotencyKey: string }): Promise<ProviderSubscription>;   // undoes a scheduled plan change, cancel, pause or resume
  getSubscription(providerRef: ProviderRef): Promise<ProviderSubscription>;
  refund(x: { paymentRef: ProviderRef; amount?: Money; idempotencyKey: string }):
    Promise<{ refundRef: ProviderRef; status: 'pending' | 'succeeded' }>;   // no amount = full refund
  parseWebhook(x: { rawBody: Uint8Array; headers: Readonly<Record<string, string>>; receivedAt: string }): Promise<PaymentEvent>;
}
```

2. **Money.** Amounts are integers in the currency's ISO 4217 minor units, with an upper-case ISO 4217 code, using the existing `Money`. Adapters convert provider amounts exactly (string or integer, never through a float) with a per-currency exponent table, and they refuse a currency the table doesn't know. In the pilot the buyer is charged in the offer's currency (no local-currency conversion). Only `net` may be in another currency (the payout currency).
3. **Idempotency.** Every write takes an `idempotencyKey` matching `^[A-Za-z0-9_-]{8,128}$`. The caller builds it from Edmate ids (for example the subscription id, the operation and a request id), never from personal data, because it may be sent to the provider. The same key with the same input gives the same result; the same key with different input throws `conflict`. A stateless adapter can't keep that promise alone, so the caller (10.3, 10.6, 10.8) claims the key first: it inserts a DB row with a unique constraint on the key, with the input, before it calls the provider. A second claim of the same key returns the stored result, or throws `conflict` when the input differs. Adapters also send the key in provider metadata (custom data or notes) where the provider supports it, so a retry can find the earlier object. If the provider has no idempotency keys, the adapter also makes the call safe to repeat: it reads the current state first, and before any refund it lists the payment's existing refunds and returns the one that carries the same key, so it never refunds twice. An adapter that can't find a refund by its key throws `unsupported` for `refund`. A repeated cancel, pause, resume or plan change to the same offer returns the current snapshot. 10.1b's shared contract suite tests a retry after a timeout. After a timeout or a retryable error the caller retries with the same key, or reads the state with `getSubscription`, and never uses a new key.
4. **Scheduled changes.** `when: 'now'` with `proration: 'prorate'` is the PRD's upgrade. `period_end` is used for downgrades, cancels and pauses. A new change replaces any scheduled one. `clearScheduled` undoes a scheduled change, including a scheduled resume. `resume` ends a pause now; the returned snapshot's `periodEnd` is the truth about billing. An adapter that can't do an operation natively throws `unsupported` and never emulates it with hidden state. 10.3 then falls back: for example, it schedules its own job that calls `changePlan` with `when: 'now'` and `proration: 'none'` at the period boundary. `proration: 'none'` with `when: 'now'` is only for this scheduled-downgrade fallback; 10.3 tests that an upgrade never uses it.
5. **Webhook verification.** `parseWebhook` gets the exact request bytes, header names in lower case (repeated headers joined with `, `) and the server's `receivedAt`. It refuses a body over 1 MiB. It checks the signature over the raw bytes in constant time, accepting any of the configured secrets (rotation), and checks the signed timestamp against at most 300 s of tolerance when the provider signs one. Only then does it parse the JSON with the provider's own Zod schemas and map it. It throws on any failure and never returns unverified data. An unknown provider status, a subscription or payment without Edmate's `subscriptionId`, or a value outside the schemas throws `malformed_event`: nothing is ever mapped to `active` by default. A provider state before the subscription starts (for example Razorpay's `created` or `authenticated`) produces no facts. `eventId` is the provider's per-delivery event id. A provider with no per-delivery id uses the lowercase hex SHA-256 of the raw body. Ordering is 10.2's job: it applies the newest snapshot by `occurredAt` and calls `getSubscription` when in doubt. `occurredAt` may carry any offset, so consumers compare parsed instants, never strings.
6. **Data minimisation.** Edmate sends a provider only its own `subscriptionId` and `packageVersionId` (opaque ids, as metadata), the offer name and price, the return URL and the idempotency key. It never sends a student id, name, email, age or teacher contact details. The hosted checkout collects the buyer's details and the card, so card data never reaches Edmate. Adapters keep only what the strict schemas carry and drop the buyer's email, name, address and card details. Raw bodies, provider responses, keys and secrets are never logged, stored, put into an error or queued. `returnUrl` must be https and is built server-side from config.
   **Binding.** Adapters read `subscriptionId` and `packageVersionId` only from server-set data (a checkout or transaction that Edmate's server created), never from fields the buyer can edit, such as client-side checkout data or URL parameters. 10.2 and 10.8 match the first snapshot or payment to Edmate's server-side checkout intent (subscriptionId, packageVersionId, price). They pin providerRef to subscriptionId on the first bind and reject a later mismatch.
7. **Errors.** Adapters throw `PaymentsError { code; retryable }`, defined in `packages/payments` like `GatewayError`. The codes are part of this contract: `invalid_signature`, `stale_signature`, `malformed_event`, `unsupported`, `not_found`, `conflict`, `validation`, `rate_limited` (retryable) and `provider_error` (retryable on 5xx and timeouts; not retryable on 401/403, so a bad key is never `unauthorized`). Messages are fixed words. `cause` is dropped. No error carries a request or response body, key, secret, header or URL with a token.
8. **Choosing a provider.** Callers never import an adapter. `paymentsFor(market)` reads `LocalePack.payments.provider`; `tbd`, an unknown market or a provider with no adapter throws `unsupported` (no checkout). The webhook route uses `forProvider(id)`, taken from its own route config, never from the body. The route also checks that `event.provider` equals the adapter's id.
9. **Helper schemas.** `payments.ts` also exports `IdempotencyKeySchema` (`^[A-Za-z0-9_-]{8,128}$`), `ProviderRefSchema`, `CheckoutResultSchema` (`checkoutRef`, an https-only `url`, optional `providerRef`), `RefundResultSchema` (`refundRef`, `status`) and `PaymentFactSchema`. They are part of the port's contract: adapters, the fake and the shared suite parse port inputs and outputs with them. They are not in the fixture registry, so it stays at 39 types. The offer name refuses control, format and separator characters (`\p{Cc}`, `\p{Cf}`, `\p{Zl}`, `\p{Zp}`: NEL, bidi controls, zero-width characters, BOM) and needs at least one letter or digit. Amended 22 Oct 2026 (10.1b review, a tightening within this ADR): it also refuses surrogates and private-use characters (`\p{Cs}`, `\p{Co}`) and the invisible Hangul fillers U+115F, U+1160, U+3164 and U+FFA0, so a zero-width-joiner emoji sequence is refused too. A `ProviderRef` needs at least one letter or digit, so `.` and `..` fail.
10. **Out of the port.** Payouts (an MoR pays Edmate; pilot payouts to teachers are manual, 10.4), invoices (10.6 reads them from the provider or the ledger), customer records and saved payment methods. Adding any of them, a yearly interval or a new fact type needs an ADR that amends this one.

## Alternatives

- **Port inside `packages/payments`** (no contracts change). Not chosen: ADR-0002 puts every port in contracts, and the normalised event must be one shared Zod schema that the web route and the worker both parse.
- **One `PaymentEvent` per delivery with no facts list** (the first draft). Not chosen: a Razorpay `subscription.charged` delivery carries both a subscription and a payment, so callers would have to change for the second provider.
- **Capability flags on the port** (for example `supportsPauseAtPeriodEnd`). Not chosen: callers would branch per provider. Throwing `unsupported`, plus the `proration: 'none'` fallback, keeps callers the same.
- **A provider SDK and its types in the port.** Not chosen: it ties callers to one provider, and SDKs hide key handling and network calls from our tests.
- **Store raw webhook bodies for replay.** Not chosen: they hold buyer personal data. 10.2 stores only `(provider, eventId)` and the normalised facts.

## Consequences

- 10.2, 10.3, 10.6 and 10.8 can code against the port and the Phase B fake with no further contracts change.
- Contracts gain three registered schemas (36 to 39), five unregistered helper schemas (§9) and one port. The Core contracts block and `spec-types.ts` change together.
- An adapter that lacks a native operation surfaces `unsupported` at test time, and the shared contract suite runs with each adapter's capability flags (flags are test-side only).
- Body-only signatures (Lemon Squeezy, Razorpay) have no replay window, so replay protection for them rests on 10.2's `(provider, eventId)` store.
- Follow-ups for later tasks (no change in 10.1):
  - 10.2: `webhook_events` is unique on `provider_event_id` alone and `subscriptions` has no `provider` column. Both should be keyed by provider plus ref before a second provider ships (a db migration).
  - 10.8: a subscription row created before payment has no status that grants no access. 10.8 needs a pending state or a checkout-intent record (a db change) so the first webhook can find the student, teacher and package. A second completed checkout for a live subscription is refunded or cancelled.
  - B-54 (an open human question): the port doesn't decide it. Option (2b) and the 30-day fallback are a `refund` with an amount. Option (2a), credit unused days on resume, is done as a pro-rata refund or needs an ADR that amends this one. 10.3 decides once the human answers.
  - 10.8: a package with `trialDays` 0 leaves the trial out of the offer. 10.8 normalises the package name to one line before it builds the offer. Normalising strips every character the offer name refuses (§9: `\p{Cc}`, `\p{Cf}`, `\p{Zl}`, `\p{Zp}`, `\p{Cs}`, `\p{Co}` and the Hangul fillers; `\p{Cf}` includes the zero-width joiner inside emoji sequences), or the studio refuses such names when they are saved; 10.8 picks one and tests it against `PaymentOfferSchema`.
  - 10.6: a 7-day refund is a `refund` followed by a `cancel` with `when: 'now'`, each with its own idempotency key.
- Tests never call a real provider (rule 4): the fake adapter and fixtures shaped from sandbox docs, with obviously fake ids and no real keys. Live sandbox runs are done by the human only.
- **Rollback:** Phase A adds types and schemas that nothing calls, so reverting it is free. After Phase B and later, setting a market's `payments.provider` back to `tbd` stops checkout with no code change.

## Reviewers

architect, security-reviewer, typescript-reviewer. The lead approves and logs it `risk: high`. Phases B and C (10.1b, 10.1c) also get security-reviewer.
