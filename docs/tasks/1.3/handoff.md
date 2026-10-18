# 1.3 handoff: Auth.js Google sign-in; roles student, teacher, staff; RBAC middleware

Status: DONE
Branch: `m1/1.3-auth`
Worktree: `.claude/worktrees/agent-a9e5d3b87c7d41524` (under the repo root)

## Acceptance evidence

Node 22.22.3 (nvm), pnpm via corepack. Postgres from
`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`
(on port 55433 with `TEST_DATABASE_URL`), stopped afterwards. Everything below was run after
merging origin/main (2.4 metering, 3.2 admit/entitle), with the migration renumbered to 0004.

**Version check (done first).** `npm view next-auth dist-tags`: `latest` 4.24.15, `beta`
5.0.0-beta.32 (20 Jul 2026). There is no stable v5. `npm view next-auth@5.0.0-beta.32
peerDependencies` gives `next: ^14.0.0-0 || ^15.0.0 || ^16.0.0` and `react: ^18.2.0 || ^19.0.0`,
so it accepts next 16.4.2 and react 19.3.1. It pins `@auth/core` 0.41.3, which exports
`customFetch` (and `next-auth` re-exports it). Pinned exactly: `"next-auth": "5.0.0-beta.32"`.

| Part | Evidence |
|---|---|
| Role × route matrix | `apps/web/src/auth/guard.test.ts` (67 tests). Covers every `ROUTE_POLICY` row × GET/POST/PUT/PATCH/DELETE × {anonymous, student, teacher, staff}. Allowed calls return 200. With no session the result is 401 `unauthorized`. A wrong role, or a method the row doesn't list, is 403 `forbidden`. Every error body is checked against `ErrorCodeSchema`, has exactly `{code,message,retryable}` and sends `cache-control: no-store`. Printed table: `[role x route matrix] 46 rows`, e.g. `POST /api/subscriptions anonymous=401 student=200 teacher=403 staff=403`, `GET /api/studio/x/y anonymous=401 student=403 teacher=200 staff=403`, `GET /api/staff/x/y anonymous=401 student=403 teacher=403 staff=200`, `PATCH /api/studio/x/y anonymous=403 student=403 teacher=403 staff=403`, `GET /api/health anonymous=200 … staff=200`. Unmatched paths (`/api/unknown`, `/api/studio`, `/api/staffx/reports`, trailing slash, `//`, encoded `/` `\`, `/elsewhere`) are denied for every role. A wrapper whose roles disagree with the policy is 403. A lookup that throws is 500 `provider_error` (retryable), and the handler never runs. |
| Deny by default for real routes | `src/auth/route-coverage.test.ts`: walks every `app/api/**/route.ts`, imports it, and asserts that each exported HTTP method carries the `GUARD` brand and that the brand equals `policyFor(method, samplePath)`. Covers `/api/health` and `/api/auth/[...nextauth]` today. |
| Google sign-in with a mocked provider | `src/auth/flow.test.ts` (11 tests) runs through Auth.js's real `handlers`. Google discovery, JWKS and token endpoints are a fake (`customFetch`) that signs id_tokens with a `jose` RS256 test key. `test/setup.ts` makes the global fetch reject, and one test asserts it was never called. Tested: the redirect carries state, nonce and S256 PKCE; a POST without CSRF is refused (`error=MissingCSRF`); the first sign-in creates `student` usr_1 with an httpOnly, SameSite=Lax, Path=/ cookie; a second sign-in reuses the user; a grant is visible on the next request and the guard follows it (studio 200, /api/me 403); an unverified Google email is `AccessDenied` and creates nothing; an existing email is `OAuthAccountNotLinked` and no link is made; a bad code gives no session; sign-out deletes the session. |
| Roles never self-assigned | `adapter.test.ts`: `createUser` passes only `{email, emailVerifiedAt, name}`, so `role`, `image`, `market` and a chosen id are dropped. `updateUser` only records `emailVerified`. `identity.int.test.ts` (Postgres): `createStudent` writes `student`/`global`/`en`. A `role`, `market` or `image` field is `invalid`. `grantRole` writes the role plus `audit_log` row `{actor: operator, actor_role: staff, action: role.grant, target: user:<id>, teacher_id: <id>, before {role: student}, after {role: staff}}`. When the audit insert fails (trigger) the role rolls back. A bad role, actor or extra field is `invalid`, an unknown user is `not_found`, and nothing is written. |
| CSRF and cookies | `config.test.ts`: over http the cookie is `authjs.session-token` with `{httpOnly, sameSite: 'lax', path: '/', secure: false}`. Over https it is `__Secure-authjs.session-token` with `secure: true` (follows `AUTH_URL`). `guard.test.ts`: POST/PATCH/DELETE/PUT with a missing, `null`, foreign or wrong-port Origin, or a foreign Origin plus `Sec-Fetch-Site: same-origin`, is 403 before the session is read. Same-origin passes by Origin or by Sec-Fetch-Site, and `providerRoute` skips the check. Auth.js's CSRF token stays on (flow test). |
| Secrets from env only | `env.test.ts` (10 tests): a missing, blank or short `AUTH_SECRET`, a bad `AUTH_URL`, or a missing Google id or secret throws `AuthConfigError` that names the variable and never the value. `index.test.ts`: the module imports with no `AUTH_*` or `DATABASE_URL`, and a guarded route then returns 500 rather than treating the caller as anonymous. `docker/env.example` has empty `AUTH_SECRET=`, `AUTH_GOOGLE_ID=` and `AUTH_GOOGLE_SECRET=`. |
| No `@edmate/db/internal` in apps | `packages/config/eslint/__tests__/app-preset.test.ts` (8 tests): `lintText` reports `@edmate/db/internal` (also type-only, re-export and deep `dist/` paths) in `apps/web/app/**` and in `src/auth/**`. It reports `next-auth`, `next-auth/*` and `@auth/core` outside `src/auth` and allows them inside. |
| Gates | `TEST_DATABASE_URL=… corepack pnpm turbo run build typecheck lint test --force` (whole repo) → `Tasks: 41 successful, 41 total`. web `Tests 126 passed (126)`, db `329 passed (329)` (identity.int 19, grant-role-cli 14, migrate.int with 0004), config `42 passed`, contracts 282, harness 308, gateway 264, evals 103, cli 29, worker 24. |
| Coverage | web `All files 100/100/100/100`, and every `src/auth/*.ts` file is 100/100/100/100 (threshold for `src/auth/**`: 100 lines/functions/statements, 90 branches). db `src/identity/store.ts` and `token-hash.ts` are 100/100/100/100 (threshold 100/100/90/100 when Postgres is up). `cli.ts` 100 % lines; its one uncovered branch is the old migrate CLI's non-Error case. |
| next build | `next build` → `✓ Compiled successfully`, routes `ƒ /api/auth/[...nextauth]` and `ƒ /api/health`. |
| /api/health with no AUTH_* | Standalone server (`node apps/web/.next/standalone/apps/web/server.js`, `NODE_ENV=production`, no `AUTH_*`, no `DATABASE_URL`): `GET /api/health` → `200`, `cache-control: no-store`. `GET /api/auth/providers` → 500, logged as `Error [AuthConfigError]: AUTH_SECRET is not set` (no values). With the env set: providers → `{"google":…}`, session → `null`, health → 200. I did not rebuild the compose image; `docker compose config` shows the web service gets the `AUTH_*` values with empty defaults. |
| Format | `prettier --check .` flags only `.github/workflows/ci.yml`, which this branch doesn't touch and which is the same on main. |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0, no output. Fake test secrets are built at runtime (`'test-only-'.padEnd(40,'x')`, `randomUUID()`). |
| Contracts | `packages/contracts/**` untouched. Roles come from the db `user_role` enum; `ErrorCode` is reused. |

