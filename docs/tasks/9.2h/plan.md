# 9.2h plan: the two 9.2g security-review LOWs

Board: milestone M13 · risk medium · deps `9.2g` (done). One phase, one branch, one PR. Written by the lead (two small test-and-schema items; no planner run). No contracts change, no migration.

## Acceptance (verbatim, `docs/board/tasks.yaml`)
"db and web typecheck, lint and test green; the int test inserts a profile with a NULL display name and sees the slug in both staff reads"

## Changes
1. `packages/db/test/teacher-profiles.int.test.ts`: one new case (test first; it should pass at once, since 9.2g already coalesces, so show it fails if the coalesce is removed, then put it back). Insert a pending profile with no `display_name` through `raw.query`, as the existing "a profile without a displayName reads back null" case does at about line 147 (`insert into teacher_profiles (id, user_id, slug, subject) ...`). Assert that `listPendingForStaff(STAFF)` and `findBySlugForStaff(STAFF, <slug>)` both return `displayName` equal to the slug. Put it in or next to the `listPendingForStaff` describe (about line 663).
2. `apps/web/app/staff/client.ts:49`: `displayName: z.string().min(1)`, matching `TeacherVerificationQueueRowSchema` in `packages/db/src/repositories/map.ts`. Add a case to `apps/web/app/staff/client.test.ts` showing an empty `displayName` is rejected the same way the client already rejects other malformed queue items (follow that file's existing pattern).

## Files
Modify only: `packages/db/test/teacher-profiles.int.test.ts`, `apps/web/app/staff/client.ts`, `apps/web/app/staff/client.test.ts`, and write `docs/tasks/9.2h/handoff.md`.

## Risky paths touched
`apps/web/app/staff/**` (client.ts): reviewers security-reviewer (plus code-reviewer and typescript-reviewer, always). The handoff logs a `risk: high` decision for that group. The db test file is not a risky path.

## Gate
`TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web`; db int tests must run, not skip.

## Budget
25 tool calls.

## Questions
None.
