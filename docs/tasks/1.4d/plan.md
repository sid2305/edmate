# 1.4d plan: sign-in follow-ups from the 1.4 review

Board: `board.py show 1.4d` · milestone M13 · deps: 1.4 (done) · risk: **risky**
(`apps/web/src/auth/**`). Plan against `main` **plus** `origin/m13/1.4b-magic-link-binding`
(PR #246), which merges first. 1.4b adds `apps/web/src/auth/confirm.ts`, the
`signin/email`/`callback/email` routes and the `/sign-in/confirm` page, and adds three new
exports to `src/auth/index.ts` (`confirmSignInView`, `confirmEmailSignIn`, `linkBindingCookie`).
None of that touches `rate-limit.ts`, `mail.ts`, `redis-ready.ts` or the `ioredis`/`nodemailer`
wiring this task changes, so the two tasks don't conflict, but 1.4d's branch must be cut from
main *after* #246 lands (or merge `origin/main` before Phase A's gate if it was cut earlier).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "Sign-in follow-ups from the 1.4 review: ioredis dev singleton and shutdown; split the
Edge-safe guard exports from the Node-only auth runtime (server-only); one shared Redis ready
promise; log the Auth.js error type, not minified class names; bump nodemailer once next-auth
allows; per-IP 'unknown' bucket; production email through Resend (human answer B-25, switchable
by config); deploy drops the Mailpit default and sets Caddy trusted_proxies"
Accept: "dev hot reload reuses one Redis client; guard helpers import without ioredis or
nodemailer; no MaxListeners warning in a Redis outage; deploy docs cover Mailpit and
trusted_proxies; auth tests pass."

Source of every item: `docs/tasks/1.4/review.md` MEDIUM/LOW findings deferred to 1.4d (index.ts
singleton, index.ts server-only split, redis-ready.ts listener, nodemailer CVEs,
rate-limit.ts unknown bucket, describe-error.ts, compose.yaml Mailpit default) plus board
decision B-25 (Resolved, `.claude/blockers.md`: Resend for production email, switch by config).

### How it is shown (paste into handoff.md)
| Part | Evidence |
|---|---|
| Dev hot reload reuses one Redis client | New test in `index.test.ts`: calling the module's internal `getRuntime()`-equivalent path twice with `NODE_ENV=development` (simulating two cold `getRuntime()` calls, since a real HMR reload can't be driven from vitest) constructs the fake `Redis` exactly once; `fakes.redis` has one entry both times. |
| Guard helpers import without ioredis or nodemailer | New `index.guard-only.test.ts` (no global `vi.mock('ioredis'/'nodemailer')`; instead each throws on import) imports only `{ withRole, publicRoute, providerRoute, requireRole, HOME_PATH, SIGN_IN_PATH, TEACHER_PATH }` from `./index` and calls nothing that reaches `getRuntime()`; the import itself must not throw. |
| No MaxListeners warning in a Redis outage | `redis-ready.test.ts`: a fake `ReadySource` with `status: 'connecting'`; 20 concurrent `whenReady` calls register exactly one `once('ready', …)` listener (spy count), not 20; all 20 promises resolve together when `ready` fires once. |
| Auth.js error type logged, not minified class name | `describe-error.test.ts` (new): an error with `.type === 'Verification'` and a minified `.name` logs `Verification`, not the name; an error with no `.type` still logs `.name`; a non-Error logs `non-error`. `config.test.ts:479` updated for the new format. |
| Deploy docs cover Mailpit and trusted_proxies | `docs/deploy-notes/sign-in-mail-and-proxy.md` (new) states: production must set `EMAIL_SERVER`/`EMAIL_FROM` explicitly (Resend's SMTP relay, `smtp.resend.com:465`, API key as the password) because compose's default is Mailpit and Mailpit's local UI shows every link; and that Caddy's `trusted_proxies` must be set to whatever load balancer or CDN sits in front of it, or the per-IP limiter's `clientIp` collapses every real client into the shared `unknown` bucket. `docker/env.example` and `docker/Caddyfile` get short comments pointing at it. |
| Auth tests pass | `corepack pnpm turbo run build typecheck lint test --filter=@edmate/web...` with Postgres (127.0.0.1:55432) and Redis (127.0.0.1:56379) up (already running; builders don't run `docker compose`). `next build` succeeds. Coverage for `src/auth/**` holds at 100/100/100. Secret scan clean. |

## Design

### 1. Dev Redis singleton (`index.ts`)
Follows the stack's existing pattern for dev-mode singletons (the same reason Prisma-style
examples use `globalThis`): when `process.env.NODE_ENV !== 'production'`, the ioredis client
built in `emailSignIn()` is cached on `globalThis.__edmateAuthRedis` and reused across repeated
calls instead of calling `new Redis(...)` again. In production, `getRuntime()` already caches
`runtime` once per process, so no `globalThis` caching is needed there, and the memoized value
is never reused *across* a real restart (the fresh process starts with no `globalThis` entry).
No disconnect/SIGTERM handling is added — the accept line only asks for reuse, and the review's
"or a quit on SIGTERM" alternative is not required to pass it.

### 2. Guard helpers import without ioredis/nodemailer (`index.ts`)
`emailSignIn()` already builds the `Redis` client, `smtpMailSender` and `createSignInLimiter`
only when `env.email` is set and only inside a function body — but `import { Redis } from
'ioredis'`, `import { smtpMailSender } from './mail'` (which statically imports `nodemailer`)
and the rate-limit imports are top-level `import` statements, so any consumer of `index.ts`
(every route file that just wants `withRole`/`Principal`, about 30 files today) pulls in
`ioredis` and `nodemailer` at module-load time regardless of whether email sign-in is even
configured. Fix: move those three imports inside `emailSignIn()` as `const { Redis } = await
import('ioredis')`, `const { smtpMailSender } = await import('./mail')`,
`const { createSignInLimiter, redisSignInCounters } = await import('./rate-limit')`, and make
`emailSignIn` (and its caller in `getRuntime()`) `async`. Add `import 'server-only'` (new tiny
dependency, zero sub-dependencies) at the top of `index.ts` only — not `guard.ts`/`policy.ts`/
`errors.ts`, which stay independently importable — so an accidental client-component import of
`index.ts`'s exports fails the build immediately, in addition to the dynamic-import fix. No
deeper file split (e.g. a separate "guard-only" module) is attempted: `getRuntime()` still needs
`@edmate/db` either way, nothing in the app runs on the Edge runtime today, and a structural
split would be scope creep against MVP-first (see Open questions, Q2).

### 3. One shared Redis-ready promise (`redis-ready.ts`)
`whenReady` currently calls `redis.once('ready', …)` on every invocation; N concurrent sign-in
requests during an outage register N listeners (`MaxListeners` warning past 10). Fix: cache the
in-flight promise per `redis` instance in a `WeakMap<ReadySource, Promise<void>>`; the first
caller registers the listener and clears the cache entry when it resolves or times out, and every
concurrent caller awaits the same promise. `readyCounters` is unchanged; `whenReady`'s signature
is unchanged.

### 4. Log the Auth.js error type (`describe-error.ts`)
Swap the preference: `return typeof type === 'string' ? type : error.name;` (drop the
`${name} (${type})` combination and the `type !== error.name` check). `config.test.ts:479`'s
`'[auth] error Error (AdapterError)'` expectation becomes `'[auth] error AdapterError'`.

### 5. Nodemailer bump — mostly out of scope
`@auth/core@0.41.3`'s `peerDependencies` still read `nodemailer: "^7.0.7 || ^8.0.5"` (checked in
`node_modules/.pnpm/@auth+core@0.41.3_nodemailer@8.0.11/node_modules/@auth/core/package.json`),
which excludes nodemailer 9.x and 10.x. This task does not touch `next-auth`/`@auth/core`, so the
major bump the review alluded to ("bump once next-auth allows") **is not possible yet and stays
out of scope.** The builder may bump the exact pin to a newer *8.x* patch if one exists with the
addressparser/DNS-cache fixes (already inside the allowed range, so no coupling to next-auth);
this is optional, not required for `DONE`, and must not become a version-range change (the repo
pins exact versions).

