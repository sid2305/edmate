# 10.1a review — APPROVE

Reviewers: architect, security-reviewer, typescript-reviewer

All three reviewed the build (433e111), and all three re-verified the fix round (c129f1e). The port is provider-neutral and holds no personal data. Money is in integer minor units, every write takes an idempotency key, and webhooks are verified over the raw bytes before parsing. B-53 and B-54 are not decided early. The fix exported the helper schemas, tightened the offer-name and provider-ref rules, and added ADR notes on caller-claimed keys, server-set binding, occurredAt, proration, clearScheduled, B-54 and event ids. The typescript re-verify found that the fix had dropped the ADR's refund safeguard; the lead restored the original sentence (§3) and added the 10.8 note on format characters.

## Findings
- [MEDIUM] [fixed] docs/adr/0015-payments-port.md:70 — a stateless adapter can't keep the idempotency promise; the caller now claims the key in a unique DB row, and adapters send it in metadata.
- [MEDIUM] [fixed] docs/adr/0015-payments-port.md:72 — webhook binding trusted buyer-editable metadata; adapters now read it only from server-set data, and 10.2/10.8 match the checkout intent and pin providerRef.
- [MEDIUM] [fixed] packages/contracts/src/payments.ts:32 — the idempotency key, provider ref, checkout and refund result shapes were comments only; they are now exported helper schemas.
- [MEDIUM] [fixed] docs/adr/0015-payments-port.md:76 — B-54 options now map onto the port without deciding them.
- [MEDIUM] [fixed] docs/adr/0015-payments-port.md:70 — the fix round dropped "check existing refunds before refunding"; the lead restored it.
- [LOW] [fixed] packages/contracts/src/payments.ts:36 — the offer name now refuses NEL, bidi and zero-width characters and needs a letter or digit.
- [LOW] [fixed] packages/contracts/src/payments.ts:32 — a ProviderRef needs a letter or digit ('..' fails).
- [LOW] [fixed] packages/contracts/src/ports.ts:196 — `proration: 'none'` is limited to the scheduled-downgrade fallback (ADR §4).
- [LOW] [fixed] packages/contracts/src/formats.ts:15 — consumers compare occurredAt as instants (ADR §5).
- [LOW] [fixed] packages/contracts/src/ports.ts:211 — clearScheduled also clears a scheduled resume.
- [LOW] [fixed] docs/adr/0015-payments-port.md:47 — a provider with no delivery id uses SHA-256 of the raw body as eventId.
- [LOW] [fixed] packages/contracts/fixtures/invalid/payments.ts:52 — the tuple tables are typed, with no cast.
- [LOW] [fixed] packages/contracts/test/types.test.ts:143 — a ts-expect-error covers period_end with a proration.
- [LOW] [fixed] packages/contracts/src/payments.ts:61 — the 10.8 note covers trialDays 0 and name normalising.
- [LOW] [deferred 10.1b] packages/contracts/src/ports.ts:177 — one shared input check (key, https returnUrl) that every adapter calls, tested in the suite.
- [LOW] [deferred 10.1b] packages/contracts/src/ports.ts:218 — refund with amount omitted means a full refund; test it or make it explicit.
- [LOW] [deferred 10.1b] packages/contracts/src/payments.ts:138 — a PaymentsErrorCode union pinned to ADR §7.
- [LOW] [deferred 10.1b] packages/contracts/src/ports.ts:222 — restore the refund JSDoc line "checks existing refunds first" and cover refund in the timeout-retry test.
- [LOW] [deferred 10.1b] docs/adr/0015-payments-port.md:71 — clearScheduled with nothing scheduled returns the current snapshot (state and test).
- [LOW] [deferred 10.1b] packages/contracts/src/payments.ts:69 — the offer name still accepts lone surrogates, private-use and Hangul filler characters; also add a ZWJ-emoji case so refusing it is deliberate.
- [LOW] [deferred 10.2] packages/contracts/src/payments.ts:168 — a standalone PaymentFactSchema parse skips the snapshot-provider check; queue the whole PaymentEvent or re-check the provider.
- [LOW] [deferred 10.8] docs/adr/0015-payments-port.md:74 — match snapshots on subscriptionId and packageVersionId, and payments on amount (net of tax) against price.
