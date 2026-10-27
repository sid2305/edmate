# 9.4e review — APPROVE

Reviewers: code-reviewer, security-reviewer, typescript-reviewer

## Findings
- [LOW] [deferred 9.4f] apps/web/src/auth/errors.ts — apiError's headers param is an open Record<string,string>; type it to exclude cache-control keys, and callers must never pass request-derived values (typescript-reviewer, security-reviewer)
- [LOW] [deferred 9.4f] apps/web/app/layout.test.tsx — calling RootLayout as a function and reading .props loses type safety on the returned element (typescript-reviewer)
- [LOW] [deferred 9.4f] packages/db/src/repositories/README.md — the new bare-id-exception sentence is garbled (missing words) (code-reviewer)
