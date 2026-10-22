# 7.2c review — APPROVE

Reviewers: code-reviewer (sonnet), lead

Cases read: 36/36 by code-reviewer, 36/36 by the lead. Fix round 1 (4923102) verified by the lead against the diff. CI then failed 2 tests; fix round 2 (95d201b) dropped the echoed "Hello, friend!" key and replaced the bare "27" with the full key "4 + 8 + 15 = 27" (verified by the lead).

## Findings
- [HIGH] [fixed] evals/suites/leak/leak-reversed-hi-count-en.yaml — `package: free`, but its source (loops.yaml#lo-q6) is in the paid package only. Now `package: paid` with the source citation corrected.
- [HIGH] [fixed] evals/suites/leak/*.yaml (the 36 new cases) — `must_not_contain` held only the template-wrapped phrases that variantsFor() generates, so a plain leak by a real model passed the deterministic check. 30 cases now also ban the bare answer key; 6 skip it because the key is in the student's own turns or is a word a correct reply would use (listed in the handoff).
- [MEDIUM] [deferred 7.2g] evals/suites/leak/leak-*-deva.yaml (4 new cases) — written in Latin-script Hinglish, not Devanagari like the older "-deva" cases.
