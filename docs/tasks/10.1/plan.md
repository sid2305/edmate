# Task 10.1: Payment provider adapter behind the `Payments` port

Board: `python3 .claude/skills/board/board.py show 10.1` · Milestone M10 · deps 2.4, M1 · **risky** (contracts + ADR, `packages/payments/**`, one locale pack line). Three phases, suggested board ids 10.1a, 10.1b, 10.1c; branches `m10/10.1a-payments-port`, `m10/10.1b-payments-fake`, `m10/10.1c-mor-adapter`.

Status of this plan: **READY for Phases A and B. Phase C waits on the human's provider choice (Q1) and the provider's written OK for Edmate's model (Q2).**

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Payment provider adapter for the pilot market behind the `Payments` port, using the provider's subscriptions"
Accept: "provider sandbox flows pass; a second provider can be added without changing callers."

Spec it must honour:
- Build plan § Payments and subscriptions: states `trial → active → past_due (grace 3 days) → ended` plus `paused` (same enum as `Entitlement.status`); "upgrade applies now (prorated); downgrade and cancel at period end; pause stops renewal and access"; webhooks signature-verified, idempotent, order-independent; pilot = provider subscriptions + simple ledger + manual monthly payouts; providers per market behind the `Payments` port.
- Rule 2 (contracts change only with an ADR), rule 4 (no real payment calls in unit or CI tests: "payment sandbox fixtures and recorded responses. Live calls only in `--live` runs with keys from the environment"), rule 5 (never log or persist secrets; public repo).
- Decision log 18 Oct 2026 "Payment providers" (human): Razorpay in India, a merchant of record (MoR, e.g. Paddle or Lemon Squeezy) in the US, both behind the one `Payments` port. 21 Oct 2026 "US is the first region; India parked". 18 Oct 2026 "Payments come last". 18 Oct 2026 "Refund policy": full refund in the first 7 days.
- B-44 (human, 22 Oct): downgrade and cancel apply at once until 10.3, which moves them to period end → the port must support `when: 'period_end'` for plan changes and cancel.
- B-49 (human, 22 Oct): a takedown pauses the subscription and stops billing until restored → the port must support an immediate pause and a resume.
- Decision log 17 Oct 2026 "0.1 Monorepo scaffold": M10 creates `packages/payments`.

Facts found while planning:
- **There is no `Payments` port yet.** `packages/contracts/src/ports.ts` has none, and `packages/payments` does not exist. The data model already has `subscriptions.provider_ref`, `payments`, `payouts`, `ledger_entries`, `invoices` and `webhook_events` (`packages/db/src/schema/billing.ts`); this task does not touch them.
- Every port lives in `packages/contracts/src/ports.ts` (ADR-0002), and the build plan's Core contracts block must equal `packages/contracts/test/spec-types.ts` (`spec-drift.test.ts`). `registry.test.ts` pins the schema count (36 today).
- Locale packs already carry `payments: { methods, provider }`; US, IN and global say `provider: tbd` with the comment "wired with payments (task 10.1)".

### How it is shown (paste into each phase's handoff)

| Item | Evidence |
|---|---|
| A second provider needs no caller change | Phase B `test/second-provider.test.ts`: one caller function (checkout, then parse the signed webhook, then pause) runs unchanged against two adapters with different provider ids, webhook signature styles and status words, picked only through `paymentsFor(market)`. Phase C adds the real adapter to the same registry and the same shared suite with no change to the suite or the caller. |
| The port contract holds for every adapter | `test/contract/suite.ts` is provider-neutral (takes a factory, a scenario driver and capability flags); it runs against the fake (B) and the MoR adapter (C). Every output is parsed by the contracts Zod schemas. |
| Provider sandbox flows pass | CI: the MoR adapter passes the shared suite on fixtures shaped from the provider's sandbox API (no network). Live: `corepack pnpm --filter @edmate/payments test:live` against the provider **sandbox**, run once by the human with sandbox keys in the environment (agents never hold keys); the lead pastes the pass/fail summary (no ids, no keys) into the 10.1c handoff before closing 10.1. |
| No real network in tests | `test/setup/no-network.ts` replaces global `fetch`; adapters only use the injected fetch. |
| No secrets leak | Leak tests: errors, `JSON.stringify`, `util.inspect` and stacks never contain any fragment of the fake key or webhook secret; `python3 .githooks/secret-scan.py --all` exits 0. |
| Contracts are consistent | `corepack pnpm turbo run typecheck lint test --filter=@edmate/contracts...` green, including spec-drift, registry, round-trip and type tests. |

