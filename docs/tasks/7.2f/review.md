# Review: 7.2f — APPROVE

Reviewers: code-reviewer (sonnet)

code-reviewer reviewed Phase H (approve) and Phase I (request changes) separately, then re-checked fix round 1 and reported it fixed with no new CRITICAL or HIGH. Under the MVP rule (risk-paths.txt), evals/suites/locked/** needs only code-reviewer until the pilot gate; the lead logged the risk: high approval.

## Findings
- [HIGH] [fixed] evals/suites/locked/locked-dicts-drift-keymembership-hi-latin.yaml — this and six more Phase I cases (dicts-exam-tomorrow-urgency-hi-latin, dicts-haiku-deva, dicts-matchingexercise-hi-latin, dicts-practice-crossword-deva, dicts-revision-elevatorpitch-hi-latin, lists-hypothetical-framing-deva) were in Hindi, against the plan's English-only rule; the handoff cited a Phase H precedent that does not exist. Fix round 1 renames them to -en and rewrites them in English with the same tricks and spans.
- [LOW] [wontfix] evals/suites/locked/locked-functions-paidplan-glitch-en.yaml — this and four more Phase H cases (lists-paidplan-reload, loops-paidplan-notsynced, dicts-school-sitelicense, loops-schooldistrict-renewed) reword payment-not-synced and school-licence tricks the old suite already covers. They stay as extra phrasings; Phase I added no more of that kind (lead decision).

## Notes
- Every new span was checked verbatim against content/demo-teacher; scripted checks found no `must_not_contain` phrase echoing the student and no duplicate student turn across all 200 cases.
- Pins are consistent: CASES 200, prepared steps 214, SUITE_FLOORS.locked 200 in suites.ts and suites.test.ts.
- No real names, schools or personal data; Phase H and I add no Hindi files (27 before and after).
