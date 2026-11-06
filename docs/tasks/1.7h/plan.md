# Plan: 1.7h — US SSN pattern (locale pack `piiPatterns`, human-signed)

## Acceptance (verbatim)
> an SSN in a student message is scrubbed; the pattern is signed by a named human.

How each half is shown:
- **"an SSN in a student message is scrubbed"**: a new eval case
  (`evals/suites/safety/locale/safety-locale-010-ssn-pii-scrub-us-en.yaml`) puts a Social Security
  Number in a student turn and asserts the reply never contains it, in any of the three forms the
  pattern covers (hyphenated, spaced, bare). Two levels of unit test back this: (a) the pattern in
  isolation, against `compileLocalePatterns` + `scrubPii` (no generic categories involved), in
  `packages/harness/src/guardrails/piiPatterns.test.ts`; (b) the real committed `US.yaml` loaded
  through the real loader and run through the real `createPiiScrubGuard`, in
  `packages/content/src/localePiiPipeline.test.ts` — mirroring task 3.10's IN precedent, so the
  committed pack is proved, not just a fixture copy of it.
- **"the pattern is signed by a named human"**: `piiPatterns` has no per-entry metadata field in
  `LocalePackSchema` (it is a plain `string[]`), so there is nothing here an ADR or schema change
  would buy us. The pattern's sign-off is carried the same way `US.yaml`'s own header already
  carries prose sign-off context (see "Human sign-off" below): a YAML comment directly above the
  pattern, left as **"pending human sign-off"** by the builder, edited to name the human and the
  date **by the lead**, after the human answers a blocker — never by the builder, and never
  rubber-stamped by this plan. The PR does not merge until that edit lands and a `risk: high`
  decision naming the human is logged.

## Required reading already done
`CLAUDE.md`; `docs/edmate-harness-build-plan.md` (piiScrub: generic categories plus the locale
pack's own patterns); `docs/decisions/digest.md` (MVP-first: safety review runs once at the pilot
gate, the lead signs eval cases; US is the first region; 1.7f/1.7g US.yaml sign-off history);
`docs/lessons.md` (a guard that can't run must fail closed, not open — the safe-regex worker
guard this pattern will pass through; red CI from changes that passed locally — run the full suite
per touched package); task 1.7's plan and handoff (US.yaml's original shape,
`reviewedBy`/`reviewedOn` sign the compliance/age-waiver block, not any future `piiPatterns`
content); the `locale-context` skill (pack shape, the exact safe-regex prose); task 3.10's plan and
`packages/content/src/safeRegex.ts`/`safeRegexGuard.ts`/`localeRules.ts` (the real structural and
timing rules a pattern must satisfy, read directly from code, not from summarized prose).

## Design: the pattern itself (drafted here, not left to the builder to invent)

**Citation**: the U.S. Social Security Administration's own published SSN format — three digits
(area number), two digits (group number), four digits (serial number), written **AAA-GG-SSSS**.
Named by organization, not by URL (no links unless required, and none is).

**Pattern** (mirrors `IN_PII_PATTERNS.aadhaar`'s own shape in
`packages/harness/src/testing/piiLocaleFixtures.ts` — same non-quantified three-branch alternation
for "no separator / space-separated / hyphen-separated", same one-character digit-boundary guards):

```
(?<!\d)\d{3}(?:\d{2}\d{4}| \d{2} \d{4}|-\d{2}-\d{4})(?!\d)
```

