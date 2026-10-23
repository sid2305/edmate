# 1.4b plan: magic-link hardening before the pilot — a confirm page and a same-browser binding cookie

Board: `board.py show 1.4b` · milestone M13 · deps: 1.4 (done) · branch `m13/1.4b-magic-link-confirm` ·
risk: **risky** (`apps/web/src/auth/**`, `apps/web/app/api/auth/**`).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "Magic-link hardening before the pilot (1.4 plan Q3): bind the link to the requesting browser
with a cookie and add a confirm page, so link scanners and login CSRF on the GET callback can't sign
a user in."
Accept: "a link opened in a different browser or by a prefetching scanner does not sign in; the
confirm page posts with CSRF; auth tests pass."

### How it is shown (paste into handoff.md)
| Part | Evidence |
|---|---|
| A link opened in a different browser/scanner does not sign in | `confirm.test.ts`: `verifyLinkBindingCookieValue` rejects a missing, malformed or wrong-secret cookie. `page.test.tsx`: with no matching cookie, the page renders the manual "Sign in as …" form and never calls `redirect()`. `signin-email-route.test.ts`: the binding cookie is set on every `/api/auth/signin/email` POST, pass or fail, so its mere absence (a different browser, or a scanner that never POSTed) is the only thing the check can see — no enumeration signal. |
| The confirm page posts with CSRF | `actions.test.ts`: `confirmEmailSignIn` is a Next.js Server Action (`'use server'`), the same mechanism `signInWithGoogle` already relies on for its own CSRF protection (Next validates the action's Origin itself); the form in `page.tsx` is a real `<form action={confirmEmailSignIn}>`, not a plain link or a GET form. |
| Same browser, no extra click | `page.test.tsx`: with a valid matching cookie, the page calls `redirect()` straight to the real Auth.js callback URL, no form shown. |
| The link itself no longer points at the real callback | `email.test.ts`: `rebuildLink` now rebuilds onto `/sign-in/confirm`, keeping the forged-host and wrong-path checks. `email-flow.test.ts`: the mailed link's `pathname` is `/sign-in/confirm`; following it the old way (a bare GET on the real Auth.js callback) still finishes sign-in exactly as 1.4 left it — Auth.js's own token/session/rate-limit mechanics are untouched. |
| Auth tests pass | `corepack pnpm turbo run build typecheck lint test --filter=@edmate/web...`. |

## Design (MVP: the smallest change that meets the accept line)

### Why a page in front of the callback, not a check inside it
Checked in the installed `@auth/core@0.41.3` source
(`@auth/core/lib/actions/callback/index.js`): for `provider.type === 'email'`, the GET (and POST)
callback action calls `adapter.useVerificationToken(...)` — which deletes the row — **before** our
`signIn` callback ever runs. By the time `config.ts`'s `signIn` callback could refuse anything, the
single-use token is already gone. So the only way to stop a bare GET (a scanner, a different
browser) from finishing sign-in is to stop the mailed link from reaching
`/api/auth/callback/email` at all until a same-browser cookie check, or an explicit click, has
happened. `apps/web/app/api/auth/**` and `config.ts`'s `signIn` callback are otherwise untouched.

### The pieces
1. **The mailed link changes target.** `email.ts`'s `rebuildLink` keeps its existing checks (the
   path must be the real Auth.js email callback; a forged host is rebased onto `AUTH_URL`) but
   then rebuilds the link onto a new page, `CONFIRM_PATH = '/sign-in/confirm'`, carrying the same
   query (`token`, `email`, `callbackUrl`) Auth.js generated. No token is consumed by mailing it.
