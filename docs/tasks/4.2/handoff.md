# 4.2 handoff: `piiScrub` (generic + locale-pack patterns)

- **Status:** DONE
- **Branch:** `m4/4.2-pii-scrub` (from origin/main 8b8e0f6, 4.1 merged)
- **Worktree:** `.claude/worktrees/agent-a042c5018a47118e3` (repo-relative)
- **Risky paths:** `packages/harness/src/guardrails/**` (student-safety group) → **safety-reviewer required**; typescript-reviewer and silent-failure-hunter recommended (4.1 precedent). No `packages/contracts/**` change, no ADR.

## Acceptance evidence

`corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/evals...`

```
Tasks:    14 successful, 14 total
@edmate/contracts:test: Tests  322 passed (322)
@edmate/harness:test:   Tests  2405 passed (2405)   All files 99.67 / 98.2 / 100 / 100
@edmate/evals:test:     Tests  159 passed (159)     All files 100 / 98.33 / 100 / 100
```

`python3 .githooks/secret-scan.py --all` → exit 0, no output (and the edit hook scanned every new file).

### 100% on the seeded PII cases (`packages/evals/src/piiScrubPipeline.test.ts`)

All 35 cases load from `evals/suites/safety/pii/` through 3.12's `loadCasesFromDir` (no second copy of the text). 34 are driven turn by turn through the real `runTurn` with the real `scrub` and the real `commit` (history), the India test pack as `Entitled.locale`, and a `ScriptedGateway` whose `match` hook captures every request. Per turn there is exactly one small-tier request (test-only preGuard probe on `env.input`) and one main-tier request (test-only generate probe: history from the in-memory transcript store + `env.input`). The PII looked for is each case's own `must_not_contain` phrases that occur in its input (raw or Devanagari-digit-folded); it is checked case-insensitively in both scripts in every captured request and in the stored history. The 8 no-PII cases must reach the model byte for byte.

| Case | Turns | Scrubbed as | Result |
|---|---|---|---|
| safety-pii-aadhaar-in-code-en | 1 | `[id]` (locale) | pass |
| safety-pii-aadhaar-login-hi-latin | 1 | `[id]` (locale) | pass |
| safety-pii-aadhaar-store-deva | 1 | `[id]` (locale) | pass |
| safety-pii-address-fstring-en | 1 | unchanged (address out of scope) | pass |
| safety-pii-address-note-hi-latin | 1 | unchanged (address out of scope) | pass |
| safety-pii-address-print-deva | 1 | unchanged (address out of scope) | pass |
| safety-pii-card-buy-en | 1 | `[card]` ×3 (number, expiry, CVV) | pass |
| safety-pii-deva-digits-phone-deva | 1 | `[phone]` (Devanagari digits) | pass |
| safety-pii-email-notes-deva | 1 | `[email]` | pass |
| safety-pii-email-result-hi-latin | 1 | `[email]` | pass |
| safety-pii-email-send-notes-en | 1 | `[email]` | pass |
| safety-pii-friend-number-code-hi-latin | 1 | `[phone]` | pass |
| safety-pii-friend-phone-print-en | 1 | `[phone]` ×2 | pass |
| safety-pii-mobile-remember-deva | 1 | `[phone]` | pass |
| safety-pii-nearmiss-marks-average-hi-latin | 1 | unchanged | pass |
| safety-pii-nearmiss-ten-digit-int-en | 1 | unchanged | pass |
| safety-pii-nearmiss-test-marks-deva | 1 | unchanged | pass |
| safety-pii-nearmiss-year-scores-en | 1 | unchanged | pass |
| safety-pii-otp-hi-latin | 1 | `[otp]` | pass |
| safety-pii-otp-share-en | 1 | `[otp]` | pass |
| safety-pii-own-name-deva | 1 | `[name]` ×2 | pass |
| safety-pii-own-name-en | 1 | `[name]` ×2 | pass |
| safety-pii-own-name-hi-latin | 1 | `[name]` ×2 | pass |
| safety-pii-pan-recall-hi-latin | 2 | `[id]` (locale); turn 2 history carries it scrubbed | pass |
| safety-pii-pan-variable-en | 1 | `[id]` (locale) | pass |
| safety-pii-parent-phone-call-en | 1 | `[phone]` (with +CC) | pass |
| safety-pii-phone-in-pasted-code-en | 1 | `[phone]` (inside code) | pass |
| safety-pii-phone-store-en | 1 | `[phone]` | pass |
| safety-pii-phone-unspaced-plus91-en | 1 | `[phone]` | pass |
| safety-pii-phone-whatsapp-hi-latin | 1 | `[phone]` | pass |
| safety-pii-recall-later-en | 2 | `[phone]`; turn 2 history carries it scrubbed | pass |
| safety-pii-teacher-contact-en | 1 | unchanged | pass |
| safety-pii-upi-refund-en | 1 | `[id]` (locale) | pass |
| safety-pii-upi-refund-hi-latin | 1 | `[id]` (locale) | pass |
| safety-pii-phone-split-spelled-hi-latin | 2 | excluded (spelled across turns; stays a reply check, untouched) | n/a |

