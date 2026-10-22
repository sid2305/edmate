# 9.6d review — APPROVE

Reviewers: typescript-reviewer (sonnet; also as code-reviewer), lead

The reviewer re-ran the web gate (34/34) in a scratch clone. The PATCH /api/subscriptions/[id] handler takes its scope from the signed-in student and the agent's own teacher, and only compares the URL id against that scope's live subscription, so a cross-student or cross-teacher id is 404 before any write. Bodies are strict per action, the 64 KB cap returns 413, the error mapping is exhaustive, and the package id is resolved server-side. PlanView wraps every action in try/catch/finally with one busy flag, never trusts a failed response body, renders no raw HTML and is axe-tested. The clearance-scan allowlist adds one named file, like the memory and progress pages. Tests use fakes only. Two MEDIUMs (no logging on the 500 path; the plan page's silent fallback when a package version is missing) are deferred to 9.6i, which already works on these subscription files.

## Findings
- [MEDIUM] [deferred 9.6i] apps/web/src/subscriptions/change.ts — a thrown `failed` or unexpected error becomes 500 with nothing logged; log the error name like apps/web/src/export/routes.ts.
- [MEDIUM] [deferred 9.6i] apps/web/app/learn/[agentId]/plan/page.tsx — a `packageVersions.getById` miss falls back to the internal packageVersionId as the shown package id instead of failing closed like change.ts; untested, and the current package could appear among the other offers.
