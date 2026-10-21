# 8.1a handoff: Onboarding form in apps/web

Status: DONE

Branch: `work-8.1a` (pushes to `m8/8.1a-onboarding-form`)
Worktree: `.claude/worktrees/agent-acb93c4f97b7fe4e8` (relative to the repo root)

## Acceptance evidence

| Item | Evidence |
|---|---|
| A signed-in teacher can create their profile | `apps/web/app/teacher/onboarding/page.tsx` calls `requireRole(['teacher'])` then `serverDatabase().repos.teacherProfiles.get({ teacherId })`. With no profile, `OnboardingForm` renders create mode (slug, subject, bio, languages) and `POST`s to `/api/studio/profile`. Proven in `OnboardingForm.test.tsx` ("create mode: shows slug, subject, bio and languages fields..." and "create mode: submits a POST...") and `page.test.ts` ("teacher with no profile renders create mode"). |
| A signed-in teacher can edit their profile | With a profile, `OnboardingForm` renders edit mode (slug read-only, subject/bio/languages editable) and `PUT`s to `/api/studio/profile`. Proven in `OnboardingForm.test.tsx` ("edit mode: slug is read-only, submits a PUT...") and `page.test.ts` ("teacher with a profile renders edit mode, prefilled..."). |
| An unverified teacher sees that publishing waits on staff verification | A banner reads `profile?.verificationStatus ?? 'pending'`: `pending`/`rejected` show "waits on staff verification" wording, `verified` shows a neutral "is verified" line; no profile yet uses the pending wording. Proven in `OnboardingForm.test.tsx`'s per-status banner tests and the "no profile yet" test. |
| Thin route handler, no new business logic | `apps/web/src/studio/profile.ts`'s `create`/`update` read the body (size-capped), build `{ teacherId: ctx.principal.userId }` as the scope, and forward the body as-is to `teacherProfiles.create`/`.update` -- no new zod schema. `profile.test.ts` proves a bad body (missing `subject`, or one carrying `verificationStatus`) surfaces as the repo's own `invalid` -> 400, never reaching the repo's write path differently than any other call. |
| Staff `by` id never comes from request input | Not applicable -- no verify/reject action exists in this task; `profile.ts` never imports or calls `setVerification`. |
| No contracts, no db, no auth-file change | `git diff origin/main --stat -- packages/contracts packages/db apps/web/src/auth` is empty (confirmed below). |

### Acceptance commands run

```
$ cd apps/web && corepack pnpm exec vitest run src/studio/profile.test.ts
 Test Files  1 passed (1)
      Tests  13 passed (13)

$ corepack pnpm exec vitest run app/teacher/onboarding/OnboardingForm.test.tsx
 Test Files  1 passed (1)
      Tests  11 passed (11)

$ corepack pnpm exec vitest run app/teacher/onboarding/page.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ git diff origin/main --stat -- packages/contracts packages/db apps/web/src/auth
(empty)
```

Full filter run:

```
$ export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
...
@edmate/web:test:  Test Files  48 passed | 1 skipped (49)
@edmate/web:test:       Tests  729 passed | 4 skipped (733)
 Tasks:    34 successful, 34 total
```
(`@edmate/web:lint` and `@edmate/web:typecheck` both completed with no errors before the test run above; the 1 skipped file is `@edmate/db`'s Postgres integration suite, unrelated to this task.)

Coverage (`src/studio`, v8 report from the run above):

```
files.ts      100 / 100 / 100 / 100
index.ts       50 /  — /   0 /  50   (wiring only, same shape as 8.2's)
profile.ts   94.73 / 93.33 / 90 / 96.87  (line 113 uncovered: the real-runtime wiring constant)
routes.ts    98.78 / 98.82 / 95.83 / 100
```

Secret scan: `python3 .githooks/secret-scan.py --all` -> clean (no output, exit 0).

## Changes

- `apps/web/src/studio/profile.ts` (new): `createProfileHandlers` -- the `create`/`update` handlers
  over an injected `ProfileBackend` (teacherProfiles repo only), plus `profileHandlers` wired to
  `serverDatabase()`. Reads the body through `routes.ts`'s size-capped `readJson`/`TOO_LARGE`
  (exported for this), builds the scope from the session principal, forwards the body as-is, and
  maps `RepositoryError.kind` to a fixed-English response (`scope`->403, `not_found`->404,
  `invalid`/`integrity`->400, `failed`->500; anything else->500).
- `apps/web/src/studio/profile.test.ts` (new): 13 cases over a fake repo (no database) --
  create/update forward the scope and body correctly, a body `teacherId`/`userId` is ignored, a
  bad body (missing `subject`, or carrying `verificationStatus`) is the repo's own `invalid` -> 400
  before reaching SQL, an oversize body is 413 before parsing, malformed JSON is 400, each
  `RepositoryError.kind` maps to its status, and an unexpected error's message text never reaches
  the client.
- `apps/web/src/studio/routes.ts` (modified): exported `TOO_LARGE` and `readJson` (previously
  module-private) so `profile.ts` reuses the same size-capped body reader, per the lead's note.
- `apps/web/app/api/studio/profile/route.ts` (new): `POST`/`PUT` wrapped in
  `withRole(['teacher'], ...)`; picked up automatically by `route-coverage.test.ts` (no edit needed
  there) against the existing `/api/studio/**` policy row.
- `apps/web/app/teacher/onboarding/page.tsx` (new): server component -- `requireRole(['teacher'])`,
  reads the session's own profile, wraps `AppShell` + a scoped `NextIntlClientProvider` (only the
  `onboarding` namespace) around the client `OnboardingForm`.
