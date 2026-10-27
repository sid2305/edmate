# 8.7n review — APPROVE

Reviewers: security-reviewer, code-reviewer

## Findings
- [MEDIUM] [wontfix] packages/db/test/publish.int.test.ts — the no-course test passes before the fix too, because `=== true` already turns NULL into false; it pins the contract instead (lead decision in the handoff) (security-reviewer)
