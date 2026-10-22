# 9.2b: public /teachers discovery page, entry points, and request-level rate limiting

## Summary

Adds the public teacher search page (`apps/web`), server-rendered and anonymous-accessible:

- `apps/web/app/teachers/page.tsx`: parses and bounds the URL's `q`/`lang`/`page`, calls
  `repos.discovery.search` (9.2a), renders a card per teacher (name, subject, excerpt, languages,
  "Free package" badge), a plain `GET` search form, next/previous links that keep `q` and `lang`,
  and an empty state that echoes the query as text. A repository error propagates -- no
  `try/catch` turns it into "no teachers found" (scope decision 5). Nav shows "Sign in" for an
  anonymous visitor, or the visitor's own home link plus a sign-out button when signed in;
  `requireRole` is never called.
- `apps/web/app/page.tsx` (Q3): an anonymous visitor now lands on `/teachers` instead of
  `/sign-in`; student/teacher/staff routing is unchanged.
- `apps/web/app/home/view.tsx`: a "Find a teacher" nav link to `/teachers` (its label lives under
  the new `discovery` en.json key, not `home`, per the Files list).

Extra scope, deferred from 9.2a's security review: **request-level rate limiting** on the public
`/teachers` page.

- `apps/web/src/discovery/rateLimit.ts`: a fixed window per client IP bucket, 60 requests/minute
  default, counted with plain Redis `INCR`/`PEXPIRE` (lazily built on `REDIS_URL`, following the
  exact pattern `src/turn/runtime.ts` and `src/studio/runtime.ts` already use -- a lazily built
  `ioredis` client on an env var, not a client shared across modules). The client IP bucket is the
  **rightmost** `x-forwarded-for` entry, matching the sign-in limiter (changed from the first entry
  in the fix round -- see Decisions); a missing or unparseable entry goes to one shared `unknown`
  bucket. A store failure, or no `REDIS_URL`, **fails open** (the page still serves) and logs a
  code-only warning, never the IP (lead decision, risk: medium -- see Decisions). Over the limit,
  the page shows `discovery.rateLimited` ("Too many searches. Try again in a minute.") and never
  calls `repos.discovery.search`.

## Files

- `apps/web/src/discovery/searchParams.ts` (+ test) -- `parseDiscoveryParams`.
- `apps/web/src/discovery/rateLimit.ts` (+ test) -- the rate limiter (extra scope).
- `apps/web/src/discovery/TeacherCard.tsx`, `nav.ts` -- the card and the public nav (`nav.ts`
  imports `signOutAndRedirect` from `app/home/actions`, read-only).