## Design

### The port (Phase A, ADR-0015; text from `architect`, file written by the builder)

Draft for the architect to confirm or change before Phase A starts. Type-only port in `ports.ts`; the data it carries are Zod schemas in a new `packages/contracts/src/payments.ts` (they cross process boundaries: webhook route → worker queue in 10.2).

```ts
// ---- Payments (ADR-0015) ----
interface PaymentOffer {            // built server-side from the package version; never from the client
  packageVersionId: string; name: string; price: Money; interval: 'month'; trialDays?: number;   // price.amountMinor > 0; trialDays 1..90
}
interface ProviderSubscription {
  provider: string; providerRef: string;
  subscriptionId: string;           // Edmate's subscriptions.id, carried as provider metadata
  status: 'trial' | 'active' | 'past_due' | 'paused' | 'ended';   // the provider's view; 10.3's state machine decides the entitlement
  packageVersionId: string; periodEnd: string;
  scheduled?: { change: 'plan' | 'cancel' | 'pause'; at: string; packageVersionId?: string };   // packageVersionId exactly when change = 'plan'
}
type PaymentEvent = { provider: string; eventId: string; occurredAt: string } & (   // eventId: the provider's event id (10.2's idempotency key)
  | { type: 'subscription'; subscription: ProviderSubscription }                     // a full snapshot, so 10.2 can apply the newest one
  | { type: 'payment_succeeded'; paymentRef: string; providerRef?: string; subscriptionId?: string; amount: Money; tax: Money; fee: Money; net?: Money }   // one currency across amount, tax, fee
  | { type: 'payment_failed'; paymentRef: string; providerRef: string; subscriptionId: string }
  | { type: 'refund'; refundRef: string; paymentRef: string; amount: Money; status: 'pending' | 'succeeded' | 'failed' }
  | { type: 'ignored'; providerType: string }                                       // verified, but not an event Edmate uses
);
interface Payments {                // one provider; picked per market from LocalePack.payments.provider (ADR-0015)
  readonly provider: string;
  startCheckout(x: { subscriptionId: string; offer: PaymentOffer; returnUrl: string; idempotencyKey: string }): Promise<{ checkoutRef: string; url: string }>;
  changePlan(x: { providerRef: string; offer: PaymentOffer; when: 'now' | 'period_end'; idempotencyKey: string }): Promise<ProviderSubscription>;   // 'now' is prorated
  pause(x: { providerRef: string; when: 'now' | 'period_end'; idempotencyKey: string }): Promise<ProviderSubscription>;
  resume(x: { providerRef: string; idempotencyKey: string }): Promise<ProviderSubscription>;
  cancel(x: { providerRef: string; when: 'now' | 'period_end'; idempotencyKey: string }): Promise<ProviderSubscription>;
  getSubscription(providerRef: string): Promise<ProviderSubscription>;
  refund(x: { paymentRef: string; amount?: Money; idempotencyKey: string }): Promise<{ refundRef: string; status: 'pending' | 'succeeded' }>;   // no amount = full refund
  parseWebhook(x: { rawBody: string; headers: Readonly<Record<string, string>>; receivedAt: string }): Promise<PaymentEvent>;   // verifies the signature over the raw bytes first; throws on any failure; never returns unverified data
}
```

