# 8.1a plan: Onboarding form in apps/web (8.1 Phase C)

Board: milestone M8 · deps `8.1` (done: `teacherProfiles.create/get/update`,
`assertVerifiedForPublish`, staff CLI), `9.1` (done: `AppShell`, next-intl, `requireRole`,
`serverDatabase()`, `/teacher` placeholder) · one phase, no risky paths.

Builds on top of task 8.2 (branch `m8/8.2-upload-centre`, not yet merged, which is expected to
land first and may add an "Uploads" nav link to `apps/web/app/teacher/view.tsx` and files under
`apps/web/src/storage/**`/`apps/web/app/api/studio/documents/**`). **Before starting the build,
re-read `apps/web/app/teacher/view.tsx` as it stands after 8.2 merges** and add this task's nav
link alongside whatever 8.2 added, rather than assuming the file is still 9.1's original. No other
file this plan touches is named in 8.2's plan.

## Acceptance (verbatim, `docs/board/tasks.yaml` id 8.1a)
"a signed-in teacher can create and edit their profile; an unverified teacher sees that publishing
waits on staff verification."

### How it is shown (paste into handoff.md)
| Item | Evidence |
|---|---|
| A signed-in teacher can create their profile | `apps/web/app/teacher/onboarding/page.tsx`: `requireRole(['teacher'])`, then `serverDatabase().repos.teacherProfiles.get({ teacherId })`. With no profile, `OnboardingForm` renders in create mode (slug, subject, bio, languages) and posts to `POST /api/studio/profile`. `OnboardingForm.test.tsx` "create mode" case; `page.test.ts` "teacher with no profile renders create mode". |
| A signed-in teacher can edit their profile | With a profile, `OnboardingForm` renders in edit mode (slug shown read-only; subject, bio, languages editable) and posts to `PUT /api/studio/profile`. `OnboardingForm.test.tsx` "edit mode, submits the changed fields"; `page.test.ts` "teacher with a profile renders edit mode, prefilled". |
| An unverified teacher sees that publishing waits on staff verification | A banner above the form reads the fixed English text for `verificationStatus` (`pending`/`rejected` → "waits on staff verification" wording; `verified` → a neutral "verified" line). No profile yet also shows the pending-style wording (nothing is live before the first save either). `OnboardingForm.test.tsx` one case per status. |
| Thin route handler, no new business logic | `apps/web/src/studio/profile.ts`'s `create`/`update` handlers do nothing but read the principal (already done by `withRole`), build `{ teacherId: principal.userId }` as the scope, parse the JSON body, and forward it as-is to `teacherProfiles.create`/`.update` — exactly the input validation and the "teacher's own id as the scope" rule 8.1's own Phase C spec named, and no new zod schema duplicating the repo's (`CreateInput`/`UpdateInput` in `teacher-profiles.ts` already do that). `profile.test.ts` proves a bad body (e.g. a `verificationStatus` key, or a missing `subject`) comes back as the repo's own `invalid` → 400, never reaches SQL — same proof 8.1's own repo test already gives one level down. |
| Staff `by` id never comes from request input | Not applicable: this task builds no verify/reject action at all (8.1's Phase C spec: "no in-app verify action... that is the CLI, until 12.1"); `profile.ts` never calls `setVerification`. Documented here because 8.1's handoff left this note specifically for 8.1a. |
| No contracts, no db, no auth-file change | `git diff origin/main --stat -- packages/contracts packages/db apps/web/src/auth` is empty (profile.ts imports `serverDatabase`/`requireRole`/`withRole`, none of which are edited — both already exist, from 9.1 and 9.4). |

## Design

### The route (`apps/web/src/studio/profile.ts` + `apps/web/app/api/studio/profile/route.ts`)
- `ROUTE_POLICY` already has `{ pattern: '/api/studio/**', methods: ['GET', 'POST', 'PUT'], access: ['teacher'] }` (added by 1.3, confirmed still on `main`) — **no `policy.ts` edit**. Teachers have no `clearance` gate (the comment in `policy.ts`: "Teachers and staff are not age-gated").
- `createProfileHandlers(deps: { repos: () => Pick<Repositories, 'teacherProfiles'> })` returns `{ create, update }`, each `(req: NextRequest, ctx: RoleContext) => Promise<Response>`:
  - Read the body with `await req.json()`; a parse failure is caught and answered as the repo's own `invalid` shape (400 `validation`, fixed English text) without ever reaching the repo.
  - `scope = { teacherId: ctx.principal.userId }` — **always the session's own id, never a body field** (same rule the route-coverage/acting-user-id convention already enforces elsewhere; a body that tries to set `teacherId`/`userId` can't, because `TeacherScope` is built here, not parsed from the body).
  - `create`: `await deps.repos().teacherProfiles.create(scope, body)`, returns `201 { profile: row }` or maps a thrown `RepositoryError` (see below).
  - `update`: same shape calling `.update`, returns `200 { profile: row }`.
  - Error mapping (`RepositoryError.kind` → status, reusing `RepositoryError.code` as the `ErrorCode` the body already carries): `scope`→403, `not_found`→404, `invalid`/`integrity`→400, `failed`→500. Message text is fixed per kind (never the repo's own `Error.message`, which only ever names the method and kind anyway, but the convention elsewhere is "never echo server text" — keep it).
- `apps/web/app/api/studio/profile/route.ts`: `export const POST = withRole(['teacher'], profileHandlers.create); export const PUT = withRole(['teacher'], profileHandlers.update);`. `route-coverage.test.ts` picks this file up automatically (no edit needed there) and checks the brand against the existing policy row.
- Default `profileHandlers` wires `deps.repos = () => serverDatabase().repos` (the same memoised runtime 9.4 already exports from `apps/web/src/auth/index.ts` — read-only use, no edit to that file).

### The page (`apps/web/app/teacher/onboarding/page.tsx`, `view.tsx` or a combined file, `OnboardingForm.tsx`)
- `page.tsx` (server): `const principal = await requireRole(['teacher']); const profile = await serverDatabase().repos.teacherProfiles.get({ teacherId: principal.userId });` then render `AppShell` (brand/skip/sign-out from `shell.*`, `nav: [{ href: '/teacher', label: teacher('nav') }]` or similar back-link) wrapping `NextIntlClientProvider locale="en" messages={{ onboarding: messages.onboarding }}` around the client `OnboardingForm`, passing `initialProfile={profile}` — same shape as `app/learn/[agentId]/page.tsx`'s provider scoping (only the `onboarding` namespace goes to the client).
- `OnboardingForm.tsx` (client component): local `useState` for the current profile (`initialProfile` to start) and form fields; a banner reads `profile?.verificationStatus ?? 'pending'` (no profile yet behaves like `pending` for the banner's wording, since nothing can be live before any save) and shows the fixed text for `pending`/`rejected` ("waits on staff verification") vs `verified`. Fields: slug (create only — disabled/read-only once a profile exists, matching 8.1's "slug is set at create only" decision), subject, bio (textarea), languages (a single comma-separated text input, split/trim client-side into the array the repo's `Languages` schema expects — no new UI component, per "no polish"). Submit disabled while a request is in flight; on success the returned `profile` replaces local state (so a first save flips the form from create to edit mode in place, no navigation); on error, the fixed message from the response body's `error.message` is shown in a `role="alert"` box (that text is already server-fixed, not raw/user text, so showing it is safe — same reasoning the chat's error banner uses for its own fixed strings).
- No new storage/photo field (8.1 Q1: no photo in this slice).

### `apps/web/app/teacher/view.tsx`
Add one nav link, `{ href: '/teacher/onboarding', label: teacher('onboardingLink') }`, to the `AppShell` `nav` prop — additive only. If 8.2 has already added an "Uploads" link here, add this one alongside it (two-item `nav` array), not instead of it.

### `apps/web/messages/en.json`
Add `teacher.onboardingLink` and a new `onboarding` namespace: `title`, `slugLabel`, `slugHint` ("can't be changed later"), `subjectLabel`, `bioLabel`, `languagesLabel`, `languagesHint` ("comma-separated, e.g. en, pt-BR"), `createButton`, `saveButton`, `saving`, `saved`, `statusPending` ("Your profile is pending review. Publishing waits on staff verification."), `statusRejected` ("Your profile was not approved. Publishing waits on staff verification." — same "waits on" wording, no reason text per 8.1's "no personal details" convention), `statusVerified` ("Your profile is verified."), and a small `errors` map if the client wants friendlier text than the server's fixed message (optional — the server message can be shown directly; builder's call, keep it to one or two lines either way, not a full `errorText.ts`-style exhaustive switch — this route has only a handful of kinds, not the turn runner's full `ErrorCode` surface).

## Files
- **Create:** `apps/web/src/studio/profile.ts`, `apps/web/src/studio/profile.test.ts`,
  `apps/web/app/api/studio/profile/route.ts`, `apps/web/app/teacher/onboarding/page.tsx`,
  `apps/web/app/teacher/onboarding/view.tsx` (or fold into `page.tsx` if the builder finds a
  separate pure view unnecessary for one component — builder's call, matching 9.4's split only
  where it earns its keep), `apps/web/app/teacher/onboarding/OnboardingForm.tsx`,
  `apps/web/app/teacher/onboarding/OnboardingForm.test.tsx`,
  `apps/web/app/teacher/onboarding/page.test.ts`.
- **Modify:** `apps/web/app/teacher/view.tsx`, `apps/web/app/teacher/view.test.tsx`,
  `apps/web/messages/en.json`.
- **Check first, do not assume unchanged:** `apps/web/app/teacher/view.tsx` (8.2 may have already
  edited it).
- **Tests first:** `profile.test.ts` (fake `repos.teacherProfiles`) before `profile.ts`;
  `page.test.ts` (fake `requireRole`/`serverDatabase`, the four branches: anonymous → redirect to
  `SIGN_IN_PATH`, student → `notFound`, teacher with no profile → create mode, teacher with a
  profile → edit mode with the right banner) before `page.tsx`; `OnboardingForm.test.tsx` (create
  mode, edit mode, each `verificationStatus` banner, a submit error shown, submit disabled while
  pending, axe-clean in every state) before `OnboardingForm.tsx`.
- **Size:** ~11 files, no risky path, no new dependency, no contracts/db/auth-file change — one
  phase, well under the ~150-tool-call budget (closer to 9.1 Phase C's ~9-10 files, which this
  mirrors almost exactly).

## Files out of bounds
- `packages/contracts/**`, `packages/db/**`, `docs/adr/**` — no change; `teacherProfiles` already
  has everything this task calls (8.1, done).
- `apps/web/src/auth/**` — read-only use of `requireRole`, `withRole`, `serverDatabase`, all
  already exported; no edit.
- `apps/web/src/auth/policy.ts` — the `/api/studio/**` row already covers GET/POST/PUT for
  `teacher`; no edit needed (8.2's plan separately adds `DELETE` to the same row for its own
  routes — do not duplicate or conflict with that edit; if it has already landed when this task
  starts, leave it as 8.2 left it).
- Any verify/reject UI, and `teacherProfiles.setVerification` — not called here at all (CLI/12.1
  remains the only path); per 8.1's handoff note, if a later reviewer asks for an in-app verify
  button, that is out of this task's scope and goes back to the lead.
- `photo` / any file upload — still no input for it (8.1 Q1); 8.2's upload centre is a separate
  page (`/teacher/uploads`), not this form.
- `apps/web/app/teacher/uploads/**`, `apps/web/src/storage/**`,
  `apps/web/app/api/studio/documents/**` — 8.2's files; not touched.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
None. Every file this plan creates or modifies — `apps/web/src/studio/**`, `apps/web/app/api/
studio/profile/**`, `apps/web/app/teacher/onboarding/**`, `apps/web/app/teacher/view.tsx`,
`apps/web/messages/en.json` — was checked against every glob in `risk-paths.txt`
(`packages/harness/src/guardrails/**`, `content/**`, `apps/worker/src/alerts/**`,
`packages/harness/src/access/**`, `packages/payments/**`, `apps/web/app/api/webhooks/**`,
`apps/web/src/auth/**`, `apps/web/app/api/auth/**`, `packages/db/src/identity/**`,
`packages/gateway/src/keys/**`, `packages/db/src/repositories/**`, `packages/contracts/**`,
`docs/adr/**`, `.claude/**`, `.github/**`, `.githooks/**`) and matches none of them. No `risk:
high` decision is required for this task. (Routine, not gate-required: `code-reviewer` and
`typescript-reviewer` on the PR as usual.)

## Open questions
None blocking. Two small builder-discretion calls are named inline above (whether `view.tsx` is a
separate file from `page.tsx`, and how much of an `errors` map the client needs) — not sent to the
human, as neither changes the acceptance evidence or touches a risky path.

## Status
READY.

## Lead notes (20 Oct 2026)
- Read the body through 8.2's size-capped reader (`readCapped`/`readJson` in `apps/web/src/studio/routes.ts`, export it if needed) instead of a bare `req.json()`; an oversize body is a 413 or 400 `validation`, never parsed.
- `profile.test.ts` also proves a body `teacherId`/`userId` is ignored: the row lands under the session's teacher.
