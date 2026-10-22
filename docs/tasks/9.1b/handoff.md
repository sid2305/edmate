# 9.1b handoff: 9.1 review follow-ups in apps/web

## Summary

Three follow-ups from the 9.1 review, in `apps/web`:

1. `currentPrincipal` (`apps/web/src/auth/index.ts`) now logs a lookup failure through the same
   `console.error` convention the rest of `src/auth` uses, via `describeError` (name and Auth.js
   `type` only, never the message -- messages can hold an email). It still returns `null`
   afterwards: no change to who is treated as signed in.
2. Added `HOME_PATH = '/home'` and `TEACHER_PATH = '/teacher'` next to `SIGN_IN_PATH` in
   `apps/web/src/auth/guard.ts`, re-exported from `apps/web/src/auth/index.ts`, and replaced the
   `'/home'` / `'/teacher'` route-path literals across `apps/web/src` and `apps/web/app` (nav
   links, redirects) with them. Sub-routes built from literal strings (e.g.
   `/teacher/uploads`, `/learn/${agentId}/plan`) were left alone, as scoped.
3. Dropped the `/home` self-link from `HomeView`'s nav (`apps/web/app/home/view.tsx`): `/home`'s
   own nav now only has the "Find a teacher" link; its test was updated to assert there is no
   "Home" link.

## Files

- `apps/web/src/auth/index.ts` -- `currentPrincipal` logs before returning null; re-exports
  `HOME_PATH`, `TEACHER_PATH`.
- `apps/web/src/auth/index.test.ts` -- failure-reads-as-null test now asserts exactly one
  `console.error` call with no message/email in it.
- `apps/web/src/auth/guard.ts` -- `HOME_PATH`, `TEACHER_PATH` exports.
- `apps/web/src/auth/guard.test.ts` -- asserts their values.
- `apps/web/src/discovery/nav.ts` -- uses `HOME_PATH` / `TEACHER_PATH` / `SIGN_IN_PATH` instead of
  literals.
- `apps/web/app/page.tsx`, `apps/web/app/page.test.ts` -- dispatcher uses `HOME_PATH` /
  `TEACHER_PATH`; test mock of `src/auth` extended with both.
- `apps/web/app/home/view.tsx`, `apps/web/app/home/view.test.tsx` -- self-link dropped (shared
  file, append-only elsewhere; this is the one required removal).
- `apps/web/app/teacher/view.tsx` -- `TEACHER_PATH` for its own nav link.
- Route pages switched from the `'/home'` / `'/teacher'` literal to the constant:
  `apps/web/app/learn/[agentId]/{page,plan/page,progress/page,memory/page}.tsx`,
  `apps/web/app/packages/[agentId]/page.tsx` (4 occurrences),
  `apps/web/app/teacher/{insights,uploads,live-classes,publish,outline,packages,style-card,questions,onboarding}/page.tsx`,
  `apps/web/app/teacher/test-chat/[agentId]/page.tsx`.
- Matching test files' `vi.mock('.../src/auth', ...)` blocks extended with `HOME_PATH` /
  `TEACHER_PATH` (and `SIGN_IN_PATH` where `nav.ts` is reached): `apps/web/app/legal/rights/page.test.tsx`,
  `apps/web/app/teachers/page.test.tsx`, `apps/web/app/teachers/[slug]/page.test.tsx`,
  `apps/web/app/learn/[agentId]/{page,plan/page,progress/page,memory/page}.test.tsx`,
  `apps/web/app/packages/[agentId]/page.test.tsx`,
  `apps/web/app/teacher/{insights,live-classes,publish,style-card,onboarding,page,packages,uploads,test-chat/[agentId],questions}/page.test.tsx`.

Test files' own expected URL strings (e.g. `toHaveAttribute('href', '/home')`) were left as
literals, as scoped.

## Tests

1. `currentPrincipal` logging: `apps/web/src/auth/index.test.ts` -- "currentPrincipal: a lookup
   failure reads as null, not thrown, and logs exactly once". Before the fix it failed (no log
   call recorded); after, it passes: `console.error` is called once with
   `'[auth] currentPrincipal Error'` (the thrown error's message, which included an email, is
   never read).
2. `HOME_PATH` / `TEACHER_PATH`: `apps/web/src/auth/guard.test.ts` -- "HOME_PATH and TEACHER_PATH
   are the one spelling for each role home (task 9.1b)". Failed before the exports existed
   (`ReferenceError`/import error), passes now with `'/home'` and `'/teacher'`.
3. Self-link drop: `apps/web/app/home/view.test.tsx` -- "shows the placeholder and a sign-out
   button, with no self-link to /home (task 9.1b)". Before the fix, `queryByRole('link', { name:
   'Home' })` found the self-link (test failed); after removing it, the query returns `null`.

Full gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` -- all green (140
test files passed, 5 skipped for missing Redis/Postgres fixtures as usual, 0 failed).
`python3 .githooks/secret-scan.py --all` -- clean (exit 0).

## Decisions

### 22 Oct 2026 · 9.1b logging the currentPrincipal failure · decided by builder · risk: high
- Decided: Log the caught error in `currentPrincipal` as `[auth] currentPrincipal <name> (<Auth.js
  type>)` via the existing `describeError` helper (never the error's `message` or `cause`), then
  still return `null`. No change to who is treated as signed in or to any guard's enforcement.
- Why: `apps/web/src/auth/**` is a risk path; a silent `catch { return null }` hid lookup failures
  (reviewed in 9.1). The rest of `src/auth` (redis errors, mail errors, age-content errors) already
  logs this way, so this keeps one convention and avoids leaking anything personal -- `describeError`
  deliberately drops the message because Auth.js, nodemailer and driver errors can carry an email
  there.
- risk: high (touches `apps/web/src/auth/**`; reviewers: security-reviewer to confirm no personal
  data can reach the log and no behaviour change to sign-in; typescript-reviewer for the
  `guard.ts`/`index.ts` export changes).

### 22 Oct 2026 · 9.1b HOME_PATH/TEACHER_PATH scope · decided by builder · risk: low
- Decided: Added the two constants only where `'/home'` or `'/teacher'` was used as a full route
  path (redirects, nav `href`s); left every sub-route (`/teacher/uploads`, `/learn/.../plan`, etc.)
  and every test file's expected URL string untouched, matching the written scope.
- Why: keeps the diff to the literal ask and avoids churn in files outside this task's scope.
- risk: low (no behaviour change; purely a string constant substitution, covered by the existing
  route tests which still assert the same literal URLs).

## Left to do

None -- all three scope items are done and tested.

Status: DONE

Tool calls used: 64