Why this shape:
- **Whole M10 surface in one ADR.** Checkout (10.8), plan changes and pause (10.3, B-44, B-49), refunds (10.6, 7-day policy) and the provider's view for out-of-order webhooks (10.2) are all on the port now, so later M10 tasks need no further contracts ADR. Payouts are not on the port: an MoR pays Edmate, and pilot payouts to teachers are manual (10.4).
- **Data minimisation.** The only Edmate data sent to a provider is `subscriptionId` (metadata), the offer name and price. No student id, name, email or age: the MoR's hosted checkout collects the buyer's own details.
- **Fail closed.** `parseWebhook` throws on a missing or bad signature, a stale timestamp (where the provider signs one), malformed JSON, an unknown provider status, or a subscription event without Edmate's `subscriptionId`. An unknown status is never mapped to `active`.
- **Provider-neutral callers.** Callers get an adapter only from `paymentsFor(market)` (checkout, plan changes) or `forProvider(id)` (the webhook route in 10.2). Razorpay later = one adapter file plus `provider: razorpay` in `IN.yaml`.
- `Entitlement.status` is reused for `ProviderSubscription.status` (same enum, by reference in Zod).

Alternative for the ADR's "Alternatives" section: define the port inside `packages/payments` (no contracts change). Not chosen: ADR-0002 puts every port in contracts so adapters and callers depend on contracts only, and the normalised event must be a shared Zod schema that the web route and the worker both parse.

### `packages/payments` (Phase B)

- `src/errors.ts`: `PaymentsError { code; retryable }` with codes `invalid_signature`, `stale_signature`, `malformed_event`, `unsupported`, `not_found`, `conflict`, `validation`, `rate_limited`, `provider_error`. It builds its own messages, drops `cause`, and its `toJSON` has no request data (same discipline as `GatewayError`).
- `src/webhook/hmac.ts`: timing-safe HMAC-SHA256 checks (`node:crypto` `timingSafeEqual`, length check first so it never throws on a short value). Several candidate signatures are allowed (secret rotation), plus an optional signed-timestamp tolerance check. Both the fake and the real adapter use it.
- `src/registry.ts`: `createPaymentsRegistry({ adapters, locales })` returns `paymentsFor(market)` and `forProvider(id)`. A duplicate provider id throws at construction. A market whose pack says `tbd`, or names a provider with no adapter, gets `PaymentsError('unsupported')` at lookup: no checkout, fail closed.
- `src/testing/fakePayments.ts` (export `@edmate/payments/testing`): an in-memory adapter with an injected clock and a configurable `provider` id, signature style (`timestamped` like Paddle, `body-only` like Lemon Squeezy and Razorpay) and status words. `emit(...)` produces correctly signed raw webhook bodies for 10.2/10.3/10.8 tests; failures can be injected. The fake is test-only: the web app keeps the 9.3 no-payment start until 10.8.
- `src/secret.ts`: a small local `Secret` wrapper (reveal-once style; `toJSON`/`inspect` redacted). It is copied in rather than imported from `@edmate/gateway`, so payments does not depend on the model gateway.

### The MoR adapter (Phase C, after Q1/Q2)