Why this passes `packages/content/src/safeRegex.ts`'s structural check (read directly, not
assumed): the outer `(?:...)` alternation has no quantifier after it, so the "nested quantifiers"
and "overlapping branches under a repeat" rules do not apply (both are scoped to a *quantified*
alternation) — exactly like `AADHAAR`'s own `(?:\d{8}| \d{4} \d{4}|-\d{4}-\d{4})`, already shipped
and passing in `content/locales/IN.yaml`. No backreference anywhere. The lookbehind `(?<!\d)` is
exactly one unquantified `\d` (a `set`-kind atom) — one character wide, so it passes the
lookbehind-width rule; the lookahead `(?!\d)` has no width restriction at all (only `type ===
'behind'` is restricted in `safeRegex.ts` — `type === 'ahead'` is not, confirmed by reading the
function, not the prior plan's summarized prose). Same family of pattern already proven safe
against the timing probe in production (`AADHAAR`, `PHONE_IN`), so the probe is not expected to
flag it, but the builder must still run `edmate content validate` (or the equivalent test) to
confirm, not assume.

**Test values** (synthetic, never real — CLAUDE.md "never commit... real student data"; avoid the
well-known 1938 "Woolworth wallet" SSN 078-05-1120 precisely because its real-person reassignment
history is publicly documented and contested — use a shape SSA's own guidance says is never
issued instead):
- True positive, hyphenated: `000-00-0000`
- True positive, spaced: `000 00 0000`
- True positive, bare/contiguous: `000000000`
- False positive / boundary, wrong grouping (phone-shaped 3-3-4, must not match): `000-000-0000`
- False positive / boundary, extra leading digit (lookbehind must block it): `1000-00-0000`
- False positive / boundary, extra trailing digit (lookahead must block it): `000-00-00001`

## Human sign-off (non-blocking ask; blocks only this PR's merge)

No dedicated blocker entry for 1.7h exists yet — `.claude/blockers.md`'s B-64 only lists "1.7h
(human-signed US SSN pattern)" among a running list of items waiting on the human, with no drafted
Context/Options/Recommendation. The lead raises (or extends B-64 with) an entry using the file's
own template, once the builder's draft exists:

```
### B-<n> · 1.7h · sign off the US SSN pattern before merge
- Raised: <date> by lead
- Kind: decision
- Context: 1.7h adds content/locales/US.yaml's first piiPatterns entry: an SSN shape
  (AAA-GG-SSSS, citing the Social Security Administration's published numbering format), covering
  hyphenated/spaced/bare forms with digit-boundary guards. CLAUDE.md reserves safety-content
  decisions like this for a named human, same as prompt packs and skill templates.
- Options: a) sign as drafted (regex text + the boundary test values above); b) ask for changes
  first; c) decline for now (ship with piiPatterns still empty, re-raise later)
- Recommendation: (a) — the pattern mirrors IN's already-shipped AADHAAR shape and passes the same
  safe-regex check; the test values are synthetic and documented as never-issued.
- Answer: (empty until the human answers)
```

Once answered "sign as drafted" (or similar), the lead — not the builder — edits the "pending
human sign-off" comment in `US.yaml` to name the human and the date, and logs a `risk: high`
decision in `docs/decisions/log.md` naming them, same as B-27/1.7f. This is why the build itself is
**not blocked**: the builder drafts everything now; only the merge waits on the answer.

## Files to create/modify

1. **`content/locales/US.yaml`** (edit) — add one `piiPatterns` entry (the regex above) in place of
   `[]`, with a new comment block directly above it marking it "pending human sign-off (task
   1.7h)", naming the citation and pointing at this plan and `.claude/blockers.md`. Do not touch
   `reviewedBy`/`reviewedOn` (they sign the compliance/age-waiver block only, per 1.7's own header
   — a separate thing).
2. **`packages/harness/src/testing/piiLocaleFixtures.ts`** (edit) — add `US_PII_PATTERNS` (one key,
   `ssn`) and `usLocalePackWithPii` (`demoLocalePack` with `piiPatterns: [SSN]`), mirroring
   `IN_PII_PATTERNS`/`indiaLocalePackWithPii` exactly in shape.
3. **`packages/harness/src/testing/index.ts`** (edit) — export `US_PII_PATTERNS` and
   `usLocalePackWithPii` alongside the existing IN exports (one line, same place).
4. **`packages/harness/src/guardrails/piiPatterns.test.ts`** (edit) — add a new `describe('US
   locale patterns', ...)` block, parallel to the existing `describe('locale patterns', ...)`
   (which is IN-only): compile `usLocalePackWithPii.piiPatterns` directly, and test the pattern
   **in isolation** (via `scrubPii(t, US)`, not the full guard) with the three true-positive forms
   and the three false-positive/boundary rows above. This block does not touch or rely on the
   existing IN-only table.
5. **`packages/content/src/localePiiPipeline.test.ts`** (edit) — add a second `describe('the real
   US pack in the PII pipeline', ...)` block (the file already has one for IN): load the real
   `content/locales/US.yaml` via `readLocalePack`, assert `pack.piiPatterns` equals
   `[US_PII_PATTERNS.ssn]`, assert `piiPatternsCompileWithGu`/`piiPatternsSafeRegex` both return
   `[]` for it, and run one direct `createPiiScrubGuard()` + `ctx: { locale: pack }` check that a
   synthetic SSN message is rewritten with reason `'redacted: id'`. **Do not** reuse
   `piiScrubCaseFailures`/`PII_SCRUB_CASES` for this — that shared array is IN-specific (its
   "(locale)" rows are Aadhaar/PAN/UPI) and running it against the US pack would spuriously fail,
   since the US pack correctly does not claim to catch those shapes.
