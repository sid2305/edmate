# 1.4 plan: Email magic-link sign-in (phone OTP later, per market)

Board: `board.py show 1.4` · Milestone M1 · deps: 1.3 (done), M0 (done) · branch `m1/1.4-magic-link` · risk: **risky** (`apps/web/src/auth/**`, `packages/db/src/identity/**`).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "Email magic-link sign-in (phone OTP later, per market)"
Accept: "link sign-in works in the sandbox; requests rate-limited per address and IP."

Spec it must honour:
- Build plan § Tech stack, Auth row: "Auth.js: Google sign-in and email magic link (phone OTP later, per market)". PRD S1: "Sign up with Google or email (phone sign-in later, per market)". Phone sign-in is out of the MVP.
- 1.3's decisions still hold: database sessions with hashed tokens, the identity store as the only path to `users`, new users are always `student`, no account linking while signed in, and the browser session JSON is `{ user: { id, role }, expires }`.
- 1.3 plan note: "email sign-in with the same address as a Google user will reach the same user ... 1.4 should confirm this and test it."
- CLAUDE.md rule 4: no real email or provider calls in tests. Rule 5: the repo is public, so only placeholders and reserved `.test` / `example.test` addresses.
- MVP first: thin. Bigger hardening goes to follow-ups (see Open questions).

