# 9.6i handoff: 9.6h security re-check follow-ups and two 9.6d review items

Status: DONE

- Branch: `m9/9.6i-subscription-recheck` (built on local `work-96i`)
- Worktree: `.claude/worktrees/agent-ac973ff04c171cdfc`
- Tool calls used: 52 (harness count; the builder reported 38)

## Summary

- `changePackage` now refuses (`invalid`) a free target while the teacher's free tier is cost-alarm paused this month, the same check `start` makes. A paid start followed by a change to the free package no longer gets round the alarm.
- `start`'s refusal re-read and `changePackage`'s target read now share one helper (`liveTarget`). It joins the verified teacher, the live package version and the live agent, and returns `alarmPaused` as a column. A missing, old, rejected-teacher or suspended-agent version is `not_found` before the alarm is considered, so there is no alarm-state oracle.
- The web start route tells the two `invalid` causes apart with `findLive`. If the student has no live subscription, the route returns 409 with its own fixed words: "This teacher's free plan is paused for now. Try again next month or choose another package." Otherwise it returns the existing "You already have a package with this teacher." If `findLive` itself fails, the route goes through the normal error mapping (for example 500) and never guesses.
- `apps/web/src/subscriptions/change.ts` logs `[subscriptions] <error name>` on every 500 path (a `failed` RepositoryError or any non-RepositoryError). It never logs the message or any ids.
- The plan page returns `notFound()` when `packageVersions.getById` misses. It no longer falls back to the internal version id.
- Comments added: the alarm marker's known window (no marker when the alarm paused nothing; a start whose snapshot predates the alarm's commit), and a note for 10.3 that resume's `created_at` tie-break adds no order.
- The "paid package starts with no payment" bypass was left alone (10.x closes it). The existing comment in `start.ts` still says so.

## Files

- `packages/db/src/repositories/subscriptions.ts` (risky path): `liveTarget` helper, alarm check in `changePackage`, joined refusal re-read in `start`, comments.
- `packages/db/test/repositories.int.test.ts` (shared, additive): 9.6h rejected-teacher test restores verification in a `finally`; two actorRole-only forged rows in the 9.6h resume test; a new `task 9.6i` describe block.
- `apps/web/src/subscriptions/start.ts`, `start.test.ts`
- `apps/web/src/subscriptions/change.ts`, `change.test.ts`
- `apps/web/app/learn/[agentId]/plan/page.tsx`, `page.test.tsx`
- No schema, migration, contracts or message-file change.

## Tests (failing first, then passing)

| Item | Test | Before the fix |
|---|---|---|
| MEDIUM changePackage alarm | `task 9.6i ... > changePackage (MEDIUM): a paid start then a change to the alarm-paused free package is invalid; paid to paid still works` | failed (the change went through) |
| MEDIUM web start wording | `start.test.ts > task 9.6i: an invalid start with no live subscription is the alarm refusal, with its own fixed words` | failed (got "already have") |
| (same, error path) | `start.test.ts > task 9.6i: a findLive failure while explaining an invalid start is a 500, not a guess` | failed (got 409) |
| LOW re-read joins | `task 9.6i ... > start (LOW): during the alarm, a non-live free version or a rejected teacher's free version is not_found, not invalid` | failed (`invalid`) |
| LOW actorRole-only forged row | 9.6h `resume (MEDIUM)` test now also has rows `actor = stu_96h_b` with roles `staff` and `system` | n/a (adds mutation coverage) |
| LOW finally | 9.6h `changePackage (MEDIUM)` rejected-teacher test restores `verified` in `finally` | n/a |
| 9.6d MEDIUM change.ts logging | `change.test.ts > task 9.6i: a 500 logs only the error name, never its message or ids` (+ `a non-500 refusal logs nothing`) | failed (no log) |
| 9.6d MEDIUM plan page | `page.test.tsx > task 9.6i: a getById miss for the live subscription fails closed (notFound), never the internal version id` | failed (rendered with the version id) |

## Acceptance evidence

```
TEST_DATABASE_URL=<own disposable pgvector pg16 on 127.0.0.1:55961> corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --filter=@edmate/web... --concurrency=2
 -> @edmate/db:test  Test Files 65 passed (65); Tests 1241 passed | 4 skipped (1245)
 -> @edmate/db:test  subscriptions.ts | 100 | 100 | 100 | 100
 -> @edmate/web:test Test Files 118 passed | 1 skipped (119)
 -> Tasks: 34 successful, 34 total
python3 .githooks/secret-scan.py --all -> clean
```

The first full run at default concurrency had two harness wall-clock tests time out under load (latency and soft-hit checks in `packages/harness`, which this task doesn't touch). They passed on the `--concurrency=2` re-run.

## Deviations

- None from the scope. The alarm-marker window is documented in a comment, not fixed (the review offered that option; a teacher-level marker row needs 10.3/7.6).

## Left to do

- security-reviewer re-check (board accept line).

## Decisions

### 22 Oct 2026 · 9.6i subscription re-check fixes on a risky path · decided by builder · risk: high
- Decided: `packages/db/src/repositories/subscriptions.ts` (risky path) now applies the cost-alarm free-tier check in `changePackage`, and `start`'s refusal re-read uses the same verified, live-version and live-agent joins. security-reviewer must re-check this PR before merge, as the board's accept line says.
- Why: the file is on the merge gate's risk list, and the change alters who can switch to a free package.
- risk: high

### 22 Oct 2026 · 9.6i the start route tells the alarm refusal apart with findLive · decided by builder · risk: low
- Decided: on `invalid` from `start`, the route calls `findLive`. No live row means the alarm refusal: 409 with "This teacher's free plan is paused for now. Try again next month or choose another package." A live row keeps "You already have a package with this teacher." A `findLive` error goes through the normal error mapping.
- Why: the repository's error kinds are fixed (a new kind would touch every route's mapping). With no live row, the unique index can't be the cause, so the alarm is the only `invalid` left.
- risk: low

### 22 Oct 2026 · 9.6i the alarm marker window is documented, not closed · decided by builder · risk: low
- Decided: no marker row is written when the alarm pauses nothing. A comment on `alarmPausedFree` records the window (at most a day, closed by the next run) and leaves a teacher-level marker to 10.3/7.6.
- Why: the review rated it LOW and offered "accept and document". A teacher-level row would change what the alarm writes.
- risk: low
