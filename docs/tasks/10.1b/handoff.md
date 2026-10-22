# 10.1b handoff: packages/payments (10.1 Phase B)

Status: DONE

Branch: `m10/10.1b-payments-package` (built on local `work-101b`)
Worktree: `.claude/worktrees/agent-ac962567e16c620fa`
Plan: `docs/tasks/10.1/plan.md` Phase B; port rules from `docs/adr/0015-payments-port.md`.

## Summary

New package `@edmate/payments`: the `PaymentsError` type with the ADR-0015 §7 codes, one shared
input check every adapter calls, timing-safe webhook signature checks, the market-to-provider
registry, a local `Secret`, and a test fake (`@edmate/payments/testing`) that passes a
provider-neutral contract suite for two signature styles. A second-provider test shows one caller
running unchanged against two providers chosen only by market. It also covers the 10.1a review
LOWs from the board title, including two small contracts edits (the offer-name rule and the
refund JSDoc line). No app imports the package yet. Phase C (the real MoR adapter) was not started;
it waits on B-53.

## Evidence

| Item | Evidence |
|---|---|
| A second provider needs no caller change | `test/second-provider.test.ts`: `checkoutThenPause` runs unchanged for US (`paddle`, timestamped header, Paddle-like words) and IN (`razorpay`, body-only header, other status words), picked only through `paymentsFor(market)`, with webhooks through `forProvider(id)`. A delivery for one provider is refused by the other's route. |
| The port contract holds for every adapter | `test/contract/suite.ts` (`describePaymentsContract`: setup + scenario driver + capability flags) runs in `test/fake.test.ts` for `timestamped` and `body-only`. Every output is parsed by the contracts schemas. |
| No real network in tests | `test/setup/no-network.ts` replaces global `fetch` and makes `net.connect`, `net.createConnection`, `Socket#connect` and `tls.connect` throw. |
| No secrets leak | The suite collects outputs and errors (JSON, `util.inspect` with hidden fields, `String`, stacks) and checks that no 8-character fragment of either webhook secret appears. Secrets are built at runtime (`test/helpers/fake-secret.ts`). `errors.test.ts` covers `cause` and leaks too. |
| Contracts consistent | The contracts tests (spec-drift, registry, round-trip, types) are green in the gate below. |

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/payments... --filter=...@edmate/contracts`
```
 Tasks:    47 successful, 47 total
