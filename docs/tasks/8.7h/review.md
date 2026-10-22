# 8.7h review — APPROVE

Reviewers: security-reviewer (sonnet), typescript-reviewer (sonnet, also as code-reviewer), lead

## Findings

- [MEDIUM] [deferred 8.7m] packages/db/src/repositories/redact-json.ts — the exemption checks only the UUID shape, so a phone number padded with hex characters to fill the 8-4-4-4-12 groups is left unredacted. This is the same trade-off as the crafted all-digit UUID that the handoff accepts (risk: high); the follow-up adds a test that records it.
- [LOW] [deferred 8.7m] packages/db/src/repositories/redact-json.ts — a digit run glued to letters with no separator (a UUID with a phone number appended) is never redacted. The gap predates 8.7h: PHONE_CANDIDATE's lookbehind has worked this way since 1.6.
- [MEDIUM] [deferred 8.7m] packages/db/test/redact-json.test.ts — the "crafted UUID whose groups are all digits" cases include the non-UUID value 'runId', so that case's title is misleading.
- [LOW] [deferred 8.7m] packages/db/src/repositories/redact-json.ts — a confusing comment next to matchAll and a `rest[0] as number` cast; there is also a duplicate lower-case assertion in a test.

Verified: the UUID regex runs in linear time (fixed-length groups, no nested quantifiers) and is anchored with \b at both ends; a phone number next to a UUID (not inside it) is still redacted; the 10,000-draw randomUUID property test exercises all-digit groups; security-reviewer reran the cases in a REPL.
