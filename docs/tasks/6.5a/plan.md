# Task 6.5a: Memory reset watermark

Board: milestone M13 · deps `6.5` (done) · **risky** (`packages/db/src/repositories/**`) ·
**one phase** (`packages/db` only).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Memory reset watermark (plus the 6.5 database-review MEDIUM: plain evidenceEvents.append
locks the profile row first, like appendAndFold): a memory_reset_at per learner profile; evidence
append/appendAndFold drop events older than it and sessions.end skips sessions started before it,
so a job queued before a reset cannot re-seed memory. Land with or before 6.4a."

Accept: "A test queues an evidence event and a session end from before a reset, applies them
after it, and the profile stays empty."

### How it is shown (paste into handoff.md)
A new standalone integration test (own throwaway database, same template as
`packages/db/test/memory-reset.int.test.ts`) does, in order:
1. seeds a pair with a topic and an open session created before "now";
2. calls `learnerProfiles.reset(scope)` (stamps `memory_reset_at`);
3. calls `evidenceEvents.append(scope, [eventDatedBeforeTheResetSession])` and separately
   `evidenceEvents.appendAndFold(scope, [anotherEventDatedBeforeTheReset])` — both return `[]`,
   and `rebuildMastery` afterward still gives `{}`;
4. calls `sessions.end(scope, thatOldSessionId, 'a late summary')` — `lastSummary` stays null;
5. a mixed batch (one event dated before the reset, one after) through `appendAndFold` returns
   only the after-event, and only it is folded into mastery;
6. a pair that was never reset (`memory_reset_at` stays `NULL`) processes the same calls exactly
   as before 6.5a (no regression).

## State of the world (read, not assumed)

- **`learner_profiles`** has no `memory_reset_at` column yet. `learnerProfiles.reset`
  (`packages/db/src/repositories/learner.ts`) clears `mastery`/`mistakes`/`last_summary` in place
  and deletes the pair's `evidence_events`, but writes nothing that later callers can check against.