```
payments tests (after the 22 Oct fix round): `Tests  579 passed | 20 expected fail | 2 skipped (601)`. The 2 skips are the stale-timestamp and rewritten-timestamp cases for the body-only style, which has no signed timestamp. The 20 expected fails are the mutant self-test cases (`it.fails`), listed below. contracts: `444 passed`. Coverage: all files 99%+. `src/webhook/**`, `src/registry.ts`, `src/errors.ts` and `src/testing/**` are at 100% and enforced by thresholds.

`python3 .githooks/secret-scan.py --all` → no output, exit 0.

## Files

- New: `packages/payments/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,vitest.live.config.ts,README.md}`
- New src: `src/index.ts`, `src/errors.ts`, `src/input.ts`, `src/secret.ts`, `src/registry.ts`, `src/webhook/hmac.ts`, `src/webhook/body.ts`, `src/testing/index.ts`, `src/testing/fakePayments.ts`
- New tests: `test/setup/no-network.ts`, `test/helpers/{fake-secret.ts,fake-driver.ts}`, `test/contract/suite.ts`, `test/{fake,hmac,errors,registry,second-provider,offer-name,secret}.test.ts`
- Modified: `packages/contracts/src/payments.ts` (the offer-name character class only), `packages/contracts/src/ports.ts` (refund JSDoc only), `pnpm-lock.yaml`

## Tests

- `errors.test.ts`: the code list is pinned to the ADR §7 list, in both directions at compile time. It also covers the fixed words for every code, the retry rule, no `cause`, and no leaks in message, stack, JSON or inspect.
- `hmac.test.ts`: covers a valid signature (either hex case); a tampered body; a wrong secret; signatures that are the wrong length, too long, non-hex or empty (none of these throws); rotation across several signatures and secrets; the timestamp tolerance edges (±300 s pass, ±301 s give `stale_signature`); a tolerance over 300 s; the 1 MiB cap; header lookup (own keys only); and bad JSON or bad UTF-8.
- `registry.test.ts`: the US and IN packs; `tbd`, an unwired provider, an unknown market and `__proto__`/`constructor` give `unsupported`; `forProvider`; duplicate providers or markets give `conflict` at construction; a bad or `tbd` adapter id gives `validation`.
- Contract suite:
  - Checkout: an https URL; the same key gives the same result; the same key with other input gives `conflict`.
  - The shared input check: a bad key gives `validation` on all seven writes before any work; an http, `javascript:` or empty return URL; a bad offer, ref or refund amount, or an extra field.
  - A completed checkout (trial and active) produces a `subscription` fact carrying `subscriptionId`, with the buyer's email dropped.
  - Plan changes: now with prorate (one prorated charge), now with none (no charge), and at period end (scheduled, and a repeat returns the snapshot).
  - Pause now, then resume; pause at period end, then `clearScheduled`; `clearScheduled` clears a scheduled resume; `clearScheduled` with nothing scheduled returns the current snapshot.
  - Cancel at period end, cancel now, and a repeated cancel.
  - `getSubscription`, and `not_found` for an unknown ref.
  - Refunds: partial, then amount omitted refunds exactly what is left (700 of 1000); amount omitted on an untouched payment is a full refund; once nothing is left another refund is `conflict`; the same key returns the same refund, while the same key with another amount is `conflict`; too much is `validation`.
  - **Retry after a timeout** (`afterApply` failure) for a plan change, a cancel and a refund: the retry with the same key returns the result, with no second charge and no second refund.
  - Webhooks: payment, refund and snapshot mapping, and an unused type gives `facts: []`. Refused: a missing header, a foreign secret, a tampered body and swapped headers; a stale or future timestamp (timestamped style only); and bad JSON, an unknown status or a missing `subscriptionId` (`malformed_event`).
  - No secret fragments anywhere.
- `fake.test.ts` specifics: the constructor's validation, repeat-safe `completeCheckout`, trial lengths, `ended` refusing writes, `scheduleResume`, a currency change giving `unsupported`, injected failures before the work and on reads, a key reused across operations, header-parsing edge cases, a configured tolerance, bad envelopes or fact data, a snapshot failing the contracts schema, and custom status words.
- `offer-name.test.ts`: refuses lone surrogates (high and low), private-use characters (BMP and supplementary), the four Hangul fillers and a ZWJ family emoji (deliberately, via `\p{Cf}`). Accepts plain words, accents and other scripts, a single emoji with no joiner, and real Hangul.

## Deviations

- The offer-name cases are tested in `packages/payments/test/offer-name.test.ts`, not as new invalid fixtures in `packages/contracts/fixtures`, so the contracts diff stays at the two lines the brief allows.
- The fake also has `charges`, `scheduleResume`, `emitRaw`, `sign` and `subscriptionBody` beyond `emit`/`failNext`, because the contract suite's scenario driver needs them (prorated-charge check, scheduled resume, malformed bodies).
- The webhook body helpers sit in `src/webhook/body.ts` (1 MiB cap, header lookup, strict JSON read) next to `hmac.ts`. `src/input.ts` is the shared input check. Neither file is in the plan's list; both serve the ADR rules and 10.1a LOWs.

## Decisions

### 22 Oct 2026 · 10.1b packages/payments: signature check, secrets and no network · decided by builder · risk: high
- Decided: Webhook signatures are checked with `timingSafeEqual` over the exact bytes, with the length checked first, every candidate and secret compared, and no early exit. A bad candidate never throws, it just doesn't match. Tolerance is at most 300 s, and a larger value is refused as `validation`. `PaymentsError` has fixed words, no `cause`, and JSON with only name, code, retryable and message. Secrets are held in a local `Secret` copy. Tests run with fetch and sockets off, and key-shaped values are built at runtime. Market to provider comes from the locale pack: `tbd`, an unknown market or a provider with no adapter gives `unsupported` (no checkout). An unknown status or a missing `subscriptionId` gives `malformed_event`, never `active`. Required reviewer: **security-reviewer** (recommended: typescript-reviewer, silent-failure-hunter, code-reviewer).
- Why: ADR-0015 §5–§8 and the plan's 10.1b decisions. `packages/payments/**` is a risky path (payments group).
- risk: high

### 22 Oct 2026 · 10.1b Two minimal contracts edits that tighten rules ADR-0015 already states · decided by builder · risk: high
- Decided: (1) In `packages/contracts/src/payments.ts`, the offer name now also refuses lone surrogates (`\p{Cs}`), private-use characters (`\p{Co}`) and the Hangul fillers U+115F, U+1160, U+3164 and U+FFA0. A ZWJ emoji is refused on purpose (U+200D is `\p{Cf}`), and a test pins it. (2) In `packages/contracts/src/ports.ts`, the refund JSDoc now says an adapter without provider idempotency checks the payment's existing refunds first and returns the one with the same key. No type, schema shape or registry count changed, and no new ADR. Required reviewers: **architect, security-reviewer, typescript-reviewer**.
- Why: 10.1a review LOWs (deferred to 10.1b). ADR-0015 §9 already says the name is one line with no hidden characters, and §3 already states the refund safeguard; these edits make the code match.
- risk: high

### 22 Oct 2026 · 10.1b The shared input check lives in packages/payments · decided by builder · risk: low
- Decided: `checkPortInput(op, input)` parses each port call with the contracts helper schemas (strict objects, so an extra field such as a student email is refused). Every failure is `validation`, and zod issues are never surfaced because they echo the input. The fake calls it first for every operation, and the suite tests it for all seven writes.
- Why: 10.1a review LOW: one check every adapter calls, so they all refuse the same input the same way.
- risk: low

### 22 Oct 2026 · 10.1b A full refund is explicit, and a fully refunded payment refuses more · decided by builder · risk: low
- Decided: When the amount is omitted, the fake refunds exactly what is left on the payment. Once nothing is left, a new refund is `conflict`. A refund larger than what is left, or in another currency, is `validation`. The refund safeguard (look up the payment's refunds by key first) is what makes a retry after a timeout safe.
- Why: 10.1a review LOW; ADR-0015 §3.
- risk: low

### 22 Oct 2026 · 10.1b A local Secret copy, with no dependency on @edmate/gateway · decided by planner · risk: low
- Decided: `src/secret.ts` is a copy of the gateway's `Secret`, with only the comments changed.
- Why: The plan's decision, so payments doesn't pull in the model gateway.
- risk: low

## Left to do

- Phase C (10.1c, the MoR adapter) is blocked on B-53 (Q1 provider, Q2 written OK).
- Deferred from 10.1a, not in this task: 10.2 (a standalone `PaymentFactSchema` parse skips the provider check) and 10.8 (matching snapshots and payments to the checkout intent).

Tool calls used: 68

## Fix round (22 Oct 2026)

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/payments... --filter=@edmate/contracts` → `Tasks: 10 successful, 10 total`; payments `579 passed | 20 expected fail | 2 skipped (601)`; contracts `444 passed`. `src/webhook/**`, `src/testing/**`, `src/registry.ts` and `src/errors.ts` stay at 100%. `python3 .githooks/secret-scan.py --all` → no output.

Per item:
1. **Blank secrets.** `Secret.of`, `matchesAnySignature` (also with no secrets at all) and the fake's constructor refuse an empty or whitespace-only secret with `validation`, the closest ADR §7 code for a configuration bug (`src/secret.ts` `isBlankSecretValue`). Tests: secret.test.ts "refuses an empty or whitespace-only value with validation (an HMAC under it is forgeable)"; hmac.test.ts "an empty or blank secret never verifies: it is validation, even next to a good one" (the old "no secrets → false" case now expects `validation`); fake.test.ts constructor checks; suite "refuses a delivery signed with an empty secret".
2. **Rewritten timestamp.** Suite "refuses a delivery whose signed timestamp was rewritten, signature unchanged" (timestamped style only; the driver's `restamp` delivery option).
3. **Exact bytes.** Suite "verifies the exact bytes: extra whitespace and unsorted keys, signed as sent, are accepted", "refuses the same JSON value in other bytes than were signed", "refuses a correctly signed body over 1 MiB; exactly 1 MiB is read".
4. **Per-operation `unsupported`.** `ContractCapabilities.unsupported?: UnsupportedOperation[]` (`changePlan.period_end`, `changePlan.proration_none`, `pause.period_end`, `cancel.period_end`, `refund`); a declared operation must throw `unsupported` after the shared input check. Wrapper test: `test/suite-mutants.test.ts` runs the suite against `unsupportedSetup` for `pause.period_end` alone and for all five.
5. **Mutants** (`test/helpers/mutants.ts`, run in `test/suite-mutants.test.ts` with `expectFailing`; each listed case runs as `it.fails`, every other case must pass, and "every case the self-test expects to fail exists and runs" proves each name exists):
   - (a) unknown status → active: "a signed body with unknown_status is malformed_event, never active", "no key or secret fragment reaches any output or error".
   - (b) idempotency key not honoured: "returns the hosted https page, and the same result for the same key", "the same key with different input is a conflict on every write".
   - (c) refund retry refunds twice: "refund: the retry returns the first refund and nothing is refunded twice", "full refund (amount omitted): the retry returns the same refund, paid out once", "same key returns the same refund; a different amount under it is a conflict; too much is validation", "the same key with different input is a conflict on every write".
   - (d) signature check skipped: "refuses a missing header, a bad signature and a tampered body", "refuses a delivery signed with an empty secret", "refuses the same JSON value in other bytes than were signed", "refuses a delivery whose signed timestamp was rewritten, signature unchanged", "a body with unknown_status signed with a foreign secret is invalid_signature (signature first)", "a body with missing_subscription_id signed with a foreign secret is invalid_signature (signature first)", "no key or secret fragment reaches any output or error".
   - (e) timestamp not signed: "refuses a delivery whose signed timestamp was rewritten, signature unchanged".
   - (f) JSON re-serialised before the check: "verifies the exact bytes: extra whitespace and unsorted keys, signed as sent, are accepted", "refuses the same JSON value in other bytes than were signed", "refuses a correctly signed body over 1 MiB; exactly 1 MiB is read".
   - (g) empty secret accepted: "refuses a delivery signed with an empty secret".
6. **LOW suite gaps.** New cases: "the same key with different input is a conflict on every write", "resume: the retry resumes once and charges once", "full refund (amount omitted): the retry returns the same refund, paid out once", "a provider state before the subscription starts gives no facts" (fake `FAKE_PRE_START_WORD = 'incomplete'`, driver event `pre_start`), "eventId is stable when the same bytes are redelivered", "accepts a delivery signed with the previous secret (rotation)", and "a body with unknown_status / missing_subscription_id signed with a foreign secret is invalid_signature (signature first)". Table cases became loops with the case named in the title; duplicate case names throw.
7. **receivedAt** is checked against the contracts ISO timestamp schema (`IsoTimestampSchema` = `ProviderSubscriptionSchema.shape.periodEnd`, since `timestamp` isn't exported) in `checkSignedTimestamp` and `checkWebhookInput`. hmac.test.ts: offset-less, date-only and RFC 2822 refused; `+05:30` and `-07:00` accepted.
8. **Fake.** `scheduleResume` validates `at` first and throws `validation` with no state change (fake.test.ts "scheduleResume refuses a bad time with validation and changes nothing"); `write<K extends KeyedOperation>` reads `idempotencyKey` without a cast. Also "a pre-start delivery for an unknown checkout is not_found".
9. **Invisible characters** in offer-name.test.ts and suite.ts are `\u{...}` escapes; a scan finds no literal left.
10. **No network.** `test/setup/no-network.ts` assigns (not spies) `fetch`, `net.connect`/`createConnection`/`Socket#connect`, `tls.connect`, `http`/`https` `get`/`request`, `dns.lookup`/`resolve`/`promises.lookup` and `dgram.createSocket`, calls `syncBuiltinESMExports()`, and re-applies before each test. Self-test `test/no-network.test.ts` (named import, `vi.restoreAllMocks()` survival).
11. **Type test** `test/input-types.test.ts`: `PortOperation` equals the port's methods minus `provider`/`parseWebhook`; `PortInput<K>` equals `Parameters<Payments[K]>[0]` for every K, plus a negative check.
12. **Not done (reverted).** Changing the PaymentOffer comment in `packages/contracts/test/spec-types.ts` fails `spec-drift.test.ts` ("spec-types.ts equals the Core contracts block of the build plan"), because the same comment lives in `docs/edmate-harness-build-plan.md` line 271, which this round may not touch. The lead should change both lines together (with the ADR-0015 amendment): `one line (no \p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}, nor the Hangul fillers U+115F U+1160 U+3164 U+FFA0), a letter or digit`.
13. Evidence count corrected above.

Deviations:
- "PortInput equals the port" is checked as mutual assignability: zod spells the same types differently (one object per `when` for changePlan, `T | undefined` for optionals), so strict identity fails on spelling only.
- The refund `amount` schema is now `.exactOptional()` so its type matches the port; an amount present as `undefined` is `validation`.
- The signed webhook timestamp is whole Unix seconds (a safe integer), not ISO; only `receivedAt` is ISO.
- Mutant runs wrap each setup in `quiet()`, which marks port promises handled: a case that fails on purpose leaves calls in flight, which would otherwise surface as unhandled rejections. Callers that await still see every rejection; the real fake runs are not wrapped.
- The "expected failing names exist" check reads the set when it runs, not at collection, because nested describes register their cases after the parent callback.

