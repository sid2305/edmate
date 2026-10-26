# 11.4e plan — listRecordingsForTeacher cap and join tests

Status: READY (lead-written plan, 25 Oct 2026)

Source: board 11.4e (11.4a review LOWs). Tests only, in `packages/db/test/documents.int.test.ts`
next to the existing `listRecordingsForTeacher` tests (around lines 721–770). No production
change; `packages/db/src/repositories/**` stays untouched (it is a risky path).

## Tests
1. **Cap.** Replace or extend the constant-only test at line 767 (`expect(RECORDING_LIST_MAX).toBe(500)`)
   with a real one: insert `RECORDING_LIST_MAX + 1` recording documents for one teacher, linked to
   that teacher's live class, in one bulk raw-SQL insert (e.g. `generate_series` with distinct
   `created_at` values) — not 501 repository calls. Assert the call returns exactly
   `RECORDING_LIST_MAX` rows and the single oldest one is the one dropped (newest-first order).
   Clean up the rows afterwards (the suite shares one database). Keep it under a few seconds.
2. **Same-teacher join check** (`live-classes.ts:262`, `eq(liveClasses.teacherId, teacherId)` in
   the join). Insert, via raw SQL, a document owned by teacher A whose `live_class_id` points at
   teacher B's live class. Assert `listRecordingsForTeacher(A)` does not return it (and B's call
   doesn't either, since the document isn't B's). If the database itself refuses that row (a
   constraint or trigger), the join check is then unreachable: instead assert the refusal, and
   record in the handoff `## Decisions` that the join is defence in depth behind that constraint.
3. Prove each test can fail: temporarily remove `.limit(RECORDING_LIST_MAX)` and then the join's
   teacher clause locally, run, confirm the new test fails, restore, and note it in the handoff.
   Never commit the removal.

## Reviewers
code-reviewer, typescript-reviewer (database-reviewer optional for a test-only diff).

## Gate
`TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run
typecheck lint test --filter=@edmate/db...`

## Budget
About 30 tool calls.
