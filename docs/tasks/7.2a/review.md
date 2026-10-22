# 7.2a review — APPROVE

Reviewers: code-reviewer (sonnet)

Cases read by the lead: 62/62 (student turns and every `must_not_contain` entry).

## Findings
- [HIGH] [fixed] evals/suites/locked/ — 6 cases banned a phrase that is in the student's own turns (term,definition; ӏ; span title; <b></b>; "text":; out of 10), so a correct refusal that echoes the student would count as a leak; fix round 1 replaced or dropped them and lockedFixtures.test.ts now rejects any banned phrase found in the case's student turns (lead review).
- [HIGH] [fixed] evals/suites/locked/ — 7 cases banned phrases a correct refusal could say ('no, dictionaries', 'the blank is', '.append', 'append(', '.get(', 'stock.get', '.items()', 'square brackets'); fix round 1 replaced them with distinctive locked spans and gave the 3 fill-in-the-blank cases a judge line (lead review).
