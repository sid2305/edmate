# 3.16 handoff — Sessions follow the package

**Status:** DONE
**Branch:** `m3/3.16-sessions-follow-package`
**Worktree:** `.claude/worktrees/agent-afa8a51db1bea816a`

Acceptance: "A student whose bigger package lapses keeps no access to its earlier module text
through history, sources or summary; tests cover downgrade and version change." No contracts
change. No model or payment calls in any test.

## Acceptance evidence

Postgres: `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`.
Nothing skipped (no `SKIPPED` line in the db run).

| Command | Result (trimmed) |
|---|---|
| `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --filter=@edmate/harness...` | `Tasks: 18 successful, 18 total` |
| db test (Postgres, `--force`) | `Test Files 22 passed (22)` · `Tests 419 passed (419)` · `All files 99.89 / 99.19 / 99.66 / 100` · `sessions.ts 100 / 100 / 100 / 100` · `ports.ts 100 / 100 / 100 / 100` |
| `test/session-package.int.test.ts` (new) | `8 tests` pass: control, **downgrade**, **version change**, stale turn never wipes a newer summary, concurrent end ends once, no-profile and out-of-scope calls, `sessions.create` package validation, teacher preview restarts on a new version |
| `test/session-package-migration.int.test.ts` (new) | `6 tests` pass; NOTICE `sessions package pin (3.16): 2 backfilled, 4 ended, 1 already ended` |
| `test/repositories.int.test.ts` | `57 tests` pass; new grid case `sessions.endOnPackageChange` (cross-tenant writes are `not_found`, nothing written) |
| `test/turn-config.int.test.ts`, `test/session-state.int.test.ts`, `test/schema.test.ts` | pass (regression) |
| harness test | `Test Files 34 passed (34)` · `Tests 2116 passed (2116)` · `memoryAccess.ts 100 / 98.78 / 100 / 100` |
| red run (harness, fixture reverted) | `Tests 5 failed | 77 passed (82)`: the 5 new pin cases; green after the fixture change |
| red run (db) | `session-package.int.test.ts` failed in setup before the repository change (seed and repo had no pin) |
| `python3 .githooks/secret-scan.py --all` | exit 0 |

### 19 Oct 2026 fix round (build-error-resolver)

| Command | Result (trimmed) |
|---|---|
| `corepack pnpm turbo run typecheck lint --filter=@edmate/db... --filter=@edmate/harness...` | `Tasks: 13 successful, 13 total` |
| `corepack pnpm turbo run test --filter=@edmate/db... --filter=@edmate/harness... --force` (Postgres up, nothing skipped) | db: `Test Files 22 passed (22)` · `Tests 421 passed (421)`; harness: `Test Files 34 passed (34)` · `Tests 2118 passed (2118)` |
| `python3 .githooks/secret-scan.py --all` | no output, exit 0 |

New/changed tests in this round: `messages.append also refuses an ended session (like saveHelpState)` (`session-state.int.test.ts`); `an open session with no package pin is a bad fixture: load throws` and `a session with only one of packageId/packageVersion is a bad fixture: load throws` (`memoryAccess.test.ts`, plus the existing "no package pin" case updated to an ended session); `turnConfigStoreFor(...).load ends the session exactly once under concurrent calls` (`session-package.int.test.ts`).

