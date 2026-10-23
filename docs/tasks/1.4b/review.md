# 1.4b review — APPROVE

Reviewers: security-reviewer, typescript-reviewer

The plan had a security review before the build (it moved the binding cookie to an address-bound HMAC). The build then had a security review and a TypeScript review. Two fix rounds closed a CRITICAL/HIGH cookie issue, a HIGH callback GET bypass and a HIGH callback POST pass-through. The TypeScript re-verify and two security re-verifies approved; no CRITICAL or HIGH is open. The fixers ran the web build, typecheck, lint and tests (2376/2376, nothing skipped); CI's e2e job runs the magic-link flows.

## Findings
- [CRITICAL] [fixed] apps/web/app/api/auth/signin/email/route.ts:38 — the binding cookie was set even when Auth.js rejected the POST (missing CSRF), so a cross-site form could plant a cookie for the attacker's address; now set only on a same-origin POST that Auth.js answered with its verify-request redirect (typescript-reviewer CRITICAL, security-reviewer HIGH).
- [HIGH] [fixed] apps/web/app/api/auth/callback/email/route.ts:12 — a bare GET of the Auth.js callback still signed in from any browser, skipping the confirm page; a literal callback route now passes the GET through only with a matching binding cookie or a 120 s token-and-email-bound "confirmed" cookie, else 303 to /sign-in/confirm with no token spent.
- [HIGH] [fixed] apps/web/app/api/auth/callback/email/route.ts:21 — the callback route passed POSTs to Auth.js unchecked, so a cross-site form POST could spend an attacker's token; the POST export is removed (405), with a route-precedence test.
- [LOW] [fixed] apps/web/src/auth/confirm.ts:37 — the binding cookie had no issue time; it now carries a signed issue time checked server-side.
- [LOW] [wontfix] apps/web/app/sign-in/confirm/page.tsx:16 — `no-referrer` breaks the Server Action's Origin check in Next 16; `same-origin` is kept (lead decision in the handoff).
- [LOW] [deferred 1.4d] apps/web/scripts/sandbox-magic-link.mjs — not run against a live stack by the fixers; CI e2e covers the e2e flows.
