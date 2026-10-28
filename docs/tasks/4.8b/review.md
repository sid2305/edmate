# Review: 4.8b — APPROVE

Reviewers: code-reviewer

## Findings
- [MEDIUM] [deferred 4.8c] packages/harness/src/guardrails/adviceGuard.ts: IMPERATIVE_RX treats a dash or comma as a sentence break, so self-regulated verbs (buy, sell, invest, sue) in history prose become a hard-rule hit.
- [MEDIUM] [wontfix] evals/suites/advice: the three cases went from pending to lead inside the builder's commit. The lead read all three after Phase A and confirmed only the reviewed_by line changed (see the lead decision).
- [LOW] [deferred 4.8d] packages/harness/src/guardrails/adviceGuard.ts: the rewrite-verify outage is reported under the generic personal_advice reason, not a cause of its own.
- [LOW] [deferred 4.8d] packages/harness/src/guardrails/adviceGuard.ts: the file-header comment for step 3 still says every outage goes to judge_unavailable.

## Notes
- Code-reviewer ran on Phase A (4c8e9302) and on Phase B (996b74ae, isolated from the 4.9 merge). Neither found a CRITICAL or HIGH.
- Fail-closed behaviour checked on Phase B: a rewrite is used only on a clean judge verdict; any judge or rewrite failure goes to the fixed fallback.
- Guardrails coverage is 100%; the evals suite is green without EDMATE_ALLOW_PENDING.
