# 8.7m plan: redact-json follow-ups (lead plan)

Status: READY

## Source
`docs/tasks/8.7h/review.md` lines 7-10 (all `[deferred 8.7m]`). Board accept: tests for the hex-padded and glued cases (the glued case redacts the phone digits); the crafted-UUID cases are all UUID-shaped; `redact-json.ts` stays at 100% coverage.

## Files
- `packages/db/src/repositories/redact-json.ts` (risky: `packages/db/src/repositories/**`, security-reviewer group; needs code-reviewer, typescript-reviewer, security-reviewer)
- `packages/db/test/redact-json.test.ts`
- Nothing else. No migration, no contracts change.

## Steps (test first)
1. **Hex-padded phone (MEDIUM, record the accepted trade-off).** Add a test where a phone number is padded with hex characters to the 8-4-4-4-12 UUID shape (e.g. `5551234a-bcde-4f00-8000-000000000000`-style, built so the digits look like a phone number); assert it is left as is, and name the test so it says this is the accepted UUID-exemption trade-off from 8.7h (link the decision in a one-line comment). No code change for this item.
2. **Glued digit run (LOW, now redacted).** Today `PHONE_CANDIDATE`'s lookbehind `(?<![\p{L}\p{N}_.+-])` skips any digit run glued to a letter, so `abc5551234567` or a UUID with a phone number appended without a separator is never redacted. Change it so a digit run of at least `PHONE_MIN_DIGITS` digits that directly follows a **letter** is redacted (the digits, keeping the letters), while these stay unredacted (one test each):
   - an underscore-prefixed id (`tch_93d`, `doc_cap_501`, `stu_1234567`): `_` before the run still blocks it, as today;
   - a whole UUID and a UUID embedded in text (the existing UUID span exemption);
   - ISO dates and decimals (`NOT_A_PHONE`);
   - a short glued run under `PHONE_MIN_DIGITS` (`v2`, `abc123456`).
   Add the glued cases: `abc5551234567` → `abc[redacted]`, and a UUID with a 10-digit phone number appended with no separator → the phone digits are redacted. Decide and log (handoff `## Decisions`) exactly what a UUID-glued run redacts if the trailing digits merge into the last hex group; the phone digits must not survive in full.
   Keep the regex linear-time (no nested quantifiers); say so in the handoff with the reasoning.
3. **Crafted-UUID cases (MEDIUM).** Drop the non-UUID value `'runId'` from the "crafted UUID whose groups are all digits" cases so every value in that case is UUID-shaped; if `'runId'` covered something else, move it to its own correctly named case.
4. **Cleanups (LOW).** Reword the matchAll comment (lines ~73-75) to plain words; replace `const offset = rest[0] as number` with a typed callback signature or a runtime `typeof` check that needs no cast; remove the duplicate lower-case assertion in the test file.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` (redact-json.ts stays at 100% coverage)
- `corepack pnpm exec prettier --check` on the two files
- `python3 .githooks/secret-scan.py --all` (use obviously fake numbers like 555-01xx; no real personal data)

## Budget
About 30 tool calls. Run tests in the foreground with a timeout; never poll a background log with repeated `tail` calls.
