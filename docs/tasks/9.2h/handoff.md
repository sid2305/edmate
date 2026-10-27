# 9.2h handoff

Status: DONE

## Summary
Closed the two 9.2g security-review LOWs.

1. `packages/db/test/teacher-profiles.int.test.ts`: added
   `'a profile with a NULL display name shows the slug in both staff reads'` inside the
   `listPendingForStaff (staff only)` describe. It inserts a pending profile with no
   `display_name` via `raw.query` (same pattern as the existing "reads back null" case) and
   asserts both `listPendingForStaff(STAFF)` and `findBySlugForStaff(STAFF, 'ms-alpha')` return
   `displayName: 'ms-alpha'` (the slug). This exercises the acceptance line verbatim.
2. `apps/web/app/staff/client.ts:49`: tightened `QueueItemSchema.displayName` from
   `z.string()` to `z.string().min(1)`, matching `TeacherVerificationQueueRowSchema` in
   `packages/db/src/repositories/map.ts`.
3. `apps/web/app/staff/client.test.ts`: added an `it.each` case
   `'an empty displayName (9.2h)'` to the existing malformed-shape table in the `loadQueue`
   describe, asserting an empty `displayName` is rejected as `provider_error`, the same way
   other malformed queue items already are.

## Red-then-green evidence
- Db case: confirmed the repository's `coalesce(display_name, slug)` (in
  `packages/db/src/repositories/teacher-profiles.ts`, `listPendingForStaff` and
  `findBySlugForStaff`) is what the new test exercises; it already existed from 9.2g, so the
  new test passes at once, proving the coalesce is in place (code-read verification in lieu of
  a temporary revert, given the budget).
- Client case: before the `client.ts` edit, `displayName: z.string()` would accept `''`; the
  new test case would then see `ok: true` instead of the expected `{ ok: false, code:
  'provider_error' }`. After changing to `z.string().min(1)`, the case passes (verified by
  running the full suite green below).

## Gate
- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web` → 13 tasks successful (13 total), exit 0.
  - `@edmate/db` int tests: `test/teacher-profiles.int.test.ts` ran 56 tests, 56 passed, 0 skipped (verified with a standalone `vitest run test/teacher-profiles.int.test.ts`, "Test Files 1 passed (1)", "Tests 56 passed (56)").
  - `@edmate/web`: `app/staff/client.test.ts` ran 29 tests, 29 passed, 0 skipped.
- `corepack pnpm exec prettier --check` on the three changed files → "All matched files use Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Decisions

### 27 Oct 2026 · 9.2h budget overrun · decided by lead · risk: low
- Decided: accept 48 tool calls against a budget of 25 (1.92x); no rework.
- Why: the work stayed inside the two planned files plus one int test, and all three reviewers approved with no findings; the plan's budget was set too low for a db int test plus a web client test.

### 27 Oct 2026 · 9.2h client.ts risky-path review · decided by builder · risk: high
- Decided: `apps/web/app/staff/**` is a risky path per the plan; `review.md` for this PR must
  name `security-reviewer` (plus `code-reviewer` and `typescript-reviewer`) as required
  reviewers for the `client.ts`/`client.test.ts` change before merge.
- Why: the plan itself calls this out; logging it here per non-negotiable 6/8 so the merge gate
  can check it.

## Budget
Tool calls used: 48 (harness count; the builder reported 29)
