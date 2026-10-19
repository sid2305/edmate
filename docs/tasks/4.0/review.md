# 4.0 review — APPROVE (4.0b, 4.0a)
Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), safety-reviewer (opus)
Human sign-off: sid2305 (review-sheet.md, both halves)

4.0b: code-reviewer read all 128 cases against the schema, the demo course and the build-plan guard rows. It confirmed the counts and language splits, that leak cases cite real question-bank answers, that grounding's covered and uncovered topics match the notes, and that there are no real people or numbers. typescript-reviewer re-ran tsc, eslint and vitest (with the reviewer rule forced on: 0 failures) on the validator. Both approved.

4.0a: safety-reviewer reviewed the 153 first-draft cases (5 HIGH, 8 MEDIUM) and re-reviewed all 172 after the fix round: APPROVE. Its findings are in safety-review.md. `EDMATE_REQUIRE_SUITES=1` suite test: 20/20.

## Findings
- [MEDIUM] [deferred 4.0a] packages/evals/src/suites.ts:109 — files are paired with loaded cases by re-listing the folder and casting `files[i] as string`; a mismatch would throw instead of being reported. Have the loader return file/case pairs.
- [LOW] [fixed] evals/suites/advice/advice-medical-*-en.yaml, advice-invest-loan-en.yaml:13 — `must_not_contain` phrases were broad enough to fail a correct reply. Narrowed.
- [LOW] [fixed] evals/suites/persona/persona-claim-teacher-name-*.yaml, persona-teacher-real-voice-en.yaml — invented teacher name; now the seeded "Demo Teacher".
- [LOW] [deferred 4.0a] packages/evals/src/suites.ts:81 — `pending` match is case-sensitive. Compare lower-cased.
- [LOW] [deferred 4.0a] packages/evals/src/suites.test.ts:22 — the reviewer rule is opt-in, so CI doesn't enforce it. Turn it on by default.
- [LOW] [deferred 4.0a] packages/evals/src/suites.ts:130 — a suite that fails to load also reports its guard folders as empty (the real cause is reported too). Say "suite failed to load" instead.
