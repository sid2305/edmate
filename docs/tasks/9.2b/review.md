# 9.2b review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), security-reviewer (sonnet), lead

## Findings

- [HIGH] [fixed] apps/web/src/discovery/rateLimit.ts — the rate-limit bucket used the first x-forwarded-for entry, which the client controls, so rotating it bypassed the limit. It now uses the rightmost (Caddy-appended) entry, with tests that a rotated fake first entry stays in one bucket (security-reviewer re-verified commit 452fcde). The lead's brief caused it.
- [MEDIUM] [deferred 9.2e] apps/web/src/discovery/rateLimit.ts — INCR then PEXPIRE is not atomic, so a key can be left without a TTL; use a Lua command like packages/queue/src/turnLimits.ts.
- [MEDIUM] [deferred 9.2e] apps/web/src/discovery/searchParams.ts — LANGUAGE_RE and the other patterns are copied from the repository and can drift; a scope error from discovery.search crashes the page instead of returning empty or 400 per the 9.2a decision.
- [LOW] [deferred 9.2e] apps/web/src/discovery/rateLimit.ts — no connectTimeout/commandTimeout, so allow() can hang about 10 s before failing open.
- [LOW] [deferred 9.2e] apps/web/src/discovery/nav.ts — a staff principal gets a "Home" label that links to /sign-in.
