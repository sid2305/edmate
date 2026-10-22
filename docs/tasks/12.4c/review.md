# 12.4c review — APPROVE

Reviewers: security-reviewer (sonnet), lead

The security-reviewer read the new staff API `/api/staff/agents` (GET lists agents with their regulated-subject flag; POST sets the subject or the approval). Staff-only access is enforced by the `/api/staff/**` policy row, `withRole(['staff'])` and the repository's own role lock. The POST body is a strict discriminated zod object, so any `by` or unknown key is a 400 before the repository is called, and the acting staff id comes only from the session. POST passes the shared same-origin check, the body is size-capped before parsing, the note is length-capped and never logged or echoed, repository errors map to fixed codes, the GET response is an explicit allow-list with no personal data, and every response is no-store. The lead checked the diff stays in apps/web/app/api/staff/agents and the handoff; the publish-block part of the int test moves to 12.4d as the plan says.

## Findings
None.