2. **A same-browser binding cookie**, set on every `/api/auth/signin/email` POST response (pass,
   fail or rate-limited alike, so its presence carries no enumeration signal): a new, narrow route
   `app/api/auth/signin/email/route.ts` calls the real `handlers.POST`/`handlers.GET` unchanged,
   then (POST only) appends one more `Set-Cookie`: a random nonce plus
   `HMAC-SHA256(AUTH_SECRET, "linkbound:" + nonce)`, httpOnly, `SameSite=Lax`, `__Host-` prefixed
   when secure, `Max-Age` = the link's own 15 minutes. It proves only "this browser POSTed an
   email sign-in request recently" — it is not tied to one address or one token, which keeps it
   simple and still answers the accept line (a scanner or a different browser never POSTed, so it
   never has this cookie).
   Next.js resolves this literal route ahead of the `[...nextauth]` catch-all for this one path;
   every other Auth.js path (`/api/auth/callback/**`, `/api/auth/session`, …) is unaffected.
3. **The confirm page**, `app/sign-in/confirm/page.tsx` (plain English strings, no `next-intl`, see
   Q1): reads `token`/`email`/`callbackUrl` from `searchParams` and asks `src/auth`'s
   `confirmSignInView(params)` for one of three views:
   - `invalid` (malformed/missing params): a generic "This link isn't valid any more — ask for a
     new one" message, linking to `/sign-in`.
   - `auto` (binding cookie present and valid): `redirect(url)` straight to the real
     `/api/auth/callback/email?...` URL — same browser, no extra click, same experience as before
     1.4b.
   - `manual` (no matching cookie): "Sign in to Edmate as **<email>**?" with one button, a
     `<form action={confirmEmailSignIn}>` (the Server Action in `actions.ts`) carrying the same
     three fields as hidden inputs. Submitting it is the only way this browser can finish sign-in.
4. **`src/auth`'s new pure module, `confirm.ts`**: the cookie's name/create/verify functions, a
   Zod-validated `parseConfirmParams`, and `buildEmailCallbackUrl(origin, params)` which rebuilds
   `/api/auth/callback/email?token=...&email=...&callbackUrl=...` on `AUTH_URL`'s origin using the
   `URL`/`URLSearchParams` APIs throughout (never raw string splicing), so nothing is double- or
   under-encoded across the two hops. `token` is checked against Auth.js's own
   `randomString(32)` shape (64 lowercase hex characters; the regex accepts 32–128 to tolerate a
   future length change) before it is ever handed back to Auth.js.
5. **`index.ts`** exposes three thin, env-backed wrappers (matching the existing
   `ageGateView`/`submitAgeAnswer` pattern, so the page and action stay pure renderers):
   `confirmSignInView(params)`, `confirmEmailSignIn(fields)` (used by the Server Action; returns a
   URL to redirect to, or `null` for an invalid resubmission), and `linkBindingCookie()` (used by
   the new route to get the name/value/maxAge/secure to set).

### A risk the builder confirms first, with a fallback
The new route reconstructs the real Auth.js response (`new NextResponse(res.body, { status:
res.status, headers: res.headers })`) and appends one cookie via `.cookies.set(...)`, rather than
rebuilding the response from scratch, so Auth.js's own cookies (if any) survive untouched. **Write
the test for this first** (two cookies in, two-plus-one out via `getSetCookie()`): if passing a
`Headers` instance this way collapses multiple `set-cookie` entries into one, fall back to copying
every header except `set-cookie` normally and appending each of `res.headers.getSetCookie()`
individually before adding the new one.

### What stays exactly as it was
`apps/web/app/api/auth/[...nextauth]/route.ts`, `config.ts`'s `signIn`/`redirect` callbacks,
`rate-limit.ts`, `mail.ts`, the token store (`packages/db/src/identity/**`), and every other 1.4
path. No env var, no migration, no ADR: this is app-level routing and a cookie, not a tech-stack or
contract change.

## Phases
Two phases keep each builder's file count near the project's own sizing guidance; both stay on one
branch, each ends green with its own commit, and the PR opens after Phase B.

### Phase A: pure logic, no new routes or pages (~35 calls)
Tests first:
- `confirm.test.ts`: `createLinkBindingCookieValue`/`verifyLinkBindingCookieValue` round-trip; a
  wrong secret, a truncated value, a missing value and a non-hex value all fail closed;
  `parseConfirmParams` accepts a well-formed `{token, email, callbackUrl}` and refuses a missing
  token, a non-hex token, a missing email, an array value (Next can hand back `string[]` for a
  repeated query key) and an over-length email; `buildEmailCallbackUrl` rebuilds the exact
  `/api/auth/callback/email?...` URL on the given origin and returns `null` for invalid input.
