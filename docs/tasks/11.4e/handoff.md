# 11.4e handoff

Status: DONE

## Summary

Added two real integration tests to `packages/db/test/documents.int.test.ts`, inside the
existing `live-class recordings (11.4a)` describe block, replacing the constant-only test at
the old line 767. No production code was touched (`packages/db/src/repositories/**` is
unchanged); `git diff` against `packages/db/src/repositories/live-classes.ts` is empty.

1. **Cap test** (`caps listRecordingsForTeacher at RECORDING_LIST_MAX, dropping only the
   oldest`) — bulk-inserts `RECORDING_LIST_MAX + 1` (501) recording documents for teacher A via
   one raw-SQL `generate_series` insert, each linked to `LC_PAST` with a distinct, strictly
   increasing `created_at`. Asserts `listRecordingsForTeacher(A)` returns exactly
   `RECORDING_LIST_MAX` rows, that the single oldest (`doc_cap_1`) is dropped, and that the
   newest (`doc_cap_501`) is present. Cleans up the inserted rows in a `finally` block.
2. **Join test** (`listRecordingsForTeacher's join only matches the scope's own live class,
   not another teacher's`) — inserts, via raw SQL, a document owned by teacher A whose
   `live_class_id` points at teacher B's live class (`LC_B`). The database accepted the insert
   (no constraint enforces document.teacher_id == live_class.teacher_id), so the join check is
   reachable, not defence-in-depth-only. Asserts neither `listRecordingsForTeacher(A)` nor
   `listRecordingsForTeacher(B)` returns it. Cleans up in a `finally` block.
3. Proved both tests can fail: temporarily removed `.limit(RECORDING_LIST_MAX)` from
   `packages/db/src/repositories/live-classes.ts` and re-ran — the cap test failed
   (`expected [ Array(501) ] to have a length of 500 but got 501`). Restored it, then removed
   `eq(liveClasses.teacherId, teacherId)` from the join condition and re-ran — the join test
   failed (`expected [ 'doc_rec_cross' ] to not include 'doc_rec_cross'`). Restored the file;
   `git diff` on it is empty.

## Decisions

### 25 Oct 2026 · 11.4e join check reachability · decided by builder · risk: low
- Decided: Treated the cross-teacher join test as a live, reachable regression test (not a
  "defence in depth behind a DB constraint" case), because inserting a document for teacher A
  with `live_class_id` pointing at teacher B's live class succeeded with no constraint or
  trigger violation.
- Why: The plan's fallback path (asserting a DB refusal) only applies if the database itself
  blocks the cross-teacher row; it did not, so the real assertion (the join excludes the row)
  is the one that matters and is exercised.

## Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
  → `Tasks: 26 successful, 26 total` (all green, includes the new tests: `test/documents.int.test.ts (45 tests)` passing).
- `corepack pnpm exec prettier --check packages/db/test/documents.int.test.ts` → initially
  flagged pre-existing style issues in the file (not from this change); ran `--write` once, then
  `--check` passed: "All matched files use Prettier code style!". Re-ran the test file after
  formatting (`vitest run test/documents.int.test.ts` → 45 passed) to confirm no behaviour
  changed.
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Budget

Tool calls used: 34
