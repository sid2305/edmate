# Handoff: 6.2a

Status: DONE

## Summary

Implements the 6.2 review follow-ups on `learner.ts` (board task 6.2a):

- **New index** `evidence_events_teacher_id_student_id_ts_id_idx` on `evidence_events(teacher_id,
  student_id, ts, id)`, covering `rebuildMastery`'s keyset-paged replay and `evidenceEvents.list`'s
  export read (same filter, same `ORDER BY ts, id`).
  - `packages/db/src/schema/learning.ts`: declared in `evidenceEvents`'s index array.
  - `packages/db/migrations/0039_evidence_events_ts_id_index.sql`: comment-only migration file
    (modeled on `0038_eval_runs_gate_passed_index.sql`).
  - `packages/db/src/migrate.ts`: `POST_MIGRATE_STEPS` gets a new `concurrentIndex` entry building
    it with `CREATE INDEX CONCURRENTLY`; doc comment above `POST_MIGRATE_STEPS` extended.
  - `packages/db/test/migrate.test.ts`: new `concurrentIndex` array entry.
  - `packages/db/migrations/meta/0039_snapshot.json` + `_journal.json`: hand-crafted snapshot
    entry (same mechanism 13.regatea's 0038 used) so `test/schema.test.ts` (which diffs the
    migration snapshot against `src/schema`) stays green without ever running `db:generate`.
    **Not listed in the plan's "Files to modify"** — needed once `test/schema.test.ts` failed; see
    Decisions.
- **Batched `rebuildMastery` replay**: new exported `REBUILD_PAGE_SIZE = 1_000` constant; the
  single unbounded `orderBy(...)` select is now a keyset-paged loop (`(ts, id) > (cursor.ts,
  cursor.id)`, `LIMIT REBUILD_PAGE_SIZE`), folding page by page inside the same transaction/lock.
  Doc comment on `rebuildMastery` extended with the "a rebuild is a snapshot as of lock
  acquisition" note the board title asked for.
- **`applyEvidenceMastery`**: `foldMastery(locked!.mastery, events)` replaced with an explicit
  `if (!locked) throw new RepositoryError('scope', method); foldMastery(locked.mastery, events)`
  guard (same shape as this method's own `owned.length !== topicIds.length` check and
  `rebuildMastery`'s own `if (!locked) throw ...`).
  `grep -n '!\.' packages/db/src/repositories/learner.ts` and `grep -n '!)' ...` both return
  nothing (confirmed below).
- **New test** `packages/db/test/profile-store.int.test.ts`: `rebuildMastery folds a history
  spanning multiple REBUILD_PAGE_SIZE pages identically to one unbounded fold` — bulk-inserts
  `2 * REBUILD_PAGE_SIZE + 37` `evidence_events` rows via one `generate_series` SQL insert (3
  pages, partial last page), asserts the rebuilt `mastery[topicId].n`/`.p` against a pure
  `foldMastery` over the same rows fetched back in Postgres order. This is the test that caught
  the real bug below.

## A real bug caught by the new test (not in the plan, fixed during build)

The plan's keyset condition `(ts, id) > (cursor.ts, cursor.id)` with `cursor.ts` taken straight
from a selected `Date` loses Postgres's sub-millisecond precision (timestamptz has microsecond
precision; `Date` only keeps milliseconds). With `ts` values a fixed number of milliseconds apart
(as in the new test, and as `defaultNow()` with sequential inserts easily could be in real
traffic), the rounded-down cursor could be *less than* the true value of the row it came from, so
`ts > cursor.ts` stayed true for that same row — duplicating the page boundary row into the next
page (confirmed by instrumenting: `ev_paged_1000` and `ev_paged_1999` each appeared at the end of
one page and the start of the next; the fold then counted 2 extra events out of 2037). Fixed by
selecting `ts` a second time as raw text (`sql<string>\`${evidenceEvents.ts}::text\``, full
precision, no `Date` round-trip) and using that for the cursor, with explicit `::timestamptz`/
`::text` casts on the comparison's parameter side — the plan had already flagged this exact cast
as an open implementation judgment call ("may drop them... keep whichever compiles and passes");
here they turned out necessary, not optional, once the cursor itself carries full precision.