Migration path used in tests: all three. `ses_ok` (active, own agent) and `ses_paused` (paused,
own agent) were **backfilled**; `ses_other` (live subscription is another agent's package),
`ses_lapsed` (ended subscription), `ses_none` (no subscription) and `ses_preview` (teacher
preview, no subscription) were **ended** and their pairs' summaries cleared; `ses_old` was
**already ended** and left alone (no pin, same `ended_at`, its pair's summary kept). Every session,
message and profile row is still there afterwards.

## Changes

- `packages/db/src/schema/learning.ts`: `sessions` gains `package_id` and `package_version`
  (nullable), a composite foreign key to `package_versions (package_id, version)`, an index on
  the pair, and two checks: the pin is both-or-neither, and every open session has one.
- `packages/db/migrations/0009_session_package_pin.sql` (+ snapshot, journal; generated, then the
  backfill block added by hand between the new columns and the constraints): for each open
  session, backfill the pin from the student's live (not ended) subscription with that teacher
  when its package is the session's agent's; otherwise clear that pair's `last_summary` and end
  the session. Already-ended sessions get no pin. Counts reported with `RAISE NOTICE`.
- `packages/db/src/repositories/sessions.ts`: `SessionRow` gains `packageId`/`packageVersion`;
  `create` takes and validates them (the package must be the given agent's and the scope
  teacher's, at an existing version, else `not_found`); new
  `endOnPackageChange(scope, sessionId) → { ended }`: in one transaction ends the scope's own open
  session and clears the pair's summary **only when this call ended it**; an already-ended own
  session is `{ ended: false }` with no write; another pair's or a missing session is
  `not_found`. A comment says why `help_state` is kept.
- `packages/db/src/repositories/ports.ts`: `turnConfigStoreFor.load`, after the ownership/open/
  agent check, compares the session's pin with the entitlement's package and version; on any
  difference it calls `endOnPackageChange` with the scope taken from the entitlement and returns
  `null` (so `entitle` gives `no_access`).
- `packages/harness/src/testing/memoryAccess.ts`: `MemorySession` gains the pin; every
  `twoTeacherWorld()` session is pinned to what its entitlement resolves to; the in-memory
  `load` mirrors the mismatch (ends the session, returns `null`).
- Tests: new `session-package.int.test.ts`, `session-package-migration.int.test.ts`; seeds pin
  their sessions; isolation grid case for the new method plus two package mismatches for
  `sessions.create`; `turn-config.int.test.ts` swaps its "missing package version" check for a
  corrupt-row check (a version mismatch now ends the session); `schema.test.ts` allows exactly
  0009's reviewed `UPDATE`s and checks which columns they set; harness `entitle.test.ts`,
  `memoryAccess.test.ts`, and the property test's invariant (session pinned to the returned
  package version).
- `packages/harness/README.md`: one sentence on the pin under entitle.

## Deviations

- **Pin columns are nullable** (plan said `NOT NULL`): the security plan review says already-ended
  sessions get no pin, so the columns can't be `NOT NULL`. The CHECK `sessions_open_has_package`
  gives the same guarantee for every session that can still be used.
- **Foreign key is to `package_versions (package_id, version)`** rather than `packages.id`: it
  also proves the version exists.
- **The migration updates data** (`UPDATE sessions`, `UPDATE learner_profiles`). The merge gate's
  destructive-SQL check flags it, so database-reviewer is required. `schema.test.ts` allows
  exactly these three statements in 0009 and nothing else.
- **`packages/harness/src/access/property.test.ts`** was touched (the plan's optional invariant
  strengthening), although the plan also listed `src/access/**` as out of bounds. Test-only; the
  path is in security-reviewer's group, which is required anyway.

## Decisions

### 18 Oct 2026 · 3.16 Any package or version change ends the session, and the summary is cleared only by the call that ended it · decided by team lead (plan decision 1 and security plan review) · risk: high
Decided: `turnConfigStoreFor.load` ends the session (and the db clears the pair's `last_summary`) whenever the entitlement's package or version differs from the session's pin, by any source; the clear happens in the same transaction and only if that UPDATE moved the session from open to ended.
Why: earlier history, sources and summary of a lapsed package must never reach the model, and a retried or stale turn must never wipe a newer session's summary.
Alternatives: end only on a downgrade (compare module sets); clear the summary on every call; two separate repository methods.
Reversible: yes, inside packages/db; no port changes.

### 18 Oct 2026 · 3.16 Migration 0009 backfills each open session's pin from its live entitlement, or ends it and clears the pair's summary · decided by team lead (lead answer and security plan review) · risk: high
Decided: an open session whose student has a live (not ended, paused included) subscription with that teacher to a package of the session's agent gets that package version; any other open session is ended and its pair's `last_summary` is set to NULL; already-ended sessions stay as they are with no pin. No row is deleted; counts are reported as a NOTICE. Tests used all three paths.
Why: the lead's rule that the migration never loses rows, without leaving an open session that could carry content from an unknown package.
Alternatives: 0007-style "stop if rows exist" guard; backfill everything with a guessed pin; leave unpinned open sessions open.
Reversible: the pins and `ended_at` values can be cleared or changed later; a cleared `last_summary` can't be restored (it's the intended effect, like `endOnPackageChange`).

### 18 Oct 2026 · 3.16 Pin columns are nullable, with checks that every open session has a full pin to a real package version · decided by builder (tdd-guide) · risk: medium
Decided: `package_id`/`package_version` are nullable, with a composite foreign key to `package_versions (package_id, version)`, a both-or-neither check and an "open sessions have a pin" check.
Why: already-ended sessions get no pin (security plan review), so `NOT NULL` is impossible; the checks keep the guarantee for usable sessions.
Alternatives: `NOT NULL` with a fake pin on ended sessions; a foreign key to `packages.id` only.
Reversible: yes, by a later migration.

### 18 Oct 2026 · 3.16 `sessions.create` checks the package against the agent and teacher · decided by team lead (plan decision 3) · risk: low
Decided: the INSERT … SELECT joins the package and version and requires them to be the given agent's and the scope teacher's; anything else is `not_found` and nothing is written.
Why: the same defense in depth as the existing agent-version check.
Alternatives: trust the caller's pin.
Reversible: yes.

### 18 Oct 2026 · 3.16 `endOnPackageChange` returns `{ ended }` and treats an own, already-ended session as a no-op · decided by builder (tdd-guide) · risk: low
Decided: the method returns `{ ended: true }` when it ended the session, `{ ended: false }` for the scope's own already-ended session, and `not_found` for anything outside the scope.
Why: retries are safe, a cross-tenant call still fails closed for the isolation grid, and tests can see which call did the work.
Alternatives: return void; throw on an already-ended session.
Reversible: yes.

### 19 Oct 2026 · 3.16 0009's FK and both CHECKs are added `NOT VALID` then validated in separate statements; the plain `CREATE INDEX` stays as it is · decided by build-error-resolver (fix round) · risk: low
Decided: `sessions_package_version_fk`, `sessions_package_pin_complete` and `sessions_open_has_package` are each added `NOT VALID` and validated by a following `ALTER TABLE ... VALIDATE CONSTRAINT`, so the ACCESS EXCLUSIVE lock needed to add them is held only briefly and the table-scan runs under `VALIDATE CONSTRAINT`'s lighter SHARE UPDATE EXCLUSIVE lock instead. The index stays a plain (non-`CONCURRENTLY`) `CREATE INDEX`: drizzle runs every migration file in one transaction, and `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, so splitting it out would need a second migration file for no real benefit on a table this small.
Why: minimise how long `sessions` is unavailable for reads and writes while 0009 runs, without changing the schema or the backfill.
Alternatives: leave the FK and CHECKs as plain `ADD CONSTRAINT` (longer lock); move the index to its own non-transactional migration.
Reversible: yes; a later migration can re-order or re-validate.

### 19 Oct 2026 · 3.16 Migration lock duration accepted for the pilot · decided by team lead · risk: medium
Decided: 0009's constraints are validated inside drizzle's migration transaction. drizzle 0.45 runs every pending migration in one transaction, so a split file wouldn't shorten the ACCESS EXCLUSIVE lock. At pilot scale (about 500 students) the `sessions` scan takes milliseconds, so the finding is re-rated from HIGH to MEDIUM, and 3.16b adds a VALIDATE path outside the migrator before the table grows.
Why: the reviewer's HIGH assumed a large production table, which doesn't exist; a correct fix needs migration tooling, not a file split.
Alternatives: a second migrate() run; an ops script with autocommit; switching migrators.
Reversible: yes.

