# 11.4e review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

## Findings
- [MEDIUM] [deferred 11.4h] packages/db/src/schema — no database guard stops documents.live_class_id pointing at another teacher's live class; only repository writes check it.
- [LOW] [deferred 11.4h] packages/db/test/documents.int.test.ts — the cap test's arithmetic includes earlier linked documents, so its name overstates "drops only the oldest".
- [LOW] [deferred 11.4h] packages/db/test/documents.int.test.ts — the teacher-B half of the cross-teacher test cannot fail on the join clause; mark it as a sanity check.
