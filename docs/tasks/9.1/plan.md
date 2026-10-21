# 9.1 plan: App shell, mobile-first layouts (360 px up), next-intl, auth

Part of the human-approved thin slice (decision log, 20 Oct 2026, "Thin teacher-upload +
student-chat slice"). GATE is waived for this build only; nothing here reaches real students
before the harness exit gate passes. Depends on 1.3, 1.4, 1.7, 1.7b (all DONE) — auth, the age
gate and the content loader already exist in `apps/web`.

## Acceptance (verbatim)
"Lighthouse accessibility ≥ 95 at 360 px."

### How it's shown (cheaply — no Lighthouse CI exists yet)
1. **Always-on, every PR:** a component-test harness (vitest + jsdom + `@testing-library/react` +
   an axe runner) renders every new presentational piece (`AppShell`, the sign-in page, the home
   and teacher placeholder views) and asserts zero axe violations. This is the regression guard
   that runs in CI like any other test.
2. **One manual check per new page, captured as evidence in the Phase C handoff, not wired into
   CI:** `next build --webpack && next start`, then `pnpm dlx lighthouse <url> --only-categories
   =accessibility --preset=mobile --screenEmulation.width=360 --screenEmulation.height=640` against
   `/sign-in`, `/home` and `/teacher` (signed in as each role via the existing sandbox pattern from
   1.4's `scripts/sandbox-magic-link.mjs`, or a seeded demo user). Scores pasted into the handoff.
   Wiring a real Lighthouse CI job into `.github/workflows/ci.yml` (headless Chrome in CI) is a
   follow-up task, not part of this thin slice — logged as a decision, not a blocker.
3. CSS is written mobile-first from a 360 px base (no horizontal scroll, ≥44px tap targets, ≥16px
   body text so mobile browsers don't zoom-on-focus, visible focus outlines), with `min-width`
   media queries only added above that base. This is what axe and Lighthouse are actually checking
   for at that width.

## Scope (kept minimal per the lead's brief)
In scope: the layout shell (header, skip link, main landmark), three routes (`/sign-in`, `/home`
for students, `/teacher` as a placeholder for 8.1), next-intl wired for English-only UI strings,
and the above pages wired to the auth already built in 1.3/1.4/1.7/1.7b. Out of scope, parked as
follow-ups: themes/dark mode, any locale beyond `en`, a marketing/discovery landing page (9.2), a
package or subscription UI (9.3), the chat UI itself (9.4 — this task only builds the shell it
will mount into), a mobile nav toggle/hamburger (three links fit at 360 px without one), a footer,
profile/avatar, and any staff-facing page.

## Design notes
- **No fs reads for UI strings.** `apps/web/messages/en.json` is loaded with a static `import`,
  never `fs.readFile` from a configurable directory. 1.7b spent a whole fix round on a worker path
  built from `import.meta.url` that broke under `next build --webpack`'s bundling; a statically
  imported JSON file is traced and bundled by Next like any other import, with nothing
  bundler-specific to misparse and no `apps/web/Dockerfile` change needed.
- **No `NextIntlClientProvider` yet.** Every new page in 9.1 is a server component; next-intl's
  server API (`getTranslations` from `next-intl/server`) works there without a client provider.
  9.4 (chat, a client component) adds the provider when it first needs translations client-side —
  confirm this still holds for the installed next-intl version during the build (docs-lookup or
  the library's own docs); if it doesn't, add the provider in Phase A instead.
- **The email sign-in form is not rebuilt.** `/sign-in` offers one button, "Continue with Google"
  (a server action calling the `signIn` already exported from `src/auth`), plus a plain link to
  Auth.js's own `/api/auth/signin` for email, which 1.4 already built with working CSRF handling.
  Rebuilding that form here would duplicate 1.4's CSRF/rate-limit wiring for no gain in this slice.
- **`/` is a pure dispatcher, not a landing page.** The build plan's 9.1 route list is exactly
  "sign-in, student home, teacher area placeholder" — no marketing copy (that's 9.2, not started).
  `/` reads the signed-in principal (if any, via a new soft, non-throwing helper) and redirects:
  anonymous → `/sign-in`, student → `/home`, teacher → `/teacher`, staff → `/sign-in` (no staff
  area exists yet; logged as a decision, not a blocker — 12.1's staff console is a separate task).
- **Routing-based i18n (a `[locale]` URL segment, middleware) is not added.** English-only pilot
  (human decision) plus next-intl's non-routing mode (one static locale, no middleware) covers
  this task; adding the `[locale]` segment later for a second market is follow-up work, not a
  rewrite, since next-intl's request-config API doesn't change.

## Files 9.1 owns (for 8.1 to build on)
- `apps/web/src/ui/AppShell.tsx` — the shared shell (skip link, header, nav slot, main landmark,
  optional sign-out form). 8.1's onboarding pages should wrap in this, not write their own chrome.
- `apps/web/app/layout.tsx`, `apps/web/app/globals.css` — the root HTML shell and mobile-first base
  styles every route inherits.
- `apps/web/src/i18n/request.ts`, `apps/web/messages/en.json` — the next-intl setup; 8.1 adds its
  own keys to the same `en.json`, not a second messages file.
- `apps/web/src/auth/guard.ts`'s exported `SIGN_IN_PATH` and `apps/web/src/auth/index.ts`'s new
  `currentPrincipal()` soft helper — the one sign-in path and the one "who, if anyone" read.
- `apps/web/app/teacher/page.tsx` (+ `view.tsx`) — a role-gated placeholder 8.1 is expected to
  extend or replace (e.g. `app/teacher/onboarding/**`), reusing `AppShell`.
- **Coordination note (not a human question):** 8.1 is being planned in parallel. Until 9.1's
  Phase A (shell) and Phase B (`SIGN_IN_PATH`, `currentPrincipal`) merge, those exports don't exist
  yet. The lead should sequence 8.1's build to start after Phase B merges, or have 8.1 build its
  teacher page without `AppShell` first and refactor once 9.1 lands — a lead sequencing call, not
  an open product decision.

## Files out of bounds
`packages/contracts/**`, `packages/harness/**`, `packages/db/**` (no schema/migration change — no
new persisted data), `content/**`, `apps/worker/**`, `apps/web/app/api/**` (no new API routes),
`apps/web/src/auth/email.ts` / `mail.ts` / `rate-limit.ts` (email sign-in UI is reused, not
touched), `.claude/skills/merge-gate/risk-paths.txt` (no new risky group needed — the existing
`apps/web/src/auth/**` entry already covers Phase B).

## Phase A — foundations: next-intl, the test harness, the shell
No risky paths. ~9 files.

### Files to create/modify
- `apps/web/src/i18n/request.ts` (new) — next-intl `getRequestConfig`, static `locale: 'en'`.
- `apps/web/messages/en.json` (new) — shell strings only (`skipToContent`, brand name) for now.
- `apps/web/next.config.ts` (edit) — wrap `nextConfig` with `createNextIntlPlugin()`; keep every
  existing comment and option (the 1.7b/1.7 fix-round history there must not be lost).
- `apps/web/app/globals.css` (new) — reset, color tokens meeting AA contrast, 360 px-first type
  scale and spacing, `:focus-visible` outlines, no component framework.
- `apps/web/app/layout.tsx` (edit) — `lang="en"`, a `viewport` export
  (`{ width: 'device-width', initialScale: 1 }`), import `globals.css`.
- `apps/web/src/ui/AppShell.tsx` (new) — skip link to `#main`, `<header>`, an optional `nav` prop
  (list of `{ href, label }`), an optional `signOutAction` prop rendering one form/button,
  `<main id="main">{children}</main>`.
- `apps/web/src/ui/AppShell.test.tsx` (new) — RTL render + axe, with and without `nav`/sign-out.
- `apps/web/vitest.config.ts` (edit) — add `**/*.test.tsx` to `include`; jsdom only for `.tsx`
  tests (`environmentMatchGlobs` or an equivalent per-file override), so the existing node-based
  `src/auth/**` suites keep their environment and 100%-coverage thresholds unaffected.
- `apps/web/package.json` (edit) — add `next-intl` (dependency); add `@testing-library/react`,
  `@testing-library/jest-dom` (or equivalent matcher), `jsdom`, and an axe runner for vitest
  (devDependencies). Builder records exact pinned versions in the handoff, as 1.4 did.

### Tests first
`AppShell.test.tsx` written and red (component doesn't exist) before `AppShell.tsx`; axe assertion
written before any CSS, so the first green run is the actual accessibility bar, not a retrofit.

### State after this phase
Shell, styles and the i18n plumbing exist; nothing renders them yet. `pnpm turbo run typecheck
lint test --filter=@edmate/web` green, `next build --webpack` still compiles (prove next-intl's
plugin doesn't reopen the 1.7b/1.7-fix-round build issues).

## Phase B — auth wiring: the one sign-in path
Touches `apps/web/src/auth/**` (risky; reviewers: security-reviewer). ~9 files.

### Files to create/modify
- `apps/web/src/auth/guard.ts` (edit) — export the existing private `SIGN_IN` constant as
  `SIGN_IN_PATH = '/sign-in'` (was `/api/auth/signin`); `requireRole` uses it unchanged otherwise.
- `apps/web/src/auth/guard.test.ts` (edit) — update the redirect-target assertions.
- `apps/web/src/auth/index.ts` (edit) — add `currentPrincipal(): Promise<Principal | null>`, a
  soft, non-throwing read (any lookup failure reads as `null`, same fail-safe-to-signed-out
  direction as `resolvePrincipal`'s existing `not_found` handling) for the `/` dispatcher in
  Phase C. Not security-enforcing by itself — `/home` and `/teacher` still call `requireRole`.
- `apps/web/src/auth/index.test.ts` (edit) — cover `currentPrincipal()`: signed in, signed out,
  lookup failure.
- `apps/web/app/welcome/age/page.tsx` (edit) — replace the literal `'/api/auth/signin'` with the
  imported `SIGN_IN_PATH`, so the age gate also lands on the new page.
- `apps/web/app/welcome/age/actions.ts` (edit) — same replacement.
- `apps/web/app/sign-in/page.tsx` (new) — wrapped in `AppShell` (no `nav`), one "Continue with
  Google" button (a server action) and one plain link to `/api/auth/signin` for email.
- `apps/web/app/sign-in/actions.ts` (new) — `signInWithGoogle()` calling the `signIn` already
  exported from `src/auth`, `redirectTo: '/'` (the Phase C dispatcher sorts the rest out).
- `apps/web/app/sign-in/page.test.tsx` (new) — RTL + axe.

### Tests first
`guard.test.ts`'s updated assertions and `index.test.ts`'s new `currentPrincipal` cases written
and red first; `sign-in/page.test.tsx` red before the page exists.

### Risky paths touched (this phase only)
- `apps/web/src/auth/guard.ts`, `apps/web/src/auth/index.ts` — match `apps/web/src/auth/**` in
  `.claude/skills/merge-gate/risk-paths.txt` → reviewers: security-reviewer. The handoff logs a
  `risk: high` decision for this phase (same group 1.4/1.7/1.7b logged high for).
- Everything else in this phase (`app/welcome/age/**`, `app/sign-in/**`) is outside every glob in
  `risk-paths.txt` — not risky on its own, but reviewed anyway because it's in the same PR as the
  risky files above.

### State after this phase
One real sign-in path (`/sign-in`) exists and every existing redirect points at it;
`currentPrincipal()` is available for Phase C. `apps/web/src/auth` coverage thresholds (100%
lines/functions/statements, 90% branches) still hold.

## Phase C — the two gated routes and the dispatcher
No risky paths. ~9-10 files.

### Files to create/modify
- `apps/web/app/page.tsx` (edit) — calls `currentPrincipal()`; redirects per Design notes above
  (anonymous → `/sign-in`, student → `/home`, teacher → `/teacher`, staff → `/sign-in`).
- `apps/web/app/page.test.ts` (new) — the four branches, over a stubbed `currentPrincipal`.
- `apps/web/app/home/page.tsx` (new) — thin: `requireRole(['student'])`, then renders `<HomeView>`.
- `apps/web/app/home/view.tsx` (new, pure) — the actual markup: `AppShell` with `nav` (Home, Sign
  out) and a one-line "your teacher's agent will be here soon" placeholder (9.4 fills this in).
- `apps/web/app/home/view.test.tsx` (new) — RTL + axe on `HomeView` directly (no server-only
  `requireRole` to stub).
- `apps/web/app/teacher/page.tsx` (new) — thin: `requireRole(['teacher'])`, then `<TeacherView>`.
- `apps/web/app/teacher/view.tsx` (new, pure) — `AppShell` with a "Teacher studio — coming soon"
  placeholder; 8.1 replaces or extends this.
- `apps/web/app/teacher/view.test.tsx` (new) — RTL + axe.
- `apps/web/messages/en.json` (edit) — add the home/teacher/dispatcher strings.
- `apps/web/package.json` (edit, optional) — a documented `a11y:check` script wrapping the
  `pnpm dlx lighthouse ...` command from the Acceptance section, so 9.2–9.6 can reuse it verbatim.

### Tests first
`page.test.ts`'s four branches, and both `view.test.tsx` files, written and red before the pages.

### State after this phase (task done)
All three routes exist and are reachable from a fresh sign-in. Evidence captured in the handoff:
component-test + axe results (every PR, already green), and the one manual Lighthouse run per
page at 360 px (score ≥ 95), against the real `next build --webpack` artifact. `pnpm turbo run
typecheck lint test --filter=@edmate/web` green; secret scan clean.

## Open questions
None that block starting. The staff-fallback-to-`/sign-in` choice and the Lighthouse-CI-as-a-
follow-up choice are logged as decisions (plan Design notes above), not sent to the human — the
build plan and the English-only-pilot/thin-slice decisions already answer everything a
spec-conflict or open-decision check would otherwise raise.

## Decisions to log on merge (per phase)
- Phase B: `apps/web/src/auth/**` touched → `risk: high`.
- `next-intl` and the component-test stack (`@testing-library/react`, jsdom, an axe runner) are
  additions named by the build plan's own task title (next-intl) or needed to prove its accept
  criterion cheaply (the test stack) — not treated as a tech-stack ADR under rule 2, consistent
  with 1.4 adding nodemailer/ioredis to `apps/web` without one.
- Lighthouse CI wiring into `.github/workflows/ci.yml` is a named follow-up, not part of 9.1.
