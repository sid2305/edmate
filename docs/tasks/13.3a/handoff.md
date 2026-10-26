# 13.3a: security headers

Status: DONE

## Summary

Added security headers to `apps/web`, split per the plan's decision:

- `apps/web/next.config.ts` — a `headers()` function returning the three static headers
  (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`) on every path.
- `apps/web/proxy.ts` (new) — per-request `Content-Security-Policy` (nonce + `strict-dynamic`,
  `'unsafe-eval'` added to `script-src` only outside production per the lead's amendment) and
  `Strict-Transport-Security` (`max-age=63072000; includeSubDomains`, production-only, no
  `preload` per the lead's amendment). Exports `buildCsp` and `storageOrigin` for the unit tests.
  Matcher excludes `_next/static`, `_next/image`, `favicon.ico`.
- `apps/web/next.config.test.ts` (new) — calls `nextConfig.headers()` directly, asserts the three
  static headers and that CSP/HSTS are never set there.
- `apps/web/proxy.test.ts` (new) — calls the exported `proxy`, `buildCsp`, `storageOrigin`
  directly with a constructed `NextRequest` (the `rate-limit.test.ts` pattern): CSP directives,
  nonce format/uniqueness across calls, `unsafe-eval` only outside production,
  `connect-src` storage-origin allowlisting (`S3_PUBLIC_ENDPOINT` falling back to `S3_ENDPOINT`,
  self-only fallback on missing/malformed), HSTS present only when `NODE_ENV=production` and
  never carrying `preload`.
- `apps/web/e2e/headers.spec.ts` (new) — asserts the four header families on `/` and
  `/api/health` against the real `next dev` e2e server; ran alongside the full existing suite.

No other files touched.

## Correction to the plan

The planner's "no Caddy in repo" claim (plan.md's HSTS decision) is wrong, per the lead's
amendment 2: `docker/Caddyfile` exists and sets `auto_https off`, and `docker/compose.yaml` sets
`NODE_ENV: production` for the local stack. `proxy.ts`'s comment on the HSTS block now says so and
explains why the flat production check is still correct (browsers ignore HSTS sent over plain
HTTP).

## How the five headers were captured

Dev (`next dev`, default `NODE_ENV`), `GET /`:

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
content-security-policy: default-src 'self'; script-src 'self' 'nonce-<per-request>' 'strict-dynamic' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
(no Strict-Transport-Security)
```

Dev, `GET /api/health`: identical header set (different nonce), no HSTS.

A `next build --webpack` + `next start` run under `NODE_ENV=production` (`S3_ENDPOINT` set so
`connect-src` carries it):

`GET /api/health` (200):

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
content-security-policy: default-src 'self'; script-src 'self' 'nonce-<per-request>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:9000; img-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
strict-transport-security: max-age=63072000; includeSubDomains
```

`GET /teachers` (500 — unrelated to this task, the page's own server code errors on an
unconfigured sign-in/db setup in this ad hoc run; the same five headers are still present on the
error response, which is the point of the check): same header set, confirmed present.

Note: testing the production CSP/HSTS branch against `next dev` (even with `NODE_ENV=production`
in the shell) doesn't work — Next's dev bundler statically inlines the literal
`process.env.NODE_ENV === 'production'` expression in `proxy.ts` to `false` regardless of the
shell env (that's why the dev server always behaves as development); only `buildCsp`'s parameterised
`env.NODE_ENV` check (not a literal `process.env.NODE_ENV` expression) picked up the override. A
real `next build` + `next start` was needed to see the production branch actually run; this is
also why `proxy.test.ts` calls the functions directly instead of relying on a server run.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` (deps built first with
  `corepack pnpm turbo run build --filter=@edmate/web...`): **10/10 tasks green** (typecheck,
  lint, test for `@edmate/web` and its built workspace deps). The `--filter=@edmate/web...`
  variant (which also re-runs `@edmate/harness`'s own test suite) hit one pre-existing,
  unrelated failure: `packages/harness/src/pedagogy/modelRequest.test.ts`'s
  `expectLinear` wall-clock ratio assertion (ratio 85–122 vs. the `<64` bound) — the exact class
  of flake `docs/lessons.md` already documents ("Wall-clock bounds fail on shared CI runners"), in
  a file this task never touches. Confirmed unrelated to this change (apps/web only); not fixed
  here (out of scope, no file in this plan's list).
- `corepack pnpm exec prettier --check` on the five changed/new files: all pass.
- `python3 .githooks/secret-scan.py --all`: clean, no output.
- `corepack pnpm --filter @edmate/web e2e` (full suite, real Postgres already running on
  `127.0.0.1:55432`, `TEST_DATABASE_URL` set): 22 specs, **21 passed including both new
  `headers.spec.ts` cases**. `full-flow.spec.ts`'s one scenario (`discover -> subscribe...`) timed
  out on the discovery search step with `[discovery] redis Error` in the server log. Reproduced
  the exact same failure with `proxy.ts` and the `next.config.ts` headers change temporarily
  reverted (restored a copy of `next.config.ts` from `HEAD`, moved `proxy.ts` aside), confirming
  it is pre-existing and unrelated to this task (likely this worktree's Redis not being reachable
  for the discovery route's own caching) — not a change this task should fix.

## Decisions

### 25 Oct 2026 · 13.3a Referrer-Policy value · decided by builder · risk: low
- Decided: `Referrer-Policy: strict-origin-when-cross-origin` (browsers' current safe default),
  since the plan named the header but not its exact value.
- Why: keeps the full origin on same-origin navigation (useful for the app's own analytics-free
  logging) while sending no path/query cross-origin; a stricter `no-referrer` was considered but
  not needed since nothing cross-origin is linked to from this app today (checked — no external
  `<a href>`/`<Link>` targets).

### 25 Oct 2026 · 13.3a default-src added to the CSP · decided by builder · risk: low
- Decided: added `default-src 'self'` to the CSP, in addition to the plan's named directives
  (script-src, style-src, connect-src, img-src, font-src, frame-ancestors, base-uri, form-action,
  object-src).
- Why: `default-src` is the CSP fallback for any resource type not explicitly covered (media-src,
  worker-src, manifest-src, etc.); Next's own documented nonce-CSP example (checked in
  `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`) always includes it.
  Omitting it would leave those untyped resource kinds unrestricted by default, which the plan's
  intent (a strict allowlist CSP) clearly does not want.

## Budget

Tool calls used: 56

## Fix round

CRITICAL (raised by security-reviewer, typescript-reviewer, code-reviewer): `proxy.ts` set the
CSP only on `response.headers`. Next 16.4.2 reads the nonce it stamps its own inline
bootstrap/hydration `<script>` tags with from the *request's* `content-security-policy` header
(next/dist/server/route-modules/app-page/parse-request-headers.js →
get-script-nonce-from-header.js; matches Next's own doc at
`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`), not from the
`x-nonce` convention this code had assumed. With no request-side CSP, Next's own inline scripts
got no nonce and `'strict-dynamic'` silently blocked them — no page hydrates.

Fix: `apps/web/proxy.ts` now does `requestHeaders.set('Content-Security-Policy', csp)` before
`NextResponse.next({ request: { headers: requestHeaders } })`, in addition to the existing
`response.headers.set(...)`. Dropped `x-nonce`: grepped the repo, no app code read it; keeping it
alongside the correct header would have been dead code.

Tests added:
- `proxy.test.ts`: a new case confirms the request-side CSP matches the response-side CSP. Direct
  inspection of `NextResponse.next({ request })`'s internal request isn't possible from a plain
  unit test, so it asserts via the documented mechanism Next itself uses to carry middleware
  request-header overrides to the server: `x-middleware-override-headers` and
  `x-middleware-request-content-security-policy` response headers (confirmed in
  `node_modules/next/dist/server/web/spec-extension/response.js`'s `handleMiddlewareField`).
- `e2e/headers.spec.ts`: a new case loads `/` in a real Chromium page, listens for
  `securitypolicyviolation` DOM events and console messages containing "Content Security
  Policy", and asserts none fire; also asserts at least one `<script>` tag's IDL `.nonce`
  property (not `getAttribute('nonce')`, which browsers blank for security) matches the nonce in
  the response's CSP header.
- Production proof (`next build --webpack` + `NODE_ENV=production next start`, no docker), `GET
  /`:
  ```
  content-security-policy: default-src 'self'; script-src 'self' 'nonce-MGJkYTdmMjctMTNhNy00YTgzLWIzNTgtMTFhMTllYTE1MDhl' 'strict-dynamic'; ...
  ```
  and the page body contains:
  ```
  <script nonce="MGJkYTdmMjctMTNhNy00YTgzLWIzNTgtMTFhMTllYTE1MDhl">
  ```
  — Next's own inline script nonce matches the response CSP's nonce exactly, confirming
  hydration is no longer blocked.

### Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web`: 10/10 tasks green.
- `corepack pnpm --filter @edmate/web e2e`: 22 specs, 22 ran, 21 passed; the pre-existing
  `full-flow.spec.ts` discovery-redis timeout recurred unchanged (unrelated to this fix, same
  failure documented in the original handoff).
- `corepack pnpm exec prettier --check` on the three changed files: clean (one formatting fix
  applied to `proxy.test.ts`).
- `python3 .githooks/secret-scan.py --all`: clean, no output.

Tool calls used: 26