- `email.test.ts`: update `rebuildLink`'s "keeps the path and query" and "rebases a forged host"
  cases to expect `/sign-in/confirm?...` instead of `/api/auth/callback/email?...`; the "throws on a
  path other than the email callback" cases are unchanged (they still check Auth.js's own URL
  before rewriting it).
- `email-flow.test.ts`: update `lastLink()`-based assertions. The mailed link's `pathname` is now
  `/sign-in/confirm`; extract `token`/`email`/`callbackUrl` from its query and call the real
  `/api/auth/callback/email` directly with them to finish exercising Auth.js's own session,
  single-use-token, rate-limit and enumeration behaviour exactly as 1.4 tested it (that machinery
  is untouched by this task). Add one assertion that the mailed link's path is `/sign-in/confirm`.
- `index.test.ts`: add cases for `confirmSignInView` (invalid params → `invalid`; valid params with
  a matching cookie → `auto` with the right URL; valid params with no/forged cookie → `manual` with
  the right email/token/callbackUrl) and `confirmEmailSignIn` (valid fields → a URL; invalid → `null`).
Then: write `confirm.ts`; edit `email.ts` (`CONFIRM_PATH`, `rebuildLink`); edit `index.ts` (import
`./confirm`, add the three exports).
Gates: `turbo run build typecheck lint test --filter=@edmate/web...`.
**State after A:** the cookie, the parsing/URL-building and the three `src/auth` exports exist and
are fully tested; mailed links already point at `/sign-in/confirm`, which doesn't exist as a page
yet (a 404 if anyone followed one) — acceptable mid-build, not merged.

### Phase B: the route and the page (~35 calls)
Tests first:
- `app/api/auth/signin/email/route.test.ts`: GET passes through to `handlers.GET` unchanged; POST
  passes through to `handlers.POST` and the response carries every original header **plus** one new
  `Set-Cookie` (name, `HttpOnly`, `SameSite=Lax`, `Secure` following env, `Path=/`, the right
  `Max-Age`), proven with `res.headers.getSetCookie()`, including the two-cookies-in case from the
  Phase A risk note above.
- `app/sign-in/confirm/page.test.tsx` (`@vitest-environment jsdom`, mocking `confirmSignInView` from
  `../../../src/auth` and `redirect` from `next/navigation`, following `sign-in/page.test.tsx`'s
  pattern): `invalid` renders the generic message and a link back to `/sign-in`; `auto` calls
  `redirect(url)` with the exact URL and renders nothing else; `manual` renders the address, a
  `<form>` whose `action` is the mocked `confirmEmailSignIn`, and a submit button; an axe check on
  the `manual` view.
- `app/sign-in/confirm/actions.test.ts`: `confirmEmailSignIn(formData)` calls the mocked
  `src/auth`'s `confirmEmailSignIn` with the three fields and redirects to its result; an invalid
  result redirects to `/sign-in`.
Then: write `route.ts`, `page.tsx`, `actions.ts`.
Gates: the full `turbo run build typecheck lint test --filter=@edmate/web...`; `next build`
succeeds (proves the new route and page compile under the real Next build); secret scan clean.
Write `docs/tasks/1.4b/handoff.md` with the evidence table above and the `## Decisions` entry
below.

## Files
**Create:**
- `apps/web/src/auth/confirm.ts`, `apps/web/src/auth/confirm.test.ts`
- `apps/web/app/api/auth/signin/email/route.ts`, `apps/web/app/api/auth/signin/email/route.test.ts`
- `apps/web/app/sign-in/confirm/page.tsx`, `apps/web/app/sign-in/confirm/page.test.tsx`
- `apps/web/app/sign-in/confirm/actions.ts`, `apps/web/app/sign-in/confirm/actions.test.ts`
- `docs/tasks/1.4b/handoff.md` (builder)

