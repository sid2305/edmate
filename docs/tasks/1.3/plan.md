# 1.3 plan: Auth.js Google sign-in; roles student, teacher, staff; RBAC middleware

Board: `board.py show 1.3` · Milestone M1 · deps: 1.1, 1.2 (done), M0 (done) · branch `m1/1.3-auth` · risk: **risky** (`apps/web/src/auth/**`).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "Auth.js Google sign-in; roles student, teacher, staff; RBAC middleware"
Accept: "role × route matrix tests pass."

Spec it must honour:
- Build plan § Tech stack, Auth row: "Auth.js: Google sign-in and email magic link (phone OTP later, per market) | Roles: student, teacher, staff". Decision log: MVP is Google + email, no phone OTP. **1.3 is Google only**; the magic link is 1.4.
- Build plan § API surface: the `Who` column (public / student / teacher / provider / staff) is the source of the route policy table.
- Build plan § Data model: `users` (id, email?, phone?, name, locale, market, role, age_confirmed_at). The `user_role` enum already exists (`packages/db/src/schema/_shared.ts`).
- `packages/db/src/internal.ts`: "app code (apps/**) must not import this; a lint rule enforces that once an app imports the package (1.3)". 1.3 owns that lint rule.
- `packages/db/src/repositories/README.md` rules 1, 7 and 9 (scope first, no deletes, never select from `users`). Auth can't follow them, so it gets its own small module with its own rules (Design § Identity store).
- CLAUDE.md rule 4 (no real provider calls in tests) and rule 5 (public repo: no secrets, only placeholders in env.example).

