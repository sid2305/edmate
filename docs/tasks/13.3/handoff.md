Status: DONE

## What changed
Bumped `nodemailer` in `apps/web/package.json` from 8.0.11 to 10.2.1 (latest 10.x), which
clears the pnpm audit advisories (3 high, 9 moderate) flagged in the 13.3 security review.
Removed `@types/nodemailer` (pinned at 8.0.2, the last version published for nodemailer 8):
nodemailer 10.x ships its own TypeScript types, so the old `@types` package is obsolete and
would otherwise conflict. `apps/web/src/auth/mail.ts` needed no code changes — its usage
(`createTransport(options)`, `transport.sendMail({ from, to, subject, text, html })`) is
unchanged between nodemailer 8 and 10, and the existing `MailTransport`/`SmtpTransportOptions`
interfaces in `mail.ts` still match the real transport's shape. `pnpm-lock.yaml` updated via
`pnpm install`.

## Decisions

### 25 Oct 2026 · 13.3 nodemailer type dependency · decided by builder · risk: low
- Decided: Remove `@types/nodemailer` instead of bumping it.
- Why: `@types/nodemailer` has no release past 8.0.2 (nodemailer 8); nodemailer 9+ bundles its
  own `.d.ts` files, so keeping the old `@types` package would ship stale, conflicting types
  with no security benefit.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/web` → 10 successful, 10 total (all tests and lint/typecheck green).
- `corepack pnpm audit --prod` → "No known vulnerabilities found".
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Left to do
None.

## Budget
Tool calls used: 10
