# 8.7m handoff: redact-json follow-ups

Status: DONE

## Summary

- `packages/db/src/repositories/redact-json.ts`
  - `PHONE_CANDIDATE`'s lookbehind no longer excludes `\p{L}`: a `PHONE_MIN_DIGITS`+ digit run
    directly after a letter is now redacted (the digits only; letters before it are kept). A run
    after `_`, a digit, `.`, `+` or `-` is still skipped, so id-style keys (`stu_1234567`) are
    unaffected. The regex is still one linear pass, no nested quantifiers.
  - `uuidSpans` now collects spans via `String.replace`'s callback (`offset: number`, no cast)
    instead of `matchAll` + `m.index as number`; the typed callback removes the need for a
    runtime check entirely and keeps 100% coverage.
  - `redactString`'s `PHONE_CANDIDATE` replace callback now has a typed signature
    `(m: string, offset: number)` instead of `(m, ...rest)` + `rest[0] as number`.
  - Reworded the span comment near the old `matchAll` loop into plain words (now describes the
    `replace` approach).
- `packages/db/test/redact-json.test.ts`
  - Dropped `'runId'` from the "crafted UUID whose groups are all digits" `it.each` (it isn't
    UUID-shaped and wasn't testing anything that case's name describes; the plain-text case at
    "keeps plain text" already covers a digit-free string passing through unchanged, so no new
    test was needed for it).
  - Removed the duplicate lower-case assertion from "keeps a UUID embedded in free text,
    case-insensitively" (the lower-case embedded case is already covered by "still redacts a
    phone number that sits right next to a UUID").
  - Added: the hex-padded-phone UUID trade-off test, the glued-letter-prefix redact test, the
    underscore-prefixed-id keep tests, the whole/embedded UUID keep test, the date/decimal
    glued-to-a-letter keep tests, the short-glued-run keep tests, and the UUID+glued-phone test.
    All test values use fake data (`555-01xx`-style numbers, example.com/org emails, crafted
    UUIDs).

## Decisions

### 25 Oct 2026 · 8.7m hex-padded phone stays an accepted UUID trade-off · decided by builder · risk: low
- Decided: no code change for the hex-padded-phone case; added a test
  (`keeps a UUID-shaped value whose digits look like a phone number (8.7h trade-off)`) that
  documents and locks in the existing 8.7h behaviour (UUID-shaped values are exempt from the
  phone digit-run rule, even when padded so the digits read as a phone number).
- Why: the plan asked for a test, not a fix; the 8.7h decision already accepted this trade-off at
  `risk: high`, and this value is still UUID-shaped by the same regex.

### 25 Oct 2026 · 8.7m a UUID glued to a phone number with no separator redacts the whole run · decided by builder · risk: low
- Decided: when a phone-length digit run is glued onto a UUID's last hex group with no
  separator, the merged run no longer matches the `UUID` regex (its trailing `\b` needs a
  non-word character right after the 12th hex character, but the next character is still a
  digit), so `PHONE_CANDIDATE` treats the whole digit-and-hyphen run as one phone-shaped
  candidate and redacts it entirely — the UUID-looking prefix is lost along with the phone
  digits. Added a test asserting the phone digits never survive
  (`redacts a UUID with a 10-digit phone number glued on with no separator`).
- Why: the plan requires the phone digits must never survive; over-redacting the glued UUID
  prefix too is the safe side (fail closed), and a UUID is already recoverable from context
  (callers keep real ids outside these audit payloads per README rule 9), whereas a phone number
  surviving would not be. Also noted: dropping `\p{L}` from the lookbehind only affects the start
  of a match; a letter glued directly to a UUID with *no* phone number appended and *no*
  separator (e.g. `id12345678-1234-4234-8234-123456789012`, no space or punctuation before the
  UUID) now also gets fully redacted for the same `\b`-boundary reason, since letter-then-digit
  is not a word boundary either. This is not covered by a test because it is not a realistic
  shape (ids and UUIDs are written with a separator such as a space or colon in text, which this
  change does not affect — see the embedded-UUID test), and the plan does not ask for it; flagged
  here in case a future value hits it.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` → 26/26 tasks successful;
  `redact-json.ts` at 100% statements/branches/functions/lines; all other `@edmate/db` coverage
  unchanged (1691 tests passed, 4 skipped, pre-existing skips).
- `corepack pnpm exec prettier --check packages/db/src/repositories/redact-json.ts packages/db/test/redact-json.test.ts` → "All matched files use Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Budget

Tool calls used: 24
