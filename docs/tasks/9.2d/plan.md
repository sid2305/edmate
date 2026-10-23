# 9.2d plan: a teacher-set public display name on discovery and teacher pages

Board: milestone M13 · risk medium · deps `9.2` (done). Follow-up of 9.2 plan Q2 (lead, 22 Oct
2026: "a verified teacher's sign-in name shows publicly ... a teacher-set public display name is a
follow-up (9.2d)"). Packages: `packages/db` (Phase A), `apps/web` (Phase B). English only (pilot).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "9.2 plan Q2 follow-up: a public display name the teacher sets in onboarding, shown on
discovery and teacher pages instead of the sign-in name"
Accept: "a teacher sets a display name and the public pages show it; the sign-in name no longer
appears publicly."

### How it is shown (paste into the Phase B handoff)

| Item | Evidence |
|---|---|
| A teacher sets a display name | Phase A `packages/db/test/teacher-profiles.int.test.ts`: `create` with `displayName` stores it and returns it; `update({ displayName })` changes it and leaves `verificationStatus` alone. Phase B `OnboardingForm.test.tsx`: the field is on the form in create and edit mode, the POST body carries it, the PUT body carries it when filled. |
| The public pages show it | Phase A `packages/db/test/discovery.int.test.ts`: a verified teacher whose `users.name` is `Private Signin Name` and whose profile `display_name` is `Public Teaching Name` shows `displayName: 'Public Teaching Name'` from both `search` and `teacherBySlug`. The pages (`/teachers`, `/teachers/[slug]`, `generateMetadata`) already render `displayName` from the repository (9.2 B/C tests, unchanged). |
| The sign-in name no longer appears publicly | Phase A `packages/db/test/scope.test.ts`: `discovery.ts` contains no `users.name` (the guard regex becomes `users\.(name\|email\|phone)`); `discovery.int.test.ts`: `JSON.stringify` of every search result and page never contains `Private Signin Name`, with a display name set and with none (fallback, below). A repo-wide grep in the handoff: `users.name` is read only in `teacherProfiles.listPendingForStaff` (staff-only, 12.1a). |
| Validated input | Phase A `packages/db/test/teacher-profiles.test.ts` (no database): the table under "Validation" below, every row `invalid` before any SQL; trim and whitespace collapse proven by the stored value in the int test. |
| No contracts change | `git diff origin/main -- packages/contracts docs/adr` is empty. |

## Scope decisions (logged in the Phase A handoff `## Decisions`, `risk: high`)

1. **Storage.** One new nullable column `teacher_profiles.display_name text` (NULL = not set yet).
   Additive migration, generated with `db:generate`, no backfill, no data rewrite, no drop or delete
   (so `database-reviewer` is not gate-required).
2. **Existing teachers without a display name: the public name falls back to the slug.** Both public
   reads select `coalesce(display_name, slug)` as `displayName`, so `PublicTeacherCard` /
   `PublicTeacherPage` keep `displayName: string` and nothing in `apps/web` changes shape. The slug
   is already public in the URL, so the fallback leaks nothing; the sign-in name is never the
   fallback. Alternatives rejected: backfilling from `users.name` (keeps the sign-in name public by
   default, the thing the task removes); hiding teachers until they set one (verified seed/demo
   teachers would vanish from `/teachers` on an already-migrated dev stack). In practice the
   fallback only hits profiles created before this migrates: the seeds set a display name (below)
   and new profiles must give one at create.
3. **Who sets it, where.** The onboarding page (`/teacher/onboarding`, 8.1a) is the one place a
   teacher creates and edits their profile; the field lives there in both modes. Required at create
   (`CreateInput.displayName`), optional in a patch (`UpdateInput.displayName?`); omitting it in a
   patch leaves it unchanged (a teacher cannot clear it back to NULL, which is fine: they can
   rename). A display-name change does **not** send the profile back to `pending` (unlike a subject
   change, 8.1c); abuse is covered by takedown and Q2 below.
4. **Validation** (zod `DisplayName` in `teacher-profiles.ts`, exported for the unit test; the
   server is the only validator, the form repeats the rules in a hint):
   - `z.string()`, trimmed, internal whitespace runs collapsed to one space (transform), then
     2–60 characters.
   - at least one letter (`\p{L}`); only letters, marks, digits, space, `'`, `.`, `-` (`/^[\p{L}\p{M}\p{N} '.-]+$/u`), which already rejects control, format, zero-width, bidi, surrogate, private-use and Hangul-filler characters (the `NOT_ONE_LINE` set in `packages/contracts/src/payments.ts`, copied as a comment, not imported: that constant is not exported), `@`, `/`, `:` and emoji.
   - no URL shape: `://`, `www.` (case-insensitive) or `word.tld` with no space (`/[\p{L}\p{N}-]\.[a-z]{2,}/iu`; "Dr. Smith" and "J.R.R. Tolkien" pass, "Dr.Smith" fails and that is accepted).
   - no email: `@` is already outside the allowed set.
   - no phone number: seven or more digits with optional `space ( ) . -` between them
     (`/(?:\d[\s().-]*){7,}/`).
   - no impersonation of the platform: contains none of `edmate`, `staff`, `admin`, `official`
     (case-insensitive, whole word) (Q3).
5. **Seeds set a display name.** `packages/db/src/seed.ts` demo teacher: `displayName: 'Demo
   Teacher'` (the name the persona eval cases and `docs/try-it.md` already use);
   `packages/db/src/discovery-seed.ts`: `displayName: \`Seed Teacher ${num}\`` (the value
   `users.name` carried, so discovery int-test assertions on seed names keep passing).
6. **The staff queue is unchanged** this task: `listPendingForStaff` keeps `name` and `email`
   (staff check identity); showing the public display name to staff is a follow-up (Q2).
7. **A failure is visible.** No new `try/catch`; a bad display name is the repo's `invalid`, which
   the profile route already maps to a 400 `validation` reply the form shows in its alert.

## Files

### Phase A: packages/db (budget 70)

Tests first:
- `packages/db/test/teacher-profiles.test.ts` (no-DB unit): an `it.each` table over `create` and
  `update` → `invalid` before any SQL: empty, one character, 61 characters, whitespace only, no
  letter (`123`), `https://x.y`, `www.example.com`, `ada.example.com`, `ada@example.com`,
  `+1 (415) 555-0100`, `415.555.0100`, zero-width (`A​da`), bidi (`‮Ada`), emoji, a
  newline, `Edmate Support`, `Official Tutor`; `create` without `displayName` → `invalid`;
  `update({})` stays `invalid` (the non-empty refine). Positive checks of the exported
  `DisplayName` schema: `'  Ada   Lovelace '` → `'Ada Lovelace'`; `"Dr. Smith"`, `"J.R.R.
  Tolkien"`, `"Mary-Jane O'Neil"`, `"Teacher 2024"`, `"Søren Ålesund"`, `"प्रिया"` pass.
- `packages/db/test/teacher-profiles.int.test.ts`: `create` stores and returns `displayName`; `get`
  returns it; `update({ displayName: 'New Name' })` changes it and keeps `verificationStatus`
  (verified stays verified); a profile inserted without one reads back `displayName: null`.
- `packages/db/test/discovery.int.test.ts`: the three acceptance rows above (set, fallback to slug,
  `Private Signin Name` never in the serialised result); exact-keys assertions unchanged.
- `packages/db/test/scope.test.ts`: `discovery.ts` matches none of `users\.(name|email|phone)`;
  comment updated (the exception is now `users.role` only).
- `packages/db/test/schema.test.ts`: `teacher_profiles.display_name` is a nullable `text` column
  (via the snapshot `table()` helper, like the `verification_status` check at line 352).
- `packages/db/test/discovery-seed.test.ts`: every seeded profile carries `displayName` equal to
  its user's `name` pattern `Seed Teacher NNN`.
- Fixture one-liners so `tsc` and `toEqual` stay green (`TeacherProfileRow` is a strict schema):
  `packages/db/test/repositories.int.test.ts`, `packages/db/test/verify-teacher-cli.test.ts`,
  `apps/web/app/teacher/onboarding/OnboardingForm.test.tsx` (`PROFILE` gets `displayName: 'Asha'`),
  `apps/web/src/studio/profile.test.ts` (add `displayName` to its profile fixture and create body),
  and any other fixture `corepack pnpm turbo run typecheck --filter=...@edmate/db` names (dependents
  of db: web, worker, cli). Nothing else in `apps/web` changes in Phase A.

Source:
- Modify `packages/db/src/schema/users.ts`: `displayName: text('display_name')` (nullable, no
  default) after `slug`; then `corepack pnpm --filter @edmate/db db:generate` →
  `packages/db/migrations/00NN_teacher_display_name.sql` + `meta/00NN_snapshot.json` +
  `meta/_journal.json`. The latest on `main` today is `0025`; 11.1d owns `0026`, so the builder
  checks the journal at build time and renames the generated file/tag to the next free number if
  drizzle picked a taken one. Expected SQL: one `ALTER TABLE "teacher_profiles" ADD COLUMN
  "display_name" text;`, nothing else.
- Modify `packages/db/src/repositories/teacher-profiles.ts`: `DisplayName` (exported),
  `CreateInput.displayName` (required), `UpdateInput.displayName` (optional), `columns.displayName`,
  insert and update `.set` wiring, header comment. No change to `setVerification`,
  `assertVerifiedForPublish` or `listPendingForStaff` (9.3e's code).
- Modify `packages/db/src/repositories/map.ts`: `TeacherProfileRowSchema.displayName:
  z.string().nullable()`; `toTeacherProfile` input and mapping.
- Modify `packages/db/src/repositories/discovery.ts`: both selects use
  `displayName: sql<string>\`coalesce(${teacherProfiles.displayName}, ${teacherProfiles.slug})\``;
  the `users` inner join stays (for `users.role`); header and `PublicTeacherCard` comments say the
  name comes from the profile, never `users.name`.
- Modify `packages/db/src/repositories/README.md` § 9 and § 11 (`display_name` with the slug
  fallback; `users.name` now reaches only the staff queue).
- Modify `packages/db/src/seed.ts` and `packages/db/src/discovery-seed.ts` (scope decision 5).
- `packages/db/src/repositories/index.ts`: no change expected (types re-export as today); if `tsc`
  needs an export, a one-line type export only.
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` and
  `corepack pnpm turbo run typecheck --filter=...@edmate/db` (dependents), db coverage threshold
  kept, `python3 .githooks/secret-scan.py --all`. Merge `origin/main` before pushing (shared
  migration journal, `teacher-profiles.ts`, int tests).

State after Phase A: a display name can be stored and edited through the repository; `/teachers`
and `/teachers/[slug]` already show it (or the slug) and never the sign-in name; the onboarding
form cannot set it yet, so a new teacher's `POST /api/studio/profile` from the old form gets a 400
until Phase B lands (Phase B follows at once; the lead orders the builds back to back).

### Phase B: apps/web onboarding form (budget 50)

Tests first:
- `apps/web/app/teacher/onboarding/OnboardingForm.test.tsx`: create mode shows a "Display name"
  field with its hint (rules in plain words) and the POST body is `{ slug, displayName, subject,
  bio, languages }`; edit mode prefills `profile.displayName`, the PUT body carries `displayName`
  when the field is non-empty and omits it when empty (keeps the stored value); an existing profile
  with `displayName: null` shows the empty field plus the "until you set one, your page shows
  `<slug>`" notice; a 400 reply shows its message in the alert and re-enables submit (existing
  case, now with the new field filled); axe clean in both modes; the field has `maxLength={60}`
  and `aria-describedby` → hint.
- `apps/web/app/teacher/onboarding/page.test.ts`: unchanged unless the page passes new props (it
  does not).

Source:
- Modify `apps/web/app/teacher/onboarding/OnboardingForm.tsx`: `displayName` state from
  `initialProfile?.displayName ?? ''`; input between the slug and subject; body building per the
  tests; no client-side rule duplication beyond `maxLength` (the server validates; lessons "UI
  state and server replies": the existing try/catch/finally and busy flag stay).
- Modify `apps/web/messages/en.json` (`onboarding` key only): `displayNameLabel: "Display name"`,
  `displayNameHint: "Shown to students on your public page. 2–60 characters; no web addresses,
  emails or phone numbers."`, `displayNameFallback: "Until you set one, your public page shows
  {slug}."`.
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`, secret scan. Merge
  `origin/main` before pushing (`en.json` is shared with 9.3e Phase B's `staff` key).

State after Phase B (task done): a teacher types a display name during onboarding or later on the
same page; discovery cards, the teacher page and its metadata show it; the sign-in name appears
only to staff.

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` (no contracts change: `TeacherProfileRow` has no contract
  type, 8.1 precedent).
- `packages/db/src/repositories/**` other than `teacher-profiles.ts`, `map.ts`, `discovery.ts`,
  `README.md` (and a one-line type export in `index.ts` if `tsc` demands it); in
  `teacher-profiles.ts`, `setVerification`, `assertVerifiedForPublish` and `listPendingForStaff`
  (9.3e's code, and the staff queue is Q2).
- `apps/web/app/teachers/**`, `apps/web/src/discovery/**` (no change needed: they render
  `displayName` as returned), `apps/web/app/staff/**`, `apps/web/app/api/staff/**` (9.3e Phase B),
  `apps/web/src/auth/**`, `apps/web/src/studio/profile.ts` (forwards the body as-is; only its test
  fixture changes), `packages/db/src/cli.ts`, `packages/db/src/bin/**`, `docs/try-it.md`.
- A builder that finds it needs any of these stops at `Status: PARTIAL` and names the file.

## Shared files and build order

- `packages/db/src/repositories/teacher-profiles.ts`, `packages/db/test/teacher-profiles.int.test.ts`
  and `packages/db/test/repositories.int.test.ts` are being changed by 9.3e (Phase A2 in flight):
  **Phase A starts after 9.3e Phase A2 merges** and merges `origin/main` before pushing. Yes,
  `teacher-profiles.ts` must change here (inputs, columns, the insert/update wiring); the change
  is additive and touches none of 9.3e's functions.
- `packages/db/migrations/**` + `meta/_journal.json`: 11.1d owns `0026` (numbering race; the
  builder checks at build time).
- `apps/web/messages/en.json`: 9.3e Phase B adds `staff` keys; 9.2d adds `onboarding` keys only.
- Phase B starts after Phase A merges (it imports the new `TeacherProfileRow.displayName`).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- Phase A: `packages/db/src/repositories/teacher-profiles.ts`, `map.ts`, `discovery.ts`,
  `README.md` (and `index.ts` if touched) match `packages/db/src/repositories/**`.
  **Required reviewer: security-reviewer** (a teacher-written string reaches every anonymous
  visitor; the sign-in name must leave only through the staff queue). Recommended, not
  gate-required: `database-reviewer` (additive nullable column, no drop or delete) and
  `code-reviewer` (runs anyway). The Phase A handoff logs the `risk: high` decision (scope
  decisions 1–4 and 6 in one entry).
- `packages/db/src/schema/**`, `packages/db/migrations/**`, `packages/db/src/seed.ts`,
  `packages/db/src/discovery-seed.ts`, `packages/db/test/**`, `apps/web/app/teacher/**`,
  `apps/web/src/studio/profile.test.ts`, `apps/web/messages/en.json`, `docs/tasks/9.2d/**`: no
  match. (`apps/web/src/auth/**` is imported by the onboarding page, not edited.)
- Phase B touches no risky path.

## Open questions (each with a recommendation; none blocks the build)

- **Q1. Default for existing teachers.** Recommend the slug fallback in the public reads (scope
  decision 2). Alternatives: hide until set, or backfill from `users.name` (rejected above).
- **Q2. Staff see the display name?** Recommend a follow-up board task after 9.3e Phase B merges:
  `listPendingForStaff` returns `displayName` and `verification-row.tsx` shows it, so staff
  approve the public name they are verifying. Not in 9.2d (those files are 9.3e's right now).
- **Q3. Platform-impersonation words.** Recommend the four-word deny list in scope decision 4
  (`edmate`, `staff`, `admin`, `official`; one regex, tested). Drop it if the lead prefers the
  bare MVP: abuse then relies on takedown.
- **Q4. Re-verification on a display-name change.** Recommend no (scope decision 3); a subject
  change already resets, and resetting on rename would let a verified teacher knock themselves
  out of discovery by a typo fix.

## Budget

Budget: 120 tool calls (2 phases: A 70, B 50; packages/db, apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test for `@edmate/db...`,
`...@edmate/db` and `@edmate/web...`, `db:generate` in Phase A, `docker compose` + `db:migrate`
for the int tests, the secret scan, git add/commit/push on the task branch only). No network beyond
localhost, no real model or payment calls.

## Exit conditions

A phase ends `Status: DONE` when its tests above exist and pass (tests first), its gate commands
are green with the db coverage threshold kept, `python3 .githooks/secret-scan.py --all` is clean,
and its "state after" line is true; the Phase A handoff carries the `risk: high` decision and the
`users.name` grep result; the Phase B handoff carries the "How it is shown" table. A builder stops
at `Status: PARTIAL` past its phase budget (A 70, B 50), if a file under "Files out of bounds"
needs a change, if `db:generate` emits anything beyond the one `ADD COLUMN`, if Phase A starts
before 9.3e Phase A2 is on `main`, or if Phase B starts before Phase A is on `main`.

## Status

READY

## Lead answers (22 Oct 2026)

- Q1: yes, the slug fallback in the public reads.
- Q2: yes, a follow-up board task after 9.3e Phase B merges (staff see the display name); not in 9.2d.
- Q3: yes, the four-word deny list (one regex, tested).
- Q4: no re-verification on a display-name change.
- Builders do not run `docker compose`: Postgres (127.0.0.1:55432) and Redis (127.0.0.1:56379) are already up; run `db:migrate` against them only.
- Phase A starts only after 9.3e (Phase A2 and B) is on `main`, since both touch teacher-profiles.