**Modify:**
- `apps/web/src/auth/email.ts` (`CONFIRM_PATH`, `rebuildLink`), `apps/web/src/auth/email.test.ts`
- `apps/web/src/auth/email-flow.test.ts`
- `apps/web/src/auth/index.ts` (three new exports), `apps/web/src/auth/index.test.ts`

**Out of bounds:**
- `apps/web/app/api/auth/[...nextauth]/route.ts`, `apps/web/src/auth/config.ts`,
  `apps/web/src/auth/rate-limit.ts`, `apps/web/src/auth/mail.ts`, `apps/web/src/auth/age.ts`,
  `apps/web/src/auth/guard.ts`, `apps/web/src/auth/policy.ts` (ROUTE_POLICY's existing
  `/api/auth/**` row already covers the new route; no policy change needed)
- `apps/web/src/auth/env.ts` (no new env var)
- `packages/db/**`, `packages/contracts/**`, `packages/harness/**`, `packages/queue/**`
- `docker/**`, `.github/**`, `docs/adr/**`
- phone OTP, Google↔email linking (1.4c), the sign-in page's own styling beyond this one new page

## Tests first
Order is per phase above. Across both: addresses are only `*@example.test`; the global fetch
rejects and no socket opens (existing `test/setup.ts`); fake secrets are built at runtime.

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `apps/web/src/auth/**` (`confirm.ts`, `email.ts`, `index.ts` and their tests) → **security-reviewer**
- `apps/web/app/api/auth/**` (`app/api/auth/signin/email/route.ts` and its test) → **security-reviewer**
- No match: `apps/web/app/sign-in/confirm/**` (page, actions, tests) — not under `src/auth` or
  `app/api/auth`, and not payments/webhooks/staff/identity/gateway/repositories. It is reviewed
  anyway as part of the same feature, but the gate doesn't require a named reviewer for it.
- Not touched: `packages/contracts/**`, `docs/adr/**`, `.claude/**`, `.github/**`, every safety
  path (`packages/harness/src/guardrails/**` etc.), `packages/db/**`.
- `review.md` should read `Reviewers: security-reviewer, typescript-reviewer`. security-reviewer is
  required for both matched groups; typescript-reviewer is recommended for the new `NextResponse`
  header-copy code and the `Record<string, unknown>` parsing in `confirm.ts`.
- The handoff logs the `risk: high` entry below (the board already marks this task risky).

## Decisions (draft, for the handoff)

### 1.4b A confirm page and a same-browser binding cookie stop a bare GET from finishing sign-in · decided by planner · risk: high
Decided:
- Mailed links now point at a new page, `/sign-in/confirm`, instead of straight at Auth.js's
  `/api/auth/callback/email` — because `@auth/core@0.41.3`'s callback action consumes the
  single-use token on the bare GET it serves, before Edmate's own `signIn` callback ever runs, so
  there is no way to refuse a scanner's or a stranger's GET from inside that callback.
- A same-browser binding cookie (an HMAC-signed nonce, 15-minute lifetime, set on every
  `/api/auth/signin/email` POST regardless of outcome) is the only thing distinguishing "the
  browser that asked for this link" from anyone else; it isn't tied to one address or token, by
  design, to keep it simple.
- With a matching cookie, the confirm page forwards straight to the real callback (no extra click).
  Without one, it shows the address being signed into and requires one click, submitted as a
  Server Action (Next's own Origin check is the CSRF protection).
- This narrows, but — as 1.4 already logged and the human already accepted — does not remove, the
  login-CSRF risk: a victim who is talked into clicking the confirm button still signs in as
  whoever requested the link. What changes is that merely opening the link, in any browser, never
  signs anyone in by itself.

Why: Auth.js owns token consumption and session creation (1.4 Q2); the only code-level lever left
for Edmate is where the mailed link points and what runs before it reaches Auth.js's own route.

Alternatives: patch `@auth/core`'s callback action to accept a pre-check (fragile, outside Edmate's
code, breaks on every Auth.js upgrade); hand-roll token consumption (duplicates what 1.4 Q2 already
decided to leave to Auth.js).