## Red before green

- `profile-store.int.test.ts`'s new multi-page test: timed out/failed before the loop existed
  (query had no `.limit`, so one giant unpaged select); after adding the loop with the `Date`-based
  cursor it failed assertion `expected 2039 to be 2037` (the precision bug above); after switching
  the cursor to raw text it passes.
- `migrate.test.ts`: the new `concurrentIndex` array entry failed against the then-unchanged
  `POST_MIGRATE_STEPS` before the step was added; green after.
- `grep -n '!\.' packages/db/src/repositories/learner.ts` — empty (no non-null assertions left).
- `grep -n '!)' packages/db/src/repositories/learner.ts` — empty.

## Decisions

### 27 Oct 2026 · 6.2a hand-crafted migration snapshot (0039_snapshot.json, _journal.json) · decided by builder · risk: low
- Decided: added `packages/db/migrations/meta/0039_snapshot.json` and a new `_journal.json` entry,
  mirroring the new index into the prior snapshot by hand (same mechanism 13.regatea used for
  0038), rather than running `drizzle-kit generate`.
- Why: the plan's files-to-modify list didn't mention `migrations/meta/`, but
  `test/schema.test.ts` (which diffs `src/schema`'s declared indexes against the latest migration
  snapshot) failed once the new index was declared in `learning.ts` without a matching snapshot
  entry. 13.regatea's 0038 precedent (same situation, same fix) confirms this is expected, not a
  scope change; no human decision needed.

### 27 Oct 2026 · 6.2a keyset cursor precision (Date vs. raw text) · decided by builder · risk: low
- Decided: the keyset cursor for `rebuildMastery`'s paged replay carries `ts` as a raw
  `::text`-cast string (full microsecond precision), not the `Date` object drizzle returns by
  default, and the WHERE clause casts it back with explicit `::timestamptz`/`::text`.
- Why: the plan flagged the explicit casts as optional ("if they turn out unnecessary... the
  builder may drop them"); testing showed they're necessary together with the raw-text selection
  to avoid `Date`'s millisecond truncation duplicating the boundary row across pages (see bug
  writeup above). Caught by the plan's own prescribed test, not a new scope item.

### 27 Oct 2026 · 6.2a full monorepo gate flakiness under parallel load · decided by builder · risk: low
- Decided: treated repeated, non-reproducible single-test timeouts in `@edmate/cli` (
  `test/chatDbRetrieval.int.test.ts`, a `beforeAll` hook timeout) and one `@edmate/web` run (a
  `page.test.tsx` test timeout) as pre-existing environment flakiness under heavy parallel
  Postgres-connection load, not failures caused by this task.
- Why: neither file is touched by this task; both pass cleanly every time they're run in
  isolation (confirmed twice for the cli one, once for web); `@edmate/db`'s own full
  typecheck/lint/test (86 files, 1806 tests) is green on every run, including after the fixes
  above.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` — green (`@edmate/db` itself:
  typecheck clean, lint clean, 86 test files / 1806 tests passed, 4 skipped, coverage 99.67%
  statements / 97.91% branches / 99.65% functions / 99.72% lines).
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db` (db + dependents) — ran
  three times; `@edmate/db`, `@edmate/web` and `@edmate/cli` each pass fully whenever run alone;
  under the full parallel-package run, one or the other occasionally times out on an unrelated
  test (see Decisions above), never in a file this task touches.
- `grep -n '!\.' packages/db/src/repositories/learner.ts` — empty.
- `grep -n '!)' packages/db/src/repositories/learner.ts` — empty.
- `corepack pnpm exec prettier --check` on every file this task changed — clean, **except**
  `packages/db/test/profile-store.int.test.ts`, which already fails `prettier --check` at `HEAD`
  (confirmed by checking out the pre-task version and running `--check` on it alone, before any
  edit of this task touched it): a whole-file `--write` produces an ~870-line unrelated
  reformatting diff, so it was not run; only the 54 lines this task added are prettier-clean in
  isolation.
- `python3 .githooks/secret-scan.py --all` — clean (no output).

## Budget

Tool calls used: 95
