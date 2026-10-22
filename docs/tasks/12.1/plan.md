# Task 12.1: Staff console with manual teacher verification

## Acceptance (verbatim)
> approve/reject audited; unverified teachers stay unpublished.

## How it will be shown
A staff user (role `staff`, granted today only via `pnpm --filter @edmate/db db:grant-role`) signs
in, opens `/staff`, sees teachers with `verificationStatus: pending` (slug, subject, declared name
and email, oldest first), and approves or rejects each with an optional reason. The action calls
the existing `teacherProfiles.setVerification` (built in 8.1), which already writes the
`teacher.verify` audit row in the same transaction. "Unverified teachers stay unpublished" is
already enforced by `teacherProfiles.assertVerifiedForPublish` (8.1/8.7, unchanged) — a DB
integration test re-asserts it so this task carries its own proof instead of relying on 8.1's.
Shown via: `packages/db` integration tests for the new listing method, `apps/web` route and page
tests for the console, and a short manual check in the handoff (grant staff role to a seed user
locally, verify a pending teacher, confirm the audit row and that an unverified teacher's publish
attempt still fails).

## Context already in place (read, not rebuilt)
- `packages/db/src/repositories/teacher-profiles.ts`: `setVerification` (staff-only, audited,
  not-self), `assertVerifiedForPublish`. No change needed to either.
- `apps/web/src/auth/policy.ts` already reserves `/api/staff/**` (GET, POST) for role `staff`;
  `apps/web/src/auth/guard.ts` `withRole`/`requireRole` already accept `staff`. Neither needs
  changing.
- `packages/db/src/cli.ts` `db:verify-teacher` and `db:grant-role` are the only ways today to
  verify a teacher or create a staff account. This task adds the UI; it does not remove the CLI.
- 8.1c (subject change resets verification) is `todo`, not a dependency: this task reads/writes
  `verificationStatus` the same way 8.1c will, through the existing repository methods, so no
  conflict either order.

## Phases
Two phases, one package each (build-plan sizing rule: split when a build touches 2+ packages).

### Phase A — packages/db: a staff-facing read method (new; Phase B depends on it)
Files to create/modify:
- `packages/db/src/repositories/teacher-profiles.ts`: add `listPendingForStaff(by: string): Promise<TeacherVerificationQueueRow[]>`. Checks `by` is currently staff with a plain
  `select role from users where id = by` (no lock needed: a read, not a write — follows
  `role-lock.ts`'s own note that it exists only to keep personal data out of role checks, not
  because every role check needs `FOR SHARE`); `scope` error if not staff. Selects
  `teacher_profiles` joined to `users` for `name` and `email` (staff need this to actually check
  identity — same precedent as `identity.getUserByEmail`), ordered oldest-first, capped at a new
  `STAFF_QUEUE_MAX_LIMIT` (50, matching the `*_MAX_LIMIT` precedent elsewhere in this file's
  siblings).
- `packages/db/src/repositories/map.ts`: new `TeacherVerificationQueueRowSchema` /
  `TeacherVerificationQueueRow` type (does not touch the existing `TeacherProfileRowSchema` —
  that type is used elsewhere and must keep its exact shape).
- `packages/db/src/repositories/index.ts` (**shared file**: another builder is also touching
  this): append-only — one new type export line
  (`export { STAFF_QUEUE_MAX_LIMIT, type TeacherVerificationQueueRow } from './teacher-profiles.js';`
  or alongside the existing teacher-profiles export block). No line is edited or reordered, to
  minimise conflict with the other builder's diff.
- Tests: `packages/db/test/teacher-profiles.int.test.ts` — a non-staff `by` is `scope`; a staff
  `by` sees only `pending` rows, oldest first, capped; the joined name/email match the seeded
  user. `packages/db/test/teacher-profiles.test.ts` — input validation if any new parsed input is
  added (the method takes a bare id, so likely none beyond the existing `IdSchema`).
- No migration: reuses existing `teacher_profiles` and `users` columns.

### Phase B — apps/web: the staff console page and API (depends on Phase A's export)
Files to create:
- `apps/web/app/api/staff/verifications/route.ts`: `GET` (list pending, via
  `listPendingForStaff`) and `POST` (body `{ teacherId, status: 'verified'|'rejected', reason? }`,
  via `setVerification`), both wrapped in `withRole(['staff'])` — matches the existing
  `/api/staff/**` policy row, no `policy.ts` change needed.
- `apps/web/app/api/staff/verifications/route.test.ts`.
- `apps/web/app/staff/page.tsx`: server component, `requireRole(['staff'])`, fetches the pending
  list server-side, renders `view.tsx`.
- `apps/web/app/staff/view.tsx` + a client sub-component for the approve/reject form. Per the
  8.4b lesson (studio pages that trust a 200 response get stuck): wrap the JSON body read in
  try/catch, use try/catch/finally around the busy flag so a network error or bad JSON never
  leaves the button disabled forever.
