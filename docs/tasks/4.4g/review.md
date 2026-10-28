# Review: 4.4g — APPROVE

Reviewers: code-reviewer

## Findings
- [LOW] [wontfix] packages/harness/src/guardrails/jailbreakPatterns.test.ts:409-411: the must-stay-null cases (chess, grammar, chemistry) have no override verb, so they never reach the OTHER_TOPIC exemption and pass on main too; they check over-blocking, not the change itself.

## Notes
- OTHER_TOPIC has one use (jailbreakPatterns.ts:214, the `unless` on the decisive override rule); nothing else exempts school subjects.
- "rules of algebra", "rules of chemistry lab safety" and "rules of grammar for commas" are not blocked.
- The must-block tests (math, physics, biology, history) were red before the change and green after (handoff).
- Safety group: code-reviewer plus a risk: high lead decision; no safety-reviewer per PR until the pilot gate.
