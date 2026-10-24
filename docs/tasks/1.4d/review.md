# 1.4d review — APPROVE

Reviewers: security-reviewer, typescript-reviewer

Both reviewers read the full diff (sign-in runtime hardening in apps/web/src/auth/**, the new setup doc, the Caddyfile and env.example pointers). Security found one HIGH: the doc's trusted_proxies recipe did not work. One fix round corrected the doc and the Caddyfile comment, reset the cached email dependencies when building them fails, and added the error listener only once. The security re-check approved all four. The one open LOW goes to board task 1.4e.

## Findings
- [HIGH] [fixed] docs/setup/sign-in-mail-and-proxy.md:29 — the trusted_proxies recipe appended the client IP instead of replacing it; now the global `servers { trusted_proxies static <ranges>; trusted_proxies_strict }` block plus `header_up X-Forwarded-For {client_ip}`.
- [MEDIUM] [fixed] docker/Caddyfile:12 — the comment repeated the doc's wrong claim; now matches the corrected doc.
- [MEDIUM] [fixed] apps/web/src/auth/index.ts:94 — `emailDeps ??=` cached a rejected promise for good; it now resets on rejection, with a retry test.
- [LOW] [fixed] apps/web/src/auth/index.ts:103 — dev hot reloads added another Redis error listener each time; the listener is now added only for a new client, with a test.
- [LOW] [deferred 1.4e] apps/web/src/auth/redis-ready.ts:1 — whenReady's shared in-flight promise ignores a second caller's different timeoutMs; harmless today (one shared default).
