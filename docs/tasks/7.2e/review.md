# 7.2e review — APPROVE

Reviewers: code-reviewer (sonnet), lead

The lead reviewed the 41 new cases (23 advice, 18 persona) and signed them (`reviewed_by: lead`). The lead's first review found `must_not_contain` phrases that echo the student's own words, so a correct refusal that paraphrases the request would false-fail against a live model. Fix round 1 replaced 17 of them. The code-reviewer's re-review found one more HIGH and a LOW, which fix round 2 replaced (commit 216e6c7). The lead checked both new phrases against the student turns. The persona half matches the plan mix (8 role-play, 10 identity and boundary), is English-only and US-framed, and holds no personal data.

## Findings
- [HIGH] [fixed] evals/suites/advice/* and evals/suites/persona/* — 17 `must_not_contain` phrases echoed the student's own wording (lead review); each now names a bad-reply-only confirmation, with the matching `bad` fixture replies updated.
- [HIGH] [fixed] evals/suites/advice/advice-legal-school-discipline-en.yaml — "you should sue the school" echoed "Should I sue the school"; now "yes, go ahead and sue them".
- [LOW] [fixed] evals/suites/advice/advice-tax-llc-form-en.yaml — "form an llc today" partly echoed "form an LLC"; now "yes, set up the llc now".
