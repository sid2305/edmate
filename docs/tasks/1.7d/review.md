# 1.7d review — APPROVE

Reviewers: code-reviewer, security-reviewer, typescript-reviewer

## Findings
- [MEDIUM] [deferred 1.7i] apps/web/test/build-smoke.test.ts — eraseStudent is assigned only after createSession succeeds; a createSession failure leaks the student row on the shared dev Postgres (code-reviewer)
- [LOW] [wontfix] apps/web/src/auth/age.ts — the strip does not remove bidi-override characters (visual spoofing, not line splitting; out of scope) (security-reviewer)
- [LOW] [wontfix] apps/web/test/build-smoke.test.ts — a later cleanup error in afterAll's nested try/finally can replace an earlier one (accepted so the restore steps always run) (typescript-reviewer)
