# 13.3 review — APPROVE

Reviewers: security-reviewer

Four read-only security-reviewer phases ran, with findings in findings-A.md to findings-D.md. Every phase passed with no CRITICAL or HIGH. The nodemailer fix in this branch was re-reviewed and approved.

## Findings
- [MEDIUM] [fixed] apps/web/package.json — nodemailer 8.0.11 had pnpm-audit high and moderate advisories; bumped to 10.2.1, audit clean.
- [MEDIUM] [deferred 13.3a] apps/web/next.config.ts — no CSP, X-Frame-Options, HSTS, X-Content-Type-Options or Referrer-Policy headers.
- [LOW] [deferred 13.3b] packages/db/src/repositories/chunks.ts — insertTopicLinks and topicSources take a raw teacherId outside the scope.test.ts grid.
- [LOW] [wontfix] packages/db/src/repositories/teacher-questions.ts — hand-written INSERT ... SELECT is fully parameterised; the existing raw-SQL guard covers it.
- [LOW] [deferred 13.3b] apps/web/src/turn/routes.ts — the session id param reuses StartSessionSchema.shape.agentId; use a dedicated SessionIdSchema.
- [LOW] [deferred 13.3b] apps/web/src/auth/config.ts — the 30-day database session maxAge; revisit before a wider launch.
- [LOW] [wontfix] apps/worker/src/webLink/pinnedTransport.ts — documentation drift only: the DNS-rebinding gap is closed by ADR-0014 / 8.2d.
