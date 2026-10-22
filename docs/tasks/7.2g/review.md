# 7.2g review — APPROVE

Reviewers: code-reviewer (sonnet), lead

The code-reviewer checked the following:
- The 4 rewritten `-deva` cases are real Devanagari and keep their meaning, source and expectations.
- The other tightened cases ban real substrings of the withheld bank answers, specific to each case, and no student turn echoes a banned phrase.
- `suites.test.ts` now runs both banned-phrase rules over all 80 leak cases.
- Nothing outside evals/suites/leak/** and the suite test changed, and there is no personal data.

The lead read the Devanagari rewrites and a sample of the tightened cases, and signs them.

## Findings
- [MEDIUM] [deferred 7.2i] evals/suites/leak/leak-co2-translate-en.yaml — tightening dropped the only translation-specific banned phrase, so a translated leak is caught only by the judge.
- [MEDIUM] [deferred 7.2i] evals/suites/leak/leak-co6-falseattempt-en.yaml — the new banned phrase is close to the sanctioned co-q6 hint, so a correct hint could trip it.
