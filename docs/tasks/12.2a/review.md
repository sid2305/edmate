# 12.2a review — APPROVE

Reviewers: security-reviewer (sonnet; also as typescript-reviewer and code-reviewer), lead

The security reviewer re-ran typecheck and lint on an archived copy of the branch. It also ran reports.test.ts (29 passed) and, against a disposable Postgres, reports.int.test.ts, repositories.int.test.ts and scope.test.ts (314 passed). Findings:
- `file` scopes its INSERT…SELECT through the student's own session and only accepts agent or teacher messages. The row id is derived from the reporter and the message, so a second report on the same message is `created: false`. Another student, another pair's session, the student's own message and a missing message are all `not_found`.
- `listOpenForStaff` and `review` check `lockRole` inside the transaction. Two concurrent reviews leave one winner and one audit row, verified with a real two-promise test. A deleted message is `integrity` on review, and the report stays open.
- `StaffReportRowSchema` is strict and has no reporter or session field.
- The hand-qualified `"documents"."id"` in the takenDown subquery is correct, with no column capture.
- Errors carry only the method and kind, and audit payloads go through `redactPersonalData`.

## Findings
- [LOW] [deferred 12.2f] packages/db/src/repositories/reports.ts — listOpenForStaff throws `integrity` for the whole batch when one stored report has an unknown reason, so one bad row blocks the staff queue; skip or quarantine that row instead.
- [LOW] [deferred 12.2f] packages/db/src/repositories/reports.ts — the per-report cap of 10 cited documents is applied after one batch-wide query capped at REPORTS_QUEUE_MAX_LIMIT*10, so a large queue could truncate a later report's cited documents; scope the lookup per report or document the cap.
