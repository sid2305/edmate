# 12.2f review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer, silent-failure-hunter

## Findings
- [HIGH] [fixed] apps/web/src/studio/publish.ts — `latest` returned `{ run: null }` before the agent lookup, so a draft agent taken down by staff before its first publish never showed the suspended banner; fix round 1 looks the agent up on the no-run path too, re-reviewed APPROVE (typescript-reviewer)
- [MEDIUM] [deferred 12.2h] packages/db/src/repositories/reports.ts — listOpenForStaff's per-row catch skips a bad row with no signal, so a shrinking staff queue is invisible (silent-failure-hunter)
- [LOW] [deferred 12.2h] packages/db/src/repositories/reports.ts — the same per-row catch is broader than the row-parse error it is for (security-reviewer)
- [LOW] [deferred 12.2h] packages/db/src/repositories/reports.ts — narrow the per-row catch to the expected error type (typescript-reviewer)
- [LOW] [deferred 12.2h] apps/web/app/api/sessions/[id]/reports/handlers.ts — the trust-inbox excerpt reads "a inappropriate reply" / "a other reply"; use a category-to-label map (code-reviewer)