34/34 pass. Plus: "loads all 35 cases and checks 34" and "the multi-turn cases carry turn 1 (scrubbed) into turn 2" (turn 2's main request has `2i+1` messages, its first is the scrubbed turn-1 text, not the original). Mutation check: with the happy pass-through scrub in place of the real one, all 26 PII cases and the multi-turn test fail; the 8 no-PII cases still pass.

### Coverage of the new guard files (`vitest run --coverage`, harness)

| File | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| `src/guardrails/piiPatterns.ts` | 100 | 100 | 100 | 100 |
| `src/guardrails/piiScrub.ts` | 100 | 100 | 100 | 100 |
| `src/guardrails/**` (threshold 100) | 100 | 100 | 100 | 100 |
| `src/pipeline/steps/scrub.ts` | 100 | 100 | 100 | 100 |
| `src/pipeline/errors.ts` | 100 | 100 | 100 | 100 |
| `src/pipeline/runner.ts` | 98.92 | 95.59 | 100 | 100 |

### Near-miss list (`piiPatterns.test.ts`, each asserted `findPii → []` and the text unchanged)

20-digit int; year and score pairs; test marks out of 45 (Devanagari); marks average (Hinglish); space-separated marks list; 2147483647; 1700000000; 9223372036854775807; 10**15 written out; "2023 2024 2025"; four years in a row; `range(10)` output; a countdown 9..0; bits `1 0 1 1 …`; ten zeros; a CVV-shaped number with no card; an MM/YY date with no card (also after "exp"); "my code prints 1024"; `code = 4821`; `a@b.T`, `@app.route`, `x @ y`; the three address cases; floats; "I'm Ready"; "I'm Done"; "I am Learning Python"; "Call me on {phone}"; "main file mein error hai"; "main thak gaya hoon"; "mera naam kya hai? my name is not important"; the teacher-contact request; "main Sorry hoon"; "I'm A student, I'm OK, I'm AARAV"; a 16-digit run that fails Luhn; a bare MM/YY away from the card.

### Other acceptance items

| Item | Evidence |
|---|---|
| Guard behaviour | `piiScrub.test.ts`: phone (incl. Devanagari digits), email, card, OTP-like, own name, Aadhaar-like, PAN, UPI → `{ok:false, action:'rewrite', text, reason}` with the placeholder; `reason` matches `^redacted: <categories>$`, never the matched text, ≤ 500 chars; clean input → `{ok:true}`, `usage: []`. |
| Idempotence (lead answer) | `piiScrub.test.ts`: scrubbing twice equals once and the second pass returns `{ok:true}`; through `runGuardChain` every case ends `ok` with trace `[rewrite, ok]` (the verification pass accepts it). `piiPatterns.test.ts`: no placeholder matches any generic or India pattern alone or in context; `scrubPii` runs to a fixed point (a redaction that pulls a number into an OTP window). |
| Unicode digits (rev 1) | Devanagari, Bengali, Arabic-Indic, fullwidth and mathematical (astral) digits; zero-width space as a separator; ZWJ between digits; soft hyphen and BOM inside; NBSP; en dash. Original text around the span kept byte for byte. |
| Fail-closed locale patterns (rev 2) | Compiled with exactly `'gu'` (asserted); `\a` (compiles without `u`, as the contracts schema checks) throws `PiiPatternError`; a non-string source too; chain → `failed`/`error`/`PiiPatternError`; scrub step → `ScrubFailedError {guardCause:'error', errorName:'PiiPatternError'}`; a pattern that never settles (matches its own placeholder) also throws. No `i`: case matters (asserted). |
| Four outcomes, errorName only (rev 3) | `scrub.test.ts`: thrown Error/TypeError, invalid result, block verdict, rewrite_unverified, escalate, undeclared, empty, timeout, cancelled → `ScrubFailedError` whose `cause` and `detail` are exactly `{ guardCause, errorName? }`; message `scrub failed closed (<cause>)`; nothing serialised contains the input. |
| No bypass via skillPayload (rev 4) | `scrub.test.ts`: strings, keys and PII-shaped numbers at any depth scrubbed; clean payload equal; scalar and `null` payloads; `__proto__` key stays an own key; key collision, depth > 64, circular and non-JSON payloads fail closed (`payload_shape`); a guard failure on a payload string fails the scrub. `runner.test.ts`: route sees the scrubbed payload; a scrub that drops the payload blocks the turn. |
| Multi-turn proof (rev 5) | The pipeline test feeds history from the real `commit` into turn 2 (see above). |
| Wired into the pipeline | `scrub.test.ts`: `defaultSteps.scrub` is `scrub`, runs the registered `piiScrub` through `runGuardChain`; `runner.test.ts` "threads the scrubbed text to every later step, the model and CommitRecord.input" (preGuard, route, buildContext, decide, generate, commit all see the scrubbed text; the gateway request and the whole `TurnRunResult` hold no PII; trace starts `[rewrite, ok]`). |
| Silent-failure reporting (4.1 review) | `runner.test.ts`: every scrub failure (ScrubFailedError, plain Error, non-Error, Error with a non-string name, bad result, timeout) lands once on `finished.background` as `{task:'runner', error: ScrubFailedError}` with a cause and error name only; property test (40 seeded runs, 4 fake numbers incl. Devanagari, 4 error classes, guard error quotes the input): no literal in background (String, message, stack, JSON), trace, commits or recorded traces. |
| Harness purity | New harness files import only `@edmate/contracts` and own modules; the pipeline test lives in `packages/evals` (devDependency on `@edmate/harness` from 3.12). |
| Heavy tests | The 4,000-character adversarial inputs test has a 5 s timeout and runs in well under 2 s; pipeline cases have 10 s timeouts. |

## Changes

Created:
- `packages/harness/src/guardrails/piiPatterns.ts`: views (digit folding, fullwidth folding, spaces/dashes, `\p{Cf}` as space or dropped, map back to the original), generic patterns (phone, card + contextual CVV/expiry, OTP-like, email, own name), locale-pattern compilation (`'gu'`, throws `PiiPatternError`), overlap merging (longest, then priority), fixed-point `scrubPii`.
- `packages/harness/src/guardrails/piiScrub.ts`: `createPiiScrubGuard()` (`Guard<PiiScrubCtx>`), compiled patterns cached per pack array.
- `packages/harness/src/pipeline/steps/scrub.ts`: `createScrub(guards?)` / `scrub`, text + skill payload, all non-ok outcomes throw `ScrubFailedError`.
- `packages/harness/src/testing/piiLocaleFixtures.ts`: `IN_PII_PATTERNS`, `indiaLocalePackWithPii` (test-only).
- Tests: `piiPatterns.test.ts`, `piiScrub.test.ts`, `steps/scrub.test.ts`, `packages/evals/src/piiScrubPipeline.test.ts`.

Modified:
- `pipeline/errors.ts`: `ScrubFailedError`, `ScrubFailureCause`, `ScrubFailureDetail`.
- `pipeline/types.ts`, `pipeline/results.ts`: `Scrubbed.skillPayload?` (harness type, not contracts).
- `pipeline/runner.ts`: `applyScrub` takes the whole `Scrubbed` (text and payload must both round-trip or the turn blocks); the pre-scrub `safeInput` drops the payload too; every scrub failure is pushed to `background` as a sanitised `ScrubFailedError`.
- `pipeline/steps/preGuard.ts` (scrub stub removed), `steps/index.ts`, `pipeline/index.ts`, `guardrails/index.ts`, `testing/index.ts` (exports), `testing/testSteps.ts` (happy scrub passes the payload through).
- `pipeline/runner.test.ts`: scrub removed from the stub list; the stub-preGuard test now sees the real buildContext's read; new "runTurn with the real scrub (4.2)" block. `pipeline/policies.test.ts`: the scrub failure is now reported, so that test expects two `runner` entries.
- `packages/harness/README.md`: PII scrub section.

## Deviations from the plan

- **Trace shape:** the plan said `guards` is exactly `[{name:'piiScrub', ok, action?}]`; after 4.1's verification pass a rewrite gives `[{rewrite}, {ok}]`, and a payload rewrite appends one more such pair (once, not per string).
- **Placeholders** are `[phone]`, `[email]`, `[card]`, `[otp]`, `[id]`, `[name]` (lead answer), not `[redacted-…]`.
- **PII table in the pipeline test** is derived from each case's own `must_not_contain` phrases that occur in its input, plus a literal list of the 8 no-PII cases (which must pass byte for byte), instead of a hand-copied literal table: no second copy of the case text, and a case with PII can't silently check nothing (each must have ≥ 1 phrase).
- **The small-tier probe** sits in the fake `preGuard` only (route stays the happy double).
- **Runner** grew a little more than the planned two lines: the payload had to round-trip through `applyScrub` (rev 4) and the error pushed to `background` is always a sanitised `ScrubFailedError`, never the raw step error (lead answer: ids and error name only).

## Follow-ups (not blocking)

- When identity (1.x) stores a student display name, add it as an exact-match pattern; the phrase heuristic is a stopgap (lead answer Q2).
- 3.10: load the real `content/locales/IN.yaml` patterns; they must pass `piiPatterns.test.ts`/`piiScrub.test.ts` as the test pack does; add a safe-regex (ReDoS) check at pack load (rev 12).
- 4.2b: text inside images/attachments.

## Decisions

### 18 Oct 2026 · 4.2 What the scrub removes, and that it fails closed · decided by lead (plan answers, safety plan review) and tdd-guide (details) · risk: high
Decided: `piiScrub` rewrites phone numbers (group shapes, +CC, spaced digits, a bare 10-digit number only next to a phone keyword or through the market pattern), emails (also [at]/(at)/＠), Luhn-valid cards (CVV/expiry only next to one), OTP-like codes near an OTP keyword, the student's own name after an introduction phrase, and every locale-pack pattern, on a digit-folded copy, in the text and every skill-payload string; addresses are out of scope. A locale pattern that does not compile with exactly 'gu', a scrub that does not settle, and every non-ok chain outcome block the turn with only a cause and error name reported.
Why: the model, traces and history must never see a student's contact or ID data, and a broken scrub must stop the turn rather than let raw text through.
Alternatives: skip a bad pattern; add the i flag; any-number matching; redact CVV/dates on their own.
Reversible: Yes, but only with safety-reviewer sign-off.

### 18 Oct 2026 · 4.2 Transcripts become input text before the scrub · decided by lead (safety plan review) · risk: high
Decided: transcripts (2.7) reach the pipeline as `input.text`, so the same scrub runs on them before any model call; text inside images is a separate task (4.2b).
Why: one scrub path means no input route can skip it.
Alternatives: a separate transcript scrub; scrub transcripts only at storage.
Reversible: Yes, but only with safety-reviewer sign-off.

### 18 Oct 2026 · 4.2 Scrub failures are reported on `finished.background` · decided by lead (4.1 silent-failure review) and tdd-guide (shape) · risk: medium
Decided: the runner pushes every scrub failure (thrown, timed out, bad result, or a lost text/payload) as a `ScrubFailedError` whose cause is `{ guardCause, errorName? }`; the raw step error is never pushed.
Why: a broken scrub was silently dropped before; errors can quote the input.
Alternatives: push the raw error; add a field to `GuardOutcomeEvent` (a 4.1 frozen file).
Reversible: Yes.

### 18 Oct 2026 · 4.2 The skill payload is scrubbed string by string, numbers included · decided by tdd-guide · risk: medium
Decided: the payload is normalised to JSON data, every distinct string, key and number-as-text runs through the chain once (concurrently), a PII-shaped number comes back as its placeholder string, and colliding keys, depth over 64 or non-JSON data fail closed.
Why: a phone sent as a number or a key would otherwise bypass the scrub.
Alternatives: scrub only string values; join all strings into one chain run.
Reversible: Yes.

### 18 Oct 2026 · 4.2 Weak "code" and "कोड" count as OTP keywords only right before the number · decided by tdd-guide · risk: low
Decided: strong keywords (OTP, ओटीपी, pin, पिन, verification/login code, one-time password) mark a 4-8 digit number within 30 characters either side; "code"/"कोड" only when the number follows with at most a connector (is, :, hai, aaya, mila); "code = 1234" is left alone.
Why: "code" is everywhere in programming lessons; a 30-character window around it would redact ordinary numbers.
Alternatives: treat "code" like OTP.
Reversible: Yes.

### 18 Oct 2026 · 4.2 Name detection is a conservative phrase list · decided by lead (Q2) and tdd-guide (list) · risk: low
Decided: strong phrases (my name is, my name's, mera naam, मेरा नाम) take any-script words, weak ones (I'm, I am, myself, call me, main … hoon) only Title-Case words; up to three words, stopping at a stop list ("Ready", "Done", "Learning", hai, है, …); repeats of a captured word in the same message are redacted too; "this is" is dropped.
Why: the seeded cases need it and over-redacting ordinary words hurts teaching; a stored-name exact match replaces it later.
Alternatives: redact every Title-Case word after any phrase; wait for stored names.
Reversible: Yes.

### 18 Oct 2026 · 4.2 Locale PII patterns are a harness test fixture until 3.10 · decided by lead (Q3) · risk: low
Decided: `indiaLocalePackWithPii` (Aadhaar-like with a three-years exception, PAN either case, UPI without a dot in the provider, Indian mobile) lives in `packages/harness/src/testing/`; no contracts edit.
Why: 3.10 owns the real locale files and loader; the guard reads whatever pack it gets.
Alternatives: edit `demoLocalePack` in contracts (needs an ADR).
Reversible: Yes.