Not built here: phone OTP, sign-in UI pages (Auth.js's built-in `/api/auth/signin` page is enough for the sandbox), the age gate (1.7), a production email provider account, a link "confirm" step (Q3), and Google↔email account linking (Q4).

### How it is shown (paste into handoff.md)
| Part | Evidence |
|---|---|
| Link sign-in works in the sandbox | `docker compose up` with `AUTH_SECRET` set in the shell and Mailpit as the SMTP catcher. `apps/web/scripts/sandbox-magic-link.mjs` gets a CSRF token, POSTs `/api/auth/signin/email` for `student1@example.test`, reads the mail from Mailpit's API, follows the link, and shows `/api/auth/session` = `{ user: { id, role: 'student' } }`. Reusing the same link fails. Output pasted. |
| Link sign-in in tests (no network) | `apps/web/src/auth/email-flow.test.ts` runs Auth.js's real handlers with the in-memory identity store, an in-memory `MailSender` and in-memory counters. Covers: request → one mail → callback → session cookie → new `student`; second use refused; expired link refused; an older link stops working after a new one is issued; an existing Google user signing in by link gets the **same** user id. |
| Tokens single-use, short-lived, stored hashed | `identity.int.test.ts` (Postgres): a raw `select` shows only the hash; `useVerificationToken` returns the row once and `null` the second time, including under two concurrent calls; an expired token is `null`. `email.test.ts`: the provider's `maxAge` is 15 minutes. |
| Rate-limited per address | `rate-limit.test.ts` and `email-flow.test.ts`: the 6th request for one address within the hour is refused. No token is written and no mail is sent. `+tag` variants and case variants share one bucket. |
| Rate-limited per IP | The 51st request from one IP within the hour (any addresses) is refused. IPv6 is bucketed per /64. A missing or untrusted IP falls into one shared `unknown` bucket (fails toward limiting). |
| Real Redis | `apps/web/src/auth/rate-limit.int.test.ts` runs the limiter on `redisTurnCounter` against compose/CI Redis: both limits hold across two connections, and Redis holds no plaintext address or IP (keys are HMACs). It skips locally without Redis and fails in CI, the 3.14 pattern. |
| No user enumeration | `email-flow.test.ts`: a known and an unknown address get byte-identical responses (status, `Location`, body), and both send exactly one mail. A rate-limited known address and a rate-limited unknown address also get identical responses. |
| No open redirect | `config.test.ts`: `safeRedirect` keeps `/teachers` and same-origin absolute URLs, and maps `https://evil.test`, `//evil.test`, `/\evil.test`, `javascript:alert(1)`, `http://localhost:8080.evil.test` and a different port to the `AUTH_URL` origin. `email-flow.test.ts`: a `callbackUrl=https://evil.test` on the request ends at the app origin after the callback. |
| No host-header link poisoning | `email-flow.test.ts`: a request carrying `x-forwarded-host: evil.test` (and a forged `Host`) still mails a link whose origin is `AUTH_URL`'s. |
| CSRF | The sign-in POST without Auth.js's CSRF token is refused and sends no mail. The GET callback is covered by the token itself (256-bit, single-use, 15 min, bound to the address). The residual login-CSRF risk is logged (Q3). |
| Server actions can't bypass the limit | `index.test.ts`: the exported `signIn('email', …)` throws, so email sign-in only goes through the rate-limited HTTP route. |
| Env | `env.test.ts`: Google is optional as a pair and email is optional as a pair (`EMAIL_SERVER` + `EMAIL_FROM`). Email needs `REDIS_URL`. No provider at all is an `AuthConfigError`. Messages name the variable and never echo a value (the SMTP URL holds a password). |
| Gates | `corepack pnpm turbo run build typecheck lint test --filter=@edmate/web... --filter=@edmate/db...` with Postgres and Redis up. Coverage for `src/auth/**` stays at 100/100/100 and 90% branches without Redis. `next build` succeeds. `/api/health` is 200 under compose. Secret scan clean. |

## Design

### Auth.js email provider, not hand-rolled
Use Auth.js's own magic-link flow, which is already in the tech stack. It handles the CSRF token on the request POST, the token generation (32 random bytes), the `sha256(token + secret)` before the adapter, the expiry check and the session. Edmate supplies four things: the provider config, two adapter methods, a mail port, and a rate check in the `signIn` callback.

- **Provider.** A generic `type: 'email'` provider with id `email` (routes `/api/auth/signin/email` and `/api/auth/callback/email`), built by `emailProvider(deps)` in `src/auth/email.ts`:
  - `maxAge: 15 * 60`.
  - `normalizeIdentifier`: `normalizeEmail` (trim, lower-case; throws on a comma, whitespace, a quote, a control character, more than one `@`, a failed `z.email()` or more than 320 characters).
  - `sendVerificationRequest`: rebuilds the link (next bullet), renders the mail and calls `MailSender.send`.
  - The builder first asks `docs-lookup` how `next-auth@5.0.0-beta.32` / `@auth/core@0.41.3` declares a non-Nodemailer email provider. If only the `Nodemailer` provider is supported, use it with `sendVerificationRequest` overridden, so sending still goes through the port. Either way the provider id stays `email`.
- **Link built from `AUTH_URL`, never the request.** With `trustHost`, Auth.js derives its base URL from `X-Forwarded-Host`. An attacker could then request a link for a victim with `Host: evil.test` and harvest the token. `sendVerificationRequest` parses Auth.js's `url` and keeps only its `pathname` + `search`, rebuilt on `env.url.origin`. A path outside `/api/auth/callback/email` throws, and no mail is sent.
- **Mail body.** Subject "Your Edmate sign-in link". The plain text and minimal HTML hold the link, "expires in 15 minutes", and "if you didn't ask for this, ignore it". The address and the link are HTML-escaped. There are no images or tracking. The recipient's address isn't repeated in the body.
- **Errors.** `sendVerificationRequest` failures go through the existing `describe()` logger (name and code only). Nodemailer errors can contain addresses. Auth.js then redirects with its generic `EmailSignin` error, the same for every address.

### Mail port: `src/auth/mail.ts`
- `interface MailSender { send(m: { to: string; subject: string; text: string; html: string }): Promise<void> }`.
- `smtpMailSender({ server, from, requireTls })` uses `nodemailer.createTransport(server)` with connection, greeting and socket timeouts of 10 s, so a hung SMTP server can't hang the request. `requireTLS: true` applies when `AUTH_URL` is https.
- Tests use `test/memory-mail.ts`, which records messages. No test opens a socket: `test/setup.ts` already makes the global fetch reject, and the SMTP adapter's unit test uses nodemailer's `jsonTransport` through an injected transport factory.
- **Sandbox: Mailpit** in compose. Its SMTP port is internal only; its UI and API are on `127.0.0.1:${EDMATE_MAIL_UI_PORT:-8025}`. Mailpit has no outbound relay, so the sandbox can't email a real person. Production SMTP is any provider's SMTP URL in `EMAIL_SERVER` (Q1), with no code change.

### Rate limits: `src/auth/rate-limit.ts`, checked in the `signIn` callback
- **Where.** In `@auth/core`'s email send path, the `signIn` callback runs with `email.verificationRequest === true` **before** the token is created or the mail is sent. Every email sign-in request passes through it, whatever path Auth.js parsed. The callback gets the request through 1.3's per-request config (`NextAuth((req) => createAuthConfig({ request: req }))`). `AuthConfigDeps.request` widens from `{ cookies }` to `{ cookies, headers }`.
  - **No request** (a server action): refused (fail closed).
  - **Over the limit:** returns the string `/api/auth/error?error=RateLimited`. Auth.js redirects there with no token written and no mail sent.
  - **Redis error:** throws. Auth.js turns it into its generic error redirect, so the request fails closed. Google sign-in is unaffected.
- **The limits** are constants, overridable in tests:
  - per address: 5 requests per hour;
  - per IP: 50 requests per hour. A classroom or coaching centre often shares one NAT IP, so this one is generous.

  The IP is checked first, then the address. A take refused by the second check doesn't refund the first; that is acceptable.
- **Keys.**
  - **Address key:** the normalised address with any `+tag` removed from the local part (`a+x@d` → `a@d`). The key is for counting only; the sign-in identifier keeps the tag.
  - **IP key:** IPv4 as is; IPv6 cut to its /64.
  - **Hashing:** both keys are `HMAC-SHA256(AUTH_SECRET, kind + value)`, so Redis holds no plaintext address or IP.
- **Client IP.**
  - When `trustHost` is on (Caddy in front), use the **rightmost** `X-Forwarded-For` entry, which is the peer Caddy saw. The builder confirms Caddy 2.10's default replace/append behaviour with `docs-lookup` and notes it in the handoff.
  - Without `trustHost`, or when the header is missing or unparseable, the IP is `unknown`: one shared bucket.
- **Counters.** Reuse 3.14's `redisTurnCounter` (`@edmate/queue`) with prefixes `edmate:signin:ip` and `edmate:signin:addr` and a one-hour window. It is an atomic Lua sliding window, and a Redis error rejects. The ioredis client is created lazily in `index.ts` only when email sign-in is on, with `maxRetriesPerRequest: 1` and `enableOfflineQueue: false` so an outage fails fast. If importing `@edmate/queue` breaks `next build` (bullmq), add `serverExternalPackages: ['bullmq', 'ioredis']` to `next.config`. If that is not enough, stop and ask the lead; do not copy the Lua script.
- **Enumeration.** The callback never branches on whether the user exists (Auth.js passes a stand-in user for unknown addresses), and the limit message is the same for both limits.
- **Server actions.** The exported `signIn` in `index.ts` throws for provider `email`. Email sign-in goes only through the HTTP route; Google server-action sign-in is unchanged.

### Tokens: `packages/db/src/identity/` and a new table
- **Schema.** New table `auth_verification_tokens` in `packages/db/src/schema/auth.ts`: `id`, `identifier` (a lower-cased email), `token_hash` (unique), `expires_at`, timestamps. It is indexed on `identifier` and on `expires_at` (for the sweep). There is no FK to `users`, because the address may not be a user yet. The migration is additive only and generated by `drizzle-kit generate` (next number, currently `0012_*`; renumber on merge if needed).
- **New store methods:**
  - `createVerificationToken({ identifier, token, expires })` stores `sha256(token)`. Auth.js already passes `sha256(rawToken + AUTH_SECRET)`, so the database holds a hash of a hash, and the store's rule "never a raw token" doesn't depend on Auth.js. In the same transaction it **deletes earlier tokens for that identifier**, so only the newest link works and each address has at most one live token.
  - `useVerificationToken({ identifier, token })` runs `DELETE … WHERE identifier = $1 AND token_hash = $2 RETURNING identifier, expires_at`. The delete is atomic, so two clicks can't both win. An expired row is still deleted and is returned as `null`.
  - Both methods use Zod inputs (`Email`, `Token`, `When`) and the existing `guardAll` scrub.
- **Adapter.** `toAuthAdapter` gains `createVerificationToken` and `useVerificationToken`. `createUser` (sign-up by link) and `updateUser` (setting `emailVerified` on an existing user) are unchanged: an email sign-up is a `student` with `emailVerifiedAt` set. Auth.js's email path never calls `linkAccount`, so a Google user who signs in by link reaches the same user and nothing is linked. If a different user is signed in, Auth.js deletes that session first; this is tested.
- **README.** Update the identity README:
  - Rule 8 now also covers verification tokens.
  - Rule 10 becomes "the only deletes are `deleteSession` and the verification-token deletes".
  - New rule 11: "one live link per address; single use by atomic delete".

### Env and config: `src/auth/env.ts`, `src/auth/config.ts`
- **Env.**
  - Google becomes optional: `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are both set or both empty.
  - Email is optional: `EMAIL_SERVER` (an `smtp:`/`smtps:` URL) and `EMAIL_FROM` are both set or both empty.
  - Email needs `REDIS_URL`, so there are no limits-less links.
  - At least one provider must be configured.
  - `AuthEnv` gains `google?: {...}`, `email?: { server, from }` and `redisUrl?`.

  This lets the sandbox run with email only and no Google credentials.
- **Config.**
  - `providers` lists only the configured ones.
  - The `signIn` callback keeps 1.3's Google branch exactly as it is and adds the `email` branch. A verification request runs the rate check; the link callback returns `true`.
  - A new `redirect` callback, `safeRedirect(url, env.url)`, allows only a relative path starting with a single `/` (not `//` or `/\`) or an absolute URL whose origin equals `AUTH_URL`'s origin; anything else gives the `AUTH_URL` origin. It compares against `env.url`, not Auth.js's `baseUrl`, because `baseUrl` can come from a forwarded host.
- **Unchanged:** cookies, session strategy, `ROUTE_POLICY` (`/api/auth/**` is already public; Auth.js checks CSRF itself), and the `[...nextauth]` route file.

### Compose and env
- **`docker/compose.yaml`.**
  - New `mailpit` service: image pinned by digest, as was done for MinIO; the builder looks up the current `axllent/mailpit` release. It uses its built-in health check and keeps no data volume.
  - `web` gets `EMAIL_SERVER: ${EMAIL_SERVER:-smtp://mailpit:1025}` and `EMAIL_FROM: ${EMAIL_FROM:-Edmate <sign-in@edmate.test>}`, and depends on `mailpit`.
  - `REDIS_URL` is already in `x-app-env`.
- **`docker/env.example`:** empty `EMAIL_SERVER=` and `EMAIL_FROM=` with a "smtp(s)://user:pass@host:port — never commit real values" note, plus the sandbox recipe (`AUTH_SECRET=$(openssl rand -base64 32) docker compose … up`, Mailpit UI on 127.0.0.1:8025).
- **Logging.** Caddy has no access log today. Add a comment to the Caddyfile that, if one is added, it must not log the query string of `/api/auth/callback/*`, because the token is in the query.

## Phases
The work touches two packages and has three adapters (verification-token store, SMTP, Redis limiter). Each phase gets a fresh builder, ends green with its own commit on the one branch, and the PR opens after Phase C.

### Phase A: tokens in the database (`packages/db` only, about 45 builder calls)
- Tests first: `identity.int.test.ts` covers hash-only storage, single use (sequential and two concurrent `useVerificationToken` calls → exactly one row), expired → `null` but deleted, a new token deletes older ones for the same identifier only, bad input → `invalid`, and the driver-error scrub. `helpers.ts` gains the new table in its list.
- Then: the schema, the generated migration with meta, the store methods, `IdentityStore` types, and the README.
- Gates: `turbo run build typecheck lint test --filter=@edmate/db...` with Postgres up. `migrate.int` passes on the new snapshot.
- **State after A:** the store can create and consume links, and nothing calls it yet. The web package is unchanged and still green.

### Phase B: mail port, email provider and rate limiter (pure `apps/web/src/auth` modules, about 55 calls)
- Tests first:
  - `mail.test.ts`: the SMTP adapter over `jsonTransport` (to, from, subject, text and html passed through; timeouts and `requireTLS` set; errors bubble).
  - `email.test.ts`:
    - `normalizeEmail` accepts and rejects the expected inputs (CRLF, comma, two `@`, 321 characters, unicode homoglyph local part allowed only if `z.email()` allows it);
    - the link is rebuilt on `AUTH_URL` (a forged host and a foreign path both throw with no send);
    - escaping in the HTML;
    - `maxAge` is 900;
    - sender errors are logged as a name only.
  - `rate-limit.test.ts` (with an in-memory `TurnCounter` fake):
    - address and IP limits;
    - `+tag` and case folding;
    - IPv6 /64;
    - rightmost `X-Forwarded-For` and spoofed left entries ignored;
    - the `unknown` bucket;
    - HMAC keys, with no plaintext in the keys passed to the counter;
    - a counter rejection propagates.
  - `rate-limit.int.test.ts`: real Redis, skip locally and fail in CI.
- Then: `mail.ts`, `email.ts`, `rate-limit.ts`, `test/memory-mail.ts`; `package.json` adds `nodemailer` (pinned exactly), `@types/nodemailer` (dev), `ioredis` 6.0.0 and `@edmate/queue`; `vitest.config.ts` if needed; `pnpm-lock.yaml`.
- Gates: `--filter=@edmate/web...` typecheck, lint and test with coverage held. `next build` must pass, which proves the `@edmate/queue` import is safe.
- **State after B:** the pieces exist and are tested on their own, but nothing is wired into Auth.js yet. Sign-in behaves exactly as it did after 1.3.

### Phase C: wiring, sandbox and evidence (about 60 calls)
- Tests first:
  - `env.test.ts` (optional pairs, `REDIS_URL` required for email, no provider → error, no values echoed).
  - `config.test.ts`:
    - `safeRedirect` cases;
    - providers by env;
    - the `signIn` email branch: verification request → limiter; no request → `false`; over the limit → `RateLimited` URL; the Google branch unchanged.
  - `adapter.test.ts`: the two new methods pass through.
  - `email-flow.test.ts`: the end-to-end flow rows in the evidence table above, including identical responses for known and unknown addresses, the forged host, `callbackUrl=https://evil.test`, missing CSRF, and Google user → link → same id.
  - `index.test.ts`: `signIn('email')` throws; the module still imports with no env.
  - `test/memory-identity.ts` gains the two methods.
- Then: `env.ts`, `config.ts`, `adapter.ts`, `index.ts`; `docker/compose.yaml`, `docker/env.example`, the Caddyfile comment; `apps/web/scripts/sandbox-magic-link.mjs`. Run the sandbox and paste the output. Write `docs/tasks/1.4/handoff.md`.
- Gates:
  - the full `turbo run build typecheck lint test` with Postgres and Redis up;
  - `next build`;
  - `docker compose config` shows web gets `EMAIL_*`;
  - `/api/health` is 200;
  - secret scan clean;
  - merge `origin/main`, renumber the migration if needed, and re-run.

## Files
**Create:**
- `packages/db/migrations/00NN_*.sql` plus meta (drizzle-kit output)
- `apps/web/src/auth/{mail,email,rate-limit}.ts` with `mail.test.ts`, `email.test.ts`, `rate-limit.test.ts`, `rate-limit.int.test.ts` and `email-flow.test.ts`
- `apps/web/test/memory-mail.ts`
- `apps/web/scripts/sandbox-magic-link.mjs`, which uses only `.test` addresses and localhost URLs
- `docs/tasks/1.4/handoff.md` (builder)

**Modify:**
- `packages/db/src/schema/auth.ts`, `src/schema/index.ts` (export), `src/identity/{store,index}.ts`, `src/identity/README.md`, and `src/identity/token-hash.ts` (a `hashToken` alias only if naming needs it)
- `packages/db/test/identity.int.test.ts`, `test/helpers.ts`
- `apps/web/src/auth/{env,config,adapter,index}.ts` and their tests; `apps/web/test/memory-identity.ts`; `apps/web/package.json`; `apps/web/vitest.config.ts` (if the include or coverage globs need it); `apps/web/next.config.*` (only if `next build` needs `serverExternalPackages`)
- `docker/compose.yaml`, `docker/env.example`, `docker/Caddyfile` (comment only)
- `pnpm-lock.yaml`

**Out of bounds:**
- `packages/contracts/**` (no contract change; `rate_limited` and `ErrorCode` already exist)
- `packages/harness/**`
- `packages/queue/**` (imported, not changed)
- `packages/db/src/repositories/**`
- `apps/web/src/auth/{policy,guard}.ts` (no policy change)
- `apps/web/app/api/auth/**` (the route file is unchanged)
- `.github/**` (CI already provides Redis and `TEST_REDIS_URL`)
- `.claude/**`, `docs/adr/**`
- sign-in UI pages, phone OTP, 1.7's age gate

## Tests first
The order is written per phase above. Across all phases:
- Every test runs with the global fetch rejecting and no SMTP socket.
- Fake secrets are built at runtime (the 1.3 pattern).
- Addresses are only `*@example.test`.
- Redis and Postgres integration suites follow the skip-locally, fail-in-CI pattern.

## Risky paths touched
Every planned path was checked against `.claude/skills/merge-gate/risk-paths.txt` and the safety prefixes:
- `packages/db/src/identity/**` (store, index, README) → **security-reviewer**
- `apps/web/src/auth/**` (env, config, adapter, index, mail, email, rate-limit and their tests) → **security-reviewer**
- No other matches:
  - `packages/db/src/schema/**`, `packages/db/migrations/**` and `packages/db/test/**`: no match. The migration is additive (no DROP, DELETE or UPDATE), so it is not destructive.
  - `apps/web/test/**`, `apps/web/scripts/**`, `apps/web/package.json`, `apps/web/next.config.*` and `apps/web/vitest.config.ts`: no match.
  - `docker/**`, `pnpm-lock.yaml` and `docs/tasks/1.4/**`: no match.
- Not touched: `apps/web/app/api/auth/**`, `.claude/**`, `.github/**`, `packages/contracts/**`, `docs/adr/**`, and every safety path.
- `review.md` should read `Reviewers: security-reviewer, database-reviewer, typescript-reviewer`. Only security-reviewer is required; database-reviewer is recommended for the token table and the atomic delete, and typescript-reviewer for the Adapter and EmailConfig typing.
- The handoff logs the `risk: high` entry below.

## Decisions (draft, for the handoff)

### 1.4 Email magic-link sign-in through Auth.js, rate-limited per address and IP in the signIn callback · decided by planner · risk: high
Decided:
- **Flow.** Auth.js's email provider (id `email`) on the existing database sessions.
- **Tokens.** 15-minute links. Tokens are stored as `sha256(sha256(token + secret))` in `auth_verification_tokens`. They are single-use through an atomic `DELETE … RETURNING`, and only the newest link per address works.
- **Link origin.** The link is always built on `AUTH_URL`, never on the request's host.
- **Redirects.** `safeRedirect` allows only same-origin targets.
- **Mail.** Sent through a `MailSender` port: nodemailer SMTP in the app, Mailpit in the sandbox, an in-memory fake in tests.
- **Rate limits.** Requests are limited before any token or mail exists, in the `signIn` callback: 5 per address and 50 per IP per hour, on 3.14's Redis sliding window. Keys are HMACs (no plaintext address or IP in Redis), `+tags` fold for counting, and IPv6 is counted per /64. A Redis error fails closed.
- **Server actions.** Email sign-in is refused through server actions, so the limit can't be bypassed.
- **Providers.** Google and email are each optional; at least one is required.
- **Linking.** The email path never links accounts. A Google user who signs in by link is the same user.

Why: it reuses the stack's own CSRF, token and session handling; host-header poisoning and open redirects are the classic magic-link takeovers; limiting in the callback covers every route into the flow; the same responses for every address prevent enumeration.

Alternatives:
- A hand-rolled flow: more code to secure.
- A route wrapper that parses the POST body: it misses server actions and Auth.js path variants.
- A fixed-window `INCR` limiter: simpler, but duplicates what 3.14 already has.

Reversible: yes. The table is additive, and the provider, port and limiter sit behind `createAuthConfig`.

### 1.4 nodemailer for SMTP; Mailpit in the sandbox · decided by planner · risk: medium
nodemailer is Auth.js's documented transport, and SMTP works with any provider in any market, so it stays country-neutral. Mailpit can't relay mail out. Alternative: a provider's HTTP API through `fetch` (no new dependency, but tied to one vendor). Reversible: yes (swap the `MailSender` adapter).

### 1.4 Limits, lifetimes and small choices · decided by planner · risk: low
- **Values.** 5 requests per address and 50 per IP per hour; links live 15 minutes.
- **Missing IP.** An untrusted or missing IP goes into the `unknown` bucket.
- **Key reuse.** Redis key prefixes are `edmate:signin:{ip,addr}`.
- **Sender address.** `EMAIL_FROM` defaults to `Edmate <sign-in@edmate.test>` in compose.
- **Rate-limited response.** It redirects to Auth.js's error page with `error=RateLimited`. Until sign-in pages exist, that page shows a generic message.

## Open questions (none blocks the build; each has a default the build uses)
- **Q1. Production email provider.** The options are any SMTP provider, e.g. Amazon SES, Postmark, Resend or the market's own. **Recommendation:** decide before the pilot. No code depends on it, because it is only the `EMAIL_SERVER` URL plus SPF, DKIM and DMARC on the sending domain. Default for 1.4: none; the sandbox uses Mailpit.
- **Q2. Auth library.** (a) Auth.js email provider + nodemailer; (b) hand-rolled tokens and routes; (c) Better Auth (needs an ADR). **Recommendation and default: (a).** It is already the stack, and 1.3 is built on it.
- **Q3. Link scanners and login CSRF on the GET callback.** Corporate and school mail scanners can open a link and use it up ("link already used"). An attacker can also mail a victim a link to the attacker's own account, so a student ends up in a stranger's account (login CSRF). Options:
  - (a) Accept for the sandbox and add a follow-up before real students.
  - (b) A confirm page: the link opens a page with a "Sign in" button, which stops scanners but not a determined attacker.
  - (c) Same-browser binding: an HMAC cookie set at request time is checked at the callback **before** the token is used. With no cookie, fall back to the (b) page that shows the address being signed in. This stops both problems; the cost is one extra click on another device or in an in-app mail browser.

  **Recommendation and default: (a)** now, with (c) as a new board task ("1.4b magic-link confirm and same-browser check", deps 1.4) that must close before the pilot gate (13.x).
- **Q4. Google sign-in for an address that first signed up by link.** Today it fails with `OAuthAccountNotLinked` (1.3 set `allowDangerousEmailAccountLinking: false`). Signing in by link as an existing Google user does work. Options:
  - (a) Keep it as it is.
  - (b) Allow linking when Google says `email_verified` and the existing user's `emailVerifiedAt` is set.

  **Recommendation:** (b) as a follow-up, since it changes a 1.3 `risk: high` decision. **Default: (a).**
- **Q5. Limit values** (5 per address and 50 per IP per hour). **Default as stated.** Revisit with real classroom NAT data in the pilot.

Follow-ups to add to the board:
- 1.4b (Q3)
- Google↔email linking (Q4)
- A sweep of expired `auth_verification_tokens` rows, with 13.4 retention. The rows hold the addresses of people who never clicked.
- Sign-in UI pages, including a friendly `RateLimited` message.

## READY
Nothing blocks the build. The unknowns are version details the builder checks first with `docs-lookup`, each with a fallback:
- how beta.32 declares a generic email provider;
- Caddy's `X-Forwarded-For` behaviour;
- the Mailpit image digest;
- whether `@edmate/queue` builds under Next.

No contracts change and no ADR is needed.

## Lead answers (20 Oct 2026)
- Q1 (production email provider): goes to the human as blocker B-25 (local only). It doesn't block the build: Mailpit in compose for the sandbox, and only `EMAIL_SERVER` changes later.
- Q2 (auth library): the Auth.js email provider with nodemailer. ADR-0001 already names "Auth.js (Google sign-in and email magic link)"; nodemailer is that provider's standard mailer, so no ADR.
- Q3 (link scanners / login CSRF on the GET callback): accepted for the MVP. A new board task 1.4b adds a cookie binding the link to the requesting browser plus a confirm page, and must close before the pilot gate (13.3).
- Q4 (Google after a link sign-up, `OAuthAccountNotLinked`): stays as 1.3 decided for now. A new board task 1.4c covers linking when both sides have a verified email; it changes a 1.3 risk-high decision, so it gets its own review.
- Q5 (limits): 5 per address and 50 per IP per hour, as constants that are easy to change.
