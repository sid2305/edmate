# 1.4b handoff: magic-link hardening (confirm page + address-bound binding cookie)

**Status:** DONE
**Branch:** `m13/1.4b-magic-link-binding` (built on local `work-14b`)
**Worktree:** `.claude/worktrees/agent-a2f67c7e08125cfd2`
**Reviewers needed:** security-reviewer (both risky groups: `apps/web/src/auth/**`, `apps/web/app/api/auth/**`), typescript-reviewer, code-reviewer.

## What changed
- **Mailed link** (`src/auth/email.ts`): `rebuildLink` still requires Auth.js's own `/api/auth/callback/email` URL and still rebases a forged host onto `AUTH_URL`, but now rebuilds the link onto `CONFIRM_PATH = '/sign-in/confirm'` with the same query. Mailing a link spends no token.
- **Pure logic** (`src/auth/confirm.ts`, new): the binding cookie is `HMAC-SHA256(AUTH_SECRET, "linkbound:" + normalizeEmail(email))` as hex (`edmate.link-bound`, `__Host-` when secure, httpOnly, SameSite=Lax, Path=/, Max-Age 900). `verifyLinkBindingCookieValue(secret, cookie, email)` is strict hex and constant-time, and it fails closed on a missing, short, long, non-hex, upper-case or wrong-secret cookie, or a bad address. `parseConfirmParams` uses zod: token 32–128 lowercase hex, email that `normalizeEmail` accepts (at most 320 characters), callbackUrl 1–2048 characters. It refuses repeated keys (arrays). `buildEmailCallbackUrl` uses `URL` and `URLSearchParams` only. `confirmView` returns `invalid`, `auto` (only when the cookie matches **this link's address**) or `manual`.
- **`src/auth/index.ts`**: three env-backed wrappers. `confirmSignInView(params)` reads the cookie through `next/headers`. `confirmEmailSignIn(fields)` returns the callback URL or null. `linkBindingCookie(email)` returns the cookie spec or null.
- **Route** `app/api/auth/signin/email/route.ts` (new): GET passes straight to `handlers.GET`. POST first reads the posted `email` from a clone of the request (urlencoded, multipart or JSON; exactly one value), then runs `handlers.POST` unchanged. If the address is valid, it copies the response (`new Headers(res.headers)` keeps every `Set-Cookie`) and adds the binding cookie, whatever Auth.js answered (sent, rate-limited, mail failure, missing CSRF). An invalid or missing address returns Auth.js's own response object untouched.
- **Page** `app/sign-in/confirm/page.tsx` (new, plain English): `invalid` shows a generic message and a link to `/sign-in`. `auto` calls `redirect()` to the real callback. `manual` shows "Sign in to Edmate as **<email>**?" and the confirm form. `metadata.referrer = 'same-origin'`.
- **Action** `app/sign-in/confirm/actions.ts` (new, `'use server'`): `confirmEmailSignIn(prev, formData)` returns the callback URL, or `/sign-in` for an invalid submission.
- **Client form** `app/sign-in/confirm/ConfirmForm.tsx` (new, see Deviations): `useActionState(confirmEmailSignIn)`. When the action returns, the client opens the URL as a full page (`window.location.assign`). A "Continue" link is the fallback.
- **Stack helpers** (see Deviations): `e2e/stack/mail.ts` now finds the `/sign-in/confirm?…` link and expects to land past both the confirm page and `/api/auth/`. `scripts/sandbox-magic-link.mjs` now checks that a second browser gets the confirm page (200, no session) and the requesting browser gets a 307 to the callback, then finishes as before.

## Evidence
| Part | Evidence |
|---|---|
| A link opened in a different browser or by a scanner does not sign in | `src/auth/confirm.test.ts` (47 tests, all pass). Cookie verification fails closed for a missing, empty, truncated, over-long, non-hex, upper-case or non-string cookie, a different secret, or an invalid address. **A cookie for `victim@` never matches `attacker@`.** `confirmView`: no cookie, a forged cookie, a cookie for another address and a cookie made with another secret all give `manual`. Case, whitespace and fullwidth-`＠` variants of the same address give `auto`. `index.test.ts` "confirmSignInView: no cookie / a forged cookie / a cookie for another address → manual" passes. `page.test.tsx` "manual: shows the address and one sign-in button…; no redirect" passes (`redirect` and the action are never called). `route.test.ts` (15 tests): the cookie is set on verify-request, RateLimited, Configuration and MissingCSRF responses alike. |
| The confirm page posts with CSRF | `actions.test.ts` (3 tests). `confirmEmailSignIn` is a `'use server'` Server Action, so Next's own Origin check applies. `page.test.tsx` "ConfirmForm: a click runs the server action with the fields, then navigates to its URL" passes. The form is a real `<form action={formAction}>` with the three hidden fields. |
| Same browser, no extra click | `confirm.test.ts` "a cookie for this address → auto, straight to the real callback". `index.test.ts` "confirmSignInView: this browser's cookie for this address → auto". `page.test.tsx` "auto: redirects straight to the real callback and renders nothing" (`redirect` called exactly once with the URL). |
| The link no longer points at the real callback | `email.test.ts` "moves Auth.js's URL onto the confirm page…" and "rebases a forged host…" (to `/sign-in/confirm?…`). The wrong-path cases are unchanged. `email-flow.test.ts` (21 tests): the mailed link's pathname is `/sign-in/confirm` and the mail never contains `/api/auth/callback/`. Every 1.4 flow (single use, expiry, newer link, enumeration, rate limits, host poisoning, open redirect, CSRF, bad addresses, mail failure, forged token) still passes through the real Auth.js handlers via `buildEmailCallbackUrl` on the mailed query. |
| Auth tests pass | `TEST_DATABASE_URL=… corepack pnpm turbo run build typecheck lint test --filter=@edmate/web --force` → `Tasks: 11 successful, 11 total`; `Test Files 153 passed (153)`; `Tests 2321 passed (2321)`. No file skipped (the four staff int files ran against Postgres on 55432). `next build` lists `ƒ /api/auth/signin/email`; its only warnings are the existing bullmq ones. Coverage: `confirm.ts` 100/100/100/100; `signin/email` route 100% lines, 94% branches; `ConfirmForm.tsx` 83% lines (the default `window.location.assign` isn't run under jsdom); all files 96.5% lines. |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0, no findings. |

## Deviations
- **The Server Action returns the URL instead of calling `redirect()`, so there is one extra file, `ConfirmForm.tsx`.** In Next 16.4.2 (`next/dist/server/app-render/action-handler.js`, `createRedirectRenderResult`), a fetch-submitted action that redirects to a same-host URL first `fetch`es that URL **on the server** to stream its RSC payload. For the Auth.js callback, that server-side GET would spend the single-use token and throw away the session `Set-Cookie`. The browser would then land on `error=Verification`. So the action returns the URL and a small client component navigates the full page to it. This is the smallest change that works. The file sits in the non-risky `app/sign-in/confirm/` folder, next to the page.
- **`e2e/stack/mail.ts` and `scripts/sandbox-magic-link.mjs`** were updated because they look for the mailed link and would fail on the new `/sign-in/confirm` target (lesson: red CI from stale tests). Neither file is in the risky path list or in another builder's area.
- **The route sets no cookie for an invalid or missing address.** The plan said "every POST". Auth.js already answers an invalid address with a different error, and there is no account to enumerate, so leaving the cookie off reveals nothing new.

## Left to do
- None for this task. Possible board follow-up (MEDIUM/LOW, not needed for the pilot): run `e2e/stack` try-it once against the compose stack to watch the same-browser auto-forward in a real browser. The unit, integration and sandbox paths cover it, but the stack run wasn't part of this gate (builders don't run docker compose).

## Decisions

### 23 Oct 2026 · 1.4b A confirm page and an address-bound cookie stop a bare GET from finishing sign-in · decided by builder · risk: high
- Decided: Mailed links now open `/sign-in/confirm`, not Auth.js's `/api/auth/callback/email`. The reason: `@auth/core@0.41.3` spends the single-use token on the bare GET of its callback, before Edmate's `signIn` callback runs, so a scanner's or a stranger's GET can't be refused from inside Auth.js.
- Decided: The `/api/auth/signin/email` POST sets a binding cookie only when the request is same-origin (Origin equals AUTH_URL's origin or, with no Origin header, `Sec-Fetch-Site: same-origin`) AND Auth.js answered with its `verify-request` redirect. An error, rate-limit or MissingCSRF answer gets no cookie (fix round: both reviewers found that a cross-site auto-submitting form could plant a cookie for the attacker's own address). The gate looks only at Auth.js's answer, which is the same for known and unknown addresses, so it adds no enumeration signal. The value is `<issuedAt>.HMAC-SHA256(AUTH_SECRET, "linkbound:" + issuedAt + ":" + normalizeEmail(email))`: httpOnly, SameSite=Lax, `__Host-` when secure, 15 minutes. The server refuses it once it is older than 15 minutes, so a captured value can't outlive Max-Age. The confirm page forwards straight to the callback only when this cookie matches the link's own `email` (lead answer to Q3, after the plan security review's CRITICAL). Anyone else sees the address and must click: a scanner, another browser, or a browser that asked for a link to a different address.
- Decided: `/api/auth/callback/email` has its own literal route, resolved ahead of the `[...nextauth]` catch-all (fix round, closing the security review's HIGH). It passes the GET to Auth.js only when the browser holds either the binding cookie for the request's `email`, or a "confirmed" cookie that the confirm Server Action sets. The confirmed cookie is `<issuedAt>.HMAC(AUTH_SECRET, "linkconfirmed:" + issuedAt + ":" + token + ":" + normalizeEmail(email))`: httpOnly, SameSite=Lax, 2 minutes, compared in constant time. Otherwise the route answers 303 to `/sign-in/confirm` with the same query, and no token is spent. An attacker can no longer send a victim straight to the real callback with the attacker's own token. The route exports no POST (fix round 2): Auth.js reads token and email from the query on any method, so a cross-site form POST would otherwise spend an attacker's token ungated; Next matches this literal path before the method, so a POST gets a 405 and never reaches the catch-all.
- Decided: The click is a Server Action (Next's Origin check is the CSRF protection). It returns the callback URL and the client opens it as a full page, because Next 16 would otherwise fetch a same-host action redirect on the server and spend the token there.
- Decided: Referer (LOW from the plan review): the page sets `metadata.referrer = 'same-origin'`, so the token-bearing URL never goes in a cross-origin Referer. `no-referrer` was rejected because it makes browsers send `Origin: null` on the action POST, which would break Next's CSRF check. The `auto` path is a server redirect, and browsers keep the original referrer across redirects, so the confirm URL isn't sent as a Referer there.
- Why: Auth.js owns token consumption and sessions (1.4 Q2). The only lever Edmate has is where the mailed link points and what runs before Auth.js's route. Binding the cookie to the address closes the auto-forward login-CSRF the review found. 1.4's accepted residual risk stays: a victim who is talked into clicking "Sign in" on someone else's link still signs in as that person. Merely opening a link, or the callback URL itself, never does.
- risk: high. This touches `apps/web/src/auth/**` and `apps/web/app/api/auth/**`. Reversible: revert `rebuildLink`'s target, the `index.ts` exports, the two new routes (`signin/email`, `callback/email`), and the page, action and form files. No migration, env var, contract or ADR.

Tool calls used: 50

## Fix round (security and TypeScript review)

What changed:
- `apps/web/app/api/auth/signin/email/route.ts`: the binding cookie is set only for a same-origin POST that Auth.js answered with `verify-request` (`signInBindsLink` → `shouldBindLink` in `confirm.ts`). The route test's "cookie on MissingCSRF" case is replaced by these cases:
  - no cookie on a MissingCSRF, rate-limited, mail-failure or non-redirect answer;
  - no cookie from a cross-site, `null` or missing Origin, even on success;
  - a cookie on a same-origin success, by Origin or by `Sec-Fetch-Site: same-origin`.
- New `apps/web/app/api/auth/callback/email/route.ts` and `route.test.ts`: the gated callback. The tests cover:
  - a bare GET → 303 to confirm, and Auth.js is not called (the token isn't spent);
  - a binding cookie for this address → passed through;
  - a binding cookie for another address, or an expired one → confirm;
  - a valid confirmed cookie → passed through;
  - a confirmed cookie for another token or another address, an expired one, or a binding value in its place → confirm;
  - a repeated `email` param → confirm;
  - a malformed query → confirm.
- `apps/web/src/auth/confirm.ts`: cookie values are now signed with their issue time (`<issuedAt>.<hmac>`, 30 s clock skew allowed). New: the confirmed cookie, `isSameOriginRequest`, `isVerifyRequestRedirect`, `shouldBindLink` and `emailCallbackGate`.
- `apps/web/src/auth/index.ts`: `confirmEmailSignIn` is now async and sets the confirmed cookie. New exports: `signInBindsLink` and `emailCallbackRedirect`. `actions.ts` awaits `confirmEmailSignIn`.
- Both sign-in paths still complete:
  - The `auto` branch redirects to the callback carrying the binding cookie, which the gate accepts.
  - In the ConfirmForm path, the Server Action sets the confirmed cookie before the client opens the callback.
- `e2e/stack/mail.ts` needs no change, because a real browser sends Origin on the sign-in form POST.
- `scripts/sandbox-magic-link.mjs` now sends `Origin` on its POST. It also checks that another browser opening the callback is sent to confirm, and that reusing the link in the same browser is refused.
- LOW (issue time in the binding cookie): done, as above.
- LOW (`no-referrer` on the confirm page): not done. It would make the Server Action POST carry `Origin: null` and fail Next's CSRF check, so the earlier lead decision stands. The callback's redirect to confirm does carry `Referrer-Policy: no-referrer`.

Gate: `corepack pnpm turbo run build typecheck lint test --filter=@edmate/web --force` → `Tasks: 11 successful, 11 total`. Web tests: 151 files passed, 4 skipped (155); 2349 tests passed, 26 skipped (2375). The 4 skipped files are `app/api/staff/{reports,agents,verifications,alerts}/route.int.test.ts`. They run only with an explicit, disposable `TEST_DATABASE_URL`, and their own comments say never to point them at the dev compose database, so they were left skipped (CI runs them). `python3 .githooks/secret-scan.py --all` → clean.

Left to do:
- The `apps/web/e2e` magic-link flows and `scripts/sandbox-magic-link.mjs` were not run against a live stack in this round (compose was not allowed). Run them once before the pilot.

Tool calls used (fix round): 30
