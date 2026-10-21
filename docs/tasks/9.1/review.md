# 9.1 review — APPROVE
Reviewers: security-reviewer (opus), code-reviewer (sonnet), typescript-reviewer (sonnet)

All three reviewers approved; none found anything CRITICAL or HIGH. The typescript-reviewer ran
typecheck, lint and test with no cache: 34/34 tasks green, and `src/auth/**` coverage is 100%. The
fix round re-ran typecheck, lint, test and build on next-intl 4.14.9; all green.

## Findings
- [MEDIUM] [fixed] apps/web/package.json:24 — next-intl 4.4.0 had two advisories (GHSA-8f24-v5vv-gm5j open redirect, GHSA-4c35-wcg5-mm9h prototype pollution), not reachable in this setup. Now pinned to 4.14.9 (security-reviewer).
- [MEDIUM] [deferred 9.1b] apps/web/src/auth/index.ts:153 — `currentPrincipal()` swallows every error with no log, so a DB outage silently sends signed-in users to /sign-in. It still fails closed (typescript-reviewer; LOW from security-reviewer).
- [LOW] [deferred 9.1b] apps/web/app/page.tsx:12 — '/home' and '/teacher' are inline literals; export them next to SIGN_IN_PATH (typescript-reviewer).
- [LOW] [deferred 9.1b] apps/web/app/home/view.tsx — the nav's only link points to /home itself (code-reviewer).
- [LOW] [deferred 9.4] apps/web/app/home/page.tsx:9 — the `age` clearance lets consent-pending students reach /home; chat added here in 9.4 must require `{ clearance: 'agent' }` (security-reviewer).
