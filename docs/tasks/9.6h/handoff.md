# 9.6h: 9.6c security review follow-ups (subscriptions.ts)

Branch: `m9/9.6h-subscription-hardening` (built on local `work-96h`)
Worktree: `.claude/worktrees/agent-ab0b662b42ee8b6a1`

## Summary

Fixes the three MEDIUMs and four LOWs from the 9.6c security review in
`packages/db/src/repositories/subscriptions.ts`. No schema change, no migration, no contracts or
apps/web change.

- **MEDIUM, cost-alarm pause -> cancel -> start:** `start` now refuses (`invalid`) a **free**
  package version while that teacher's free tier is cost-alarm paused this UTC calendar month, which
  means a `subscription.pause_cost_alarm` audit row for the teacher since the month began. That is
  the same marker the alarm itself uses, and the same month as `monthStartUtc` in apps/worker. The check is a
  `NOT (...)` clause inside the existing single `INSERT ... SELECT`, so it can't be raced apart
  from the write. When nothing is written, a second read tells `invalid` (alarm-blocked) from
  `not_found`. Paid versions are unaffected.
- **MEDIUM, resume trusts any pause_student row:** the latest audit row must now have action
  `subscription.pause_student` **and** `actor` = this student **and** `actorRole` = 'student'.
  Any other latest row, including a staff, system or other-student row with that action, is `invalid`.
- **MEDIUM, changePackage skipped the verified-teacher check:** the target query now inner-joins
  `teacher_profiles` with `verification_status = 'verified'`, the same as `start` (9.3c). A plain read with
  no lock, so the lock order (subscription row first) is unchanged.
- **LOW, trial reset:** if the student has ever had a subscription with this teacher, a `trial`
  start is stored and returned as `active` (same `periodEnd`).
- **LOW, trial carried into a no-trial package:** `changePackage` from `trial` to a version whose
  config has no positive `trialDays` sets `status = 'active'` (period_end kept). The audit row's
  `after` records it.
- **LOW, resume ordering:** audit rows are ordered by `(ts, created_at, id)`. Since ids are random,
  if the two latest rows tie on both `ts` and `created_at`, resume fails closed (`invalid`)
  and doesn't let the id pick.
- **LOW, unlocked live-version read:** a code comment on `changePackage`'s target query notes the
  same unlocked-publish gap as `start`, and that it's accepted.

## Files

- `packages/db/src/repositories/subscriptions.ts`: `alarmPausedFree` SQL fragment; `start`
  (alarm block, one trial per pair); `changePackage` (verified join, trial end, gap comment);
  `resume` (actor/role check, tie fails closed).
- `packages/db/test/repositories.int.test.ts` (shared, additive): a new self-contained
  `describe('task 9.6h: ...')` block (teacher `tch_96h`), plus one inserted cleanup line in the
  `subscriptions.pauseFreeForTeacher` isolation case. It deletes that teacher's alarm audit rows
  after the case's own seed reset, because otherwise the new alarm block makes the later
  `subscriptions.start` grid case (free seed packages) `invalid`.

## Tests

Failing before the fix, passing after (run against the disposable container before the source change).
All three failed with `promise resolved ... instead of rejecting`:
- MEDIUM 1: `start (MEDIUM): cost-alarm pause -> cancel -> start of a free package is invalid for
  the rest of the month; a paid package still starts`
- MEDIUM 2: `resume (MEDIUM): only a pause_student row by this same student counts; staff, system
  or another student's row is invalid`
- MEDIUM 3: `changePackage (MEDIUM): a teacher rejected after publishing can't be switched to,
  like start (9.3c)`

LOW tests (same block): `resume (LOW): two latest rows with the same timestamp ...`,
`changePackage (LOW): a trial switched to a package with no trial becomes active ...`,
`start (LOW): cancel then start does not give the pair a second trial`.

```
$ TEST_DATABASE_URL=postgres://…@127.0.0.1:55497/edmate corepack pnpm vitest run test/repositories.int.test.ts
      Tests  154 passed (154)
```

Gate, after merging origin/main (`--concurrency=2`; an earlier unthrottled run had one unrelated
wall-clock retrieval-latency test fail under load, and it passed on the re-run):

```
$ TEST_DATABASE_URL=… corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
@edmate/db:test:  Test Files  63 passed (63)
@edmate/db:test:       Tests  1206 passed | 4 skipped (1210)
@edmate/db:test:   subscriptions.ts |     100 |      100 |     100 |     100 |
 Tasks:    26 successful, 26 total
$ python3 .githooks/secret-scan.py --all
(clean, no output)
```

Disposable container `edmate-db-test-96h` (port 55497) was started and removed by this builder.
The running `edmate-*` containers were not touched.

## Decisions

### 22 Oct 2026 · 9.6h subscription hardening on a risky path · decided by builder · risk: high
- Decided: the three 9.6c security MEDIUMs and four LOWs are fixed in `packages/db/src/repositories/subscriptions.ts` (risky path). security-reviewer must re-check this PR before merge, as the board's accept line says.
- Why: the file is on the merge gate's risk list and the changes touch access to paid/free subscriptions.
- risk: high

### 22 Oct 2026 · 9.6h start refuses a free package while the teacher's free tier is alarm-paused · decided by builder · risk: medium
- Decided: the lead's preferred option. `start` is `invalid` for a free version when a `subscription.pause_cost_alarm` audit row exists for that teacher since the start of the current UTC month. The block is per teacher, not per pair, so a new student also can't start the free package until the month ends. A staff unpause of an existing subscription doesn't lift it. Paid packages still start.
- Why: it reuses the alarm's own marker (no schema change) and closes the cancel -> start loop for every student, not just the one who cancelled. Keeping the alarm state on cancel would have left new free starts open until the next daily alarm run. If staff need to reopen a teacher's free tier mid-month, that needs a later task (for example, a staff action that writes an "unblock" row).
- risk: medium

### 22 Oct 2026 · 9.6h a restarted pair gets no second trial · decided by builder · risk: low
- Decided: if the student has any earlier subscription row with this teacher, a `trial` start becomes `active`, with the caller's `periodEnd` unchanged (that is the trial length the web caller computed). It is not refused.
- Why: refusing would break restarting a trial-offering package. With no payment until M10, `active` vs `trial` only matters for future billing, and 10.3 revisits trial rules.
- risk: low

### 22 Oct 2026 · 9.6h changePackage ends a trial on a no-trial target · decided by builder · risk: low
- Decided: `trial` -> a version whose `config.trialDays` is missing, 0 or not a number becomes `active`. `period_end` is kept. Other statuses are unchanged.
- Why: the review's LOW. Recomputing the period needs billing (10.3).
- risk: low

### 22 Oct 2026 · 9.6h resume fails closed on a timestamp tie · decided by builder · risk: low
- Decided: resume orders by (ts, created_at, id) and rejects `invalid` when the two latest rows tie on both timestamps, because a random id isn't a real order.
- Why: no schema change was allowed, so there's no sequence column. A paused_by column or a sequence is left for 10.3.
- risk: low

## Left to do

- `changePackage` from a paid package to a free one while the teacher is alarm-paused is not blocked (out of this task's scope). It could get the same `alarmPausedFree` check in a follow-up.
- A staff "reopen free tier" action, if the business wants one (see the decision above).
- security-reviewer re-check (board accept line).

Status: DONE

Tool calls used: 62 (harness count; the builder reported 55)
