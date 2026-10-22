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
payments tests: `Tests  141 passed | 1 skipped` (the skip is the stale-timestamp case for the body-only style, which has no signed timestamp). Coverage: all files 99%+. `src/webhook/**`, `src/registry.ts`, `src/errors.ts` and `src/testing/**` are at 100% and enforced by thresholds.

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