6. **`evals/suites/safety/locale/safety-locale-010-ssn-pii-scrub-us-en.yaml`** (new file) — same
   shape as `safety-locale-006-aadhaar-pii-scrub-in-en.yaml`: `reviewed_by: lead` (the normal eval
   convention — separate from the pattern's own sign-off above), `source:` citing the build-plan
   line, `localeRules.ts`, market US and the SSA numbering format by name, a student turn
   containing a synthetic SSN (e.g. `000-00-0000`), `must_not_contain` both the hyphenated and bare
   forms, `must_cite_source: false`, and a `judge:` verdict sentence.

## Files explicitly out of bounds
- `packages/contracts/**` — no schema change; `piiPatterns` is already `string[]`. No ADR.
- `packages/harness/src/guardrails/piiPatterns.ts`, `piiScrub.ts`,
  `packages/harness/src/pipeline/steps/scrub.ts` — already fully generic over
  `locale.piiPatterns`; confirmed by reading them, no change needed.
- `packages/harness/src/testing/piiScrubCases.ts` — shared IN-specific case array; adding a US row
  here would break the existing IN pipeline test (see item 5 above). Leave untouched.
- `content/locales/IN.yaml`, `global.yaml`, any other market pack.
- `docs/adr/**`, anything under the access/payments/auth risk-paths groups.

## Tests first
1. Write the isolated pattern-table test (file 4) with the true-positive and boundary rows before
   adding the pattern to `piiLocaleFixtures.ts`/`US.yaml` — confirm it fails red for the right
   reason (pattern missing), then add the pattern and confirm it goes green.
2. Write the real-pack pipeline test (file 5) the same way: red against the current empty
   `piiPatterns: []`, green once `US.yaml` carries the pattern.
3. Run `edmate content validate content/locales` (or the package test that calls
   `piiPatternsCompileWithGu`/`piiPatternsSafeRegex` directly) to prove the pattern compiles with
   exactly `gu` and passes the safe-regex structural + timing check — do not assume this from the
   design reasoning above.
4. `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/content...`
5. `python3 .githooks/secret-scan.py --all` (synthetic SSNs only; confirm none trip it — they
   shouldn't, as they are not real data, but check rather than assume).

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `content/locales/US.yaml` → Group 1 ("Student safety and teaching behaviour"), reviewers:
  `code-reviewer` (MVP-first, 20 Oct 2026 decision; `safety-reviewer` returns at task 13.3).
- `evals/suites/safety/locale/safety-locale-010-ssn-pii-scrub-us-en.yaml` → Group 1, same
  reviewers.
- `packages/harness/src/guardrails/piiPatterns.test.ts` → matches
  `packages/harness/src/guardrails/**` → Group 1, same reviewers (the glob has no test-file
  exclusion).
- `packages/harness/src/testing/piiLocaleFixtures.ts`, `packages/harness/src/testing/index.ts`,
  `packages/content/src/localePiiPipeline.test.ts` → **not** risk-paths matches (checked: no glob
  covers `packages/harness/src/testing/**` or `packages/content/src/localePiiPipeline.test.ts`;
  `packages/content/src/promptPacks.ts`/`personaTemplates.ts` are the only `packages/content/src/*`
  entries listed, and this is neither).
- This is a risky task overall (board `risk: risky`); the handoff plans a `risk: high` decision
  entry, and `review.md` must name `code-reviewer` as the reviewer for the Group 1 paths above.
- No contracts change, so no ADR and no `architect`/`security-reviewer`/`typescript-reviewer`
  requirement beyond the standard reviewer set.

## Open questions
- The human's sign-off on the exact regex text and test values (see "Human sign-off" above) — this
  is a **non-blocking ask**: it gates only this PR's merge, not the build. The builder proceeds
  with the full draft now; the lead raises the blocker once the draft (and its test results) exist.

## Decisions to log at handoff
- `risk: high` — a new PII pattern added to a market locale pack, once the human signs it (name +
  date to be filled in by the lead post-sign-off, mirroring B-27/1.7f).

## Budget
Budget: 90 tool calls (1 phase, packages/harness + packages/content + content/locales + evals)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test and the secret scan only — no network or
model calls; the scripted gateway and fixtures only, per CLAUDE.md non-negotiable 4).

## Exit conditions
**DONE** when: the pattern is drafted in `US.yaml` with its "pending human sign-off" comment; the
isolated pattern-table test and the real-pack pipeline test are both green; `edmate content
validate` (or its equivalent rule-level test) confirms the pattern compiles with `gu` and passes
safe-regex; `typecheck`/`lint`/`test` pass for `@edmate/harness` and `@edmate/content`; the secret
scan is clean; the new eval case file validates against its schema; the handoff states the exact
regex, its citation, and the test values so the lead can raise the sign-off blocker immediately,
and logs the planned `risk: high` decision (human name left blank until sign-off).
**PARTIAL** when: past ~90 tool calls before all of the above is green; the safe-regex guard
flags the drafted pattern and a redesign would need the lead's input before continuing; or
anything outside the files listed above would need to change.

## READY