## Changes

Web (`apps/web`):
- `src/auth/env.ts`: `readAuthEnv`, read lazily.
- `src/auth/errors.ts`: `apiError`.
- `src/auth/policy.ts`: `ROUTE_POLICY`, `policyFor`, `sameAccess`. No inheritance, deny by default, HEAD treated as GET.
- `src/auth/guard.ts`: `createGuard` → `withRole` / `publicRoute` / `providerRoute` / `requireRole`, the `GUARD` brand and `resolvePrincipal` (where 1.7's age check will go).
- `src/auth/adapter.ts`: `toAuthAdapter`.
- `src/auth/config.ts`: `createAuthConfig`, `principalFromIdentity`, `sessionCookieName`.
- `src/auth/index.ts`: lazy runtime; exports `handlers`, `signIn`, `signOut` and the guards.
- `app/api/auth/[...nextauth]/route.ts`: new route.
- `app/api/health/route.ts`: now wrapped in `publicRoute`; its test is unchanged.
- `test/setup.ts`: the global fetch rejects and `AUTH_*` is cleared.
- `test/memory-identity.ts`: in-memory store for the web tests.
- `vitest.config.ts`: includes `src/**`, runs the setup, inlines `next-auth` and adds coverage thresholds.
- `eslint.config.js`: uses `@edmate/config/eslint/app`.
- `package.json`: adds `next-auth` 5.0.0-beta.32, `@edmate/db`, `@edmate/contracts`, `zod` 4.6.7, and dev `jose` 6.2.12.

DB (`packages/db`):
- `src/schema/auth.ts`: `auth_accounts` and `auth_sessions`.
- `users.email_verified_at`.
- `migrations/0004_auth_identity.sql` plus meta, generated by drizzle-kit. It is additive only, with no DROP, DELETE or UPDATE.
- `src/identity/{store,token-hash,index}.ts` and `README.md`: the identity store and its rules.
- `src/index.ts`: exports the identity store, and `openDatabase()` now returns `{ repos, identity, close }`.
- `src/cli.ts`: `runGrantRoleCli`. `src/bin/grant-role.ts` is the entry point and the `db:grant-role` script runs it.
- `src/migrate.ts`: `MIGRATIONS_DIR` now uses `path.join` (see Deviations).
- Tests: `identity.int.test.ts`, `grant-role-cli.test.ts`. `helpers.ts`'s table list gains the two `auth_` tables, and `repositories.int.test.ts`'s `openDatabase` key assertion now expects `identity`.
- `vitest.config.ts`: identity coverage is enforced when Postgres is up and excluded otherwise, like the repositories.

Config:
- `packages/config/eslint/app.js` with its test.
- New `./eslint/app` export.

Ops:
- `docker/env.example`: sign-in section with empty placeholders and the grant-role bootstrap command.
- `docker/compose.yaml`: web gets `AUTH_*` with empty or dev defaults; the worker gets none.
- `.claude/skills/merge-gate/risk-paths.txt`: `apps/web/app/api/auth/**` and `packages/db/src/identity/**` added under security-reviewer (Q5).
- `pnpm-lock.yaml`.

Reviewers needed (risk paths `apps/web/src/auth/**`, `apps/web/app/api/auth/**`, `packages/db/src/identity/**`, `.claude/**`): security-reviewer. Also recommended: database-reviewer (schema and indexes) and typescript-reviewer (Adapter typing). No safety paths were touched.

## Deviations

1. **next-auth v5 exists only as a beta.** The pinned release is `5.0.0-beta.32`. It is the only v5 line, and its peer range includes Next 16. The lead's rule was "a pinned release supports Next 16.4", and this one does. See Decisions.
2. **Migration renumbered to `0004_auth_identity`.** 2.4 merged `0003_usage_ledger_metering` first. I regenerated with drizzle-kit on top of main's snapshot, so the SQL contains only this task's changes.
3. **`packages/db/src/migrate.ts` changed by one line.** `new URL('../migrations', import.meta.url)` broke `next build`: Turbopack treats it as an asset import and can't resolve a directory. It now uses `join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')`, which gives the same path. migrate.int still passes.
4. **`auth` is not exported from `src/auth`.** Its server-side session merges the full user (email, name). Server components use `requireRole` instead. `signIn` and `signOut` are exported for server actions.
5. **The session JSON is `{ user: { id, role }, expires }`.** Auth.js's `Session` type needs `expires`. No email, name or image is included.
6. **Google users keep `email_verified_at = null`.** Auth.js always passes `emailVerified: null` for OAuth sign-ups. The `signIn` callback is what requires Google's `email_verified === true`.
7. **Test file locations.** The preset test is `packages/config/eslint/__tests__/app-preset.test.ts`, next to the existing harness-purity test, not `packages/config/test/`. Small test-only edits were also needed in `packages/db/test/helpers.ts` and `repositories.int.test.ts`.
8. **`withRole` checks `ROUTE_POLICY` at request time.** If its roles don't match the row, the request is 403. `publicRoute` and `providerRoute` only add the brand, as planned, so `GET()` in the health test keeps working; the coverage test checks them.
9. **No `docker compose up --build` run.** The health check ran on the standalone server with `NODE_ENV=production` instead.

## Decisions

### 18 Oct 2026 · 1.3 Google sign-in with database sessions; roles change only by a server-side grant; deny-by-default route guard · decided by planner, accepted by team lead · risk: high
Decided:
- **Sign-in.** Auth.js (next-auth pinned at 5.0.0-beta.32) with Google only. The provider checks state, nonce and PKCE, and `allowDangerousEmailAccountLinking` is false.
- **Sessions.** Database sessions with 30-day expiry, refreshed daily. Only the SHA-256 of the cookie token is stored, in `auth_sessions`.
- **Identity store.** A separate store in `packages/db/src/identity/`, outside the scoped repositories. It returns identity fields only.
- **Roles.** New users are always `student`. Only `grantRole` changes a role: the `db:grant-role` operator CLI now, 12.1 later. Each grant writes an audit row in the same transaction.
- **Route guard.** Every API route export must be wrapped by `withRole`, `publicRoute` or `providerRoute`, and its access must match `ROUTE_POLICY`. An unmatched path is denied at runtime, and an unwrapped or mismatched export fails `route-coverage.test.ts`. There is no role inheritance.
- **Origin.** Unsafe methods need a same-origin `Origin` (or `Sec-Fetch-Site: same-origin`).
- **Cookies.** httpOnly, SameSite=Lax, path `/`, and Secure with the `__Secure-` prefix when `AUTH_URL` is https.
- **Browser session JSON.** `{ user: { id, role }, expires }` only.
- **Stored data.** No Google OAuth tokens and no photos are stored.

Why:
- Role changes and revocation apply at once.
- No role sits in a client-held token.
- Sign-in has one door.
- Auth must read `users` and delete sessions, which repository rules 1, 7 and 9 forbid.

Alternatives:
- JWT sessions: the role stays stale until the token expires.
- `@auth/drizzle-adapter`: it writes `image`, needs nullable market, locale and role, and can't force the role.
- A proxy-only check: it can be bypassed, and Next doesn't recommend it.

Reversible: yes. `createAuthConfig` and `createIdentityStore` sit behind interfaces, and the migration is additive.

### 18 Oct 2026 · 1.3 next-auth 5.0.0-beta.32 pinned (v5 has no stable release) · decided by builder (tdd-guide) under the lead's Q1 rule · risk: medium
Decided: Pin `next-auth` exactly at `5.0.0-beta.32`. Its peer range is `next ^16` and `react ^19`, and it bundles `@auth/core` 0.41.3 with `customFetch`. Vitest inlines `next-auth` because it imports `next/server` without an extension.
Why: The tech stack names Auth.js, and v5 is the only line that supports the App Router on Next 16. v4 (`latest`) is the old API.
Alternatives: next-auth 4.24.15; bare `@auth/core`, or Better Auth, either of which needs an ADR.
Reversible: yes. Bump the pin once a stable v5 ships.

### 18 Oct 2026 · 1.3 First sign-in sets market `global` and locale `en` · decided by team lead (Q2) · risk: low
Decided: `createStudent` hard-codes `market: 'global'` and `locale: 'en'`. Neither is ever guessed from IP or headers; 1.7's country question sets the real market.
Why: Both columns are NOT NULL, and guessing from IP is unreliable and privacy-hostile.
Alternatives: Make the columns nullable, or infer from `Accept-Language`.
Reversible: yes.

### 18 Oct 2026 · 1.3 Role grants are audited with the target user as scope · decided by team lead (Q3) · risk: medium
Decided: The audit row for `grantRole` has:
- actor: the staff user id, or `operator` for the CLI
- actorRole: `staff`
- action: `role.grant`
- target: `user:<id>`
- teacherId scope: the target user (1.6 requires a teacher scope)
- before/after: `{ role }`

The first staff account is bootstrapped with `db:grant-role --by operator`. There is no HTTP grant endpoint in 1.3.
Why: Every audit row needs a teacher scope, and a role change belongs to the user it changes.
Alternatives: A separate role-grant table; an HTTP endpoint now.
Reversible: yes.

### 18 Oct 2026 · 1.3 Google sign-in checks state + nonce + PKCE · decided by builder (tdd-guide) · risk: low
Decided: Set `checks: ['pkce', 'state', 'nonce']` on the Google provider.
Why: Auth.js 0.41 defaults to PKCE only, and the plan's acceptance needs state on the redirect. Nonce adds id_token replay protection.
Alternatives: The default (PKCE only).
Reversible: yes.

### 18 Oct 2026 · 1.3 Small choices: tables, timing, proxy, lint, exports · decided by builder (tdd-guide) on the plan · risk: low
Decided:
- **Tables.** Tables are prefixed `auth_`, because the learning `sessions` table already exists.
- **Session timing.** 30-day sessions, refreshed after 24 h.
- **No proxy.** No `proxy.ts`; each route handler enforces its own role (Q8).
- **Lint.** A new `@edmate/config/eslint/app` preset bans `@edmate/db/internal` in apps, and bans `next-auth` / `@auth/*` outside `src/auth/**`.
- **Exports.** `auth` is not exported from `src/auth`: server components use `requireRole`.
- **Email verification.** Google users keep `email_verified_at` null, because Auth.js passes null for OAuth and the `signIn` callback enforces Google's `email_verified`.
- **Migrations path.** `MIGRATIONS_DIR` uses `path.join` so Turbopack can build the web app.

Why: These follow the plan's recommendations, and they keep the build and the guard simple.
Alternatives: As listed in the plan.
Reversible: yes.
