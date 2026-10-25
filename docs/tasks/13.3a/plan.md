# 13.3a: security headers

## Acceptance (verbatim, from board)
"apps/web/next.config.ts headers() sets a CSP that works with Next.js 16.4.2 (nonce or hash for
inline scripts), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, and HSTS
once behind TLS; a test asserts the headers on a page and an API route; the e2e suite still
passes."
Source finding: `git show origin/m13/13.3-security-review:docs/tasks/13.3/findings-D.md` line 12.

## How it will be shown
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` green, including the new
unit tests and `corepack pnpm --filter @edmate/web e2e` (full suite, unchanged specs still pass
plus the new headers assertions). Handoff pastes the five response headers captured for `/` and
`/api/health` in both dev and a `NODE_ENV=production` run.

## Decision: proxy.ts (nonce CSP), not static-only next.config headers()
Next's own App Router hydration/RSC bootstrap emits inline `<script>` content that differs per
request (it carries the page's data), so a build-time hash can never match it — the board's "hash"
option is not viable here. A nonce is the only workable option, and Next needs it minted per
request, which only `proxy.ts` (Next 16's renamed `middleware.ts`) can do; `next.config.ts`
`headers()` stays static. Checked `apps/web/app/**`: every page and API route already declares
`export const dynamic = 'force-dynamic'` (69 files), so a nonce (which also forces dynamic
rendering) costs nothing extra — there is no static page to lose. No `proxy.ts`/`middleware.ts`
exists today (9.1 kept the pilot non-routing on purpose); this adds one, scoped to headers only, no
routing/redirect logic, so it doesn't reopen that decision.
Split: `proxy.ts` sets `Content-Security-Policy` (needs the per-request nonce) and HSTS (needs
`NODE_ENV`, trivial but kept alongside the other security headers for one place to read); the four
header-only values that need no per-request data (X-Frame-Options, X-Content-Type-Options,
Referrer-Policy, and the static part of the CSP string) are written once in `next.config.ts`
`headers()` so a reviewer sees the full static policy in one array literal. `proxy.ts` only adds
`Content-Security-Policy` (overwriting, since it needs the nonce) and HSTS; it does not duplicate
the other three.

## Decision: CSP content
- `default-src 'self'`
- `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'` — covers Next's own inline hydration
  script via the documented nonce-propagation convention (middleware sets `x-nonce` request header
  + the CSP response header; Next reads the request header and stamps its own inline scripts with
  it). No app code adds a `<script>` tag today (checked `app/layout.tsx`, grepped the repo for
  `<script` and `dangerouslySetInnerHTML` — the only hits are `.next/` build output and the
  existing `no-raw-html.test.ts` scan, which already forbids raw HTML in chat/learn/teacher/studio
  output), so `strict-dynamic` has nothing uncontrolled to grandfather in.
- `style-src 'self' 'unsafe-inline'` — three files use React's `style={{...}}` prop
  (`src/chat/renderReply.tsx`, `app/staff/reports/report-row.tsx`, `app/welcome/age/page.tsx`),
  which the browser enforces as `style-src`/`style-src-attr`, not `script-src`; nonces don't attach
  to style attributes in the browsers this pilot targets. Refactoring three call sites to CSS
  classes is out of scope for a headers task; CSS-attribute injection is a much smaller blast
  radius than script injection, so `'unsafe-inline'` stays on `style-src` only, never `script-src`.
- `connect-src 'self' <storage origin>` — `apps/web/src/storage/presign.ts` signs a PUT URL the
  *browser* calls directly (`RecordingUpload.tsx`, `UploadsView.tsx`), bypassing the Next server;
  the storage origin (`S3_PUBLIC_ENDPOINT` falling back to `S3_ENDPOINT`, read the same way
  `storageConfigFromEnv` does) must be in `connect-src` or uploads break under this CSP. `proxy.ts`
  reads this origin from `process.env` once per request (cheap: it's a already-parsed string, no
  new I/O) and appends it; a missing/invalid value falls back to `'self'` only (uploads would then
  fail closed with a CSP violation rather than silently widen the policy).
- `img-src 'self'`, `font-src 'self'`, `frame-ancestors 'none'` (belt-and-suspenders with
  X-Frame-Options), `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`. No external image,
  font or iframe origin exists today (grepped for `next/image`, `<img`, `fonts.googleapis`,
  `fonts.gstatic`, `remotePatterns` — none found).
- No `report-uri`/`report-to` for this task (no collector exists); left for a later task if needed.

## Decision: HSTS
Set `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` only when
`process.env.NODE_ENV === 'production'`, unconditionally within production (not a per-request
`x-forwarded-proto` check). There is no in-repo reverse proxy/TLS terminator (no Caddy, no
`deploy/`; `apps/web/Dockerfile` runs the Next standalone server on plain HTTP behind whatever
cloud load balancer terminates TLS — per the 18 Oct 2026 "Hosting region" decision, one US cloud
region) and `proxy.ts` has no reason to run differently for a hypothetical plain-HTTP production
request — there isn't one. Checking `x-forwarded-proto` would add a decision this app can't verify
(it must trust whatever the LB sets) for no real case it needs to cover; a flat production check is
simpler and correct for how this app is actually deployed. Dev/test stay without HSTS so
`localhost` dev and the Playwright `next dev` e2e server keep working over plain HTTP.

## Files to create/modify
- `apps/web/next.config.ts` — add `headers()` returning the four static headers (X-Frame-Options
  DENY, X-Content-Type-Options nosniff, Referrer-Policy, and a baseline CSP omitted of the nonce —
  actually: static headers only; CSP is proxy-owned per above, so next.config adds the three
  non-CSP headers for every path).
- `apps/web/proxy.ts` (new) — per-request nonce, builds and sets `Content-Security-Policy`, and
  sets HSTS in production; matcher excludes `_next/static`, `_next/image`, `favicon.ico`.
- `apps/web/next.config.test.ts` (new) — unit test calling `nextConfig.headers()` directly (no dev
  server) asserting the three static headers' names and values on a representative source.
- `apps/web/proxy.test.ts` (new) — unit test importing the exported handler and calling it with a
  constructed `NextRequest` (matches the pattern `src/auth/rate-limit.test.ts` uses for calling
  exported logic directly instead of spinning a server); asserts the CSP string's directives, the
  nonce format (`nonce-[A-Za-z0-9+/=]+`, non-empty, different across two calls), `connect-src`
  includes the configured storage origin, and HSTS is present only when `NODE_ENV=production` is
  injected and absent otherwise.
- `apps/web/e2e/headers.spec.ts` (new) — one Playwright spec against the existing `next dev` e2e
  server (`playwright.config.ts`, already `NODE_ENV` unset → development): `request.get('/')` and
  `request.get('/api/health')` each assert `x-frame-options`, `x-content-type-options`,
  `referrer-policy` and a `content-security-policy` header are present (dev CSP, no HSTS assertion
  here since the e2e server never runs with `NODE_ENV=production`).
- No change to any other existing page/route file; no change to `app/layout.tsx` (no `<Script
  nonce>` needed since no app code adds its own `<script>` tag).

## Files out of bounds
Everything else under `apps/web/app/**`, `apps/web/src/**` besides the three new test files and
`proxy.ts`; `apps/web/Dockerfile`; no changes to `packages/**`; no changes to CI workflows.

## Tests first
1. `next.config.test.ts`: red (no `headers()` exported) → green after adding the static headers.
2. `proxy.test.ts`: red (no `apps/web/proxy.ts`) → green after the nonce/CSP/HSTS logic lands.
3. `e2e/headers.spec.ts`: red against current `next dev` (no headers yet) → green once both land;
   run the full existing e2e suite (`chat.spec.ts`, `full-flow.spec.ts`, `skills.spec.ts`,
   `a11y.spec.ts`, `teacher-packages-walkthrough.spec.ts`) after, unchanged, to confirm the CSP
   doesn't break any existing page (these specs intercept the turn stream per `fixtures.ts`, so no
   real model call is at risk; the a11y spec uses `@axe-core/playwright`, unaffected by headers).

## Risky paths touched
Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- `apps/web/next.config.ts`, `apps/web/proxy.ts`, `apps/web/next.config.test.ts`,
  `apps/web/proxy.test.ts`, `apps/web/e2e/headers.spec.ts` — none match any glob in
  `risk-paths.txt` (not under `packages/harness/**`, `packages/payments/**`,
  `apps/web/app/api/webhooks|auth|staff/**`, `apps/web/src/auth/**`, `packages/db/**`,
  `packages/contracts/**`, `docs/adr/**`, `.claude/**`, `.github/**`, `.githooks/**`, or any
  content/locale/prompt-pack path).
- This task is **not risky by path**. It is still security-sensitive by nature (it changes browser
  security headers), so the plan asks for `code-reviewer` (always required), `typescript-reviewer`
  (new typed module + two new test files) and `security-reviewer` (CSP directive choices, the
  `'unsafe-inline'` style-src carve-out, the HSTS production-only call, and the storage-origin
  allowlist logic) even though `risk-paths.txt` doesn't force it. No `risk: high` decision entry is
  required by the non-negotiables (no risky path touched), but the lead should still log a plain
  decision entry recording the CSP/HSTS choices above, per rule 8 (the spec didn't make these
  calls, the finding only named the acceptance bar).

## Open questions
None blocking. One note for the lead: HSTS's `preload` directive is a one-way submission to
browsers' preload lists once sent from the real production domain — fine for a task this small to
set in the header now, but worth knowing before the first real production deploy under the final
domain.

## Budget
Budget: 60 tool calls (1 phase, apps/web only)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (tests and secret scan only)

## Exit conditions
Status: DONE when `next.config.test.ts`, `proxy.test.ts` and `e2e/headers.spec.ts` are green, the
full existing `apps/web` unit and e2e suites still pass, and lint/typecheck are clean. Status:
PARTIAL past ~60 tool calls, or if making the existing e2e suite pass under the new CSP needs a
change to a file outside this plan's list (e.g. a page needs a `nonce` prop on a `<Script>` tag
that doesn't exist yet) — stop and hand back rather than widening scope.

## Lead amendments (25 Oct 2026)
1. **No `preload`.** HSTS is `max-age=63072000; includeSubDomains` — drop `preload`. Preload is a
   one-way browser-list submission; the production domain isn't chosen yet. Log this as a builder
   decision citing the lead.
2. **The local docker stack runs `NODE_ENV=production` over plain HTTP** (`docker/Caddyfile` has
   `auto_https off`; `docker/compose.yaml` sets `NODE_ENV: production`). Browsers ignore HSTS sent
   over HTTP, so the flat production check is still fine, but say so in a comment in `proxy.ts`,
   and the planner's "no Caddy in repo" claim is wrong: correct it in the handoff.
3. **Dev needs `'unsafe-eval'`** in `script-src` (React dev builds use eval for stack frames and
   Fast Refresh). Add it only when `NODE_ENV !== 'production'`, with a unit test both ways.
4. The e2e header check must also pass against the stack config (`playwright.stack.config.ts`) if
   that suite is run in CI; if it isn't run in CI, a unit test of the production CSP is enough.