### 6. Per-IP `unknown` bucket — docs only, no code change
The review's LOW is about operational exposure (an app reachable without Caddy, or without
`trustHost`, collapses every client into one bucket), not a code defect — `clientIp`'s
fail-toward-limiting default is correct. This item is covered entirely by the new deploy doc
(§7).

### 7. Production email through Resend; deploy docs for Mailpit and trusted_proxies
B-25 is **Resolved**: Resend, switchable later by config. Because `mail.ts` already sends
through any `smtp:`/`smtps:` URL via nodemailer, Resend's SMTP relay needs **no code change** —
only `EMAIL_SERVER=smtps://resend:<API_KEY>@smtp.resend.com:465` and a verified-domain
`EMAIL_FROM` in production's env/secret manager. New doc `docs/deploy-notes/sign-in-mail-and-
proxy.md` (following the `docs/backup-provider.md` precedent for a small, standalone topic doc,
since the real deploy guide, board task 13.6, doesn't exist yet) states:
- production must set `EMAIL_SERVER`/`EMAIL_FROM` itself; compose's `${EMAIL_SERVER:-smtp://
  mailpit:1025}` default is for the sandbox only and must never reach production (Mailpit's UI
  shows every sign-in link in plain text);
- the Resend SMTP shape, and that switching provider later is a config change only;
- Caddy's `trusted_proxies` must list whatever reverse proxy, load balancer or CDN sits in front
  of it in production, or `clientIp` (task 1.4) reads no real client IP and the per-IP rate limit
  collapses to one shared bucket;
- a one-line pointer for board task 13.6 to fold this into the real deploy guide.
`docker/env.example`'s existing placeholder comment (the generic `smtp.provider.example`) gets a
Resend-specific example line plus a pointer to the new doc. `docker/Caddyfile`'s existing
`X-Forwarded-For` comment gets one added line pointing at the same doc for `trusted_proxies`.

## Phases
Two phases on one branch, each ends green with its own commit; the PR opens after Phase B.

### Phase A: runtime hardening, `apps/web/src/auth` only (about 55 calls)
Tests first:
- `index.test.ts`: the dev-singleton case (§1); the guard-only import case moves to a **new**
  file, `index.guard-only.test.ts` (§2), because it needs the opposite of this file's global
  `vi.mock('ioredis'/'nodemailer')`.
- `redis-ready.test.ts`: the shared-promise/listener-count case (§3); existing timeout/resolve
  cases stay green.
- `describe-error.test.ts` (new): the type-preference cases (§4).
- `config.test.ts`: update line ~479's expected log string (§4).
Then: edit `index.ts` (dynamic imports, `async emailSignIn`, dev singleton, `import 'server-
only'`), `redis-ready.ts` (WeakMap cache), `describe-error.ts` (swap preference);
`apps/web/package.json` adds `server-only` (exact pin, check the current stable version first)
and, only if a non-major nodemailer patch exists, bumps that one exact pin; `pnpm-lock.yaml`.
Gates: `turbo run build typecheck lint test --filter=@edmate/web...` with Postgres/Redis up (no
`docker compose` — they're already running at 127.0.0.1:55432/56379); `next build`; secret scan.
**State after A:** the three code-level accept items hold; nothing in `src/auth`'s public shape
(exports, types, routes) changed, so 1.4b's `confirm.ts`/page/routes are unaffected either way.

### Phase B: deploy docs and config, plus the handoff (about 25 calls)
Tests first: none new (docs and comments only); re-run the full `@edmate/web` suite to confirm
Phase A's change didn't regress anything docs-adjacent (e.g. `env.test.ts`, which reads
`docker/env.example`'s shape only indirectly if at all — check first).
Then: write `docs/deploy-notes/sign-in-mail-and-proxy.md`; edit `docker/env.example` (Resend
example line, pointer) and `docker/Caddyfile` (one comment line, pointer); write
`docs/tasks/1.4d/handoff.md` with the evidence table and `## Decisions` entries.
Gates: `turbo run build typecheck lint test --filter=@edmate/web...`; `docker compose config`
is **not** run by the builder (no compose access) — instead, hand-check the edited YAML/Caddyfile
syntax by eye and note that in the handoff; secret scan clean.
**State after B:** DONE.

## Files
**Create:**
- `apps/web/src/auth/index.guard-only.test.ts`
- `apps/web/src/auth/describe-error.test.ts`
- `docs/deploy-notes/sign-in-mail-and-proxy.md`
- `docs/tasks/1.4d/handoff.md` (builder)

**Modify:**
- `apps/web/src/auth/index.ts`, `index.test.ts`
- `apps/web/src/auth/redis-ready.ts`, `redis-ready.test.ts`
- `apps/web/src/auth/describe-error.ts`
- `apps/web/src/auth/config.test.ts` (one log-string assertion)
- `apps/web/package.json`, `pnpm-lock.yaml`
- `docker/env.example`, `docker/Caddyfile` (comments only)

**Out of bounds** (per task scope and to avoid clashing with concurrent builders):
- `packages/harness/**`, `apps/web/app/teacher/onboarding/**`, `apps/web/src/studio/**`,
  `apps/web/src/turn/**` (other builders)
- `apps/web/src/auth/{config,email,mail,rate-limit,adapter,env,confirm,guard,policy,age}.ts` and
  their tests (owned by 1.4/1.4b/1.4c; this task's guard-only split doesn't need to touch them)
- `apps/web/app/api/auth/**`, `apps/web/app/sign-in/**` (1.4b's routes/pages)
- `packages/db/**`, `packages/contracts/**`, `packages/queue/**`, `docs/adr/**`
- `docker/compose.yaml` (no env/service shape change needed — only the two comment edits above)
- `.github/**`, `.claude/**`
- phone OTP, Google↔email linking (1.4c), the real deploy guide (13.6)

## Tests first
Order is per phase above. Addresses stay `*@example.test`; no real socket opens; fake secrets
built at runtime (the 1.3/1.4 pattern). No real Redis/SMTP network calls in any test — the
Postgres/Redis integration suites already in the repo (`rate-limit.int.test.ts` etc.) are
untouched by this task and continue to skip locally / fail in CI as before.

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `apps/web/src/auth/**` (`index.ts`, `redis-ready.ts`, `describe-error.ts` and their tests) →
  **security-reviewer**.
- No match: `apps/web/package.json`, `pnpm-lock.yaml`, `docker/env.example`, `docker/Caddyfile`,
  `docs/deploy-notes/**`, `docs/tasks/1.4d/**` — none are payments/webhooks/staff/identity/
  gateway/repositories/contracts/harness/safety paths.
- Not touched: `apps/web/app/api/auth/**`, `packages/db/**`, `packages/contracts/**`,
  `docs/adr/**`, `.claude/**`, `.github/**`, every safety path.
- `review.md` should read `Reviewers: security-reviewer, typescript-reviewer`. security-reviewer
  is required (the one matched group); typescript-reviewer is recommended for the `async
  emailSignIn`/dynamic-import typing and the `WeakMap<ReadySource, Promise<void>>` change.
- The handoff logs a `risk: high` decision (the board already marks 1.4d risky, and it touches
  the sign-in path).

## Open questions (none blocks the build; each has a recommended default)
- **Q1. `server-only` package version to pin.** **Default:** the exact current stable version
  (the builder checks `pnpm info server-only version` or the registry page; it is a zero-
  dependency, rarely-updated package, so any recent version is fine). If adding it causes any
  friction (e.g. it isn't resolvable offline), **fallback default:** skip the package and rely
  only on the dynamic-import fix (§2) — the accept line only tests "guard helpers import without
  ioredis or nodemailer", not the presence of `server-only` specifically.
- **Q2. Deeper structural split of guard exports into their own module.** **Default: no.** The
  dynamic-import fix already satisfies the accept line; a bigger file split is not needed while
  nothing runs on the Edge runtime, and would be scope creep (MVP-first).
- **Q3. Nodemailer: bump the exact 8.x patch pin if one exists.** **Default: yes, if a newer 8.x
  patch (not a major) exists and plausibly includes the CVE fixes the review named; otherwise
  leave `8.0.11` as is.** The major bump stays out of scope either way (§5).
- **Q4. Where the new deploy doc lives.** **Default:** `docs/deploy-notes/sign-in-mail-and-
  proxy.md`, matching the existing `docs/backup-provider.md` precedent for a small standalone
  topic doc, since board task 13.6 (the real deploy guide) doesn't exist yet.

## Decisions (draft, for the handoff)

### 1.4d Sign-in runtime hardening: dev Redis singleton, dynamic ioredis/nodemailer imports, shared ready-wait, Auth.js error type in logs · decided by planner · risk: high
Decided: `index.ts` reuses one ioredis client across dev reloads via a `globalThis` cache; the
`ioredis`/`nodemailer`/`rate-limit` imports `emailSignIn()` needs move inside the function as
dynamic imports, plus `import 'server-only'` at the top of `index.ts`, so importing the route
guard helpers never requires `ioredis` or `nodemailer`; `redis-ready.ts` shares one in-flight
"ready" promise per Redis instance instead of registering a new listener per request;
`describe-error.ts` now logs Auth.js's own `type` field when present, instead of the (possibly
minified) `Error.name`. Nodemailer's major-version bump stays out of scope: `@auth/core@0.41.3`
still caps it below 9.0.0.
Why: these are the 1.4 review's deferred findings; this is the sign-in path
(`apps/web/src/auth/**`), so risk: high.

### 1.4d Production sign-in mail is Resend's SMTP relay, by config only; a new deploy-notes doc covers Mailpit and trusted_proxies · decided by planner · risk: low
Decided: no code change for Resend (B-25, Resolved) — `EMAIL_SERVER`/`EMAIL_FROM` already route
through any SMTP endpoint. A new doc, `docs/deploy-notes/sign-in-mail-and-proxy.md`, states that
production must override the Mailpit default and must set Caddy's `trusted_proxies`; both
`docker/env.example` and `docker/Caddyfile` get a one-line pointer to it. The real deploy guide
(13.6) folds this in later.
Why: this is documentation and config comments, not production-path code; low risk.

## Budget
Budget: 80 tool calls (2 phases, apps/web + docs/docker only)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (tests and secret scan only)

## Exit conditions
`Status: DONE` when both phases are green, `corepack pnpm turbo run build typecheck lint test
--filter=@edmate/web...` passes with Postgres/Redis already up, `next build` succeeds, the
secret scan is clean, the evidence table is filled in with real output, and
`docs/tasks/1.4d/handoff.md` carries the `## Decisions` entries above (risk: high for the first).
`Status: PARTIAL` past ~55 calls into Phase A or ~25 into Phase B with no green tests yet, if a
file outside this plan's list needs changing, or if 1.4b hasn't actually merged yet when this
branch is cut (merge `origin/main` first and re-check `index.ts`'s shape before editing it).

## READY
Nothing blocks the build. The nodemailer peer-range fact (§5) was confirmed directly from the
installed `@auth/core@0.41.3` package.json. No contracts change and no ADR is needed.

## Lead answers (23 Oct 2026)
- Q1: Don't add the `server-only` package. A new dependency edges into a stack change; the dynamic-import fix meets the accept line on its own.
- Q2: No deeper split (default).
- Q3: Yes. Bump the exact 8.x patch pin only if a newer 8.x patch exists; no major bump.
- Q4: Put the doc in `docs/setup/sign-in-mail-and-proxy.md`, the existing setup folder, not a new `docs/deploy-notes/` folder.
- One builder runs both phases (budget 80; PARTIAL past 95). The handoff's decision headings use the merge-gate format: `### 23 Oct 2026 · <title> · decided by builder · risk: high|low`, with `- Decided:`, `- Why:` and `- risk:` lines.
- Reviewers: security-reviewer and typescript-reviewer.
