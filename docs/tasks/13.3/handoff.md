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

### 25 Oct 2026 · 13.3 security review outcome · decided by lead · risk: high
- Decided: accept 13.3 as passing: four read-only security-reviewer phases (A db scope and access filter, B web auth and entitlement, C worker, uploads and ingest, D dependencies, headers, secrets and logging) found no CRITICAL or HIGH. The nodemailer advisories are fixed in this task (8.0.11 to 10.2.1, pnpm audit clean). The missing security headers go to 13.3a and the LOWs to 13.3b.
- Why: the acceptance is "no high findings open". The findings files in docs/tasks/13.3 record what each phase checked, and the bump was re-reviewed by security-reviewer.

### 25 Oct 2026 · 13.3 nodemailer major bump without an ADR · decided by lead · risk: medium
- Decided: treat the nodemailer 8 to 10 bump as a dependency update inside the existing stack, not a tech-stack change that needs an ADR.
- Why: the same library sits in the same role. Its only breaking changes (Node 20 or later, TLS checks on remote content) do not touch apps/web/src/auth/mail.ts, and web typecheck, lint and test stay green.

### 25 Oct 2026 · 13.3 wontfix LOWs · decided by lead · risk: low
- Decided: wontfix the LOWs on packages/db/src/repositories/teacher-questions.ts (parameterised raw SQL) and apps/worker/src/webLink/pinnedTransport.ts (documentation drift).
- Why: neither is a defect. The first is already guarded by scope.test.ts's raw-SQL check, and the second records that the 5.1a DNS-rebinding gap is closed.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/web` → 10 successful, 10 total (all tests and lint/typecheck green).
- `corepack pnpm audit --prod` → "No known vulnerabilities found".
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Left to do
None.

## Budget
Tool calls used: 20 for the fix (harness count; the builder reported 10), plus 125 across the four review phases
