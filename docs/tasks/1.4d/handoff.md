# 1.4d handoff: sign-in follow-ups from the 1.4 review

**Status:** DONE

## What changed

Phase A (`apps/web/src/auth/**`):
- `index.ts`: the `ioredis`, `./mail` and `./rate-limit` imports that `emailSignIn()` needs moved
  from top-level `import`s to dynamic `import()`s inside `emailSignIn()`, which is now async and
  memoizes its result (`emailDeps`). The per-request Auth.js config factory inside `getRuntime()`
  is now `async` and awaits `emailSignIn(env)`; `getRuntime()` itself stays synchronous (the guard
  deps it returns, used synchronously by `createGuard`'s `() => getRuntime().guard`, never needed
  email/Redis/mail to be ready). A dev-mode Redis singleton (`globalThis.__edmateAuthRedis`,
  reused when `NODE_ENV !== 'production'`) survives a module reload (dev HMR); production is
  unaffected (its `runtime` is already cached once per process, and a fresh process starts with
  no `globalThis` entry).
- `redis-ready.ts`: `whenReady` now caches the in-flight "ready" promise per `ReadySource` in a
  `WeakMap`; N concurrent callers during an outage share one `once('ready', …)` listener instead
  of registering N. The entry is cleared when it resolves or times out, so a later outage on the
  same instance registers a fresh listener. `readyCounters`'s signature is unchanged.
- `describe-error.ts`: `describeError` now prefers Auth.js's own `.type` (a stable string) over
  `.name` (can be a minified class name once the app is built) whenever `.type` is a string,
  instead of combining `${name} (${type})`.
- `config.test.ts`: updated the one log-string expectation at the old line ~479 to match (`'[auth]
  error AdapterError'`, not `'[auth] error Error (AdapterError)'`).
- New tests: `index.guard-only.test.ts` (ioredis/nodemailer throw on import; the guard helpers and
  path constants still import cleanly), `describe-error.test.ts`, plus new cases in
  `index.test.ts` (dev Redis singleton across two cold `load()`s) and `redis-ready.test.ts` (20
  concurrent callers share one listener; a second outage after the first resolves gets a fresh
  one).