- `apps/web/app/teacher/onboarding/page.test.ts` (new): 4 cases -- reads only the session's own
  teacher id, create mode with no profile, edit mode prefilled with the right banner, and nothing
  is read from the database when the guard rejects (anonymous/wrong role, simulated the same way
  `uploads/page.test.tsx` does).
- `apps/web/app/teacher/onboarding/OnboardingForm.tsx` (new): client component, one file (folded
  `view.tsx` into this -- see Decisions). Local state for the profile and form fields; a banner
  for `verificationStatus`; slug editable only in create mode; languages as one comma-separated
  text input split/trimmed client-side; submit disabled while in flight; a fixed server error
  message shown in a `role="alert"` box.
- `apps/web/app/teacher/onboarding/OnboardingForm.test.tsx` (new): 11 cases -- create mode fields,
  create POST body and the switch to edit mode on success, edit mode's read-only slug and PUT
  body, one case per `verificationStatus` banner plus "no profile yet", a submit error shown,
  submit-disabled-while-in-flight, and axe-clean in both create and edit mode.
- `apps/web/app/teacher/view.tsx` / `view.test.tsx` (modified): added the third nav link,
  `{ href: '/teacher/onboarding', label: t('onboardingLink') }`, alongside the `/teacher/uploads`
  link 8.2 already added (additive, per the plan's "Before starting the build" note -- re-read
  after 8.2 merged and confirmed the uploads link was present).
- `apps/web/messages/en.json` (modified): added `teacher.onboardingLink` and the `onboarding`
  namespace (title, labels, hints, button/status text).

## Deviations from plan

- No separate `view.tsx` file for the onboarding page: `OnboardingForm.tsx` is the only client
  component this task needs, so `page.tsx` renders it directly (the plan explicitly left this to
  the builder's discretion when "a separate pure view [is] unnecessary for one component").
- No `errors` map added to `en.json`: the server's fixed `error.message` text is shown directly in
  the alert box (the plan called this optional and left it to the builder; one or two lines was
  the ceiling either way, and the server already only returns a small, fixed set of messages for
  this route).
- Exported `TOO_LARGE` from `routes.ts` in addition to `readJson` (the plan named `readJson` only)
  -- `readJson`'s return type includes the `TOO_LARGE` sentinel, so `profile.ts` needs the same
  symbol to compare against; keeping it the same symbol (not a new local one) is what makes reuse
  meaningful.

## Left to do

None -- all acceptance items, tests, typecheck, lint and the secret scan are green.

## Fix round (review)

- [HIGH] Unhandled rejection on fetch failure / invalid success JSON: `onSubmit` now has a `catch`
  that sets `t('errors.generic')` in the `role="alert"` box, so a rejected `fetch` or a success
  response whose `res.json()` throws no longer becomes an unhandled rejection with no visible
  error. Added tests for both: a rejected fetch, and a 200 response with invalid JSON.
- [MEDIUM] Added `onboarding.errors.generic` ("Something went wrong. Please try again.") to
  `apps/web/messages/en.json`; the no-message fallback on a non-ok response and the new `catch`
  both use this key instead of the misleading `t('saving')` fallback.
- [LOW] The unguarded success-path `res.json()` is now covered by the new `catch` above.

## Decisions

### 21 Oct 2026 · One client component, no separate onboarding view.tsx · decided by tdd-guide
Decided: `OnboardingForm.tsx` is the only client component; `page.tsx` renders it directly instead
of adding a pure `view.tsx` wrapper.
Why: the plan named this a builder's-discretion call ("fold into page.tsx if ... a separate pure
view [is] unnecessary for one component"); there is exactly one component here, so a wrapper would
only forward props with no logic of its own, unlike `uploads/UploadsView.tsx` which the server page
also has to pass computed data into alongside other page concerns.
risk: low

### 21 Oct 2026 · Server error text shown directly, no client errors map · decided by tdd-guide
Decided: `OnboardingForm` shows the API response's `error.message` text directly in the
`role="alert"` box, with no per-code translation map in `en.json`; the one fallback key `onboarding.errors.generic` (fix round) covers a missing message or a network failure.
Why: the plan called the errors map optional and capped it at "one or two lines, not a full
exhaustive switch"; this route's `fromError` in `profile.ts` only ever returns five fixed,
already-English, non-identifying messages (same reasoning the chat error banner uses for its own
fixed strings, per the plan), so a second copy of the same five strings in `en.json` would be pure
duplication with no behavioural difference.
risk: low

### 21 Oct 2026 · 8.1a merged with code-reviewer and typescript-reviewer only · decided by team lead
Decided: no security-reviewer run; the diff touches no risky path (no auth, policy, db or contracts file), and code-reviewer checked the security properties explicitly: scope from the session only, body teacherId/userId/verificationStatus ignored or rejected, 16 KB body cap reused, fixed error text only, the route under the teacher-only /api/studio/** row. The typescript-reviewer HIGH (no catch in the submit handler) was fixed in bf633b7 and the lead read the fix diff.
Why: MVP first (human, 20 Oct 2026), one fix round, reviewers only where the diff needs them.
risk: low
