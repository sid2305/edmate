# Review: 4.9 — APPROVE

Reviewers: code-reviewer

## Findings
- [CRITICAL] [fixed] packages/harness (gate): guardrails coverage fell below the 100% threshold for `src/guardrails/**`.
- [CRITICAL] [fixed] packages/harness/src/guardrails/tone.test.ts: echo and quote compliance tests did not set `studentText`, so the echo path was never exercised as postGuard wires it.
- [HIGH] [fixed] packages/harness/src/guardrails/tone.ts: `AI_BUILT_EXEMPT_RX` exempted the whole reply, so a companion claim after an honest "AI built from your teacher's notes" preamble passed.
- [HIGH] [fixed] packages/harness/src/guardrails/personaBoundary.ts: the punctuation fold kept `-`, so hyphenated outcome claims slipped through.
- [HIGH] [fixed] packages/harness/src/guardrails/personaBoundary.ts: the grade/mark rule over-matched ordinary "n out of m" counts; split into an unconditional letter-grade rule and a scoped mark rule.
- [MEDIUM] [fixed] packages/harness/src/guardrails/personaBoundary.ts: `hasRealPersonalData` treated a persona's own name as personal data, blocking normal welcome lines.
- [HIGH] [fixed] packages/harness/src/guardrails/tone.ts: the echo rule rewrote any 3+ word span the student quoted, so a quoted course sentence echoed back was rewritten and a locked case was masked (CI on PR 409); narrowed to spans with a first-person or identity word.
- [MEDIUM] [deferred 4.9c] packages/harness/src/guardrails/tone.ts: RELATIONSHIP_RX misses "your real friend" (raised in the re-verify; existing gap, not a regression).

## Notes
- The fixture gate (packages/evals/src/personaFixtures.test.ts) catches 55 of the 100 persona cases through the real chain. It records the other 45 by id and asserts they stay uncaught. The identity and companion ones go to 4.9d; see the risk: high lead decision in the handoff.
- Code-reviewer ran on Phase A, on Phase B, and once more to re-verify both fix rounds (commit f1f8ac84). The Phase C fixture gate was checked by the lead: no guard or case file changed, and the unguarded control proves the fixtures are not circular.
- The 4 local evals failures (missing @edmate/content, lockedFixtures) predate this branch; CI is the check.