Not built here: email magic link (1.4), age gate and consent (1.7; also don't block on min-age), seed (1.5), staff console and its grant endpoint (12.1), teacher onboarding (8.1), sign-in UI pages.

### How it is shown (paste into handoff.md)
| Part | Evidence |
|---|---|
| Role × route matrix | `apps/web/src/auth/guard.test.ts`: for every entry in `ROUTE_POLICY` × every method × {anonymous, student, teacher, staff}, the result is 200 when allowed, 401 `unauthorized` with no session, and 403 `forbidden` for a wrong role. A path that matches no policy is denied for every role. Table output pasted. |
| Deny by default for real routes | `apps/web/src/auth/route-coverage.test.ts`: globs every `app/api/**/route.ts`, imports it, and asserts each exported HTTP method carries the guard brand (`withRole` or `publicRoute`) and matches a `ROUTE_POLICY` entry. A route with no guard fails. |
| Google sign-in with a mocked provider | `apps/web/src/auth/flow.test.ts`: sign-in goes through Auth.js's real handlers. The Google discovery, JWKS and token endpoints are served by an injected fetch with a test keypair; the global fetch rejects (`test/setup.ts`). First sign-in creates a `student`; a second sign-in reuses the same user; sign-out deletes the session. |
| Roles never self-assigned | `adapter.test.ts`: `createUser` and `updateUser` ignore `role` and any extra field. `identity.int.test.ts`: `createStudent` always writes `student`; only `grantRole` changes a role, and it writes an audit row. `flow.test.ts`: a grant takes effect on the next request without signing in again (database sessions). |
| CSRF and cookies | `config.test.ts`: the session cookie is httpOnly, `SameSite=Lax`, `path=/`, and `Secure` with the `__Secure-` prefix when `AUTH_URL` is https. `guard.test.ts`: an unsafe method (POST/PUT/PATCH/DELETE) with a missing or cross-site `Origin` gets 403 before the handler runs. Auth.js's own CSRF token on its sign-in/sign-out POSTs is left on. |
| Secrets from env only | `env.test.ts`: a missing or short `AUTH_SECRET`, or a missing Google id/secret, throws a message naming the variable, never its value. `docker/env.example` has empty placeholders. The secret scan is clean. |
| No `@edmate/db/internal` in apps | `packages/config/test/app-preset.test.ts`: ESLint `lintText` on an `apps/web` file importing `@edmate/db/internal` reports an error. |
| Gates | `corepack pnpm turbo run build typecheck lint test --filter=@edmate/web... --filter=@edmate/db...` with Postgres up. Coverage for `apps/web/src/auth/**` and `packages/db/src/identity/**` pasted. `next build` succeeds. `/api/health` still returns 200 under compose with no `AUTH_*` set. |

## Design

### Versions (check first, before any code)
The builder asks `docs-lookup` for the current stable `next-auth` v5 release and checks that its `peerDependencies` include `next@16.4.2` and `react@19.3.1`. Pin it exactly (no caret). Also check whether the pinned version supports injecting fetch into a provider (`customFetch`) and has the Next 16 `proxy` notes. Auth.js has been maintained by the Better Auth team since 2025. If no v5 release supports Next 16, **stop and ask the lead**. The tech stack is frozen, so moving to Better Auth or bare `@auth/core` needs an ADR. No other new runtime dependency is expected; `jose` is a dev dependency only, if the flow test needs it to sign test id_tokens.

### Session strategy: database sessions (recommended)
- Revocation and role changes apply at once. The role is read from `users` on every request via `getSessionAndUser`, so a staff grant or revoke, a ban or a takedown works without waiting for a token to expire. A JWT would carry a stale role until it expired.
- No role or identity data sits in a client-held token. The cookie is an opaque random token.
- 1.4's magic link needs an adapter anyway, so the database is already in the path.
- Cost: one indexed lookup per authenticated request, which is fine at pilot scale.
- Defaults: `maxAge` 30 days, `updateAge` 24 h. The session token is stored as a **SHA-256 hash**, so a leaked database copy holds no live sessions. Hashing happens inside the identity store, so Auth.js never sees it.

### Identity store: `packages/db/src/identity/` (new folder, not `repositories/`)
Auth has to read `users` by email, look up OAuth accounts and delete sessions, which break repository rules 1, 7 and 9. That is why it lives in its own folder, which also keeps it outside `test/scope.test.ts`'s grep and the `CASES` table. Its own `README.md` sets these rules:
- It returns identity fields only (`id`, `role`, `email`, `emailVerifiedAt`, `name`) and never teacher or student data.
- Every input is Zod-validated, and every method is wrapped in the same `guarded()` driver-error scrub as the repositories.
- `createStudent` hard-codes `role: 'student'`, `market: 'global'` and `locale: 'en'` (Q2), and takes only `{ email, emailVerifiedAt, name }`.
- Only `grantRole` changes a role.

It is exported from `@edmate/db` as `createIdentityStore`, and `openDatabase()` returns `{ repos, identity, close }`.

| Method | Notes |
|---|---|
| `createStudent({ email, emailVerifiedAt, name })` | Role is always `student`. A duplicate email is `invalid`. |
| `getUser(id)` / `getUserByEmail(email)` / `getUserByAccount(provider, providerAccountId)` | Return `IdentityUser \| null`. Email is lower-cased and trimmed. |
| `markEmailVerified(userId, at)` | The only profile field Auth.js may update. |
| `linkAccount({ userId, type, provider, providerAccountId })` | **No OAuth tokens are stored** (access, refresh and id tokens are dropped): Edmate doesn't call Google APIs (Q6). |
| `createSession(token, userId, expires)` · `getSessionAndUser(token)` · `updateSession(token, expires)` · `deleteSession(token)` | Stores and looks up `sha256(token)`. An expired session reads as `null`. |
| `grantRole({ userId, role, by, reason })` | Server-side only, called by the CLI below (and by 12.1 later). It writes a 1.6 audit row in the same transaction: actor `by`, actorRole `staff`, action `role.grant`, target `user:<id>`, before/after `{ role }`, scope `{ teacherId: userId }` (Q3). An unknown user is `not_found`. |

**Schema (one additive migration, `0003_<drizzle-kit name>.sql`, generated by `drizzle-kit generate`)**, in `packages/db/src/schema/auth.ts`:
- `auth_accounts`: id, user_id (FK users, indexed), type, provider, provider_account_id, timestamps; unique (provider, provider_account_id).
- `auth_sessions`: id, session_token_hash (unique), user_id (FK users, indexed), expires_at, timestamps.
- `users.email_verified_at`: tstz, nullable.

The tables are prefixed with `auth_` because a learning `sessions` table already exists. Verification tokens are 1.4's. Nothing is dropped, so `DESTRUCTIVE_SQL` stays clean.

**Operator CLI:** `corepack pnpm --filter @edmate/db db:grant-role -- --email <e> --role <student|teacher|staff> --by <staff-user-id|operator> [--reason <text>]`. It needs `DATABASE_URL` and runs `runGrantRoleCli` in `src/cli.ts`, plus `src/bin/grant-role.ts`. The first staff account is bootstrapped this way, and no HTTP endpoint grants roles in 1.3. Errors are redacted the same way `runMigrateCli` redacts them.

### Web: `apps/web/src/auth/`
- `env.ts`: `readAuthEnv(env)` uses Zod to parse `AUTH_SECRET` (32 or more characters), `AUTH_URL` (a URL; it decides secure cookies), and `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`. It is read **lazily** on the first auth call, never at module load, so `/api/health` and `next build` work without them. Error messages name the variable and never echo its value. Values are passed to Auth.js explicitly; we don't rely on its env inference.
- `adapter.ts`: `toAuthAdapter(identity)` maps the Auth.js `Adapter` methods that OAuth with database sessions needs onto the identity store. `createUser` copies only `email`, `emailVerified` and `name`; `image` is dropped, so the Google photo is never stored. `updateUser` passes only `emailVerified`. Methods outside that scope throw.
- `config.ts`: `createAuthConfig(deps)` is a pure factory, so tests inject the identity store, env and provider fetch. It sets:
  - `session.strategy: 'database'`, the Google provider, `allowDangerousEmailAccountLinking: false`.
  - A `signIn` callback that rejects a Google profile unless `email_verified === true` and an email is present.
  - A `session` callback that returns **only `{ user: { id, role } }`**. `/api/auth/session` is readable by the browser, so it carries no email or name.
  - Explicit cookie options: httpOnly, `sameSite: 'lax'`, `path: '/'`, and `secure` plus the `__Secure-` prefix iff `AUTH_URL` is https. The cookie must be Lax, not Strict, or the OAuth callback redirect breaks.
  - `useSecureCookies` follows `AUTH_URL`, not `NODE_ENV`, because compose runs `NODE_ENV=production` over http.
  - `trustHost` from `AUTH_TRUST_HOST` (Caddy forwards the host).
  - `debug: false`, and a `logger` that writes only the error name and code (Auth.js errors can carry emails and tokens).
- `index.ts`: lazily creates `NextAuth(createAuthConfig(...))` with `openDatabase().identity` and exports `handlers`, `auth`, `signIn`, `signOut`. `next-auth` is imported only from this folder (lint rule below).
- `policy.ts`: `ROUTE_POLICY`, an ordered list of `{ pattern, methods, access }`, where `access` is `'public' | 'provider' | Role[]`. Its rows are built from the API table: `/api/health`, `/api/auth/*` and `GET /api/teachers*` are public; `/api/webhooks/*` is `provider` (no session; signatures come with 10.x); `/api/subscriptions*`, `/api/sessions*` and `/api/me*` are `['student']`; `/api/studio/*` is `['teacher']`; `/api/staff/*` is `['staff']`. `policyFor(method, path)` returns `deny` when nothing matches. There is **no role inheritance** (Q4).
- `guard.ts`:
  - `withRole(roles, handler)` wraps a route handler. In order: an Origin check on unsafe methods (it must equal the `AUTH_URL` origin; `Sec-Fetch-Site: same-origin` is also accepted); principal lookup (no session gives 401 `unauthorized`; a role not in `roles` gives 403 `forbidden`); then the handler gets `{ principal: { userId, role } }`.
  - `publicRoute(handler)` and `providerRoute(handler)` (webhooks, no Origin check) only add the brand.
  - Every wrapper sets `cache-control: no-store` on its error responses.
  - A principal lookup that **throws** returns 500 `provider_error` (retryable). It is never treated as anonymous and never allowed.
  - `requireRole(roles)` for server components and server actions returns the principal, or calls `redirect('/api/auth/signin')` when anonymous and `notFound()` on a wrong role. Server actions keep Next's built-in Origin check.
  - The single `resolvePrincipal` function is the one place where 1.7 will later add its "age not confirmed → no access" check. 1.3 adds no gate there.
  - `getPrincipal` is injected, so tests need no Next runtime.
- `errors.ts`: `apiError(code, message, status)` gives `{ error: { code, message, retryable } }`, with `code` typed by the contracts' `ErrorCode`.
- `apps/web/app/api/auth/[...nextauth]/route.ts`: `GET` and `POST` are `publicRoute(handlers.GET/POST)`. `apps/web/app/api/health/route.ts` is wrapped in `publicRoute` too, and its test is unchanged.
- **No `proxy.ts`** (Next 16's middleware). Next's guidance is that proxy checks are optimistic and must not be relied on, and every route handler already enforces its own role. A proxy redirect for pages can come with the first gated pages (Q8).

### Lint
New `packages/config/eslint/app.js` preset: base plus `no-restricted-imports` banning `@edmate/db/internal`, and banning `next-auth`/`@auth/*` everywhere except `src/auth/**`. It is exported as `@edmate/config/eslint/app`, and `apps/web/eslint.config.js` uses it.

## Tests first (red, then green)
1. `apps/web/test/setup.ts`: global `fetch` always rejects (the 2.2 precedent). `vitest.config.ts` includes `src/**/*.test.ts`. Coverage covers `src/auth/**` with 100% lines/functions/statements and 90% branches.
2. `src/auth/guard.test.ts`, the matrix:
   - Policy × method × {anon, student, teacher, staff} gives 200, 401 or 403, with the error body checked against `ErrorCodeSchema`.
   - An unmatched path is denied.
   - A lookup that throws gives 500 and the handler never runs.
   - Unsafe methods with a missing, cross-site or `null` Origin give 403; same-origin passes; `providerRoute` skips the check.
   - `requireRole` redirects anonymous users and gives `notFound` on a wrong role.
3. `src/auth/route-coverage.test.ts`: every real `route.ts` export is branded and has a policy entry.
4. `src/auth/env.test.ts`, `config.test.ts` (cookies, strategy, the `signIn` email_verified rule, a session payload of `{id, role}` only, the logger never prints its input) and `adapter.test.ts` (a fake identity store; role, image and extra fields are dropped; OAuth tokens are dropped).
5. `src/auth/flow.test.ts`: the Google flow through Auth.js handlers, with injected OIDC endpoints and an in-memory identity store that has the store's interface:
   - The sign-in redirect carries state and PKCE.
   - The callback creates a student and sets the cookie.
   - A second sign-in reuses the user.
   - A `grantRole` is visible on the next request.
   - An unverified Google email is refused.
   - Sign-out deletes the session.
   - If the pinned version can't inject fetch, fall back to items 2–4 plus the db int test, and say so in the handoff.
6. `packages/db/test/identity.int.test.ts` (real Postgres):
   - `createStudent` forces the role.
   - Unique email and unique account.
   - A raw `select` shows only the token hash.
   - An expired session reads as `null`.
   - `deleteSession` works.
   - `grantRole` writes the role and the audit row in one transaction; a bad role is `invalid`; an unknown user is `not_found`.
   - Driver errors are scrubbed.

   `packages/db/test/grant-role-cli.test.ts` covers argument parsing and redacted failures.
7. `packages/config/test/app-preset.test.ts`: the restricted imports are reported.
8. `migrate.int.test.ts` is unchanged; it checks the new snapshot itself.

## Files
**Create:**
- `apps/web/src/auth/{env,adapter,config,index,policy,guard,errors}.ts` and their tests, `flow.test.ts`, `route-coverage.test.ts`
- `apps/web/app/api/auth/[...nextauth]/route.ts`, `apps/web/test/setup.ts`
- `packages/db/src/identity/{index,store,token-hash}.ts`, `README.md`
- `packages/db/src/schema/auth.ts`, `packages/db/src/bin/grant-role.ts`
- `packages/db/migrations/0003_*.sql` plus meta (drizzle-kit output)
- `packages/db/test/identity.int.test.ts`, `grant-role-cli.test.ts`
- `packages/config/eslint/app.js`, `packages/config/test/app-preset.test.ts`
- `docs/tasks/1.3/handoff.md` (builder)

**Modify:**
- `apps/web/package.json` (`next-auth` pinned, `@edmate/db`, `@edmate/contracts`, `zod` 4.6.7; `jose` as a dev dependency if needed), `vitest.config.ts`, `eslint.config.js`, `app/api/health/route.ts`
- `packages/db/src/{index,internal,cli}.ts`, `src/schema/{index,users}.ts`, `package.json` (`db:grant-role` script)
- `packages/config/package.json` (export)
- `docker/env.example` (`AUTH_SECRET=`, `AUTH_URL=http://localhost:8080`, `AUTH_TRUST_HOST=true`, `AUTH_GOOGLE_ID=`, `AUTH_GOOGLE_SECRET=`, all empty or dev-only, with a "never commit real values" note)
- `docker/compose.yaml` (pass through `AUTH_*` with empty defaults)
- `.claude/skills/merge-gate/risk-paths.txt` (Q5)
- `pnpm-lock.yaml`

**Out of bounds:**
- `packages/contracts/**`: no contract change. Roles come from the db `user_role` enum, and `ErrorCode` is reused.
- `packages/harness/**`
- `packages/db/src/repositories/**`: imported for the audit helper, not modified.
- The 1.4/1.5/1.7/8.1/12.1 scope listed above, sign-in UI pages, `proxy.ts`
- `.github/**`, `docs/adr/**`

## Risky paths touched
Every path was checked against `.claude/skills/merge-gate/risk-paths.txt` and the `SAFETY` prefixes in `merge_gate.py`:
- `apps/web/src/auth/**` → **security-reviewer**.
- `.claude/skills/merge-gate/risk-paths.txt` (`.claude/**`) → **security-reviewer**.
- Not matched today, but proposed for addition under the security-reviewer group (Q5): `packages/db/src/identity/**`, `apps/web/app/api/auth/**`.
- The migration is additive only (not destructive). **database-reviewer** is recommended for the schema and index shape, and **typescript-reviewer** for the Adapter typing.
- No safety paths, so no `safety-review.md` is needed.
- Every other path (`apps/web/app/api/health`, `apps/web/test`, `packages/db/src/schema`, `bin`, `cli`, `test`, `packages/config`, `docker/**`, `docs/tasks/1.3`) has no match.
- `review.md` should read `Reviewers: security-reviewer, database-reviewer, typescript-reviewer`.

**Planned `risk: high` handoff entry:**
> ### 1.3 Google sign-in with database sessions; roles change only by a server-side grant; deny-by-default route guard · decided by planner · risk: high
> Decided: Auth.js (pinned v5) with the Google provider, database sessions whose token is stored as a SHA-256 hash, and an identity store in `packages/db/src/identity/` (outside the scoped repositories). New users are always `student`, and only `grantRole` (operator CLI now, 12.1 later) changes a role, with an audit row. Every API route must be wrapped by `withRole`/`publicRoute`/`providerRoute` and match `ROUTE_POLICY`; an unmatched or unwrapped route is denied, and a test fails. There is no role inheritance. Unsafe methods need a same-origin `Origin`. Cookies are httpOnly, SameSite=Lax, and Secure when https. The session payload is `{id, role}` only. Google OAuth tokens and photos are not stored.
> Why: immediate revocation and role changes, no role in a client token, and one door for auth. Auth must read `users` and delete sessions, which repository rules 1, 7 and 9 forbid.
> Alternatives: JWT sessions (a stale role until expiry); `@auth/drizzle-adapter` on the schema (it writes `image` and needs nullable market/locale/role, and can't force the role); a proxy-only check (bypassable, and not recommended by Next).
> Reversible: yes. The session strategy and the store are behind `createAuthConfig` and `createIdentityStore`.

Other decisions to log (risk: low/medium): the `market: 'global'`/`locale: 'en'` defaults; no `proxy.ts`; 30-day / 24 h session timing; the `auth_` table prefix; audit scope for grants; the lint preset.

## Open questions (each has a recommendation; none blocks the build)
- **Q1. Auth.js version / Next 16.** Recommend: pin the newest v5 release whose peer range includes Next 16 (the builder verifies with docs-lookup first). If there is none, stop and ask (tech stack, ADR).
- **Q2. Market and locale at first sign-in** (both are NOT NULL). Recommend: `global` / `en`, never guessed from IP or headers. 1.7's country question sets the real market.
- **Q3. How roles are granted.** Recommend: the operator CLI only in 1.3, with the first staff account bootstrapped by it; HTTP grants arrive with 12.1. Audit rows use the target user as the `teacherId` scope (1.6 requires one) with actorRole `staff`, and an actor of `operator` for CLI grants that have no staff user.
- **Q4. Role inheritance.** Recommend: none. Staff aren't a superuser on student or teacher routes. With one role per user (the schema), a teacher who wants to learn uses a second account.
- **Q5. Extend risk-paths.txt** with `packages/db/src/identity/**` and `apps/web/app/api/auth/**` (security-reviewer). Recommend: yes, in this PR.
- **Q6. Don't store Google tokens or photo.** Recommend: yes; we never call Google APIs.
- **Q7. For the lead (not 1.3):** the decision log already records min-age as 13+ (country + birth year), but 1.7 still has `needs_decision: min-age` and an "18+" title. Consider updating the board.
- **Q8. No `proxy.ts` now.** Recommend: add an optimistic page redirect only when gated pages exist.

For 1.4: email sign-in with the same address as a Google user will reach the same user. Auth.js links email-provider sign-ins by verified address; 1.4 should confirm this and test it.

## READY
Nothing blocks the build. The only external unknown (Q1) is checked first, with a stop rule. No contracts change, no ADR.

Before the final push: merge `origin/main`, regenerate the lockfile if it conflicts, and re-run the gates.

## Lead answers (18 Oct 2026)

- Q1: pin next-auth v5 if a pinned release supports Next 16.4; if none does, stop and report BLOCKED (tech-stack change → the human).
- Q2–Q6: accepted as recommended (market `global` + locale `en` at first sign-in; roles granted only via an audited operator CLI; no role inheritance; add `packages/db/src/identity/**` and `apps/web/app/api/auth/**` to risk-paths.txt under security-reviewer; store no Google tokens or photos).
- Q7: the human decided 13+ (log 18 Oct 2026, "Minimum learner age"); the board is now synced. 1.3 builds no age gate (that's 1.7).
- Sessions: database sessions.
- Build after 3.2 merges (both touch packages/db; avoid clashing migrations). Before the final push: merge origin/main, regenerate the lockfile, renumber the migration if needed, re-run gates.
