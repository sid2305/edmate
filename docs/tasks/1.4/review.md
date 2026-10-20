# 1.4 review — APPROVE

Reviewers: security-reviewer (sonnet: phases A and B; opus: phase C and the whole sign-in flow), code-reviewer (sonnet), typescript-reviewer (sonnet), database-reviewer (sonnet)

Head reviewed: 9d4e3e1 (security, code, typescript); 5f687b2 after the sync with main (database: migration 0013 chains to 0012, additive only).

All four reviewers approve, with no CRITICAL or HIGH findings. Tokens are SHA-256 hashed and single use (atomic `DELETE … RETURNING`), and only the newest link per address works. The rate limit runs before any token or mail exists. Known and unknown addresses get identical responses. Redirects are pinned to AUTH_URL's origin. A Redis cold start fails closed. The tests drive the real NextAuth handlers.

## Findings
- [MEDIUM] [deferred 1.4b] apps/web/src/auth/config.ts:117 — the magic link is opened by a plain GET, so login CSRF is possible and mail scanners can use links up. 1.4b binds the link to the requesting browser and adds a confirm page; it is required before the pilot gate.
- [MEDIUM] [deferred 1.4d] apps/web/src/auth/index.ts:1 — the module-level ioredis client is never disconnected, so dev hot reload opens a new connection each time. Fix with a globalThis dev singleton or a quit on SIGTERM.
- [MEDIUM] [deferred 1.4d] apps/web/src/auth/index.ts:1 — ioredis and nodemailer are imported next to the Edge-safe guard re-exports. Harmless today because no route runs on Edge; split the entry point or add `server-only`.
- [LOW] [deferred 1.4d] apps/web/package.json:16 — nodemailer 8.0.11 has addressparser and DNS-cache CVEs. They are not exploitable here: the zod email check excludes the syntax and `to` is a bare address. Bump once next-auth's peer range allows it.
- [LOW] [deferred 1.4d] apps/web/src/auth/rate-limit.ts:31 — a request with no client IP falls into one shared 'unknown' bucket. This only happens if the app is exposed without Caddy.
- [LOW] [deferred 1.4d] apps/web/src/auth/rate-limit.ts:99 — the per-IP limit relies on Caddy seeing real client IPs. The deploy task sets Caddy's `trusted_proxies` for any load balancer.
- [LOW] [deferred 1.4d] apps/web/src/auth/redis-ready.ts:37 — during a Redis outage each waiting request adds a 'ready' listener, which can trigger a MaxListeners warning (nothing leaks). Share one ready promise.
- [LOW] [deferred 1.4d] apps/web/src/auth/describe-error.ts:8 — production logs show minified class names. This is noise, not a leak; log the Auth.js error `type` instead.
- [LOW] [deferred 1.4d] docker/compose.yaml:102 — EMAIL_SERVER defaults to Mailpit, whose local UI shows every sign-in link. The deploy task must drop it in production.
- [LOW] [wontfix] packages/db/src/identity/store.ts — after a switch to a new address, the old session row lasts until it expires, but the browser no longer holds its token. Accepted under plan Q3; sign-out-everywhere is later work.
