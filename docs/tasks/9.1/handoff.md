# 9.1 handoff: app shell, mobile-first layouts (Phase A)

Status: PARTIAL (Phase A done; Phases B and C not started)

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

## Left to do
- **Phase B** (risky: `apps/web/src/auth/**`, reviewers: security-reviewer) — `SIGN_IN_PATH`
  export, `currentPrincipal()`, the real `/sign-in` page and its Google sign-in server action, the
  `/welcome/age` literal-path replacements.
- **Phase C** — the `/` dispatcher, `/home` and `/teacher` gated routes and their views, the
  manual Lighthouse ≥95 run at 360px for `/sign-in`, `/home`, `/teacher` (the plan's Acceptance
  evidence), and `apps/web/messages/en.json`'s home/teacher/dispatcher strings.
- The plan's "Coordination note" (8.1 sequencing) still applies: 8.1's teacher pages should wait
  for Phase B to merge, or build without `AppShell` first and refactor — a lead sequencing call.

## Decisions

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
