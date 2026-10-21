# 9.1 handoff: app shell, mobile-first layouts (Phase A, B)

Status: PARTIAL (Phases A and B done; Phase C not started)

## Phase A

Built the next-intl plumbing, the component-test harness (vitest + jsdom + RTL + jest-axe) and the
shared `AppShell`, per the plan's Phase A file list. No risky paths touched.

### What was built
- `apps/web/src/i18n/request.ts` (new) — next-intl `getRequestConfig`, static `locale: 'en'`,
  messages statically imported from `messages/en.json` (no `fs` read, per the plan's Design notes).
- `apps/web/messages/en.json` (new) — shell strings only (`shell.skipToContent`, `shell.brand`,
  `shell.signOut`).
- `apps/web/next.config.ts` (edit) — wraps the existing `nextConfig` with `createNextIntlPlugin()`;
  every existing comment and option (the 1.7/1.7b fix-round history) kept as-is.
- `apps/web/app/globals.css` (new) — reset, AA-contrast color tokens, 360px-first type scale and
  spacing, `:focus-visible` outlines, `min-height`/`min-width: 44px` tap targets, no component
  framework.
- `apps/web/app/layout.tsx` (edit) — imports `globals.css`, adds a `viewport` export
  (`{ width: 'device-width', initialScale: 1 }`).
- `apps/web/src/ui/AppShell.tsx` (new) — skip link to `#main`, `<header>` with brand, an optional
  `nav` prop (`{ href, label }[]`, omitted entirely — no empty `<nav>` — when not given), an
  optional `signOutAction` prop rendering one form/button, `<main id="main">{children}</main>`.
- `apps/web/src/ui/AppShell.test.tsx` (new) — RTL render + jest-axe, with and without `nav`/
  sign-out; written and red (component didn't exist) before `AppShell.tsx`, per the plan's "Tests
  first".
- `apps/web/vitest.config.ts` (edit) — `include` now also matches `**/*.test.tsx`; `environment:
  'node'` stays the default (so `src/auth/**`'s 100%-coverage suites are unaffected), and the new
  `.test.tsx` files opt into jsdom per file with a `// @vitest-environment jsdom` docblock. See
  Decisions: vitest 5 dropped the `environmentMatchGlobs` config option the plan named.
- `apps/web/test/setup.ts` (edit) — imports `@testing-library/jest-dom/vitest` once; `afterEach`
  now also calls RTL's `cleanup()`, guarded by `typeof document !== 'undefined'` so the existing
  node-environment suites are unaffected.
- `apps/web/test/jest-axe.d.ts` (new) — augments Vitest's own `Matchers` interface with
  `toHaveNoViolations()` (jest-axe's shipped types augment Jest's `expect`, not Vitest's).
- `apps/web/package.json` (edit) — dependencies/devDependencies below.

### Dependencies added (exact pinned versions)
- `next-intl@4.4.0` (dependency) — see Decisions for why this version, not the registry's latest
  (4.14.9).
- `@testing-library/react@16.3.3`, `@testing-library/jest-dom@7.0.1`, `jsdom@30.1.3`,
  `jest-axe@11.0.0`, `@types/jest-axe@3.5.9` (devDependencies).

### Test results
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — all 34 tasks green (trimmed):
```
Tasks:    34 successful, 34 total
```
`apps/web`'s own `vitest run --coverage`:
```
Test Files  16 passed | 1 skipped (17)
     Tests  349 passed | 4 skipped (353)
All files          |   99.79 |      100 |   99.23 |   99.75 |
 src/i18n/request.ts (0% — no direct test; the only uncovered file, config glue with no branches)
```
`AppShell.tsx` itself: 100% covered by `AppShell.test.tsx`'s 7 cases (skip link + `#main`, children
render, no nav/no sign-out by default, nav links render, sign-out form renders, axe-clean with and
without nav/sign-out).

`corepack pnpm run build` (`next build --webpack`) in `apps/web`: succeeds. Compiles with one
pre-existing, unrelated warning (`bullmq`'s optional `@valkey/valkey-glide` import, present before
this task). Route list is unchanged from before this task (`/`, `/welcome/age`, the two API
routes) — Phase A adds no new route, only the shell and i18n plumbing nothing mounts yet, matching
the plan's "State after this phase".

`python3 .githooks/secret-scan.py --all` — clean, no output.

## Phase B

Built the one real sign-in path, `/sign-in`, per the plan's Phase B file list. Touches
`apps/web/src/auth/**` (risky path, reviewers: security-reviewer) — no guard, age gate or
cookie/session setting was weakened; the one behaviour change is the redirect target string
itself.

### What was built
- `apps/web/src/auth/guard.ts` (edit) — the private `SIGN_IN` constant is now the exported
  `SIGN_IN_PATH = '/sign-in'` (was `'/api/auth/signin'`); `requireRole`'s anonymous redirect uses
  it unchanged otherwise. Auth.js's own API route (`/api/auth/signin/*`) is untouched — only the
  *page* a human lands on moved.
- `apps/web/src/auth/guard.test.ts` (edit) — the redirect-target assertions now expect
  `SIGN_IN_PATH`; one new case asserts the exported constant's value directly.
- `apps/web/src/auth/index.ts` (edit) — re-exports `SIGN_IN_PATH` from `./guard`; adds
  `currentPrincipal(): Promise<Principal | null>`, a soft, non-throwing read (any failure —
  `getRuntime()` throwing, or the session lookup throwing — reads as `null`, the same
  fail-safe-to-signed-out direction as `resolvePrincipal`'s existing `not_found` handling). Not
  security-enforcing by itself: `/home` and `/teacher` (Phase C) still call `requireRole`.
- `apps/web/src/auth/index.test.ts` (edit) — three new `currentPrincipal` cases: signed out (no
  cookie), signed in (a real session via the memory identity store), and a lookup failure (the
  identity store's `getSessionAndUser` made to throw) reading as `null`, not propagating.
- `apps/web/app/welcome/age/page.tsx`, `apps/web/app/welcome/age/actions.ts` (edit) — the literal
  `'/api/auth/signin'` redirect replaced with the imported `SIGN_IN_PATH`; both now land on the
  new page too. No other behaviour in either file changed.
- `apps/web/app/sign-in/page.tsx` (new) — a server component wrapped in `AppShell` (no `nav`): one
  "Continue with Google" button (a server action) and one plain link to `/api/auth/signin` for
  email (1.4's own CSRF/rate-limited form, not rebuilt). Strings come from `next-intl`'s server
  `getTranslations` (confirmed working in a server component with no provider, per the plan's
  Design notes), reading `shell.*` and the new `signIn.*` keys.
- `apps/web/app/sign-in/actions.ts` (new) — `signInWithGoogle()`, calling the `signIn` already
  exported from `src/auth`, `redirectTo: '/'` (the Phase C dispatcher sorts the rest out).
- `apps/web/app/sign-in/page.test.tsx` (new) — RTL + jest-axe; written and red before the page
  existed. `next-intl/server`'s `getTranslations` is mocked to read the same `messages/en.json`
  the real `src/i18n/request.ts` loads (jsdom has no server/client runtime split, so next-intl's
  real server API resolves to its client-only build and throws under jsdom — see Decisions).
- `apps/web/messages/en.json` (edit) — added `signIn.title`, `signIn.googleButton`,
  `signIn.emailLink`.

### Test results
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — all 34 tasks green
(trimmed): `Tasks: 34 successful, 34 total`. `apps/web`'s own coverage report:
```
All files          |   99.79 |      100 |   99.24 |   99.76
 src/auth          |     100 |      100 |     100 |     100
 src/i18n/request.ts (0% — unchanged from Phase A: config glue, no direct test, no branches)
```
`src/auth/**` holds its 100% lines/functions/statements, 100% branches (exceeds the 90% floor).

`corepack pnpm run build` (`next build --webpack`) in `apps/web`: succeeds. New route: `/sign-in`
(static, ○). Same pre-existing, unrelated warning as Phase A (`bullmq`'s optional
`@valkey/valkey-glide` import).

`python3 .githooks/secret-scan.py --all` — clean, no output.

## Left to do
- **Phase C** — the `/` dispatcher, `/home` and `/teacher` gated routes and their views, the
  manual Lighthouse ≥95 run at 360px for `/sign-in`, `/home`, `/teacher` (the plan's Acceptance
  evidence), and `apps/web/messages/en.json`'s home/teacher/dispatcher strings.
- The plan's "Coordination note" (8.1 sequencing) still applies: 8.1's teacher pages should wait
  for Phase B to merge, or build without `AppShell` first and refactor — a lead sequencing call.

## Decisions

### 20 Oct 2026 · `apps/web/src/auth/**` touched in Phase B · decided by tdd-guide
Decided: `src/auth/guard.ts` and `src/auth/index.ts` are both edited in this phase (the
`SIGN_IN_PATH` rename and the new `currentPrincipal()` soft read), matching the plan's own call-out
and `.claude/skills/merge-gate/risk-paths.txt`'s existing `apps/web/src/auth/**` entry.
Why: both are named in the plan's Phase B file list; no guard, age-gate or cookie/session setting
was weakened — `requireRole`'s only behaviour change is the string it redirects to, and
`currentPrincipal()` is explicitly not security-enforcing (`requireRole` still gates `/home` and
`/teacher` in Phase C). `src/auth/**`'s 100%-lines/functions/statements, 90%-branches coverage
floor holds (100% branches, measured).
risk: high (this group's reviewers: security-reviewer; the lead finalises).

### 20 Oct 2026 · next-intl's server `getTranslations` is mocked in jsdom component tests · decided by tdd-guide
Decided: `app/sign-in/page.test.tsx` mocks `next-intl/server`'s `getTranslations` to read
`messages/en.json` directly, instead of calling the library's real implementation under jsdom.
Why: Vitest's jsdom environment has no server/client runtime split the way Next's build does;
next-intl's package exports resolve to its client-only bundle whenever `document` is defined
(true for every `.tsx` test in this suite), and that bundle throws
`` `getTranslations` is not supported in Client Components `` outright — there is no way to make
the real server API callable under jsdom. The mock still exercises the page's real namespace keys
(`shell.*`, `signIn.*`) against the real `en.json` the production `src/i18n/request.ts` loads, so
a typo'd or missing key still fails the test; only next-intl's own request-context plumbing (which
only exists inside a real Next request) is replaced.
risk: low.

### 20 Oct 2026 · next-intl pinned to 4.4.0, not the registry's latest 4.14.9 · decided by tdd-guide
Decided: `next-intl@4.4.0`, the newest 4.x release that both (a) lists `next@^16.0.0` and
`react@^19.0.0` in its peer ranges and (b) has no `@swc/core`/`@parcel/watcher` hard dependency.
Why: `next-intl`'s current `latest` (4.14.9) added a message-extraction/catalog feature (new
`@eloqnt/*`, `icu-minify`, `next-intl-swc-plugin-extractor` dependencies) that pulls in
`@swc/core` and `@parcel/watcher` as plain (non-optional) dependencies needing native install-time
build scripts — a public repo should not need to run two extra native builds for a feature (PO
catalog extraction) this task never uses, and the lead's existing `pnpm-workspace.yaml`
`allowBuilds: false` pattern is for *optional* speed-ups, not a dependency a package can't function
without installing a build for. `next-intl@4.4.0` (the commit just before `@swc/core` was added as
a hard dependency, per the registry's version history) still fully supports the non-routing
`getRequestConfig`/`createNextIntlPlugin` API this task uses, with no feature gap for this scope.
risk: low (within the plan's own "not a tech-stack ADR" carve-out for this task's chosen next-intl
version).

### 20 Oct 2026 · `environmentMatchGlobs` replaced with a per-file `@vitest-environment` docblock · decided by tdd-guide
Decided: `apps/web/vitest.config.ts` keeps `environment: 'node'` as the suite default and the new
`.test.tsx` files each carry a `// @vitest-environment jsdom` docblock comment, instead of the
plan's suggested `environmentMatchGlobs` config option.
Why: the installed vitest (`5.0.5`, already pinned in the workspace) removed `environmentMatchGlobs`
from its config type; the per-file docblock override is still supported in 5.0.5 and gives the same
per-file environment selection the plan asked for, without introducing Vitest's `projects`
(workspace) config — which the plan itself called overkill for two environments in one small
package — for just this one override.
risk: low.

### 20 Oct 2026 · jest-axe over vitest-axe for the axe runner · decided by tdd-guide
Decided: `jest-axe@11.0.0` (published 2 months before this task, actively maintained) is the axe
runner, not `vitest-axe` (latest tagged release `0.1.0`, four years old; its `pre` tag
`1.0.0-pre.5` is a year old and still pre-release).
Why: `jest-axe`'s matcher (`expect.extend({ toHaveNoViolations })`) is framework-agnostic — it only
needs `expect.extend`, which Vitest's `expect` also supports — so it works under Vitest without a
Jest runtime; `apps/web/test/jest-axe.d.ts` supplies the Vitest-side type augmentation `jest-axe`'s
own types (written for Jest) don't provide. The plan asked for "an axe runner for vitest", not
`vitest-axe` by name.
risk: low.
