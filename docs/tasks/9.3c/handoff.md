# 9.3c handoff

## Summary

A package whose teacher is no longer verified can't be started, and its package page shows not
found. `packageVersions.liveForAgent` now inner-joins `teacherProfiles` on
`verificationStatus = 'verified'`, so a pending or rejected teacher's agent looks the same as a
missing one (empty list, never an error). `subscriptions.start` carries the same verified join into
its single `INSERT ... SELECT ... FOR SHARE OF teacher_profiles` statement, so the teacher's
profile row is read FOR SHARE as part of the one statement that writes the subscription — a
verification change can land strictly before or after that statement, never mid-write, and the
refusal is the existing `not_found` kind (the same one a non-live package already uses; no new
kind). `/packages/[agentId]` now treats an empty `liveForAgent` result as not found, instead of
rendering an empty compare view (a rejected teacher's agent is still "live" per `agents.owner`,
task 9.2 plan Q5 decision 2: that read is unchanged in this task).

## Files

- `packages/db/src/repositories/package-versions.ts` — `liveForAgent`'s verified join.
- `packages/db/src/repositories/subscriptions.ts` — `start`'s verified join + `FOR SHARE`.
- `packages/db/test/repositories.int.test.ts` — isolation grid: both seeded teachers (A, B) are
  now verified by default from `beforeAll` (task 9.3c), with `discovery.search` /
  `discovery.teacherBySlug` updated to explicitly push B to `pending` for their "stays pending"
  assertions and restore it afterward (previously relied on the old pending-by-default). Two new
  standalone `it()`s (own fixture, teacher `tch_93c`, not A/B) cover: `liveForAgent` is `[]` for a
  pending and for a rejected teacher and sees the package once verified; `subscriptions.start`
  refuses a rejected teacher's package with nothing written (checked via the whole-database
  `snapshot()` plus explicit `subscriptions`/`audit_log` row counts), then succeeds once verified.
- `apps/web/app/packages/[agentId]/page.tsx` — empty `liveForAgent` is `notFound()`.
- `apps/web/app/packages/[agentId]/page.test.tsx` — new case for the rejected-teacher/empty-offers
  path; the existing "before any database read" case's `liveForAgent` fixture now returns one
  offer (it used to return `[]`, which would now 404 before the assertion it's checking).

## Tests

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` — green (1052 passed, 4
  skipped; 100% statements/functions/lines, 97.62% branches on `src/repositories/**`, meeting the
  package's threshold).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — green (`apps/web` test
  suite passes; the two touched page test cases pass, 13/13 in `app/packages`).
- `python3 .githooks/secret-scan.py --all` — clean.

## Decisions

### 22 Oct 2026 · 9.3c add the verified join to packageVersions.liveForAgent and subscriptions.start · decided by lead · risk: high
- Decided: `packageVersions.liveForAgent` and `subscriptions.start` both require
  `teacherProfiles.verificationStatus = 'verified'` (an inner join), so a pending or rejected
  teacher's live agent/package is invisible and unstartable, the same as a missing one.
- Why: 9.2's plan Q5 found that a teacher rejected after publishing stayed startable by typed URL,
  since neither read checked verification.
- risk: high (a `packages/db/src/repositories/**` change).

### 22 Oct 2026 · 9.3c re-check verification inside start's own write statement, FOR SHARE · decided by builder · risk: high
- Decided: `subscriptions.start` re-checks the teacher's profile as part of the same
  `INSERT ... SELECT ... FOR SHARE OF teacher_profiles` statement that writes the subscription
  (not a separate pre-check), so a verification change can't commit mid-start. Refuses with the
  existing `not_found` kind (the same one a non-live `packageVersionId` already uses) — no new
  error kind invented.
- Why: the lead's instruction was to re-check verification "inside subscriptions.start's
  transaction ... reading the profile FOR SHARE". Since `start` was already a single atomic
  `INSERT ... SELECT` statement (no separate transaction wrapper), the simplest statement that
  satisfies both "read FOR SHARE" and "inside the same transaction" is one `INSERT ... SELECT ...
  FOR SHARE OF` statement with the verified join folded into its own `FROM`/`WHERE`, rather than a
  separate `SELECT ... FOR SHARE` followed by a second `INSERT ... SELECT` inside an explicit
  `db.transaction` (that two-statement form was tried first; it made the final
  `written(result) !== 1` defensive check unreachable — every mismatch that could fail the insert
  was already caught by the earlier select — dropping `src/repositories` coverage below the
  package's 100% statement threshold). The one-statement form keeps `written(result) !== 1` as the
  single, fully-exercised refusal path.
- risk: high (a `packages/db/src/repositories/**` change).

### 22 Oct 2026 · 9.3c seeded teachers A and B are verified by default in the isolation grid · decided by builder · risk: low
- Decided: `packages/db/test/repositories.int.test.ts`'s `beforeAll` sets both seeded teachers'
  `teacher_profiles` rows to `verified` right after creating them (previously left at the schema
  default, `pending`). `discovery.search`/`discovery.teacherBySlug`'s existing "teacher B stays
  pending" assertions now explicitly push B to `pending` for that one assertion and restore it to
  `verified` afterward, instead of relying on the old default.
- Why: once `liveForAgent`/`subscriptions.start` check verification, the grid's many pre-existing
  passing assertions for both methods (reached before `discovery.*` in file order) need the seeded
  teachers verified by default, the same way a real published, reviewed teacher would be. Adding
  a brand-new always-verified teacher fixture instead (leaving A/B pending) was rejected: the grid
  test that asserts `createRepositories(db)` has exactly one case per method
  (`'has a case for exactly the methods...'`) does not care, but the `liveForAgent` and
  `subscriptions.start` cases already assert success for A/B specifically, so A/B had to become
  verified.
- risk: low (test-only; no production behaviour change).

### 22 Oct 2026 · 9.3c existing subscribers of a rejected teacher keep access for now · decided by lead · risk: medium
- Decided: 9.3c blocks only new starts and the package page; the turn path and agents.owner are unchanged, so students who subscribed before a rejection keep learning until the human answers B-46.
- Why: whether to cut access is a product decision; the brief kept it out of scope, and the reviewers confirmed the gap is tracked.
- risk: medium (a rejected teacher's agent stays reachable for existing students meanwhile).

## Left to do

- **Open question (lead decision 2, not acted on here):** `agents.owner` (used by
  `/packages/[agentId]` to resolve the teacher, and by the turn path in `ports.ts`) still returns
  a live agent's teacher regardless of verification. A rejected teacher's existing subscribers can
  therefore still reach `/learn/<agentId>` and keep learning (the "already subscribed" branch of
  `/packages/[agentId]` never calls `liveForAgent`, so it is unaffected by this task). Whether
  existing subscribers of a rejected teacher should keep learning is a product decision for the
  human — out of scope here per the lead's explicit instruction not to touch `agents.owner` or
  `ports.ts`.
- No migration was needed (schema already has `teacher_profiles.verification_status`); did not
  touch `publish.ts`, `packages/contracts`, or any migration file.

Status: DONE

Tool calls used: 106 (harness; over the 70 budget)