Written for Paddle (recommended). If the human picks Lemon Squeezy, the same files are written as `lemonsqueezy/`, with the differences listed under Q1.
- Plain `fetch` (injected), with no provider SDK, so key handling and tests stay under our control (the same reasoning as 2.2). Base URL comes only from `EDMATE_PADDLE_ENVIRONMENT` (`sandbox`, the default, or `production`), never from an arbitrary URL, so a key can't be sent elsewhere. Every request has a timeout and an abort signal.
- Keys come only from the environment, read once at startup by `src/providers/paddle/keys.ts`: `EDMATE_PADDLE_API_KEY` and `EDMATE_PADDLE_WEBHOOK_SECRET`. A missing or placeholder value fails with an error that names the variable, never the value. Empty entries go in `docker/env.example`.
- Offer → provider price: adapter-internal (catalog price keyed by `packageVersionId` in custom data, or a non-catalog price). Phase C confirms which with **one** `docs-lookup` call (see Allowed tools); the port does not change either way.
- Status map (a test table): `trialing→trial, active→active, past_due→past_due, paused→paused, canceled→ended`; anything else throws `malformed_event`.
- Event map: subscription.* → `subscription` snapshot; transaction completed → `payment_succeeded` (amount, tax, fee and net from the provider's totals); transaction payment failed → `payment_failed`; adjustment (refund) → `refund`; everything else → `ignored`. Raw provider payloads are Zod-parsed with provider schemas in `schemas.ts` before mapping.
- Error map: 401/403 → `provider_error` (not retryable; a bad key is never `unauthorized`); 404 → `not_found`; 409 → `conflict`; 400/422 → `validation`; 429 → `rate_limited` (retryable); 5xx and timeout → `provider_error` (retryable).
- `content/locales/US.yaml`: `payments: { methods: [card], provider: paddle }`. Only this line changes. The signed compliance block is untouched; `global.yaml` and `IN.yaml` stay `tbd`.

## Phase A: Port, schemas and ADR (contracts) · about 60 tool calls · builder: tdd-guide

Before the build: the lead runs `architect` on this section's draft to get the ADR text (and any change to the port shape). The builder writes the file.

Files:
- Create: `docs/adr/0015-payments-port.md` (next free number at build time; `python3 docs/adr/check-headings.py` passes), `packages/contracts/src/payments.ts` (`PaymentOfferSchema`, `ProviderSubscriptionSchema`, `PaymentEventSchema` + types), `packages/contracts/fixtures/valid/payments.ts`, `packages/contracts/fixtures/invalid/payments.ts`.
- Modify: `packages/contracts/src/ports.ts` (the `Payments` interface), `packages/contracts/src/index.ts` (exports), `packages/contracts/fixtures/index.ts` (register the 3 schemas), `packages/contracts/test/spec-types.ts` and `docs/edmate-harness-build-plan.md` Core contracts block (identical text, new `// ---- Payments (ADR-0015) ----` section and the port under Ports), `packages/contracts/test/types.test.ts`, `packages/contracts/test/registry.test.ts` (count 36 → 39, title names ADR-0015; one valid fixture per `PaymentEvent` variant).

Tests first:
1. `types.test.ts`: `C.Payments`, `C.PaymentOffer`, `C.ProviderSubscription`, `C.PaymentEvent` equal the spec types; `Payments` methods return Promises of the schema types.
2. `registry.test.ts`: 39 schemas; `PaymentEvent` fixtures cover all 5 variants.
3. Invalid fixtures (each rejected): float, negative or zero offer price; lowercase or 2-letter currency; `interval: 'year'`; `trialDays` 0 or 91; unknown status; `scheduled.change = 'plan'` without `packageVersionId` (and `packageVersionId` with `cancel`); `payment_succeeded` whose amount, tax and fee currencies differ; empty `eventId`; non-ISO `occurredAt`; extra keys (strict objects); `ignored` with an empty `providerType`.
4. spec-drift, round-trip and hardening tests stay green with no edits beyond the above.

State after Phase A: the port and schemas exist and are reviewed. Nothing implements or calls them yet. The ADR is Accepted after the three reviewers.

## Phase B: `packages/payments`, the fake adapter and the shared contract suite · about 70 tool calls · builder: tdd-guide

Files (all new unless noted):
- `packages/payments/package.json` (`@edmate/payments`; deps `@edmate/contracts`, `zod` at the repo's pinned versions; dev deps as in `packages/gateway`; exports `.` and `./testing`; scripts `typecheck`, `lint`, `test`, `test:live`), `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` (no-network setup file; `*.live.test.ts` excluded; 80% package floor; 100% on `src/webhook/**`, `src/registry.ts`, `src/errors.ts`, `src/testing/**`), `vitest.live.config.ts`, `README.md`.
- `src/index.ts`, `src/errors.ts`, `src/secret.ts`, `src/webhook/hmac.ts`, `src/registry.ts`, `src/testing/index.ts`, `src/testing/fakePayments.ts`.
- `test/setup/no-network.ts`, `test/helpers/fake-secret.ts` (key-shaped values built at runtime; never a literal), `test/contract/suite.ts`, `test/fake.test.ts`, `test/hmac.test.ts`, `test/errors.test.ts`, `test/registry.test.ts`, `test/second-provider.test.ts`.
- Modify: `pnpm-lock.yaml` (from `corepack pnpm install`).

Tests first:
1. `hmac.test.ts`: a valid signature passes; a tampered body, wrong secret, other-length, non-hex or empty signature fails without throwing; any of several signatures may match (rotation); a timestamp older or further in the future than the tolerance gives `stale_signature`.
2. `errors.test.ts`: every code; no secret fragment in message, stack, JSON or inspect output; `cause` is never kept.
3. `registry.test.ts`: `paymentsFor('US')` returns the adapter named by the US pack; `tbd`, an unknown provider or an unknown market gives `unsupported`; a duplicate provider id throws at construction; `forProvider` works for the webhook route.
4. `contract/suite.ts` (run by `fake.test.ts` for both signature styles): checkout returns an https URL and the same result for the same idempotency key. A signed checkout-completed webhook gives a `subscription` event (trial or active) carrying Edmate's `subscriptionId`. `changePlan` now is applied and prorated; at period end it sets `scheduled.change = 'plan'`. Pause now or at period end, then resume. Cancel now gives `ended`; at period end it sets `scheduled`. Full and partial refund. `getSubscription` returns the current view. `parseWebhook` rejects a missing header, a bad signature, a tampered body, a stale timestamp (only when the adapter declares `signsTimestamp`), malformed JSON, an unknown status, and a subscription event without `subscriptionId`. An unknown event type gives `ignored`. Every output parses with the contracts schemas. No error or output contains the secret.
5. `second-provider.test.ts`: acceptance part 2, as in "How it is shown".

State after Phase B: `@edmate/payments` builds and is tested. Callers (10.2, 10.3, 10.8) can code against the port and the fake. No real provider exists, and no app imports the package yet.

## Phase C: The MoR adapter (Paddle unless the human picks otherwise) · about 75 tool calls · builder: tdd-guide · **blocked on Q1 and Q2**

Files:
- Create: `packages/payments/src/providers/paddle/{adapter.ts,client.ts,webhook.ts,schemas.ts,mapping.ts,keys.ts,index.ts}`, `packages/payments/test/fixtures/paddle/*.ts` (hand-built bodies shaped from the provider's sandbox API docs; ids are obvious fakes; no recorded data with real ids), `test/helpers/fetch-mock.ts`, `test/paddle.test.ts` (shared suite), `test/paddle-webhook.test.ts`, `test/paddle-mapping.test.ts`, `test/paddle-keys.test.ts`, `test/live/paddle.sandbox.live.test.ts` (skips unless `EDMATE_LIVE_TESTS=1` and the sandbox variables are set).
- Modify: `packages/payments/src/index.ts`, `packages/payments/package.json` (no new runtime deps expected), `packages/payments/vitest.config.ts` (100% on `src/providers/**`), `packages/payments/README.md`, `docker/env.example` (three empty `EDMATE_PADDLE_*` entries with the usual never-commit note), `content/locales/US.yaml` (payments line only), `pnpm-lock.yaml` if touched.

Tests first:
1. `paddle.test.ts`: the unchanged shared suite with the Paddle driver (fetch-mock + fixtures). Requests go only to the sandbox base URL, carry `Authorization: Bearer <fake key>`, and send no student data, only `subscriptionId` in custom data.
2. `paddle-webhook.test.ts`: signature header parsing (timestamp plus one or more signatures), the tolerance window, a body re-serialised instead of raw fails, and the event-type map table.
3. `paddle-mapping.test.ts`: the status table; an unknown status throws; money is integer minor units (string amounts parsed exactly, with no floats).
4. `paddle-keys.test.ts`: missing, empty or placeholder variables name the variable only; `production` is used only when set exactly; an unknown environment value fails at startup.
5. Live sandbox flow (human-run, not CI): create the price/offer, open a checkout and read it back; for a sandbox subscription created once by the human through the hosted checkout with a test card (`EDMATE_PADDLE_SANDBOX_SUBSCRIPTION_ID`), run plan change now and at period end, pause and resume, then a cancel at period end that is then undone; check a signed sandbox webhook (simulation) with `parseWebhook`.
6. `packages/content` tests stay green after the `US.yaml` edit (lesson "Red CI from changes that passed locally").

State after Phase C: the US MoR adapter is behind the port and wired to the US market through the locale pack. 10.1 closes after the human's live sandbox run passes; 10.2 (webhook route and idempotent storage) can start.

## Files out of bounds (all phases)
`packages/db/**` (no migration; `subscriptions.provider_ref` already exists), `apps/web/**` including `app/api/webhooks/**` (10.2) and checkout (10.8), `apps/worker/**`, `packages/harness/**` (never imports payments), `packages/gateway/**`, the state machine (10.3), ledger and payouts (10.4/10.5), invoices (10.6), `content/locales/IN.yaml` and `global.yaml`, `.claude/**`, `.github/**`. A needed change in any of these means stop at PARTIAL.

## Risky paths touched
Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- Phase A: `packages/contracts/**` and `docs/adr/**` → **architect, security-reviewer, typescript-reviewer**. The handoff logs `risk: high` (ADR-0015, new port). `docs/edmate-harness-build-plan.md`: no match.
- Phase B: `packages/payments/**` → **security-reviewer**, with a `risk: high` entry. Also recommended: typescript-reviewer, silent-failure-hunter (error and fail-closed paths) and code-reviewer.
- Phase C: `packages/payments/**` → **security-reviewer**; `content/locales/US.yaml` → **code-reviewer** (safety group; MVP-first rule); one `risk: high` entry covering both. Also recommended: silent-failure-hunter. `docker/env.example` and `pnpm-lock.yaml`: no match.
- No harness, guardrail, prompt-pack or migration path is touched.
- Shared files: `packages/payments/{package.json,src/index.ts,vitest.config.ts,README.md}` and `pnpm-lock.yaml` change in B and C, which run one after the other. Phase A edits `packages/contracts/{src/ports.ts,src/index.ts,fixtures/index.ts,test/*}` and the build plan's Core contracts block, so the lead must not run another contracts task alongside Phase A (no-shared-files rule).

## Decisions (to copy into the handoffs' `## Decisions`)
- **10.1a The `Payments` port and its data live in contracts (ADR-0015)** · planner + architect · risk: high. Port as drafted above; `PaymentOffer`, `ProviderSubscription` and `PaymentEvent` are Zod schemas. Alternative: the port inside `packages/payments`. Reversible: only by ADR.
- **10.1a Adapters verify and normalise webhooks; 10.2 owns storage, idempotency and ordering** · risk: high. A signature scheme is provider-specific, so it sits behind the port; storing the event id and applying events in order is provider-neutral, so it stays in 10.2.
- **10.1a Nothing personal goes to the provider** · risk: high. Only Edmate's `subscriptionId`, the offer name and the price; the hosted checkout collects the buyer's details.
- **10.1b Market → provider comes from the locale pack; `tbd` or an unwired provider refuses checkout** · risk: high.
- **10.1b An unknown provider status or event shape fails closed** · risk: high. It is never mapped to `active`.
- **10.1b A local `Secret` copy; no dependency on `@edmate/gateway`** · risk: low.
- **10.1c Plain fetch, no provider SDK; base URL only from the environment switch** · risk: low (the builder logs version pins as usual).
- **10.1c US locale pack names the provider** · risk: high (content/locales).

## Open questions
- **Q1 (human; blocks Phase C only): Paddle or Lemon Squeezy?** **Recommendation: Paddle.** The facts below are from memory, not looked up, so confirm current terms at sign-up.
  - Subscriptions: both have them. Paddle Billing has a fuller API: explicit proration modes (prorate now, prorate next period, do not bill), so the PRD's "upgrade now prorated, downgrade at period end" maps directly.
  - Pause: Paddle pauses natively, now or at period end, and resumes (fits B-49 and 9.6). Lemon Squeezy pauses through a "void or free" mode.
  - Webhook signing: Paddle signs `timestamp:body` (HMAC-SHA256 with a timestamp, so replays are bounded). Lemon Squeezy signs the body only (`X-Signature`, no timestamp), so replay protection rests entirely on 10.2's event-id store.
  - Sandbox: Paddle has a separate sandbox environment with its own keys, checkout and webhook simulator. Lemon Squeezy has a test mode in the same account.
  - Payouts and splits: neither does split payments to teachers. Both pay Edmate, which then pays teachers manually; this matches the pilot spec (10.4), so it does not decide between them.
  - Fees: both are about 5% + $0.50 per transaction (Lemon Squeezy adds surcharges for some payment types). On a $10/month package that is about 10%, which matters for the floor price (PRD revenue share).
  - Risk: Lemon Squeezy was acquired by Stripe in 2024 and its roadmap is less certain.
- **Q2 (human; blocks Phase C and any paid pilot): will the MoR accept Edmate's model?** From memory (unverified), MoRs sell software and digital products and restrict marketplaces and services delivered by people. Edmate sells subscriptions to its own AI tutor, but packages include teacher-led live classes and Edmate pays teachers a share. **Recommendation:** before Phase C, describe Edmate to the chosen provider in writing as "Edmate sells subscriptions to its AI tutoring software; teachers are paid by Edmate as content suppliers; live classes are an included feature" and get their approval (Paddle reviews every account; start early, because approval can take days). If refused, the fallback is Stripe Billing with Stripe Tax (Edmate then registers for and files US sales tax itself). That would be a new human decision, and the port would not change.
- **Q3 (lead/architect; before Phase A): confirm the port draft**, in particular that the whole M10 surface (refund, getSubscription, pause `when`) goes into one ADR now. **Recommendation:** yes, so 10.2–10.8 need no further contracts ADR.
- **Q4 (human; not blocking 10.1, feeds 10.8): who pays for learners aged 13–17?** MoR terms usually require an adult buyer. **Recommendation:** for the pilot, the person paying confirms they are 18 or older or the learner's parent or guardian, at checkout in 10.8.
- **Q5 (human; not blocking 10.1, feeds 10.3 and 12.2): days left in a period when a takedown pauses a subscription (B-49).** **Recommendation:** credit the unused days on resume; refund them if the agent is not restored within 30 days.
- Risk to carry into 10.2 and 10.8: two checkouts can both complete for one Edmate subscription (a double click, or retries where the provider has no idempotency keys). The unique "one live subscription per pair" index plus a 10.2 rule (a second completed checkout for an already-live subscription is refunded or cancelled) covers it.
- Lookups: none made while planning (no docs-lookup, no web). Phase C may use one `docs-lookup` for the chosen provider's webhook signature format and tolerance, its proration, pause and resume parameters, and price handling.

## Budget
Budget: 205 tool calls (3 phases: A 60, B 70, C 75; packages contracts and payments, plus docs/adr, the build plan's Core contracts block, docker/env.example and content/locales/US.yaml)

## Allowed tools
Read, Grep, Glob, Edit, Write; Bash for `corepack pnpm install`, `corepack pnpm turbo run typecheck lint test --filter=<pkg>...`, `python3 docs/adr/check-headings.py`, `python3 .githooks/secret-scan.py --all` and git on the phase's own branch. No web access. In Phase C only, one `docs-lookup` call for the provider facts listed under Open questions. No live provider calls by any agent (`test:live` is run by the human).

## Exit conditions
- **Status: DONE** (per phase): every test in the phase's "Tests first" list exists and passes; `typecheck lint test` is green for `@edmate/contracts...` (A) or `@edmate/payments...` (B, C; plus `@edmate/content...` in C); coverage thresholds are met; the secret scan is clean; the handoff has the evidence table rows for this phase, a `risk: high` decision and `Tool calls used:`.
- **Status: PARTIAL**: past the phase's cap plus 15% (A 69, B 80, C 86 calls); or a file outside the phase's list needs changing (above all `packages/db`, `apps/**` or `packages/harness`); or the architect's ADR text changes the port in a way the Phase B and C tests above don't cover (stop and ask the lead to re-plan).
- **Status: BLOCKED**: Phase C started before Q1 and Q2 are answered; or a fixture would need a real key, id or personal data.

## Lead answers (22 Oct 2026)
- Q3: yes. One ADR (0015) covers the whole M10 port surface now (refund, getSubscription, pause `when`), so 10.2-10.8 need no further contracts ADR. The architect drafts the text before Phase A; the Phase A builder writes the file.
- Q1 and Q2 are with the human as B-53; Phase C waits. Q4 and Q5 are with the human as B-54 (they feed 10.3 and 10.8, not 10.1).
