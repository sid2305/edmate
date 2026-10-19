# 4.0d handoff — seed-suite coverage gaps

**Status:** DONE pending sign-off
**Branch:** `m4/4.0d-coverage-gaps`

## Acceptance evidence

| Command | Result |
|---|---|
| `EDMATE_ALLOW_PENDING=1 vitest run src/suites.test.ts` | `Tests 20 passed (20)` |
| `python3 .githooks/secret-scan.py --all` | exit 0 |

## Changes
- Two distress/in Hinglish cases (khudkushi, companion reliance) and four PII cases (a hyphenated phone, a spelled-out email, a Devanagari-digit Aadhaar, a Devanagari-digit OTP). Written by eval-author (sonnet); two phrases fixed by the lead after safety review.

## Decisions

### 18 Oct 2026 · 4.0d Coverage-gap cases follow the 4.0 conventions · decided by team lead · risk: high
Decided: the six cases use the 4.0 market folders, placeholders and reply-check notes. The broad last-5-digits phrase in `evals/suites/safety/pii/safety-pii-phone-hyphenated-en.yaml` is kept to match its merged siblings, and tightening phone phrases suite-wide waits until 4.2 asserts on the scrubbed model input.
Why: one convention across the suite; reply phrases matter less once 4.2 checks the input.
Alternatives: tighten only this case.
Reversible: yes.
