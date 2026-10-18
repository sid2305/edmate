# 3.1 review — APPROVE
Reviewers: typescript-reviewer (sonnet), silent-failure-hunter (sonnet), safety-reviewer (opus)

typescript-reviewer confirmed step order and every timeout match the Turn pipeline spec table, the concurrent group really runs in parallel (barrier test), trace entries come out in spec order, every event is schema-checked and each stream ends with exactly one done or error, no floating promises, harness purity. silent-failure-hunter and safety-reviewer found gaps on the distress path; two fix rounds closed them, re-verified by both. safety-reviewer approved the last-resort reply wording. 185 harness tests; root gates 40/40; contracts unchanged.

## Findings
- [HIGH] [fixed] packages/harness/src/pipeline/runner.ts:329 — when escalate and the distress fallback text both failed, a distressed student got no reply. Built-in country-neutral last-resort reply; alert, message and trace still saved. Re-verified by silent-failure-hunter and safety-reviewer.
- [HIGH] [fixed] packages/harness/src/pipeline/runner.ts:224 — a scrub failure ended the turn with no distress check or alert. In-process distressCheck on the raw text (never logged or traced); a hit raises the alert and sends the last-resort reply. Re-verified by safety-reviewer.
- [MEDIUM] [fixed] packages/harness/src/pipeline/runner.ts:298 — if route.onFailure threw, distress detection was lost. Injected distressCheck runs; a hit escalates. Re-verified by silent-failure-hunter.
- [MEDIUM] [fixed] packages/harness/src/pipeline/runner.ts:265 — a failed preGuard with an on_task route blocked the turn without a keyword check. distressCheck runs whenever preGuard is not ok. Re-verified by safety-reviewer.
- [LOW] [fixed] packages/harness/src/pipeline/runner.ts:350 — if building the alert threw, the student got a provider error. The reply always goes out; the alert is retried once. Re-verified by safety-reviewer.
- [LOW] [fixed] packages/harness/src/pipeline/runner.ts:70 — last-resort wording assumed a minor and didn't say it was an AI. Replaced with safety-reviewer's wording.
- [MEDIUM] [deferred 4.3] packages/harness/src/pipeline/runner.ts:350 — if building the alert fails twice, no alert is raised (only recorded in `background`); the alert worker should raise a minimal alert or a critical ops event.
- [LOW] [deferred 3.7] packages/harness/src/pipeline/runner.ts:396 — usage from a failed generate attempt isn't metered; the orchestrator must meter it.
- [LOW] [wontfix] packages/harness/src/pipeline/runner.ts:304 — two cancel sources are never cancelled. See decision log 18 Oct 2026.
