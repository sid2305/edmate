# 8.7p handoff

Status: DONE

## Summary
Two review follow-ups fixed in `packages/db/src/repositories/redact-json.ts`:

1. **Phone candidate crossing an exempt span's boundary (8.7m typescript-reviewer MEDIUM).**
   `redactString` replaced the single `coveredBy` boolean check with a manual scan
   (`PHONE_CANDIDATE.exec` in a loop, same idiom `redactEmails` already used). For each raw
   match, `start`/`end` are now clipped inward past any exempt span (`UUID`/`PREFIXED_ID`/
   `HEX_DIGEST`) they overlap, before the digit-count/`NOT_A_PHONE` check runs on the clipped
   text. If clipping leaves `start >= end` the match was fully covered (unchanged behaviour: the
   8.7h UUID-shaped-digits case, the two no-separator glued cases). `coveredBy` was removed as
   unused. Comments on `redactString` and `PHONE_CANDIDATE` updated to describe the clip-at-
   boundary behaviour.
2. **Low surrogate stepped over without checking for a high surrogate (8.7o typescript-reviewer
   LOW).** `redactEmails`'s left-walk now also requires `s.charCodeAt(charStart - 1)` to be a high
   surrogate (`0xd800`-`0xdbff`) before stepping `charStart` back an extra position on a low
   surrogate. A lone low surrogate (no real pair) now correctly stops the walk at its own
   position (category `Cs`, rejected by `EMAIL_LOCAL_CHAR`), instead of silently testing whatever
   ordinary character sat one position earlier.

Files changed:
- `packages/db/src/repositories/redact-json.ts`
- `packages/db/test/redact-json.test.ts` (new failing-first tests for both items, a seeded
  property test for item 1, an unpaired-surrogate addition to the existing fuzz `ALPHABET` for
  item 2)

Both red tests were confirmed failing on the pre-fix code before the fixes landed (6 new tests
red: 3 example cases + 1 property test for item 1, 1 hand-written case + the pre-existing 50k
seeded fuzz for item 2 — the fuzz test went red too, since the new `ALPHABET` surrogate characters
hit the unfixed branch).

No counter-example was found to the "exempt spans only touch a phone match at an edge, never sit
fully inside one" reasoning in the plan's step 3; the fully-covered-match tests (8.7h UUID case,
both no-separator glued cases) still pass unchanged.

## Decisions
### 26 Oct 2026 · 8.7p item-1 clip region includes the separator · decided by builder · risk: low
- Decided: when a raw `PHONE_CANDIDATE` match is clipped at an exempt span's boundary, the
  redacted `REDACTED` region covers from the span's end to the match's end — including any
  separator character (e.g. the single space between an id and a phone number) that sits between
  them. The id/UUID/digest text itself is always left untouched; only the separator plus the
  phone text is replaced, so output looks like `rp_<hex40>[redacted]` rather than
  `rp_<hex40> [redacted]`.
- Why: the plan's accept line only required "the id/UUID/digest text unchanged and `${REDACTED}`
  in place of the phone" — it did not pin down whether a separator between them survives as
  literal text. Keeping the separator as literal text would require a second, separate clip rule
  for "boundary characters immediately after a span before the phone proper starts," which the
  plan did not ask for and which adds complexity without changing the safety property (no exempt
  span text is ever redacted, no phone digit ever survives). Tests were written to check both
  invariants (`toContain(span)`, `not.toMatch(phone digits)`) rather than pin exact spacing, so
  this choice does not need a test change if the lead prefers the other spacing later.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db` → all 17 tasks successful
  (typecheck, lint, test for db + dependents web/worker); `redact-json.ts` at 100%
  statements/branches/functions/lines.
- `corepack pnpm exec prettier --check packages/db/src/repositories/redact-json.ts packages/db/test/redact-json.test.ts`
  → "All matched files use Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Budget
Tool calls used: 24