- `apps/web/app/teachers/page.tsx` (+ `page.test.tsx`).
- `apps/web/messages/en.json` -- new top-level `discovery` key only (merged cleanly alongside
  main's unrelated `questionsInbox` key added since 9.2a).
- `apps/web/app/page.tsx` + `page.test.ts` -- anonymous -> `/teachers`.
- `apps/web/app/home/view.tsx` + `view.test.tsx` -- the one nav link.

No file outside this list, and no file under "Files out of bounds" in the task plan, was touched.
`apps/web/src/auth/**` was imported (not edited): `currentPrincipal`, `serverDatabase` from
`src/auth`, and the `signOutAndRedirect` action from `app/home/actions`.

## Tests

`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` -- 34/34 tasks green (after
building `@edmate/contracts`, `@edmate/content` and `@edmate/db` first, needed once per fresh
worktree). `@edmate/web`'s own run: 83 test files (82 passed, 1 pre-existing skip), 1202 tests
(1198 passed, 4 pre-existing skips); `src/discovery` coverage 88.1% statements / 90.5% branches /
78.6% functions / 88.0% lines (above the package's 80% global floor; the uncovered lines are the
real-Redis branch of `discoveryRateLimiter`'s lazy singleton, intentionally not exercised against
a live connection, lessons.md "no real model or payment calls in tests" extended here to "no real
Redis"). `python3 .githooks/secret-scan.py --all` -- clean.

`apps/web/src/discovery/rateLimit.test.ts` uses only a fake `RateLimitStore` and a fake `ioredis`
shaped object for `redisRateLimitStore`'s own unit test -- no real Redis anywhere.

## Manual timed run (left to do -- see below)

Not run in this build (no compose stack brought up, per the brief). Exact steps for the lead:

1. `docker compose -f docker/compose.yaml up -d` (postgres, redis).
2. `corepack pnpm --filter @edmate/db db:migrate`
3. `corepack pnpm --filter @edmate/db db:seed-discovery -- --fake-teachers 200`
4. `corepack pnpm --filter @edmate/web run build && corepack pnpm --filter @edmate/web run start`
5. 20 runs each, p50/p95/max via
   `for i in $(seq 20); do curl -s -o /dev/null -w '%{time_total}\n' "$URL"; done | sort -n`
   against `http://localhost:3000/teachers`, `/teachers?q=finance`,
   `/teachers?q=python+beginner`, `/teachers?lang=en`.
6. Paste the four p50/p95/max triples into this handoff; pass = p95 < 1 s (acceptance table, not a
   CI assertion).

## Decisions

### 22 Oct 2026 · 9.2b A Redis outage fails the discovery rate limit open, not closed · decided by lead · risk: medium
- Decided: unlike the sign-in limiter (fails closed, `src/auth/rate-limit.ts`), `discoveryRateLimiter` fails open on a store error or a missing `REDIS_URL`: the `/teachers` page still serves, and the failure is logged by code only (`rate_limit_unavailable`), never the client's IP.
- Why: this limit protects database load on data that's already public and already published (scope decision 1/2 of the 9.2 plan); refusing every search because Redis blipped would hurt real students more than an occasional burst of searches hurts the database.
- risk: medium (an attacker who can also knock out Redis loses the limit; accepted, since the data behind it is public by design).

### 22 Oct 2026 · 9.2b The rate limiter gets its own Redis client, not the sign-in limiter's connection · decided by builder · risk: low
- Decided: `src/discovery/rateLimit.ts` lazily builds its own `ioredis` client on `REDIS_URL`, the same way `src/turn/runtime.ts` and `src/studio/runtime.ts` already do, instead of reusing the connection `src/auth/index.ts`'s `emailSignIn()` opens internally.
- Why: that connection is never exported from `src/auth/**` (only `redisSignInCounters`/`createSignInLimiter`, which take a connection, are exported from `rate-limit.ts`, and `index.ts` itself exports no client), and the brief explicitly forbids editing `auth/**` to add one. "The client the sign-in limiter already uses" is read here as the established pattern (ioredis + `REDIS_URL`, read-only reused), not a shared connection object -- every other Redis-using module in `apps/web` already opens its own client the same way.
- risk: low (an extra Redis connection, same as `turn/runtime.ts` and `studio/runtime.ts` each already open their own).

### 22 Oct 2026 · 9.2b The rate limit's client bucket uses the rightmost x-forwarded-for entry · decided by lead · risk: low
- Decided: `discoveryClientBucket` takes the rightmost (Caddy-appended) `x-forwarded-for` entry, mirroring the sign-in limiter's `clientIp`, and sends a missing, empty or non-IP entry to one shared `unknown` bucket. The lead's brief first asked for the first entry; the fix round changed it to the rightmost.
- Why: the security review (HIGH) found the first entry is client-controlled, so a caller could rotate a fake first value to get unlimited buckets. The logic is mirrored, not imported, so this module doesn't pull in the sign-in limiter's `@edmate/queue` dependency and `src/auth/**` is untouched.
- risk: low

## Left to do

- The manual timed run (acceptance table, p95 < 1 s) -- steps above; needs the compose stack, which this build did not bring up.
- Nothing else outstanding for Phase B's own scope. Phase C (teacher page, packages, scorecard) is a separate task and depends on this one being merged.

Status: DONE

Tool calls used: 64

## Fix round

- [HIGH, security-reviewer] `discoveryClientBucket` bucketed on the first, client-controlled `x-forwarded-for` entry. Now it uses the rightmost (proxy-appended) entry, like `src/auth/rate-limit.ts`; logic mirrored, `src/auth/**` not edited.
- Tests first (red, then green) in `apps/web/src/discovery/rateLimit.test.ts`: `<fake>, <real>` lands in the same bucket as `<real>` alone; rotating the fake first entry keeps one bucket and the limit still bites; missing, empty, trailing-comma and non-IP rightmost entries go to `unknown`.
- Decision "first x-forwarded-for entry" replaced by "rightmost x-forwarded-for entry" (see Decisions).
- MEDIUM/LOW findings deferred to 9.2e.
- Evidence: `corepack pnpm vitest run src/discovery/rateLimit.test.ts` → `Tests 17 passed (17)`; `turbo run typecheck lint test --filter=@edmate/web...` green; secret scan clean.

Status: DONE