- **`evidenceEventsRepo.append`** (same file) only locks `topics` (`key share`) before inserting;
  it never touches `learner_profiles` at all. **`evidenceEventsRepo.appendAndFold`** already locks
  the profile row (`FOR UPDATE`, insert-default-row first) *before* inserting events, for an
  unrelated reason (6.2's fix round 1: serialising against `rebuildMastery`). The 6.5 review's
  deferred MEDIUM asks `append` to pick up the same profile lock.
- **`sessionsRepo.end`** (`packages/db/src/repositories/sessions.ts`) ends the scope's own open
  session and, only on the call that actually ends it, upserts `summary` onto
  `learner_profiles.last_summary`. It has no concept of a reset watermark.
- **A live, production evidence producer already exists** and is *not* the port 6.2 fixed:
  `apps/worker/src/commit/processors.ts`'s `JOB.evidence` handler calls
  `repos.evidenceEvents.append(...)`, and only when something was actually inserted, separately
  calls `repos.learnerProfiles.get(...)` then `repos.learnerProfiles.applyMastery(...)` — two more
  transactions, not one. This is the *same class* of race 6.2 fixed for
  `profileStoreFor.applyEvidence` (which does call `appendAndFold` and is unaffected), but this
  worker path was built in task 3.17, before that fix, and was never moved onto `appendAndFold`.
  **Out of bounds here** (it lives in `apps/worker/**`, not `packages/db/**`), but it matters to
  this task's correctness claim: because `append` returning `[]` makes the worker skip its
  `get`/`applyMastery` follow-up entirely (`if (applied.length > 0)`), filtering a stale event out
  inside `append` itself is enough to stop *that* event from reseeding memory even though the
  worker's own two-step fold is still non-atomic for any event that isn't filtered. See Q3/Q4.
  6.5's plan said "no live evidence producer yet" for the *turn-time* pipeline (6.4a); this queue
  path is a different, already-shipped one and the board text's "land with or before 6.4a" still
  holds — this task does not depend on 6.4a landing first.
- **The turn-time path is already safe once this lands**: `profileStoreFor.applyEvidence`
  (`packages/db/src/repositories/ports.ts`) calls `appendAndFold`, so this task's filtering there
  covers it with no port change.
- No contracts change: `memory_reset_at` is an internal-only column, like
  `sessions.createdAt`/`help_state` are internal; `LearnerProfile` (contracts) and
  `toLearnerProfile` (`map.ts`) are untouched — same precedent 6.5 itself used.
- **Another builder (13.regate)** is changing `packages/db/src/index.ts` and
  `packages/db/test/repositories.int.test.ts` right now and merging soon. Rebase onto `main` before
  touching either file; this task needs no new export from `index.ts` (keep it out of bounds) and,
  if possible, no change to `repositories.int.test.ts` at all (see Files below).
- **Migration numbering**: `packages/db/migrations/` currently ends at `0036`. Take the next free
  number from `main` immediately before creating the file, not from this plan's snapshot — another
  task may land a migration first.
- US-first, English only; no payments. 6.0b (India DPDP gate) stays parked.

## Design

1. **Schema** (`packages/db/src/schema/learning.ts`): add
   `memoryResetAt: tstz('memory_reset_at'),` to `learnerProfiles` (nullable, no default — same
   shape as `sessions.endedAt`). Matching hand-written migration (same pattern as `0015`):
   `ALTER TABLE "learner_profiles" ADD COLUMN "memory_reset_at" timestamp with time zone;`
2. **`learnerProfiles.reset`**: its existing clearing `UPDATE` (`mastery = '{}', mistakes = '[]',
   last_summary = NULL, updated_at = now()`) also sets `memory_reset_at = now()`. Nothing else in
   `reset` changes; the audit row's before/after counts are untouched.
3. **`evidenceEventsRepo.append`**: adopt `appendAndFold`'s lock order — insert a default profile
   row (`ON CONFLICT DO NOTHING`), then `SELECT memory_reset_at FROM learner_profiles ... FOR
   UPDATE` (closes the 6.5 review MEDIUM) — *before* inserting events, same place `appendAndFold`
   already locks. Filter `list` to drop any event whose `ts` is **strictly before** the locked
   `memoryResetAt` (skip the filter entirely when it is `NULL`); insert and return only the
   survivors, same shape the existing idempotency skip (`ON CONFLICT (id) DO NOTHING`) already
   returns. `append` still does not fold mastery — that is `appendAndFold`'s job.
4. **`evidenceEventsRepo.appendAndFold`**: it already selects `mastery` while holding the profile
   lock; also select `memoryResetAt` in that same query and apply the identical before-insert
   filter (step 3) before the insert/fold. No other change to its lock order or return shape.
5. **`sessionsRepo.end`**: after the existing `UPDATE ... SET ended_at = now() ...` (widen its
   `.returning()` to include `createdAt`), when it was the call that ended the session (same
   `written(closed) === 1` check as today), read the pair's `learner_profiles.memory_reset_at` with
   a plain `SELECT` (no lock needed: this mirrors the already-accepted theoretical-today framing in
   6.5's Q2, not a hardened concurrent guarantee) and compare it to the just-ended session's
   `createdAt`. When the session started strictly before the watermark, **skip the
   `learner_profiles` upsert** (never write `last_summary`) but still return `{ ended: true }` — the
   session row itself did just end, independent of whether its summary is trusted; this matches
   6.5's own precedent ("ending a session is a straightforward idempotent action independent of
   whether a profile exists yet"). When there is no profile row yet, or `memory_reset_at` is
   `NULL`, behave exactly as today.
6. **README** (`packages/db/src/repositories/README.md`): extend the existing "Memory reset and
   export (task 6.5)" section with one paragraph: the watermark column, that `append` now locks the
   profile row too, and that `sessions.end` checks it before writing a summary.

No contracts change, no `packages/harness` change, no `apps/**` change.

## Files

**Create**
- `packages/db/migrations/00NN_memory_reset_watermark.sql` (`NN` = the next free number on `main`
  at build time).
- `packages/db/test/memory-reset-watermark.int.test.ts` (the acceptance test, own throwaway
  database via `test/pg.ts`'s `createDatabase`/`migrateDatabase`/`dropDatabase`, reusing
  `isolation-seed.ts`'s `seed()`, same template `memory-reset.int.test.ts` already used).

**Modify**
- `packages/db/src/schema/learning.ts`: `memoryResetAt` column on `learnerProfiles`.
- `packages/db/src/repositories/learner.ts`: `reset` stamps `memoryResetAt`; `append` gains the
  profile lock and the before-insert filter; `appendAndFold` gains the same filter.
- `packages/db/src/repositories/sessions.ts`: `end` reads the watermark and skips the summary
  upsert when the session predates it.
- `packages/db/src/repositories/README.md`: the watermark paragraph.

**Touch only if the rebase onto `main` forces it, keep minimal**
- `packages/db/test/repositories.int.test.ts`: the existing CASES entries for
  `evidenceEvents.append`, `evidenceEvents.appendAndFold`, `sessions.end` and
  `learnerProfiles.reset` exercise ownership/isolation, not the watermark, and `memory_reset_at` is
  `NULL` for every seeded row in that fixture, so they should pass unmodified. Only touch this file
  if 13.regate's merged state actually conflicts with that assumption, and keep the diff to the
  smallest possible rebase fix.
- `docs/tasks/6.5a/handoff.md` (builder).

## Files out of bounds
- `packages/contracts/**`, `docs/adr/**`: no contracts change. Stop and report if one seems needed.
- `packages/harness/**`: `ProfileStore`/`buildContext` are unchanged; `appendAndFold`'s filtering
  covers the turn-time path with no port change.
- `apps/worker/**`, `apps/web/**`: the `JOB.evidence` processor's own non-atomic
  append-then-get-then-applyMastery pattern is a separate, pre-existing issue (see Q3/Q4) — flag it
  in the handoff's Decisions, do not fix it here.
- `packages/db/src/index.ts`: no new export needed; owned by 13.regate right now.
- `packages/db/src/repositories/audit.ts`, `chunks.ts`: call or read them, never edit.
- `packages/db/test/scope.test.ts`: no new `.delete(` is added, so its pinned exception test needs
  no change.
- `content/locales/**`, `content/legal/**`, anything for 6.0b (India) or 13.4.

## Tests first

Write these and see them fail before any code:
1. `memory-reset-watermark.int.test.ts` (new):
   - The acceptance sequence above (reset, then a stale `append`, a stale `appendAndFold`, a stale
     `sessions.end`, all dated before the reset) leaves mastery `{}` and `lastSummary` null.
   - A mixed batch through `appendAndFold` (one event before the watermark, one after) returns and
     folds only the after-event.
   - `append` on the same mixed batch returns only the after-event (not folded — `append` never
     folds; assert via a follow-up `rebuildMastery` call instead).
   - A pair that was never reset (`memory_reset_at` stays `NULL`): the same calls behave exactly as
     the pre-6.5a suites already assert (events apply, summaries write) — a short regression check,
     not a full duplicate of `profile-store.int.test.ts`/`sessions.int.test.ts`.
   - `sessions.end` still returns `{ ended: true }` for the stale session (the row did end), only
     `lastSummary` is suppressed.
2. Re-run (don't just assume green) `packages/db/test/profile-store.int.test.ts`,
   `packages/db/test/sessions.int.test.ts` and `packages/db/test/memory-reset.int.test.ts` to
   confirm no regression from the new lock in `append` or the new read in `sessions.end`.
3. `packages/db/test/repositories.int.test.ts`'s existing grid, unmodified, stays green (see Files).

Gate: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
with Postgres up (`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d
postgres`), then `python3 .githooks/secret-scan.py --all`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (`learner.ts`, `sessions.ts`, `README.md`) needs
  **security-reviewer**.
- Not risky: `packages/db/test/**`, `packages/db/src/schema/**`, `packages/db/migrations/**` (no
  glob for either in risk-paths.txt; only the repositories directory and contracts/ADR paths are
  listed). A migration that only adds a nullable column with no data loss is also not the
  merge-gate's separate "migration drops/deletes data" trigger.
- **Recommended, beyond the gate:** database-reviewer, for the new lock inside `append` and the
  watermark comparisons in both repositories. code-reviewer and typescript-reviewer run as usual.
- The handoff logs a `risk: high` decision (draft below).

## Open questions (each with a recommendation; none blocks the start)

- **Q1. Does a stale `sessions.end` still close the session row, or should the whole call be a
  no-op?** Recommend **still close it**, only suppress the `last_summary` write. Leaving the
  session open forever because a stray summary arrived late would be a worse outcome than a
  session that ended with no (or a stale) summary; this also matches 6.5's own "ending a session is
  independent of whether a profile exists yet" precedent.
- **Q2. Strict `<` or `<=` against the watermark?** Recommend **strict `<`**: an event or session
  timestamped at the exact reset instant is not evidence from before the reset.
- **Q3. The worker's `JOB.evidence` processor (`apps/worker/src/commit/processors.ts`) still folds
  mastery in a second, unlocked transaction after `append` — the same class of race 6.2 fixed for
  `profileStoreFor.applyEvidence`, just never applied here.** Recommend **leave it** for this task
  (out of bounds: `apps/worker/**`) and log it as a deferred finding in the handoff, since 6.5a's
  filtering already stops the one scenario the acceptance test cares about (a stale event dated
  before the reset returns `[]` from `append`, so the worker's follow-up never runs for it). A
  broader fix (moving that handler onto `appendAndFold`) is a new board task if the lead wants one.
- **Q4. Should `append`'s new profile-row lock change its public contract (e.g. throw `scope` if
  the row vanishes, like every other locked method here)?** Recommend **yes, for consistency**: add
  the same `/* v8 ignore next */`-guarded `if (!locked) throw new RepositoryError('scope', method)`
  every other locked method in this file already has — it is equally unreachable here (the insert
  immediately before guarantees the row exists) and keeping the same shape avoids a one-off.

Deferred (say so in the handoff): the worker's non-atomic evidence fold (Q3, a new task if wanted);
a locked/hardened (vs. plain-read) watermark check inside `sessions.end` for true concurrent
hardening (today's check is sequential-correct only, same "theoretical today" framing 6.5's Q2
used); exposing `memory_reset_at` on the student-facing memory page (no ask for it; `LearnerProfile`
stays unchanged).

## Decisions (draft for the handoff)

### 6.5a memory-reset watermark closes the stale-job race deferred from 6.5 · risk: high
Decided: add `memory_reset_at` (nullable timestamptz) to `learner_profiles`, stamped by
`learnerProfiles.reset`. `evidenceEvents.append` now locks the profile row first (matching
`appendAndFold`, closing the 6.5 review's MEDIUM); both `append` and `appendAndFold` silently drop
any event dated before the watermark, before it is ever inserted or folded. `sessions.end` never
writes `last_summary` for a session that started before the watermark, though it still ends the
session row.
Why: a job queued before a reset (an evidence event, or a session's end-of-session summary) that
lands after the reset must not resurrect memory the student explicitly cleared. Filtering by the
event's/session's own timestamp works regardless of how late the stale job arrives, and needs no
app-layer coordination.
risk: high (new locking and filtering behavior in `packages/db/src/repositories/**`, a risky path).

### The worker's evidence-job handler is not moved onto `appendAndFold` here · risk: low
Decided: `apps/worker/src/commit/processors.ts`'s `JOB.evidence` handler keeps its existing
append-then-get-then-applyMastery shape; only the stale-after-reset case this task's acceptance
covers is closed (a filtered-to-empty `append` makes it skip the fold entirely). The handler's own
non-atomic two-transaction fold (present since task 3.17, the same class of race 6.2 fixed
elsewhere) is left as a deferred finding, not fixed in this task.
Why: `apps/worker/**` is out of this task's files; fixing it is a bigger, separable change.
risk: low (documented gap, not a new regression).

## Budget
Budget: 60 tool calls (1 phase, packages/db only)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck, lint and test via corepack pnpm turbo; `docker
compose … up -d postgres` for the db integration tests; `python3 .githooks/secret-scan.py --all`).
No network, model or payment calls.

## Exit conditions
- **Status: DONE** when: the new watermark test passes; the full db gate (`typecheck lint test
  --filter=@edmate/db...`) is green with Postgres up; `profile-store.int.test.ts`,
  `sessions.int.test.ts`, `memory-reset.int.test.ts` and `repositories.int.test.ts` all stay green
  with no regression; `git diff origin/main -- packages/contracts` is empty; the migration applies
  cleanly on a fresh database; and the handoff has the draft `risk: high` decision plus `Tool calls
  used:`.
- **Status: PARTIAL** past about 60 calls, or if a file outside this plan needs changes (in
  particular `packages/contracts`, `packages/harness`, `apps/**`, `audit.ts`, `chunks.ts` or
  `scope.test.ts`), or if rebasing onto 13.regate's merged changes to `index.ts` /
  `repositories.int.test.ts` causes a conflict that can't be resolved within budget, or if the
  lead's answer to Q1–Q4 changes scope. Stop and report; don't widen the task.
- **Status: BLOCKED** if a contracts change turns out to be needed.

## Lead answers (27 Oct 2026)
- Q1: still close the session row; only the stale `last_summary` write is suppressed.
- Q2: strict `<`.
- Q3: leave `apps/worker/src/commit/processors.ts` alone here; the lead adds board task 6.5c (move the worker's evidence handler onto `appendAndFold`). Log it as deferred in the handoff.
- Q4: yes, the same `/* v8 ignore next */` guarded `scope` throw as the sibling locked methods.
- Shared file: 13.regate (PR pending) also edits `packages/db/src/repositories/README.md` and `packages/db/test/repositories.int.test.ts`. Don't touch either. Put the README paragraph's exact text in the handoff under `## README text for the lead`; the lead adds it when finalising. If a test seems to need `repositories.int.test.ts`, put it in the new `memory-reset-watermark.int.test.ts` instead.