- `apps/web/package.json`/`pnpm-lock.yaml`: **no change.** Checked the npm registry directly
  (`npm view nodemailer versions`): `8.0.11` (the pinned version) is already the newest `8.x`
  patch, so there is nothing to bump (plan §5/Q3's "only if a newer 8.x patch exists"). The major
  bump stays out of scope either way (`@auth/core@0.41.3` caps it below `9.0.0`). `server-only`
  was not added, per the lead's Q1 answer.

Phase B (docs/config, no code):
- New `docs/setup/sign-in-mail-and-proxy.md` (lead's Q4 answer: the existing `docs/setup/` folder,
  not a new `docs/deploy-notes/`): states production must set `EMAIL_SERVER`/`EMAIL_FROM` itself
  (Resend's SMTP relay, `smtp.resend.com:465`, API key as the password) because compose's default
  is Mailpit-only and Mailpit's UI shows every link in plain text; and that Caddy's
  `trusted_proxies` must list whatever sits in front of it in production, or the per-IP rate
  limiter's `clientIp` collapses every client into the shared `unknown` bucket.
- `docker/env.example`: one comment line pointing at the new doc with the Resend URL shape, next
  to the existing `EMAIL_SERVER`/`EMAIL_FROM` placeholders.
- `docker/Caddyfile`: one comment line pointing at the new doc for `trusted_proxies`, next to the
  existing `X-Forwarded-For` comment.
- `docker/compose.yaml` was not touched (no env/service shape change needed; the plan's §7 is
  docs-only for this item). The edited `docker/env.example`/`Caddyfile` were hand-checked by eye
  (comments only, no shape change); `docker compose config` was not run (no compose access in this
  worktree, as the plan anticipates).

## Evidence

| Part | Evidence |
|---|---|
| Dev hot reload reuses one Redis client | `index.test.ts`: `'dev hot reload reuses one Redis client across module reloads...'` -- two cold `load()`s (simulating two HMR reloads) each hit `handlers.GET('/api/auth/providers')`; `fakes.redis` stays at length 1 across both. Passes. |
| Guard helpers import without ioredis or nodemailer | `index.guard-only.test.ts`: `vi.mock('ioredis'/'nodemailer', () => { throw })`; `await import('./index')` and reading `withRole`/`publicRoute`/`providerRoute`/`requireRole`/`HOME_PATH`/`SIGN_IN_PATH`/`TEACHER_PATH` does not throw. Passes. |
| No MaxListeners warning in a Redis outage | `redis-ready.test.ts`: `'20 concurrent callers register exactly one listener and all resolve together'` -- a spy on `redis.once` is called exactly once for 20 concurrent `whenReady` calls; all 20 resolve together on one `ready` emit. Passes. |
| Auth.js error type logged, not minified class name | `describe-error.test.ts` (new, 3 tests): `.type` preferred over `.name`; falls back to `.name` with no `.type`; non-`Error` logs `non-error`. `config.test.ts`'s updated assertion also passes. |
| Deploy docs cover Mailpit and trusted_proxies | `docs/setup/sign-in-mail-and-proxy.md` (new); `docker/env.example` and `docker/Caddyfile` each get a one-line pointer. |
| Auth tests pass | `corepack pnpm turbo run build typecheck lint test --filter=@edmate/web --force`, Postgres (127.0.0.1:55432) and Redis (127.0.0.1:56379) already up: **11/11 tasks successful** (build, typecheck, lint, test across the dep graph). `next build` succeeded (all routes compiled, including `/api/auth/[...nextauth]`, `/sign-in/confirm`). Test run: **157/157 test files passed, 2412/2412 tests passed, 0 skipped.** Coverage `web/src/auth`: **100% stmts, 99.74% branch, 100% funcs, 100% lines** (threshold for `src/auth/**` is 100/90/100/100 -- all four met, branch well above the 90% floor). One lint warning was seen and fixed mid-build (an unused `eslint-disable` comment); the final gate run has 0 lint errors and 0 warnings. One cold-import test (`index.guard-only.test.ts`) hit vitest's default 5s timeout once on a loaded machine and was given the same 20s bound the file's other cold-import cases already use; the re-run after that fix is the green run reported above (not a re-run of an untouched file -- the fix is committed). Secret scan: `python3 .githooks/secret-scan.py --all` -- clean (0 findings). |

## Left to do (board follow-ups only)

- `apps/web/scripts/sandbox-magic-link.mjs` was **not** run. It needs the full compose stack (the
  web container built and served at `localhost:8080`, plus Mailpit's API at `127.0.0.1:8025`) --
  not just the bare Postgres/Redis this task's gate uses -- and the setup explicitly says not to
  run `docker compose` in this worktree. Running it is unchanged scope from 1.4b/1.4 and belongs
  with whichever task next exercises the sandbox stack end to end (e.g. 9.0).
- The nodemailer major-version bump (to use whatever CVE fixes land past the `8.x` line) stays
  blocked on `@auth/core`/`next-auth` raising its peer range above `9.0.0`; re-check when either
  is next bumped.
- The real deploy guide (board task 13.6) should fold in `docs/setup/sign-in-mail-and-proxy.md`
  once it exists, per that doc's own pointer.

## Fix round

Four review follow-ups (security-reviewer, typescript-reviewer):

1. [HIGH] `docs/setup/sign-in-mail-and-proxy.md` -- the `trusted_proxies` recipe was wrong: a
   trusted Caddy *appends* its peer to `X-Forwarded-For` rather than replacing it, so
   `clientIp` (`rate-limit.ts`'s rightmost-entry read) still gets the load balancer's IP, not
   the real client's -- every client shares one per-IP bucket, not an "unknown" one. Replaced
   with the reviewer's tested recipe: global `servers { trusted_proxies static <ranges>;
   trusted_proxies_strict }` plus `header_up X-Forwarded-For {client_ip}` in the `reverse_proxy`
   block, with the reasoning (append-not-replace; why `trusted_proxies_strict` matters) in plain
   sentences. Placeholder only (`<your load balancer ranges>`), no real IPs or hosts.
2. [MEDIUM] `docker/Caddyfile:12-14` -- the comment repeated the same wrong claim; corrected to
   match the doc. Comment only; the live `:80` block is unchanged.
3. [MEDIUM] `apps/web/src/auth/index.ts` (`emailSignIn`) -- `emailDeps ??= (async () => {...})()`
   cached a rejected promise forever (a throw during the one-time build locked out every later
   request until a process restart). Added a `.catch` that resets `emailDeps = undefined` before
   rethrowing, so the next call rebuilds from scratch. New test: `'emailSignIn retries after a
   throw during the one-time build (not cached forever)'` -- the first `requestLink` throws (the
   fake `Redis` constructor is made to throw once), `fakes.redis` stays empty, and the next
   `requestLink` succeeds and reaches `ready`.
4. [LOW] `apps/web/src/auth/index.ts` -- the dev-mode Redis singleton's `error` listener was
   attached every time the (memoized-per-reload) builder ran, including when it reused the
   cached `globalThis` client across a hot reload, so repeated edits piled up listeners. Moved
   the `.on('error', ...)` call inside the `if (!redis)` branch that creates a new client, so it
   runs exactly once per client, in dev or production. New test: `'dev: a hot-reloaded module
   reuses the singleton client without adding another error listener'` -- after four simulated
   HMR reloads (`load()` + a providers request each), `fakes.redis` still has length 1 and its
   instance's `listenerCount('error')` is still 1.

Gate: `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
TEST_REDIS_URL=redis://127.0.0.1:56379 corepack pnpm turbo run typecheck lint test
--filter=@edmate/web --force` -- **10/10 tasks successful**; **157/157 test files passed,
2418/2418 tests passed, 0 skipped** (`index.test.ts` grew from 25 to 27 tests, the two new
cases above; items 1/2 are docs/comments only, no test files). `python3
.githooks/secret-scan.py --all` -- clean.

Tool calls used (this fix round): 27

### Gate verification (second fix round, resumed after a usage-limit interruption)

The four items above were already implemented and committed (by the earlier, interrupted agent)
when this round started; this round verified them against a clean gate rather than redoing the
work. Re-ran: `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate
TEST_REDIS_URL=redis://127.0.0.1:56379 corepack pnpm turbo run typecheck lint test
--filter=@edmate/web --force` -- **10/10 tasks successful**; **157/157 test files passed,
2418/2418 tests passed, 0 skipped**. `python3 .githooks/secret-scan.py --all` -- clean (0
findings). No further code changes were needed.

Tool calls used (gate-verification round): 9

## Decisions

### 23 Oct 2026 · Sign-in runtime hardening: dev Redis singleton, dynamic ioredis/nodemailer imports, shared ready-wait, Auth.js error type in logs · decided by builder · risk: high
- Decided: `index.ts` reuses one ioredis client across dev module reloads via a `globalThis`
  cache; the `ioredis`/`nodemailer`/`rate-limit` imports `emailSignIn()` needs moved inside the
  function as dynamic imports (`emailSignIn` is now async, memoized), and the per-request Auth.js
  config factory inside `getRuntime()` is now async and awaits it -- `getRuntime()` itself stays
  synchronous, since the guard dependencies it returns never depended on email/Redis/mail and
  `createGuard`'s `() => getRuntime().guard` callback is called synchronously and is out of this
  task's scope to change. This satisfies the accept line ("guard helpers import without ioredis or
  nodemailer") without the `server-only` package (lead's Q1 answer: skip it) and without a deeper
  structural split (lead's Q2 answer: no). `redis-ready.ts` now shares one in-flight "ready"
  promise per Redis instance (a `WeakMap`) instead of registering a new listener per request.
  `describe-error.ts` now logs Auth.js's own `type` field when present, instead of the (possibly
  minified) `Error.name`. Nodemailer's exact `8.x` patch pin (`8.0.11`) is unchanged: the npm
  registry shows no newer `8.x` patch exists today (lead's Q3 answer: bump only if one exists);
  the major-version bump stays out of scope regardless, since `@auth/core@0.41.3` still caps it
  below `9.0.0`.
- Why: these are the 1.4 review's deferred findings; this is the sign-in path
  (`apps/web/src/auth/**`), so risk: high.

### 23 Oct 2026 · Production sign-in mail is Resend's SMTP relay, by config only; a new setup doc covers Mailpit and trusted_proxies · decided by builder · risk: low
- Decided: no code change for Resend (human decision B-25, Resolved) -- `EMAIL_SERVER`/
  `EMAIL_FROM` already route through any SMTP endpoint via the existing `smtpMailSender`. A new
  doc, `docs/setup/sign-in-mail-and-proxy.md` (lead's Q4 answer: the existing `docs/setup/`
  folder, not a new `docs/deploy-notes/`), states that production must override the Mailpit
  default and must set Caddy's `trusted_proxies`; both `docker/env.example` and `docker/Caddyfile`
  get a one-line pointer to it. The real deploy guide (board task 13.6) folds this in later.
- Why: this is documentation and config comments, not production-path code; low risk.

Tool calls used: 70
