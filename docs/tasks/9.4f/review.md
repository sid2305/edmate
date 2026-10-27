# 9.4f review — APPROVE

Reviewers: security-reviewer, typescript-reviewer, code-reviewer

## Findings
- [HIGH] [fixed] apps/web/src/auth/errors.ts — the `{ 'cache-control'?: never }` guard was case-sensitive, so `{ 'Cache-Control': 'public' }` produced `cache-control: public, no-store`; now `new Headers(headers).set('cache-control', 'no-store')`, with a mixed-case test (security-reviewer, typescript-reviewer; re-checked by both)
- [MEDIUM] [fixed] apps/web/src/auth/errors.ts — the doc comment overstated the compile-time guard (code-reviewer)
- [LOW] [fixed] packages/db/src/repositories/README.md — lockRole returns `Role | null`; the calling repository method throws RepositoryError('scope') (typescript-reviewer)
- [LOW] [deferred 1.7e] docs/tasks/9.4f/handoff.md — 1.7e must also check the dev-mode bullmq/@edmate/queue break at /api/health before the Playwright `--webpack` flag is dropped (security-reviewer)
