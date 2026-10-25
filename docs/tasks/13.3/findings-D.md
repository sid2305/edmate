# 13.3 findings — Phase D (dependencies, headers, secrets, logging)

Reviewer: security-reviewer (sonnet), read-only, 25 Oct 2026.

**Verdict: PASS (no HIGH under the plan's criteria).** `pnpm audit --prod` reports "high" advisories on one package; they are fixed in this task (see below).

## Findings
- [MEDIUM] apps/web/package.json — a vulnerable dependency. `corepack pnpm audit --prod` reports that nodemailer 8.0.11 has 3 high and 9 moderate advisories:
  - the `raw` message option bypasses file and URL access limits;
  - addressparser has quadratic-time DoS bugs.
  apps/web/src/auth/mail.ts never sets `raw`, so the file-read path cannot be reached. The DoS path can, through the sign-in address. Fix: bump to a patched version (10.1.4 or later) and re-run the audit.
- [MEDIUM] apps/web/next.config.ts — missing security headers. Nothing sets a CSP, X-Frame-Options, HSTS, X-Content-Type-Options or Referrer-Policy: there is no `headers()` and no middleware. This is a defence-in-depth gap. Fix: a `headers()` block, with HSTS once the app is behind TLS.

## Checked clean
- `pnpm audit --prod`: nothing other than nodemailer.
- scripts/foundry.env.example: placeholders only.
- packages/*/src and apps/*/src: no key or password literals.
- Log call sites in web turn, studio, auth, subscriptions, export and chat, and in worker ingest, alerts and alarms, log only event names, error names and ids. The alarms logSink whitelists its fields.
