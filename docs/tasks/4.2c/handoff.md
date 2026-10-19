# 4.2c handoff: PII pattern hardening

- **Status:** DONE
- **Branch:** `m4/4.2c-pii-hardening` (from origin/main 951d8c0, 4.2 merged)
- **Worktree:** `.claude/worktrees/agent-adde9a04a947e41df` (repo-relative)
- **Risky paths:** `packages/harness/src/guardrails/**` (student-safety group, risk-paths.txt) →
  **safety-reviewer required**.

## Acceptance evidence

### Each listed form has a test

| Item | New tests (harness) |
|---|---|
| 1. Digit forms | `digitForms.test.ts` (10 tests, 100% coverage); `piiPatterns.test.ts` "4.2c item 1" (4 tests): keycap phone, superscript grouped phone, circled-digit OTP, a mark (CGJ) mid-number. |
| 2. Phone separators | `piiPatterns.test.ts` "4.2c item 2" (6 tests): multi-space gap, pair groups, uneven dash groups, `+CC` UK-shaped groups, no-keyword near-miss, years near-miss (spaced and `+CC`). |
| 3. Card | "4.2c item 3" (8 tests): dot-separated groups, unlabelled CVV+expiry after a card (the proposed eval case's shape), the existing "unrelated word stops the window" near-miss re-asserted, spaced CVV, spelled-out CVV, spelled-out CVV with no card (near-miss), a bare 3-4 digit run with no date, a 3-4 digit run that's really the date's own tail (not doubled). |
| 4. OTP | "4.2c item 4" (7 tests): spaced digits after OTP, dashed digits after "otp:", Devanagari spaced digits, "code" after the number, bheja/aaya after the number, a no-keyword near-miss. |
| 5. Names | "4.2c item 5" (11 tests): "hai"/"है" skipped after a strong phrase (English and Devanagari), "name:"/"naam:", "मैं … हूँ", the proposed eval case's word order, 4 stop-list near-misses (khatam/barbaad/bekaar/nothing), a Devanagari-filler near-miss for "मैं … हूँ". |
| 6. Spelled numbers | "4.2c item 6" (4 tests): English spelled phone, Hinglish spelled phone, Hinglish spelled OTP, a no-keyword near-miss. |
| 7. Payload keys | `scrub.test.ts` "4.2c item 7" (6 tests): `card`/`name`/`pin` bare left alone (the 3 named near-misses plus a top-level bare "name"), an object value under a PII key not propagating into its own nested keys, compound forms (`cardNumber`/`studentName`/`pinCode`) still redacting; the pre-existing payload-key tests updated (bare `name` moved out of the redacted table, an array-under-key case added). |
| 8. Over-scrub | "4.2c item 8" (2 tests): a constant run (`x = 9999999999`) and a counting run with no keyword (`matrix 1 2 3 4 5 6 7 8 9`), both left alone. |
| 9. Eval cases | 6 new YAML cases (below), driven by `packages/evals/src/piiScrubPipeline.test.ts` (4 PII) and left for 4.3's distress eval wiring (2 distress, `reviewed_by: pending`). |

Aadhaar Verhoeff (mentioned only in the board task's title, not in the lead's numbered list) was
out of scope for this pass; flagged as a follow-up below.

### `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/evals... --force`

Postgres and Redis up (`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml -f apps/worker/test/compose.port.yaml up -d postgres redis`, both healthy).

```
@edmate/harness:test:   Tests  2733 passed (2733)
@edmate/evals:test:     Tests  176 passed | 1 failed (177)
 Tasks:    11 successful, 14 total
Failed:    @edmate/evals#test
```

The one evals failure is `src/suites.test.ts > evals/suites (real cases) > every case validates
and follows the suite rules`, reporting exactly the 6 new cases' `reviewed_by: pending` — expected
and by design until a human signs them off (see "Pending review" below). No other test, in either
package, fails. `packages/evals/src/piiScrubPipeline.test.ts` itself (the task's acceptance test)
passes in full regardless of that env var, since it loads cases directly and never reads
`reviewed_by`:

```
@edmate/evals:test:  src/piiScrubPipeline.test.ts (45 tests) — all pass
```

(Re-run standalone: `EDMATE_ALLOW_PENDING=1 corepack pnpm vitest run src/piiScrubPipeline.test.ts`
→ `Tests  45 passed (45)`. The env var makes no difference to this file; it is set only because
the lead's instructions named it. Setting it for the *whole* evals suite instead trips a different,
deliberate meta-test — `requires reviewed cases and all guards by default (no opt-out env var set
here)` — that asserts the var is normally unset. There is no single setting that turns the full
evals test run fully green while any case is still `reviewed_by: pending`; that is the suite's own
design, not a bug introduced here.)

### Coverage (`vitest run --coverage`, harness)

```
All files          |   99.32 |    98.34 |   98.45 |   99.58
```

`src/guardrails/**` (threshold 100, `vitest.config.ts`): no threshold error — 100/100/100/100,
including the two new files (`digitForms.ts`, and `piiPatterns.ts`'s new code). `src/pedagogy/**`
(threshold 100): unaffected, untouched by this task. `src/pipeline/steps/scrub.ts` (not under the
100% threshold): 98.91/98.41/100/100, one pre-existing uncovered line (an unreachable "string
missing from the map" throw, same as 4.2's handoff noted).

### Secret scan

`python3 <repo-root>/.githooks/secret-scan.py --all` (run with an absolute path) → exit 0, no output.

### The 6 proposed eval cases (lead's correction, 19 Oct 2026)

All `suite: safety`, `package: free`, `reviewed_by: pending`, `source` starting "4.2 safety
review: ...", following the existing case format.

| id | Folder | Checked by |
|---|---|---|
| `safety-pii-keycap-phone-en` | `evals/suites/safety/pii/` | `piiScrubPipeline.test.ts` (PII case) |
| `safety-pii-card-unlabelled-cvv-en` | `evals/suites/safety/pii/` | `piiScrubPipeline.test.ts` (PII case) |
| `safety-pii-otp-spaced-deva` | `evals/suites/safety/pii/` | `piiScrubPipeline.test.ts` (PII case) |
| `safety-pii-name-word-order-hi-latin` | `evals/suites/safety/pii/` | `piiScrubPipeline.test.ts` (PII case) |
| `safety-distress-name-heuristic-in-en` | `evals/suites/safety/distress/in/` | not a PII-scrub case (per lead); not wired to a live agent yet (4.3/eval-author scope), so this is seeded only, same as every other `distress/in` case today |
| `safety-distress-name-heuristic-in-hi-latin` | `evals/suites/safety/distress/in/` | seeded only, as above |

`piiScrubPipeline.test.ts`'s case counts updated: 39→43 loaded, 38→42 checked, 30→34 caught by the
mutation check (the 2 distress cases live outside `evals/suites/safety/pii/`, so they never reach
this test; they are future input to 4.3's distress-eval wiring, not this task's scope).

### Pending review

All 6 new case files carry `reviewed_by: pending`. **The lead needs to get human sign-off on these
6 cases** (content and phrasing, same as every other seeded case) and then update each file's
`reviewed_by` away from `pending` — at which point `src/suites.test.ts`'s "every case validates and
follows the suite rules" test goes green with no env var needed.

## Changes

Created:
- `packages/harness/src/guardrails/digitForms.ts`, `digitForms.test.ts`: `foldDigitForms` — a
  pre-pass (kept deliberately separate from `piiPatterns.ts`'s own digit-folding view, per the
  lead's instruction, so it doesn't collide with 4.5's move of that view to a shared helper).
  Folds keycap (digit + VS16 + combining enclosing keycap), superscript and circled digit
  presentations to ASCII, and drops `\p{Default_Ignorable_Code_Point}`/`\p{M}`/U+2800 marks that
  immediately follow a digit, with a position map back to the original text.
- 4 PII eval cases under `evals/suites/safety/pii/`, 2 distress eval cases under
  `evals/suites/safety/distress/in/` (see table above).

Modified:
- `packages/harness/src/guardrails/piiPatterns.ts`:
  - `findPii` runs `foldDigitForms` before the existing fold/view, composing the two position maps
    back to the original text; the existing fold/view block itself is untouched.
  - Phone: `PHONE_FLEX_BARE` (keyword-windowed, like `BARE_TEN`) and `PHONE_FLEX_CC` (unconditional,
    like the other `+CC` shapes) accept 7-13 digits in any grouping, joined by space, dot, comma,
    slash, underscore or dash; `validPhoneFlex` excludes an all-single-digit list (left to
    `PHONE_SPACED`), a run of year-shaped groups, and a constant run.
  - Card: `CARD`'s separators now also take a dot. `unlabelledAfterCard` redacts the next 3-4 digit
    run and the next `MM[ /-]YY` within ~25 characters after a card, through punctuation and
    whitespace only (an unrelated word still stops the window, same as the existing near-miss).
    `CVV_AFTER_SPACED`/`CVV_AFTER_SPELLED` add single-spaced and spelled-out CVV values.
  - OTP: `CODE_AFTER` adds "code"/bheja/aaya/mila *after* the number (the existing `OTP_CODE` only
    had it before); `OTP_FLEX` (keyword-windowed) accepts a 4-8 digit OTP split by separators.
  - Names: `afterStrongPhrase` skips one leading "hai"/"है"/"is"/":" right after a strong phrase so
    "mera naam hai Aarav" and "मेरा नाम है आरव" still capture the real name; `NAME_STRONG` also
    matches "name:"/"naam:"; `NAME_MAIN_DEVA` adds "मैं … हूँ"; `NOT_A_NAME` gains
    khatam/khatm/barbaad/bekaar/bekar/nothing and a small set of Devanagari fillers/distress words
    for the new `NAME_MAIN_DEVA` path.
  - `SPELLED_RUN` (English and Hindi-latin digit words, 3-10 in a row) feeds the same keyword-window
    mechanism as bare numbers, for both phone and OTP categories.
  - `localeMatches` skips a purely-numeric locale match that is a constant digit run (not a
    monotonic/counting one, which stays — "9876543210" is still a valid phone-shaped test number).
- `packages/harness/src/pipeline/steps/scrub.ts`: `keyCategory` now requires a prefix or suffix for
  the three ambiguous words (`card`, `name`, `pin`) — a bare key no longer redacts, only a compound
  one (`cardNumber`, `studentName`, `pinCode`, ...). `rebuild` no longer lets a PII-named key's
  category propagate into an object value's own nested keys (only into an array's elements, which
  are still the key's own value) — so `{"card":{"front":"..."}}` and
  `{"files":[{"name":"main.py"}]}` keep their content.
- `packages/harness/src/guardrails/piiPatterns.test.ts`, `packages/harness/src/pipeline/steps/scrub.test.ts`:
  new tests per item above; the pre-existing bare-`name`/nested-under-key payload-key tests updated
  to match the new (narrower) behaviour.
- `packages/harness/src/guardrails/index.ts`: export `foldDigitForms`/`FoldedDigitForms`.
- `packages/harness/README.md`: PII scrub section updated for the new shapes and the digit-forms
  pre-pass.
- `packages/evals/src/piiScrubPipeline.test.ts`: case counts 39/38/30 → 43/42/34; header comment
  updated.

Not touched: `packages/contracts/**` (no schema/fixture edit, no ADR);
`packages/harness/src/guardrails/{guard,registry,chain,order}.ts`;
`packages/harness/src/pipeline/runner.ts`; `evals/suites/safety/pii/` and
`evals/suites/safety/distress/in/`'s *existing* files (read-only); `apps/cli/**`,
`packages/evals/src/{agent,runner,schema,loader}.ts`.

## Deviations from the task description

- **Card redaction after an unrelated word stays excluded.** "redact the next 3-4 digit run and
  the next MM[ /-]YY within about 25 characters" is implemented so the ~25-character window only
  passes through punctuation and whitespace, never an unrelated word — otherwise the pre-existing,
  still-required near-miss ("4111 1111 1111 1111 and the exam on 12/29" must stay unchanged) would
  break, since "12/29" there is well within 25 raw characters of the card. This matches the
  example eval case (`.../ 12/29 / 123 ...`, punctuation-only gaps) and the spirit of "about 25
  characters", read together with the existing near-miss it must not regress.
- **Flexible-group phone candidates don't reuse `phoneLikeDigits`'s monotonic-step exclusion.**
  Two of the task's own example numbers ("98765 43210", a classic test number) are a constant
  -1-step sequence, which `phoneLikeDigits` (designed for single-digit-spaced lists like a
  countdown) would wrongly exclude. Grouping into multi-digit chunks is itself a much stronger
  phone-shape signal than a single-digit-spaced list, so only a genuinely constant run
  ("9999999999") and a run of year-shaped groups are excluded for this shape; the existing
  single-digit-spaced near-misses (countdown, bits, zeros, range output) are unaffected because
  they are excluded earlier by "not every group a single digit".
- **The over-scrub guard on locale-pattern digit matches excludes only a constant run, not a
  counting one.** The existing `phoneLikeDigits` guard (constant *or* counting) would have broken a
  pre-existing, still-required test (`'note 9876543210 down'` → `` `note ${P.id} down` ``, since
  "9876543210" is a counting run). Item 8's own example ("x = 9999999999") is a constant run, which
  the narrower guard still catches.
- **Aadhaar Verhoeff** is in the board task's title but not in the lead's numbered instructions for
  this build; out of scope here (see Follow-ups).

## Follow-ups (not blocking)

- Aadhaar Verhoeff checksum, in place of the current years-exception, is 3.10's job per the 4.2
  handoff's existing follow-up (the real `content/locales/IN.yaml` pack must pass the same tests);
  it was not in this task's numbered list.
- 4.2b (text inside images) and the stored-student-name exact match (once identity, 1.x, stores a
  display name) are unchanged follow-ups from 4.2.
- The lead needs to get human sign-off on the 6 new eval cases (see "Pending review" above).

## Decisions

### 19 Oct 2026 · 4.2c Digit-form folding is a separate pre-pass module · decided by lead (coordination with 4.5) and tdd-guide · risk: medium
Decided: `foldDigitForms` (keycap, superscript, circled digits; marks dropped after a digit) lives in its own new file, `guardrails/digitForms.ts`, called once at the top of `findPii` before the existing fold/view code in `piiPatterns.ts`, which is left untouched.
Why: 4.5 is moving that existing fold/view block to a shared helper on its own branch; keeping the two changes in separate files avoids a conflicting edit to the same lines, whichever PR merges first.
Alternatives: add the new digit forms to the existing `fold()` function directly.
Reversible: Yes; a later merge can fold the two modules together once both land.

### 19 Oct 2026 · 4.2c Card redaction after an unrelated word still stays excluded · decided by tdd-guide · risk: medium
Decided: the ~25-character window after a card for an unlabelled CVV/expiry only passes through punctuation and whitespace; a word (a letter) stops it immediately.
Why: the task's own near-miss ("... and the exam on 12/29" must stay unchanged) and the new eval case (punctuation-only gaps) both need to pass; a word-blind 25-character window would redact the near-miss's unrelated date too.
Alternatives: a plain 25-character window with no word boundary; a shorter window with no boundary check.
Reversible: Yes.

### 19 Oct 2026 · 4.2c Flexible-group and locale-pattern over-scrub guards exclude constant runs, not counting ones · decided by tdd-guide · risk: medium
Decided: the new flexible-group phone pattern and the locale-pattern over-scrub guard (item 8) both exclude a run of the same digit repeated, but not a monotonic/counting run (ascending or descending by one).
Why: two of the task's own example numbers, and a pre-existing required test (`9876543210`, India mobile shape), are counting runs that must still redact; only the narrower "constant digit" exclusion satisfies every required case at once.
Alternatives: reuse `phoneLikeDigits` (constant or counting) everywhere, which breaks the pre-existing test and one of the task's own phone examples.
Reversible: Yes.

### 19 Oct 2026 · 4.2c Payload-key ambiguity is narrowed to three words, via a prefix/suffix requirement · decided by tdd-guide · risk: low
Decided: `card`, `name` and `pin` alone no longer redact a payload value (they need a prefix or suffix — `cardNumber`, `studentName`, `pinCode`); an object value under a PII-named key no longer propagates its category into the object's own nested keys (an array still does, since it is the key's own value).
Why: a flashcard's `card`, a file's `name` and a map/GPIO `pin` are ordinary teaching content, and the old code redacted a sibling key's unrelated nested object too (`{"card":{"front":...}}`).
Alternatives: keep all PII words bare-matching and rely on value shape alone; propagate `under` into nested objects too (today's behaviour, the thing being fixed).
Reversible: Yes.

### 19 Oct 2026 · 4.2c The 2 proposed distress eval cases are seeded only, not wired into piiScrubPipeline · decided by lead (correction) · risk: low
Decided: `safety-distress-name-heuristic-in-en`/`-hi-latin` live under `evals/suites/safety/distress/in/` with `reviewed_by: pending`, same shape as every other distress case; they are not PII-scrub cases and are left out of `piiScrubPipeline.test.ts`'s PII assertions.
Why: the lead's correction said so explicitly; a live/reply check for these needs 4.3's distress-eval wiring, not this task.
Alternatives: fold them into the PII pipeline test anyway (would assert nothing meaningful, since they carry no PII).
Reversible: Yes.
