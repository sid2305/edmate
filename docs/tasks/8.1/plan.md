# Task 8.1 plan: Onboarding — profile, subject, bio, photo; identity checked manually by staff

Board: milestone M8 · deps `GATE` (waived for this thin slice, 20 Oct 2026 decision), `1.3`, `5.1`,
`5.2` (all done) · branch `m8/8.1-onboarding` · **risky** (touches `packages/db/src/repositories/**`)
· three phases: A and B are db-only (one builder each, tdd-guide), Phase C (apps/web UI) is
**blocked on 9.1** and is written here only as a forward spec — do not start it until 9.1's app
shell has merged.

Context: the human approved a thin MVP slice ahead of the harness exit gate (decision log, 20 Oct
2026, "Thin teacher-upload + student-chat slice"): 8.1, 8.2, 9.1, 9.4. Per that decision, GATE is
waived for the build only; nothing reaches real students before GATE passes. 8.1's own acceptance
line is purely server-side, so Phases A+B alone satisfy it — Phase C is the bare-form UI the task's
title also promises, deferred until 9.1 exists to host it.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Onboarding: profile, subject, bio, photo; identity checked manually by staff (12.1)"
Accept: "an unverified teacher cannot publish."

### How it is shown (paste into handoff.md)
| Item | Evidence |
|---|---|
| Profile data model | `teacher_profiles` already exists (migration 0001, task 1.1/1.3): `slug`, `subject`, `bio`, `photo`, `languages`, `verificationStatus`, `payoutAccountRef`, one row per teacher (`teacher_profiles_user_id_key`). 8.1 only converts `verificationStatus` from free text to a `teacher_verification_status` enum (`pending`/`verified`/`rejected`) for defense in depth — same pattern as `agent_status`/`subscription_status`. |
| Teacher can create/read/edit own profile | `teacherProfilesRepo.create`/`.get`/`.update` (new, `packages/db/src/repositories/teacher-profiles.ts`), teacher-scoped like every other repository; `.update`'s input schema has no `verificationStatus` key, so a teacher can never set it on themself (`repositories.int.test.ts` isolation case + a dedicated unit test that a strict-object patch containing `verificationStatus` is rejected before any SQL). |
| Verified flag settable only by staff | `teacherProfilesRepo.setVerification({ teacherId, status, by, reason? })`: inside one transaction, re-reads `users` for `by` and requires `role = 'staff'` (else `RepositoryError('scope')`, same pattern as `identity.grantRole`'s actor check) before writing `verification_status` and a `teacher.verify` audit row via `insertAuditEntry` (`action: 'teacher.verify'`, `before`/`after: { verificationStatus }` — the exact shape `repositories.int.test.ts` already exercises at lines 1969-1978/2010-2021 as a generic audit fixture). A test calling it with a non-staff `by` id throws `scope` and leaves the row unchanged. |
| An unverified teacher cannot publish, enforced server-side | New `teacherProfilesRepo.assertVerifiedForPublish(scope)`: throws `RepositoryError('scope', ...)` unless the scope's own profile exists and `verificationStatus === 'verified'`; resolves otherwise. Unit test: no profile → throws; `pending` → throws; `rejected` → throws; `verified` → resolves. This is the primitive 8.7 (Publish flow, not yet built) will call before flipping `agents.status` to `live`; 8.1 does not build 8.7's gate/scorecard machinery, only this guard, per the lead's scope note. |
| Staff tool (12.1 is out of scope) | `pnpm --filter @edmate/db db:verify-teacher -- --email <teacherEmail> --status verified\|rejected --by <staffUserId> [--reason <text>]`, modelled on the existing `db:grant-role` CLI (`src/cli.ts`, `src/bin/grant-role.ts`): resolves the teacher by email via the identity store, calls `setVerification`, never prints the email. A CLI test mirrors `grant-role-cli.test.ts` (fake identity + fake repo). |
| No contracts change | `git diff origin/main -- packages/contracts` is empty. No `TeacherProfile` contract type exists or is added — same precedent as `AuditRow`/`SessionRow` (`map.ts`'s own comment: "no contract type exists for it"); the row schema is a local zod object in `teacher-profiles.ts`/`map.ts`. |
| No real storage calls in tests | Nothing here calls a model, payment or object-storage provider; `photo` stays a plain nullable string column (see Open question). |

## Design

### Phase A — schema, migration, repository (packages/db only)

1. `packages/db/src/schema/_shared.ts`: add `export const teacherVerificationStatus = pgEnum('teacher_verification_status', ['pending', 'verified', 'rejected']);` next to the other status enums.
2. `packages/db/src/schema/users.ts`: change `teacherProfiles.verificationStatus` from `text(...).notNull().default('pending')` to `teacherVerificationStatus('verification_status').notNull().default('pending')`.
3. `packages/db/src/schema/index.ts`: export `teacherVerificationStatus` from `_shared.js`.
4. `pnpm --filter @edmate/db db:generate` → new migration (`0016_*.sql` + `meta/0016_snapshot.json`). Expect `CREATE TYPE ... AS ENUM(...)` + `ALTER TABLE "teacher_profiles" ALTER COLUMN "verification_status" SET DATA TYPE ... USING "verification_status"::text::...` — the exact pattern `0005_cost_alarm.sql` already used for `audit_log.actor_role`; this is **not** flagged by `test/schema.test.ts`'s "migrations are create-only" check (it isn't `UPDATE ... SET` or a `DROP`), so no entry in `REVIEWED_UPDATES` is needed. Review the generated SQL by hand before committing it — do not hand-write migration SQL.
5. New file `packages/db/src/repositories/teacher-profiles.ts` exporting `teacherProfilesRepo(db)`:
   - `create(scope: TeacherScope, input: { slug, subject, bio?, photo?, languages? })`: `INSERT INTO teacher_profiles (user_id, ...) VALUES ($teacherId, ...)`. A `teacherId` not in `users` is a FK violation → `translateWrite` makes it `not_found`; a second profile for the same teacher or a taken `slug` is `invalid` (unique violations, default `translateWrite` behaviour — no special-casing needed).
   - `get(scope: TeacherScope)`: the scope's own row or `null`.
   - `update(scope: TeacherScope, patch: { subject?, bio?, photo?, languages? })`: a strict zod input object with **no** `verificationStatus` or `payoutAccountRef` key (payouts are M10's job); `UPDATE ... WHERE user_id = $teacherId`; a patch with no keys is `invalid` before any SQL (same convention as other repos' empty-patch guard).
   - `setVerification(scope: TeacherScope, input: { status: 'verified' | 'rejected', by: string, reason?: string })`: transaction; locks and checks `by` is a current staff user (`FOR SHARE`, like `identity.grantRole`); locks the target profile row (`FOR UPDATE`); writes the new status; calls `insertAuditEntry(tx, method, teacherId, null, { actor: by, actorRole: 'staff', action: 'teacher.verify', target: \`teacher:${teacherId}\`, reason, before: { verificationStatus: current }, after: { verificationStatus: status } })` (import from `./audit.js`); returns the updated row.
   - `assertVerifiedForPublish(scope: TeacherScope)`: reads the scope's own profile; throws `RepositoryError('scope', method)` when missing or not `verified`; otherwise resolves `void`.
6. `packages/db/src/repositories/map.ts`: add a local `TeacherProfileRowSchema` (strict zod object: id, userId→teacherId?, slug, subject, bio, photo nullable, languages, verificationStatus, following the existing `AuditRowSchema`/`toAuditRow` precedent — no contracts import) and a `toTeacherProfile(row, method)` mapper; export the row type.
7. `packages/db/src/repositories/index.ts`: import and wire `teacherProfilesRepo`, add `teacherProfiles: guardAll('teacherProfiles', teacherProfilesRepo(db))`, export any new public types (`TeacherProfileRow`).
8. Tests (write first):
   - `packages/db/test/repositories.int.test.ts`: add `CASES` entries for `teacherProfiles.create`, `.get`, `.update` (teacher-scope isolation, following the `documents.create`/existing patterns — another teacher's scope must not see or touch the row). `setVerification` and `assertVerifiedForPublish` are staff/guard operations, not ordinary teacher-scoped CRUD: add them to `CASES` using the same `attempt`/`verify`/`mismatches` shape as `audit.appendForTeacher` (staff actor, e.g. `'stf_1'`, fixed in the fixture), or — if the harness's `RepositoryMethod` typing makes that awkward — confirm with `code-reviewer` whether a narrower dedicated test file is acceptable; default to fitting the existing `CASES` shape since `audit.appendForTeacher` already proves it is possible for a staff-actor write.
   - A focused unit test that `update`'s zod schema rejects a `verificationStatus` key (strict object, so Zod itself refuses it) before any SQL runs, proving a teacher cannot self-verify through `update`.
   - A focused test for `setVerification` with a non-staff `by` id → `scope`, row unchanged; with a correct staff id → row updated + one `teacher.verify` audit row readable via `audit.listForTeacher`.
   - A focused test for `assertVerifiedForPublish`: no profile / `pending` / `rejected` → throws `scope`; `verified` → resolves. This is the acceptance-criterion evidence.
   - `packages/db/test/schema.test.ts`: add one line under "enums match the contracts" (or its own small `it`) asserting `values('teacher_verification_status')` equals `['pending', 'verified', 'rejected']` (no contracts type to compare against, so a literal array, like the existing `usage_status` check).
9. Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`.

### Phase B — staff CLI (depends on Phase A's `setVerification`)

1. `packages/db/src/cli.ts`: add `runVerifyTeacherCli(argv, env, log, open?)`, modelled exactly on `runGrantRoleCli`: parses `--email`, `--status` (`verified`/`rejected`), `--by`, optional `--reason`; opens the identity store to resolve the teacher's user id by email (reuses `getUserByEmail`, no new identity-store method); opens the db repositories to call `teacherProfiles.setVerification`; never prints the email; redacts connection strings on failure (reuse `redact.ts`).
2. `packages/db/src/bin/verify-teacher.ts`: thin entry point, same shape as `bin/grant-role.ts`.
3. `packages/db/package.json`: add `"db:verify-teacher": "node dist/bin/verify-teacher.js"`.
4. `packages/db/test/verify-teacher-cli.test.ts`: mirrors `grant-role-cli.test.ts` — usage errors without opening the db, missing user, non-staff `by` surfaces the repository's `scope` failure as a one-line redacted message, successful run prints the new status and never the email.
5. Gate: same turbo filter as Phase A.

### Phase C — apps/web onboarding page (blocked on 9.1; spec only, do not build yet)

Once 9.1's shell exists (auth-wired layout, teacher-role route group): a bare form at
`apps/web/app/studio/onboarding/page.tsx` (slug, subject, bio, photo-URL text input) posting to a
thin route handler (`apps/web/app/api/studio/profile/route.ts`) that does nothing but validate the
signed-in user is the `teacher` role (1.3's RBAC middleware) and call
`teacherProfiles.create`/`.update` with that user's own id as the scope — no new business logic,
no file upload. A read-only banner shows `verificationStatus` ("pending review" / "verified" /
"rejected"); there is no in-app verify action (that is the CLI, until 12.1). This phase gets its own
fresh builder once scheduled, reading this plan plus Phase B's handoff.

## Files

- **Create (A):** `packages/db/src/repositories/teacher-profiles.ts`.
- **Modify (A):** `packages/db/src/schema/_shared.ts`, `packages/db/src/schema/users.ts`,
  `packages/db/src/schema/index.ts`, `packages/db/src/repositories/map.ts`,
  `packages/db/src/repositories/index.ts`, `packages/db/test/repositories.int.test.ts`,
  `packages/db/test/schema.test.ts`.
- **Generate (A):** `packages/db/migrations/00NN_*.sql`, `packages/db/migrations/meta/00NN_snapshot.json`,
  `packages/db/migrations/meta/_journal.json` (via `db:generate`, never hand-written).
- **Create (B):** `packages/db/src/bin/verify-teacher.ts`, `packages/db/test/verify-teacher-cli.test.ts`.
- **Modify (B):** `packages/db/src/cli.ts`, `packages/db/package.json`.
- **Deferred (C, blocked on 9.1):** `apps/web/app/studio/onboarding/page.tsx`,
  `apps/web/app/api/studio/profile/route.ts` and their tests.
- **Tests first** in both buildable phases: the isolation/unit tests in step 8 (Phase A) and the CLI
  test (Phase B) are written before the implementation they check.
- **Size:** Phase A ~9 files / ~90-110 tool calls (the isolation-test fixture is the long pole —
  read `repositories.int.test.ts`'s existing `CASES` entries closely before adding new ones). Phase B
  ~4 files / ~40-50 tool calls, straightforward once Phase A's method exists.

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` — no port or contract change; see "No contracts change"
  above. If a reviewer decides a `TeacherProfile` contract type is actually needed, stop and raise
  it to the architect rather than adding it unilaterally — that reopens the ADR question this plan
  is deliberately avoiding.
- `packages/db/src/identity/**` — not modified; the CLI only calls the existing
  `getUserByEmail`, no new identity-store method.
- `12.1` (staff console) — not built; the CLI is the whole staff tool for this task.
- `8.6`/`8.7` (package builder, publish flow, quality gate, scorecard) — not built; Phase A ships
  only the `assertVerifiedForPublish` guard primitive those tasks will call.
- `payoutAccountRef` — untouched; payments are M10.
- Any real object storage / file upload adapter — `photo` stays a plain string column (see Open
  question); no provider call, no new storage port.
- `apps/web/**` beyond the Phase C spec — do not start Phase C before 9.1 merges.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/teacher-profiles.ts` (new), `packages/db/src/repositories/map.ts`,
  `packages/db/src/repositories/index.ts` — all match `packages/db/src/repositories/**`.
  **Reviewers: security-reviewer** (the group covers "keeping each teacher's and student's data
  apart"; `setVerification`'s staff-authority check and `assertVerifiedForPublish`'s publish gate
  are exactly the kind of access-control logic that group exists to review).
- Everything else this plan touches (`packages/db/src/schema/**`, `src/cli.ts`, `src/bin/**`,
  `migrations/**`, `package.json`, `test/**`) matches no glob in `risk-paths.txt` — not gate-risky.
  The lead may still want `database-reviewer` on the enum/migration change as routine practice (it
  is not drop/delete, so not gate-required), and `typescript-reviewer` on the new repository file,
  consistent with how other db-layer tasks have been reviewed.
- This task's handoff should log a `risk: high` decision regardless (CLAUDE.md non-negotiable 6),
  since the group is touched.

## Open questions (each with a recommendation)

- **Q1. `photo` storage.** No object-storage port or adapter exists anywhere in the repo yet (not
  even for document uploads — `documents.storageKey` is a nullable "object-store key" column with
  nothing behind it; 8.2, upload centre, is presumably where that lands). Recommend: for 8.1,
  `photo` stays a plain optional string the teacher pastes (an already-hosted image URL), with only
  basic length/format validation in the zod schema — no upload, no provider call. Flag to the
  architect that a real photo-upload path needs a storage port decision before 8.2 or any later
  task implements one; not a blocker for 8.1's accept criterion.
- **Q2. `teacherProfiles.setVerification`'s isolation-test shape.** The repo's `README.md` says
  staff cross-teacher *reads* are 12.1's own access pattern, not something `repositories/**`'s rule
  1 allows generally — but a single *write* to one named teacher's own row, gated by a staff role
  check, matches the existing `audit.appendForTeacher` precedent (staff actor, teacher-scoped
  target) exactly, so this plan treats it as in-bounds for 8.1. Recommend the lead or `architect`
  confirm this reading before the PR; if not, the fallback is to log it as a decision and keep the
  method anyway (it does not violate "no staff cross-teacher list/search", it never reads another
  teacher's row).
- **Q3. Phase C's sequencing.** 9.1 is being planned in parallel; this plan leaves Phase C
  unscheduled rather than guessing a date. Recommend the lead either (a) merge Phases A+B as 8.1's
  PR now (the written accept criterion is fully met) and open a short follow-up task for the bare
  UI once 9.1 lands, or (b) hold 8.1's PR open until 9.1 merges and add Phase C to the same branch.
  Flagging for the lead's call, not a human blocker.

## Status
READY.

## Lead decisions (20 Oct 2026)
- Q1 photo: no photo input in the thin slice. Keep the column nullable and leave it unset; photo upload arrives with the storage port in 8.2 or later. A pasted third-party URL would make students' browsers fetch from arbitrary hosts, so it is not accepted.
- Q2 setVerification: in bounds. Follow the `audit.appendForTeacher` precedent (staff actor writes to one named teacher, staff role checked in the same transaction, audit row written). security-reviewer checks it.
- Q3: this task is Phases A and B only and merges on its own. Phase C (the bare apps/web onboarding form) becomes task 8.1a, which starts after 9.1 merges.
