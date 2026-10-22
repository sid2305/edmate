# 10.1a handoff: Payments port, schemas and ADR-0015 (10.1 Phase A)

Status: DONE

- Branch: `m10/10.1a-payments-port` (built on local `work-101a`)
- Worktree: `.claude/worktrees/agent-a4591c541207852d0` (under the repo root)
- Plan: `docs/tasks/10.1/plan.md` (Phase A); ADR text from architect (the ADR wins over the plan's port draft)
- Builder: tdd-guide
- Tool calls used: 42

## Summary

The `Payments` port (type-only, `ports.ts`) and its data (`PaymentOffer`, `ProviderSubscription`, `PaymentEvent` with the `PaymentFact` union) now exist in `packages/contracts`, as ADR-0015 describes. `ProviderId` and `ProviderRef` are exported string aliases. The Core contracts block in the build plan and `test/spec-types.ts` get the same new `// ---- Payments (ADR-0015) ----` section (data types and the port together, placed just before `// ---- Ports`). ADR-0015 is the architect's text word for word, status Proposed. Nothing implements or calls the port yet.

## Files

- New: `docs/adr/0015-payments-port.md`, `packages/contracts/src/payments.ts`, `packages/contracts/fixtures/valid/payments.ts`, `packages/contracts/fixtures/invalid/payments.ts`, `packages/contracts/test/payments.test.ts`
- Changed: `packages/contracts/src/ports.ts` (`Payments`), `packages/contracts/src/index.ts` (one export line), `packages/contracts/fixtures/index.ts` (3 schemas registered, fixtures exported), `packages/contracts/test/spec-types.ts` and `docs/edmate-harness-build-plan.md` (Core contracts block only; identical text), `packages/contracts/test/types.test.ts`, `packages/contracts/test/registry.test.ts` (36 → 39), `packages/harness/src/testing/fixtures.test.ts` (36 → 39; see Deviations)

## Tests

| Item | Evidence |
|---|---|
| Contracts are consistent | `corepack pnpm turbo run typecheck lint test --filter=...@edmate/contracts` → `Tasks: 41 successful, 41 total` (contracts plus every dependant: harness, gateway, db, ingest, content, web, worker and the rest). `--filter=@edmate/contracts...` → `Tasks: 6 successful, 6 total`. |
| Types equal the spec | `types.test.ts`: `C.Payments`, `PaymentOffer`, `ProviderSubscription`, `PaymentFact`, `PaymentEvent`, `ProviderId`, `ProviderRef` `toEqualTypeOf` the spec; every write returns `Promise<ProviderSubscription>`; `parseWebhook` takes `Uint8Array` (a string is refused); `changePlan` `'now'` without `proration` doesn't type-check; `refund` returns only a ref and `pending`/`succeeded`; status = `Entitlement['status']`. |
| Registry | `registry.test.ts`: 39 schemas; `PaymentEvent` fixtures cover all 4 fact types, an empty facts list and a multi-fact (Razorpay-style) delivery; `ProviderSubscription` fixtures cover all 5 statuses. |
| Invalid fixtures | 51 cases, each rejected at its expected path (`roundtrip.test.ts`): float, negative or zero offer price; lowercase or 2-letter currency; `interval: 'year'`; `trialDays` 0, 91 or `undefined`; blank, two-line or >120-character name; unknown status; `tbd`, upper-case or 1-letter provider; bad or too-long ref; plan scheduled without `packageVersionId` and cancel with one; tax or fee currency mismatch or above the amount; zero refund; empty `eventId`; non-ISO `occurredAt`; empty or prose `providerType`; 5 facts; old `ignored` variant; snapshot from another provider; extra keys (buyer email, card digits, raw body). |
| Boundaries | `payments.test.ts` (12 tests): both sides of every cap (trialDays 1/90, name 120 code points, provider id 2/32/33, ref 128, 4 facts, providerType 64, tax = amount), control characters in the name, unicode and zero-width in refs. |
| spec-drift, round-trip, hardening | Green with no edits. |
| ADR headings | `python3 docs/adr/check-headings.py` → exit 0, no output. |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0, no output. |

## Deviations

- `packages/harness/src/testing/fixtures.test.ts`: one line, the pinned schema count 36 → 39 (plus its comment). The plan lists `packages/harness/**` as out of bounds, but this test re-checks the contracts registry count, so without the edit the dependants gate is red. It is test-only, and `src/testing/` is not a risk path. No harness runtime code changed, and harness still never imports payments.
- No departures from the ADR text. The file is the architect's draft, unchanged.

## Decisions

### 22 Oct 2026 · 10.1a The Payments port and its data live in contracts (ADR-0015) · decided by planner + architect · risk: high
- Decided: `Payments` is a type-only port in `ports.ts`; `PaymentOffer`, `ProviderSubscription` and `PaymentEvent` (with its `PaymentFact` union) are strict Zod schemas in `packages/contracts/src/payments.ts`; one ADR covers the whole M10 surface (checkout, plan change with proration, pause, resume, cancel, clearScheduled, getSubscription, refund, parseWebhook). Reviewers required: architect, security-reviewer, typescript-reviewer (risky paths `packages/contracts/**` and `docs/adr/**`).
- Why: ADR-0002 puts every port in contracts, and the normalised event must be one shared schema that the web route and the worker both parse. Alternative (port inside `packages/payments`) not chosen. Reversible only by ADR.
- risk: high

### 22 Oct 2026 · 10.1a Adapters verify and normalise webhooks; 10.2 owns storage, idempotency and ordering · decided by planner + architect · risk: high
- Decided: `parseWebhook` takes the raw bytes and verifies before parsing; `(provider, eventId)` storage and newest-snapshot ordering stay in 10.2.
- Why: a signature scheme is provider-specific, so it sits behind the port; storage and ordering are provider-neutral.
- risk: high

### 22 Oct 2026 · 10.1a Nothing personal goes to the provider · decided by planner + architect · risk: high
- Decided: only Edmate's `subscriptionId` and `packageVersionId` (opaque ids), the offer name and price, the return URL and the idempotency key are sent. The strict schemas carry no buyer email, name, address or card data, and extra keys are rejected.
- Why: the hosted checkout collects the buyer's details; the repo is public and card data must never touch Edmate.
- risk: high

### 22 Oct 2026 · 10.1a Schema details the ADR left open · decided by builder · risk: low
- Decided: (1) a provider id of `tbd` is rejected by the schemas, not only by the registry; (2) `providerType` uses the same narrow charset as refs (letters, digits, `_ . : -`, 1..64), so it can't carry payload text; (3) a `PaymentEvent` whose `subscription` fact names a different provider than the event fails; (4) the offer name refuses blank text and any control character or line separator, and its 120 cap counts code points; (5) the caps are exported as `PAYMENT_LIMITS` (not added to the shared `LIMITS`); (6) the `PaymentFact` schema is not exported as `*Schema` (the type is), so the registry has the ADR's 39 schemas.
- Why: each makes the "fail closed" and "never payload text" rules in ADR-0015 concrete. All are narrower than the ADR, so adapters that follow the ADR still pass.
- risk: low

### 22 Oct 2026 · 10.1a Harness fixtures test count bumped with the registry · decided by builder · risk: low
- Decided: changed the harness test's pinned schema count from 36 to 39, even though the plan lists `packages/harness/**` as out of bounds.
- Why: that test mirrors the contracts registry count, and the dependants gate needs it. It is test-only and outside every risk path.
- risk: low

## Left to do

- Reviews: architect, security-reviewer, typescript-reviewer; then the lead marks ADR-0015 Accepted and logs the `risk: high` decision.
- Phase B (10.1b): `packages/payments`, the fake adapter, the shared contract suite. Phase C (10.1c) waits on B-53 (provider choice and the MoR's written OK).
- Follow-ups in the ADR's Consequences (10.2 keys, 10.8 pending state) are for later tasks.
