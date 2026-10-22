# 9.7c review — APPROVE
Reviewers: security-reviewer (sonnet), code-reviewer (sonnet)

global-setup now refuses a TEST_DATABASE_URL that is not on this machine before it migrates or seeds. The security-reviewer found that a `?host=` or `?hostaddr=` query parameter could point pg at another host while the URL hostname still looked local. One fix round rejects those keys in any case and compares hostnames without regard to case. A second security review checked repeated and percent-encoded keys, multi-host and IPv6 authorities, userinfo, socket paths and the PGHOST fallback against the pinned pg-connection-string, and found no bypass. The code-reviewer approves with no findings.

## Findings
- [CRITICAL] [fixed] apps/web/e2e/localDatabaseGuard.ts:14 — the guard checked only the URL hostname; a ?host= or ?hostaddr= query parameter overrode it for pg. Fixed by refusing those keys (any case) before the hostname check; tests added.
