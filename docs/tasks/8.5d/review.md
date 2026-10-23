# 8.5d review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

Both reviewers approved with no findings. Preview turns now get no-op profile and teacher-question ports, so an escalation or evidence from a teacher's preview never lands in real data (tests assert that the real repository methods are never called). readJson and TOO_LARGE are shared from src/turn; configuredMarket moved to turn/previewMarket.ts (a logged builder decision). The usage-ledger source test checks teacher_preview, postCorrection uses teacherScope(), and correction fields are capped at 8000 characters with a boundary test. A non-blocking TypeScript note: the preview profile store's applyEvidence([]) returns a profile with empty ids, which the harness never calls today.

## Findings
None.
