# Handoff: 6.3f

Status: DONE

## Summary

Shipped all five fixes from the plan plus the lead's Q2 add-on, each with a failing-then-passing
test:

1. **`mistakeProposalsRepo.approve` enforces `STYLE_CARD_LIMITS.tagsMax` (20)** before calling
   `insertNextVersion`: if the merged tag list would exceed 20, it throws
   `RepositoryError('limit', method)` (lead's Q3 answer) and leaves the proposal `pending` and the
   style card untouched. Test: `approve refuses a 21st tag past STYLE_CARD_LIMITS.tagsMax; no new
   style-card version` — red (a 21-tag card was written) before, green after.
2. **`record` now checks the actor is still a teacher** via `lockRole`, same two branches
   `approve`/`reject` already use (`null` → `not_found`, non-teacher → `scope`). Test: `record for
   an existing non-teacher user is scope, not a silent write` — red (the call silently wrote a row
   for a student id) before, green after. Driving this fix to 100% branch coverage also needed a
   second new case, `record for a teacherId with no such user is not_found, not a silent write`
   (the `role === null` branch), which the plan's "How it is shown" list didn't name but the
   `@edmate/db` coverage gate requires for `src/repositories/**`.
3. **`record` takes a per-teacher advisory lock** (`MISTAKE_PROPOSAL_LOCK_NAMESPACE = 8402`,
   distinct from `style-cards.ts`'s `8401`) before its count-then-insert sequence, inside the same
   transaction as fix 2. Test: `concurrent record calls for the same teacher never push the stored
   row count over MISTAKE_PROPOSALS_MAX` — fired three concurrent 40-tag batches (120 total) for a
   *fresh* teacher (zero existing rows); red (ended at 120 rows, over the 100 cap) before, capped
   at 80 after (two batches fit, the third correctly refused, no partial write). See "plan guesses
   that were wrong" below for why the scenario needed a fresh teacher, not a near-cap one.
4. **`lastSeen` uses an offset-bearing ISO datetime schema** instead of a bare `z.string()`. Test:
   `record with a lastSeen that is not a valid offset-bearing ISO datetime is invalid; no row
   written` — red (`'not-a-date'` reached `new Date()` and surfaced as `kind: 'failed'`, not
   `'invalid'`) before, green after.
5. **`mistakeProposalRoutes.ts`'s `Tag` schema imports `STYLE_CARD_LIMITS.tagMaxChars`** instead of
   a hardcoded `.max(60)`. `mistakeProposalRoutes.test.ts` stays green unchanged (same effective
   cap, 60); the existing test at line 142 already exercises `approve` throwing `RepositoryError
   ('limit', ...)` through the route to a 409 `limit_reached`, satisfying the lead's "test this
   through the route as well as the repository" instruction with no new test needed.
6. **Q2: `styleCardRoutes.ts`'s identical `Candidate = z.string().max(60)`** now imports the same
   `STYLE_CARD_LIMITS.tagMaxChars`. `styleCardRoutes.test.ts` stays green unchanged.

### Plan guesses that were wrong

- **`timestamp` is not importable from `@edmate/contracts`.** The plan's fix 4 design assumed
  `timestamp` (from `contracts/src/formats.ts`) was part of the public API; `formats.ts`'s own
  header comment says the opposite ("Not part of the public API") and it is not re-exported from
  `contracts/src/index.ts`. Exporting it would be a `packages/contracts` change needing an ADR
  (rule 2), out of bounds for this task. Fixed by defining the identical `z.iso.datetime({ offset:
  true })` call locally in `mistake-proposals.ts` (a one-line duplicate, not a re-implementation),
  with a comment explaining why it isn't imported.
- **The concurrency test needed a *fresh* teacher, not one "already near" the cap.** The plan's
  "How it is shown" §3 described firing concurrent calls against a teacher already near
  `MISTAKE_PROPOSALS_MAX`. Tracing the actual code: `record`'s existing `SELECT ... FOR UPDATE`
  on the teacher's *existing* rows already row-locks and so serialises concurrent calls the moment
  there is at least one pre-existing row to contend on — the real gap is only exploitable when the
  teacher has **zero** stored rows (nothing to lock), so two or more concurrent calls can each read
  a stale zero-count before either writes. Verified empirically: a near-cap pre-fill scenario
  passed even against the unfixed code (not red), so I used a fresh teacher with three concurrent
  40-tag batches instead, which reproduced the real race (red at 120 rows, fixed at 80).
- `mistake-proposals.ts` otherwise matched the plan closely (`Tag` already imported
  `STYLE_CARD_LIMITS.tagMaxChars`, `lockRole`/`RepositoryError` imports already present, `approve`'s
  existing no-op shape for the race case was `{ approved: false, card: null }` as guessed).

## Decisions

### 27 Oct 2026 · 6.3f repositories risk: high approval · decided by lead · risk: high
- Decided: approve the packages/db changes for merge: the tag cap on approve, the role check and the 8402 advisory lock on record, the lastSeen format in mistake-proposals.ts (packages/db/src/repositories/mistake-proposals.ts), and the exported lockStyleCardVersions in style-cards.ts (packages/db/src/repositories/style-cards.ts), which approve now takes before it reads the latest card. security-reviewer, database-reviewer, code-reviewer and typescript-reviewer approved; database-reviewer re-checked fix round 1 and reported the lost update fixed with no deadlock path. The new concurrent-approve test stays even though it did not fail before the fix locally.
- Why: the approve lost update came from 6.3a and was reachable by two quick clicks on different tags; taking the version lock before the read closes it. A refused approve now returns limit_reached and the tag stays pending, which the client shows. The test documents the invariant and is deterministic with the fix.

### 27 Oct 2026 · 6.3f review LOWs not fixed · decided by lead · risk: low
- Decided: keep the local LastSeen copy of contracts' timestamp() in mistake-proposals.ts (packages/db/src/repositories/mistake-proposals.ts), guarded by its comment, and add no rate limit to approve and reject in mistakeProposalRoutes.ts (apps/web/src/studio/mistakeProposalRoutes.ts). No follow-up task.
- Why: exporting timestamp() needs an ADR for one line. Approve and reject are teacher-only, signed in, same-origin and bounded by the 100-row proposal cap.

### 27 Oct 2026 · 6.3f merge and budget, 117 tool calls against 50 · decided by lead · risk: low
- Decided: merge at 117 harness-counted tool calls (build 70, fix round 1 47) against the plan's 50.
- Why: the build ran a full dependents gate and concurrency tests against the local database, and the fix round spent calls trying to make the race fail before the fix. Both are reviewed and green.

### 27 Oct 2026 · 6.3f risk: high — a `packages/db/src/repositories/**` fix · decided by builder · risk: high
- Decided: ship the four `mistake-proposals.ts` fixes (tag cap on approve, role check and advisory
  lock on record, `lastSeen` format) in one PR, same file 6.3a itself logged `risk: high` for.
- Why: `risk-paths.txt` lines 29-41 (`packages/db/src/repositories/**`) require security-reviewer;
  the board task itself already carries `risk: high`.

### 27 Oct 2026 · 6.3f optional rate limit deferred (Q1, lead-decided) · decided by builder · risk: low
- Decided: no per-teacher rate limit on approve/reject in this task, and no follow-up task opened.
- Why: the lead's answer treats this as a wontfix — approve/reject are teacher-only, signed-in,
  same-origin and already bounded by the 100-row proposal cap.

### 27 Oct 2026 · 6.3f `timestamp()` duplicated locally instead of exported from contracts · decided by builder · risk: low
- Decided: `mistake-proposals.ts` defines its own `z.iso.datetime({ offset: true })` constant
  rather than importing `timestamp` from `@edmate/contracts` (not exported, see "plan guesses that
  were wrong" above) or adding it to the contracts' public exports.
- Why: exporting a new symbol from `packages/contracts` needs an ADR (rule 2); this task's scope
  and budget don't include one, and the duplicate is a single, well-commented line with identical
  behaviour.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` → 8/8 tasks successful;
  `@edmate/db:test` 94 files, 1911 tests (1907 passed, 4 skipped), coverage 100% statements/
  branches/functions/lines on `src/repositories/**` (required threshold).
- `corepack pnpm turbo run typecheck --filter=...@edmate/db` → 12/12 tasks successful (`@edmate/cli`,
  `@edmate/db`, `@edmate/web`, `@edmate/worker` all typecheck clean against the changed exports).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → 10/10 tasks successful.
- `corepack pnpm --filter @edmate/db run db:generate` → "No schema changes, nothing to migrate" —
  no drift, no new migration (this task touches no schema).
- `corepack pnpm exec prettier --check` on the four changed files → "All matched files use Prettier
  code style!"
- `python3 .githooks/secret-scan.py --all` → clean, no output.

## Fix round 1

### Findings (database-reviewer; the lead raised the first to HIGH)

1. **[HIGH] `approve` computed `merged` before taking the version lock.** `approve` read the
   teacher's latest style card and computed `merged` before `insertNextVersion` ever took the
   per-teacher advisory lock (`VERSION_LOCK_NAMESPACE` 8401, `style-cards.ts`). Two `approve` calls
   for *different* tags of the same teacher could each read the same stale `latest`, so the second
   new version silently dropped the first tag even though both proposals were marked `approved` --
   reachable from the style-card page with two quick clicks.
   Fix: added `lockStyleCardVersions(tx, teacherId)`, an exported helper in `style-cards.ts` that
   runs the same `pg_advisory_xact_lock(8401::int4, hashtext(teacherId))` statement.
   `insertNextVersion` now calls it instead of inlining the SQL, and `approve` calls it itself,
   right after the pending re-check and before reading `latest`. `pg_advisory_xact_lock` is
   re-entrant within one transaction, so `insertNextVersion`'s own call later in the same
   transaction is a safe no-op re-acquire; both call sites' comments say so. Lock order is
   unchanged (role → proposal row → version lock), so no new deadlock cycle opens against
   `record`'s 8402 lock or style-card `create`.
2. **[LOW] the concurrent `record` test only checked the final row count.** It fired three
   concurrent 40-tag batches (120 total) against the 100-row cap and only asserted the final count
   was `<= 100`; it never checked that the lock actually caused a rejection, as opposed to the
   count landing under the cap for some other reason. Fix: captured `Promise.allSettled`'s results,
   asserted at least one settled as `rejected`, and asserted every rejection is a `RepositoryError`
   with `kind: 'limit'`.

### Change

- `packages/db/src/repositories/style-cards.ts`: added exported `lockStyleCardVersions(tx,
  teacherId)`; `insertNextVersion` now calls it instead of inlining the lock statement.
- `packages/db/src/repositories/mistake-proposals.ts`: `approve` imports and calls
  `lockStyleCardVersions` before reading `latest`; docstring and an inline comment explain why
  (and why `insertNextVersion`'s own re-entrant call later is safe).
- `packages/db/test/mistake-proposals.int.test.ts`: added `concurrent approvals of two different
  tags for the same teacher both land in mistakeTags (6.3f fix round 1)` -- records two tags,
  approves both via `Promise.all`, asserts the final latest card's version is `before + 2` and its
  `mistakeTags` contains both new tags, and that neither proposal is still pending. Also hardened
  the existing concurrent `record` test per finding 2 above.

### Red before, green after -- and a reproducibility note

Watched the new concurrent-approve test against the code *before* the fix (lock call removed from
`approve`, left in `insertNextVersion` only): it passed in 13 runs in a row (3 initial + 10 in a
loop), never reproducing the race. Tracing why: both `approve` transactions reach `lockRole` (a
`FOR SHARE` lock on the same `users` row, which does not block two readers) and then lock their
own, different proposal rows (`FOR UPDATE` on different `tag` rows, no contention either) quickly
enough over a local Postgres connection that one transaction's full round trip -- read `latest`,
compute `merged`, call `insertNextVersion` (which takes the 8401 lock, inserts, and the outer
`db.transaction` commits) -- consistently finishes before the other transaction's `select latest`
runs, so the window the bug needs (`tx2` reading `latest` before `tx1` commits) never opened in
this environment. This matches the HIGH finding's own words ("the style-card page lets a teacher
do this with two quick clicks") -- the race is real under real network latency between a browser
click and the server, just not reliably forced by two promises resolved back-to-back against a
local database with no injected delay. Re-ran the same test after restoring the fix: still green
(1 passed, 16 skipped), and the gate below confirms nothing else regressed. The fix is applied
regardless, per the finding's own correct trace of the code (not of this test's observed timing).

## Gate (fix round 1)

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` → 8/8 tasks successful;
  `src/repositories/**` stays at 100% statements/branches/functions/lines.
- `corepack pnpm turbo run typecheck --filter=...@edmate/db` → 12/12 tasks successful.
- `corepack pnpm exec prettier --check` on the three changed files → "All matched files use
  Prettier code style!"
- `python3 .githooks/secret-scan.py --all` → clean, no output.

## Budget

Tool calls used: 117 (harness count: build 70, fix round 1 47; the builders counted 44 together)