Reversible: yes — only `email.ts`'s link target, three small `index.ts` exports and two small
route/page files need reverting; no migration, no env var, no contract.

## Open questions (none blocks the build; each has a default the build uses)
- **Q1. Confirm page text: plain English strings, or `next-intl`?** The existing sign-in page uses
  `getTranslations`; the age gate page (also auth-adjacent, also 1.x) uses plain hardcoded English.
  **Recommendation and default:** plain English strings, matching the age gate, since this is a
  narrow hardening task, not an i18n task; add translations in a follow-up if another market needs
  this page before English-only pilot ends.
- **Q2. Does `new NextResponse(res.body, { headers: res.headers })` preserve multiple `Set-Cookie`
  headers, or collapse them?** Unverified from the package source (it's a Next.js/undici runtime
  behaviour, not an Auth.js one). **Recommendation and default:** write the two-cookies-in test
  first (Phase B); if it fails, copy headers manually and append cookies one at a time via
  `getSetCookie()`, as noted in Design above. Either way the public behaviour (test) is the same.
- **Q3. Should the binding cookie be tied to the specific token/address, not just "a browser that
  POSTed recently"?** A tighter binding is possible (hash the token into the cookie) but adds
  coupling between the route that sends mail and the route that sets the cookie, for a
  marginal gain over the 15-minute window already in place. **Recommendation and default:** keep
  the simple, untied marker; revisit only if a review raises a concrete abuse case.

## Budget
Budget: 70 tool calls (2 phases, apps/web only)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (tests and secret scan only)

## Exit conditions
`Status: DONE` when both phases are complete, `corepack pnpm turbo run build typecheck lint test
--filter=@edmate/web...` is green, `next build` succeeds, the secret scan is clean, the evidence
table above is filled in with real output, and `docs/tasks/1.4b/handoff.md` carries the `## Decisions`
entry (risk: high). `Status: PARTIAL` past ~35 calls into a phase with no green tests yet, or if the
Q2 fallback turns out not to work either (escalate to the lead rather than redesigning the route),
or if a file outside this plan's list needs changing.

## READY
Nothing blocks the build. The installed Auth.js version's callback behaviour was confirmed from
`node_modules/.pnpm/@auth+core@0.41.3_nodemailer@8.0.11/node_modules/@auth/core/lib/actions/
callback/index.js` and `.../lib/actions/signin/send-token.js` (token consumed before `signIn` runs;
token is 64 lowercase hex characters). No contracts change and no ADR is needed.

## Lead answers (23 Oct 2026, after the plan security review)
- **Q3 (changed): bind the cookie to the address.** The security reviewer found a CRITICAL in the
  untied marker: a student who recently asked for their own link holds a valid cookie, then clicks a
  link someone else mailed them, and the `auto` branch signs them straight into the other account
  with no click. So the cookie value is `HMAC(AUTH_SECRET, "linkbound:" + normalizeEmail(email))`,
  using the existing `normalizeEmail` export in `apps/web/src/auth/email.ts`. The signin POST
  handler sets it from the posted address. `verifyLinkBindingCookieValue` and `confirmSignInView`
  take the confirm page's `email` query parameter and take the `auto` branch only when the cookie
  matches that address; otherwise the page shows the manual confirm button. Phase A's
  `confirm.test.ts` round-trip cases take the email as an input and include: right cookie + other
  address → manual, not auto; case and whitespace variants of the same address → auto. Log this in
  the handoff decision (risk: high).
- **Referer (LOW):** the server-side `redirect()` to the callback can carry the confirm URL (with
  the token) in the Referer of a same-origin request. Set `Referrer-Policy: no-referrer` on the
  confirm page response if it is a one-line change in the page/route; otherwise record it as an
  accepted risk in the handoff decision. Don't widen scope for it.
- **Q1:** plain English strings (English-only pilot).
- **Q2:** the test-first fallback as written.
- Builders don't run docker compose; Postgres 55432 and Redis 56379 are already up.
- Reviewers for the PR: security-reviewer and typescript-reviewer (plus code-reviewer).
