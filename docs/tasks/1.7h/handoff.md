# 1.7h handoff: US SSN PII pattern (locale pack, human-signed)

Status: **DONE**. Signed by sid2305, 6 Nov 2026 (B-67): the regex and the synthetic test values
below are approved as drafted. `content/locales/US.yaml`'s comment and
`packages/harness/src/testing/piiLocaleFixtures.ts`'s comment both carry the sign-off now.

Branch: `m13/1.7h-us-ssn-pii-pattern`

## Spec (board `1.7h`, plan `docs/tasks/1.7h/plan.md`)
Add one `piiPatterns` entry to `content/locales/US.yaml`: a US Social Security Number shape,
mirroring `IN.yaml`'s `AADHAAR` pattern's shape and safe-regex reasoning. The acceptance has two
halves: "an SSN in a student message is scrubbed" (proved by tests + a new eval case) and "the
pattern is signed by a named human" (carried as a YAML comment — signed per B-67 above).

## The pattern (for the lead to put in the sign-off ask)

**Citation**: the U.S. Social Security Administration's own published SSN format — three digits
(area number), two digits (group number), four digits (serial number): **AAA-GG-SSSS**.

**Regex** (exactly as drafted in the plan, unchanged):
```
(?<!\d)\d{3}(?:\d{2}\d{4}| \d{2} \d{4}|-\d{2}-\d{4})(?!\d)
```
Covers hyphenated (`000-00-0000`), spaced (`000 00 0000`) and bare (`000123456`) forms, with
one-character digit-boundary guards on both sides so a longer or shorter digit run never matches.
Same unquantified three-branch alternation shape as `IN.yaml`'s `AADHAAR` pattern, so it passes
`packages/content/src/safeRegex.ts`'s structural check the same way (no quantified alternation, no
backreference, a one-character lookbehind); `piiPatternsSafeRegex`/`piiPatternsCompileWithGu` both
confirm this directly against the committed pack (see evidence below), not by assumption.

**Test values used** (all synthetic; SSA guidance says area number `000` is never issued, so every
value below starts with `000` and is never a real SSN):
- True positive, hyphenated: `000-00-0000`
- True positive, spaced: `000 00 0000`
- True positive, bare/contiguous: `000123456` (**not** `000000000` as the plan first suggested —
  see "Build note" below)
- Boundary, wrong grouping (phone-shaped 3-3-4, must not match): `000-000-0000`
- Boundary, extra leading digit (lookbehind must block it): `1000-00-0000`
- Boundary, extra trailing digit (lookahead must block it): `000-00-00001`

## Changes
- `content/locales/US.yaml`: `piiPatterns: []` → one entry (the regex above), with a new comment
  block above it marked **"pending human sign-off (task 1.7h)"**, naming the SSA citation and
  pointing at this plan and `.claude/blockers.md` (B-64). `reviewedBy`/`reviewedOn` untouched (they
  sign the compliance/age-waiver block only, per 1.7f).
- `packages/harness/src/testing/piiLocaleFixtures.ts`: added `US_PII_PATTERNS` (`{ ssn }`) and
  `usLocalePackWithPii` (`demoLocalePack` with `piiPatterns: [SSN]`), mirroring
  `IN_PII_PATTERNS`/`indiaLocalePackWithPii`.
- `packages/harness/src/testing/index.ts`: exports the two new symbols alongside the IN ones.
- `packages/harness/src/guardrails/piiPatterns.test.ts`: new `describe('US locale patterns', ...)`
  block — compiles `usLocalePackWithPii.piiPatterns` directly and runs the three true-positive
  rows through `scrubPii` (full pipeline, generic categories included, as the IN block does), plus
  three isolated boundary checks that call the compiled SSN regex directly (no generic categories
  involved) to prove the lookbehind/lookahead guards hold. Does not touch the existing IN-only
  table.