- `apps/web/app/staff/page.test.tsx`, `apps/web/app/staff/view.test.tsx`.
- `apps/web/messages/en.json` (**shared file**: two other builders are also touching this and
  `apps/web/app/teacher/view.tsx`): append a new top-level `staff` key block only; do not touch
  the `teacher` block or reorder existing keys, to minimise conflict. This task does not touch
  `apps/web/app/teacher/view.tsx` at all.
- `.claude/skills/merge-gate/risk-paths.txt`: add `apps/web/app/api/staff/**` under the
  `# reviewers: security-reviewer` group that already covers `apps/web/src/auth/**` (see Open
  question 4) — a `.claude/**` edit, itself risky, needs security-reviewer sign-off in review.md.

Files explicitly out of bounds for this task: `apps/web/src/auth/guard.ts`, `policy.ts` (no
change needed — already support `staff`); `apps/web/app/teacher/**`; `packages/contracts/**`
(no new contract type — `TeacherVerificationQueueRow` follows the existing no-contract precedent
of `AuditRow`/`TeacherProfileRow`); `packages/db/src/identity/**`; `packages/payments/**`.

## Tests first
Both phases: write the failing integration/unit test (role check, ordering, cap; route 403 for
non-staff, 200 + audit row for staff) before the implementation, per `tdd-workflow`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (Phase A) — reviewers: **security-reviewer** (listed).
- `.claude/**` (Phase B, the risk-paths.txt edit itself) — reviewers: **security-reviewer**
  (listed).
- `apps/web/app/api/staff/**` (Phase B) — not yet a glob in risk-paths.txt, but this is the
  first real staff-auth route exercising the `staff` role guard end to end; treated as risky by
  this plan regardless of the glob gap (see Open question 4). Needs **security-reviewer**.
- Not touched: `packages/contracts/**`, `apps/web/src/auth/**`, `packages/db/src/identity/**`,
  `.github/**`, `.githooks/**`.
- A `risk: high` decision entry is planned for the handoff (staff role boundary + the
  risk-paths.txt addition).

## Lead answers (22 Oct 2026)
- Q1: accepted. Staff accounts come from the existing `db:grant-role` CLI; no UI in 12.1.
- Q2: accepted. Only the new staff-only method joins users.name and email.
- Q3: accepted. Reuse the existing `teacher.verify` audit row from `setVerification`.
- Q4: accepted with one change: Phase B adds `apps/web/app/api/staff/**` to risk-paths.txt under security-reviewer, and security-reviewer reviews that line. No architect sign-off is needed, since there is no contract or stack change.
- Q5: accepted. Keep `db:verify-teacher`.
- Build order: Phase A starts after 8.7a (both append to packages/db/src/repositories/index.ts) and merges origin/main before pushing; Phase B after Phase A merges.

## Open questions (none are blocking; each has a recommendation)
1. How is a staff account created? Already answered by existing code:
   `pnpm --filter @edmate/db db:grant-role` (operator bootstraps the first staff account; an
   existing staff user can grant more via the same CLI, which calls `identity.grantRole`).
   **Recommendation:** reuse as-is; no in-product staff-management UI in 12.1 (MVP first).
2. Is it OK for the new repository method to return the teacher's name and email to staff?
   **Recommendation:** yes, scoped to this one method only — that is the point of a manual
   identity check, and it mirrors the existing `identity.getUserByEmail` precedent. It must not
   go anywhere near `role-lock.ts`, which stays personal-data-free.
3. Does verification need its own audit action? **Recommendation:** no — reuse the existing
   `teacher.verify` audit row written inside `setVerification` (built in 8.1); this task adds no
   new audit code.
4. Should `apps/web/app/api/staff/**` be added to `risk-paths.txt` now? **Recommendation:** yes,
   in Phase B, under the existing `security-reviewer` group — risk-paths.txt is "owned by the
   architect, update as code lands" and this is the first code landing there; get a one-line
   architect sign-off in review.md rather than a full ADR (no contract or stack change).
5. Should the older `db:verify-teacher` CLI be removed now the console exists?
   **Recommendation:** keep it — cheap to keep, useful for scripts/incident recovery; revisit in
   M13 hardening if it turns out unused.

## Budget
Budget: 180 tool calls (2 phases, packages/db + apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for the touched package(s) only,
and the secret scan)

## Exit conditions
`Status: DONE` when both phases are green (typecheck, lint, test for `@edmate/db` and `apps/web`),
the manual check in "How it will be shown" is recorded in the handoff, and risk-paths.txt's new
line is in place with an architect sign-off noted in review.md. `Status: PARTIAL` past ~90 tool
calls in a phase with no green tests yet, or if a file outside this plan's list turns out to need
changes (for example if `/api/staff/**`'s existing policy row turns out not to fit the chosen
request shape) — stop and hand back rather than widening scope.
