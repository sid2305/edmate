# 4.2b review — APPROVE
Reviewers: safety-reviewer (sonnet), typescript-reviewer (sonnet; also covered silent failures)

Any turn with a non-empty `attachments` array is refused at the scrub step, before the guard chain or skill-payload walk, and nothing about the attachment (storage key, mime, bytes) is read. The raw-text distress check still runs first, so a distress message with a photo still escalates (runner regression test). The refusal takes the same fail-closed path as every other scrub failure and is reported with a code only. Harness 3,137 tests pass; 34/34 turbo tasks; secret scan clean. No contracts change.

## Findings
- [MEDIUM] [deferred 9.4] packages/contracts/src/turn.ts:249 — a refused turn reaches the client as a bare retryable guard_blocked with no explanation; the wire error event has no text field (pre-existing, shared with the limit-reached reply).
- [MEDIUM] [deferred 4.2d] .claude/skills/merge-gate/risk-paths.txt — pipeline/steps/scrub.ts (and admit.ts) carry PII and distress fail-closed logic but are not in the safety glob.
- [MEDIUM] [deferred 4.2d] image data pasted as base64 or a data: URL in text or skillPayload is not caught by any guard (accepted in the plan, Q4); add a monitoring case.
- [LOW] [deferred 4.2d] packages/evals/src/agent.ts:11 — EvalTurnInput has no attachments field, so distress-with-photo can only be tested in harness tests.