- `packages/content/src/localePiiPipeline.test.ts`: new `describe('the real US pack in the PII
  pipeline', ...)` block — loads the real `content/locales/US.yaml` via `readLocalePack`, asserts
  `pack.piiPatterns` equals `[US_PII_PATTERNS.ssn]`, asserts
  `piiPatternsCompileWithGu`/`piiPatternsSafeRegex` both return `[]`, and runs one direct
  `createPiiScrubGuard().run(...)` check that a synthetic SSN message is rewritten with reason
  `'redacted: id'`. Does **not** reuse `PII_SCRUB_CASES`/`piiScrubCaseFailures` (IN-specific, as the
  plan warned).
- `evals/suites/safety/locale/safety-locale-010-ssn-pii-scrub-us-en.yaml` (new): same shape as
  `safety-locale-006-aadhaar-pii-scrub-in-en.yaml`, `reviewed_by: lead`, market US, a student turn
  with a synthetic SSN, `must_not_contain` both the hyphenated and bare forms.

No change to `packages/harness/src/guardrails/piiPatterns.ts`/`piiScrub.ts`,
`packages/harness/src/pipeline/steps/scrub.ts`, `packages/harness/src/testing/piiScrubCases.ts`,
`content/locales/IN.yaml`/`global.yaml`, or `packages/contracts/**` — confirmed not needed, per the
plan's "out of bounds" list.

## Build note (worth the lead/human knowing before sign-off)
The plan's first-draft bare/contiguous test value, `000000000`, collides with an existing,
out-of-scope hardening rule: `piiPatterns.ts`'s `localeMatches` skips a purely-digit locale match
whose digits are **all the same** (4.2c item 8, e.g. `"x = 9999999999"` is never flagged just
because of its length/shape). `000000000` is nine identical digits, so it was silently skipped —
discovered red during TDD (file 4's test failed with the number left unredacted). Fixed by using
`000123456` instead (area `000` is still an SSA "never issued" area number, so the synthetic
property holds). This does not change the regex or its citation — only one test fixture value.
Also, the "wrong grouping" boundary value (`000-000-0000`) is itself phone-shaped, so the full
`scrubPii` pipeline still redacts it (as `phone`, via the generic category, not `id`) — nothing
leaks either way, but it does mean that value can't prove the SSN pattern's own boundary via the
full pipeline; the isolated regex-only check in `piiPatterns.test.ts` proves it directly instead.

## Acceptance evidence

TDD order followed per plan: file 4's new describe block was written first (referencing fixtures
that did not exist yet, confirmed red by a module-resolution error naming the missing exports);
added the fixtures, confirmed green. File 5's new describe block was written next (against the
real `US.yaml`, still `piiPatterns: []`), confirmed red (`pack.piiPatterns` was `[]`, the guard
left the SSN unredacted); added the pattern to `US.yaml`, confirmed green.

```
$ source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/content...
...
 Tasks:    14 successful, 14 total
```

```
$ source ~/.nvm/nvm.sh && corepack pnpm --filter @edmate/evals exec vitest run src/suites.test.ts
 Test Files  1 passed (1)
      Tests  36 passed (36)
```
(confirms the new eval case parses against `EvalCaseSchema` and follows the suite layout rules —
file name/id/suite/package all consistent, `reviewed_by` not `pending`.)

```
$ python3 .githooks/secret-scan.py --all
(clean, no output)
```
Only synthetic SSNs (`000`-prefixed, SSA "never issued") appear anywhere in the diff.

## Decisions to log at merge (human name left blank until sign-off)

### 1.7h US SSN pattern added to the US locale pack · decided by **(blank — fill in after B-64
answers)** · risk: high

- Decided: `content/locales/US.yaml` carries its first `piiPatterns` entry — an SSN shape
  (`AAA-GG-SSSS`, citing the Social Security Administration's published numbering format),
  covering hyphenated/spaced/bare forms with digit-boundary guards. Pattern:
  `(?<!\d)\d{3}(?:\d{2}\d{4}| \d{2} \d{4}|-\d{2}-\d{4})(?!\d)`.
- Why: CLAUDE.md reserves safety-content decisions like this for a named human, same as prompt
  packs and skill templates; the pattern mirrors IN's already-shipped `AADHAAR` shape and passes
  the same safe-regex structural and timing checks.
- risk: high
