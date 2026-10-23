# 10.1b review — APPROVE

Reviewers: architect, security-reviewer, typescript-reviewer, code-reviewer

`@edmate/payments` (errors, the webhook signature check, secrets, the fake adapter and the shared contract suite) is sound: no CRITICAL or HIGH. The reviewers found six MEDIUMs: an empty webhook secret was accepted, and the shared suite could not catch an adapter that leaves the timestamp out of the signature, re-serialises the JSON before checking it, or can't do an operation. The suite also had no proof that it catches broken adapters. One fix round (opus) fixed all six and most LOWs; seven broken fakes each fail the suite cases claimed. The security reviewer (opus) re-verified at 461bf23e: all MEDIUMs fixed, 3 new LOWs, deferred to 10.1c. The lead amended ADR-0015 §9 for the wider offer-name refusal set.

## Findings
- [MEDIUM] [fixed] packages/payments/src/webhook/hmac.ts:40 — an empty webhook secret was accepted (also secret.ts:20, fakePayments.ts:215), so anyone could forge a webhook; refused everywhere now
- [MEDIUM] [fixed] packages/payments/test/contract/suite.ts:625 — the suite could not catch an adapter that leaves the signed timestamp out of the HMAC; a rewritten timestamp is now refused
- [MEDIUM] [fixed] packages/payments/test/contract/suite.ts:588 — the suite could not catch an adapter that re-serialises the JSON before verifying; exact-bytes cases added
- [MEDIUM] [fixed] packages/payments/test/contract/suite.ts:70 — no per-operation `unsupported` capability, so a correct adapter that throws `unsupported` (ADR §3/§4) would fail the suite
- [MEDIUM] [fixed] packages/payments/test/fake.test.ts:1 — nothing proved the suite catches a broken adapter; seven mutant fakes now fail the claimed cases
- [MEDIUM] [fixed] docs/adr/0015-payments-port.md:77 — §9 listed only Cc/Cf/Zl/Zp while the code also refuses Cs, Co and the Hangul fillers; dated amendment line, 10.8 note, spec-types.ts and build plan comment updated (lead)
- [LOW] [fixed] packages/payments/test/contract/suite.ts:550 — missing cases: body over 1 MiB, pre-start provider state, stable eventId, resume retry, same-key conflict on every write, secret rotation, foreign-secret malformed body, full-refund retry
- [LOW] [fixed] packages/payments/src/webhook/body.ts:24 — receivedAt and the signed timestamp are checked with the contracts ISO timestamp schema, not bare Date.parse
- [LOW] [fixed] packages/payments/src/testing/fakePayments.ts:696 — scheduleResume validates `at` and throws a PaymentsError with no state change; `write<K>` is constrained to keyed operations
- [LOW] [fixed] packages/payments/test/offer-name.test.ts:18 — literal invisible characters in sources are now `\u{...}` escapes
- [LOW] [fixed] packages/payments/test/setup/no-network.ts:14 — the no-network guard survives restoreAllMocks, also blocks dns and dgram, and has a self-test
- [LOW] [fixed] packages/payments/src/input.ts:23 — PortInput<K> is pinned to Parameters<Payments[K]>[0] by a type test
- [LOW] [fixed] docs/tasks/10.1b/handoff.md:34 — test count corrected
- [LOW] [deferred 10.8] packages/payments/test/offer-name.test.ts:1 — the new contracts refusal set is tested only downstream; move the cases into packages/contracts fixtures with the next contracts change
- [LOW] [deferred 10.8] packages/payments/package.json:12 — `@edmate/payments/testing` can be imported from production code; add an eslint no-restricted-imports rule outside tests when 10.8 wires payments into apps
- [LOW] [deferred 10.1c] packages/payments/test/contract/suite.ts:176 — an adapter that makes the change at the provider and then throws `unsupported` passes the suite
- [LOW] [deferred 10.1c] packages/payments/test/contract/suite.ts:112 — `expectFailing` is a public suite option, so a real adapter's test could mark its own failing cases green; keep it to the mutant tests
- [LOW] [deferred 10.1c] packages/payments/src/secret.ts:18 — a secret of only invisible characters or a single character is accepted; set a minimum length
