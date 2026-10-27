# 13.4b plan: account-wide export and account delete (13.4 Phase C)

Written by the lead, 26 Oct 2026. Status: READY.

## Source
Build **docs/tasks/13.4/plan.md, section "Phase C — apps/web: root export and account delete"**,
with the human's B-59 answers (26 Oct 2026, docs/decisions/log.md) and the amendments below.
Phase A (`identity.anonymise`, packages/db/src/identity/store.ts) and Phase B (worker retention)
are merged; reuse them, don't change them.

## B-59 answers that shape this task
- (2) Delete anonymises the user, their consents and message text through the existing
  `identity.anonymise`; safety alerts, payments and the audit log stay as they are.
- (3) **A delete is held while a safety alert is open** (see Amendment 1). Payment disputes do not
  exist yet (M10 comes last), so there is nothing to check for them; log that as a decision and
  the lead adds the dispute hold to the payments follow-ups.
- (5) One account-wide export across all the student's teachers, beside the per-teacher export.

## Amendment 1: the hold on an open safety alert
- `packages/db/src/repositories/safety-alerts.ts`: add one read,
  `hasOpenForStudent(studentId: string): Promise<boolean>`. It is true when the student has any
  `safety_alerts` row with `acknowledged_at is null` (across all teachers). Validate the id with
  zod like the other methods (`parseArg`); no new index, because
  `safety_alerts_student_id_teacher_id_idx` leads with `student_id`. Add a short doc comment that
  it serves the student's own account-delete hold, and that it returns only a boolean, never alert
  content.
- Test it first in the existing safety-alerts integration test file in packages/db/test: an
  open alert is true, an acknowledged one is false, another student's open alert is false, and
  no alerts is false.
- The `DELETE /api/me` handler calls `hasOpenForStudent(principal.userId)` before
  `identity.anonymise`. When it is true, the handler returns **409** with
  `{ error: 'delete_on_hold' }` and a plain message: "We can't delete your account while a
  safety check on it is still open. Please try again later, or contact support." It does not
  anonymise and does not sign the student out. The handler test covers both branches.
- An alert raised between the check and the delete is acceptable: alerts keep their rows anyway.

## Amendment 2: sign-out
Reuse the existing sign-out path (`signOut` / the session-cookie name in
`apps/web/src/auth/index.ts`); do not edit anything under `apps/web/src/auth/**`. If clearing the
session cookie needs an auth change, stop with `Status: PARTIAL` and say why. Phase A already
deletes the student's `auth_sessions` rows, so the old cookie stops working even before it
is cleared.

## Files
- packages/db/src/repositories/safety-alerts.ts (one new method) and its integration test
- apps/web/src/export/accountExport.ts (new) and its test
- apps/web/app/api/me/export/route.ts (new) and its test
- apps/web/src/account/delete.ts (new) and its test
- apps/web/app/api/me/route.ts (new) and its test
- any apps/web fake backend or ports file that must gain `hasOpenForStudent` so the types match
  (name each one in the handoff)
- docs/tasks/13.4b/handoff.md

Out of bounds: as in the 13.4 plan (US.yaml, packages/contracts, apps/web/src/auth/**,
subscriptions and payments repositories), plus packages/db/src/identity/store.ts and
packages/db/src/repositories/redact-json.ts (another builder is in that file).

## Tests first
As in the 13.4 plan's Phase C (the fake backend only; a do-not-leak regex scan over the
serialised export; DELETE never accepts a body-supplied studentId or teacherId), plus the hold
tests above.

## Risky paths
- packages/db/src/repositories/** → security-reviewer.
- The lead also runs code-reviewer, typescript-reviewer and database-reviewer.
- The handoff logs a `risk: high` builder decision naming the personal-data surface: account
  export and account delete.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=@edmate/web...`
  (db and everything that depends on it, plus web)
- With TEST_DATABASE_URL set (see the brief), the db integration test for safety-alerts runs and
  passes; say in the handoff whether it ran or skipped.
- `corepack pnpm exec prettier --check` on changed files; `python3 .githooks/secret-scan.py --all`.

## Budget
About 55 tool calls. Stop with `Status: PARTIAL` past 75.
