# 3.16 plan: Sessions follow the package

**Branch:** `m3/3.16-sessions-follow-package` · **Milestone:** M3 · **Dep:** 3.4 (done)

## Acceptance (verbatim)

> A student whose bigger package lapses keeps no access to its earlier module text through
> history, sources or summary; tests cover downgrade and version change.

Task title adds the trigger: "when the entitled package or its version changes, end the open
session (or start a fresh one), so earlier history, sources and summary from a lapsed package
never reach the model."

**How it will be shown:** no UI exists yet (no web route creates sessions or submits turns). Shown
by tests at two levels, both without any model or payment call:
1. `packages/db` Postgres integration tests: a session pinned to one package/version, a
   subscription that changes `packageId` (downgrade, different package) or just `packageVersion`
   (same package, new version) under it, then `turnConfigStoreFor.load` / the real `entitle` step
   on top of it — asserting `null` / `no_access`, the session row's `ended_at` now set, and the
   student's `learner_profiles.last_summary` cleared. A follow-up `sessions.create` for a fresh
   session with the new package, and `messages.history`/`learnerProfiles.get` on it, showing it
   starts with no history and no stale summary.
2. `packages/harness` in-memory tests (`entitle.test.ts`, `memoryAccess.test.ts`): the same
   mismatch, through the in-memory `TurnConfigStore` double, ending in `entitle` → `no_access`.

## Why no contracts change (ADR-0004 checked)

`TurnConfigStore.load(e, sessionId)` already returns `null` on any mismatch (ADR-0004 Decision 3
and 5), and `entitle` already turns `null` into `no_access`. Its return shape
(`{ agent, pkg, styleCard, locale, helpState } | null`) does not change. `ProfileStore`,
`SessionStateStore` and every other frozen port are untouched. The missing piece is purely
db-internal: **no column anywhere currently records which package/version a session was opened
under** — `sessions` has `agent_id`/`agent_version` (ADR-0004) but no package columns, and
`TurnConfigStore.load`'s db adapter always loads the package at the *entitlement's current*
`packageVersion`, never compares it to what the session started with. That comparison needs a new
db column, not a new port. **No ADR.** (Per the task's framing, this is also not a prompt-pack or
tech-stack change.)

## Design

1. **`sessions` gains `package_id` (FK → `packages.id`) and `package_version` (integer)**,
   both `NOT NULL`, set once at `sessions.create` from the entitlement the caller resolved right
   before creating the session (mirrors how `agent_id`/`agent_version` are pinned, ADR-0004
   Decision 4). Migration: additive columns, no default, guarded by the same
   `IF EXISTS (SELECT 1 FROM "sessions") THEN RAISE EXCEPTION` pattern as migration `0007`
   (turn_traces), since there is no real session data yet to backfill truthfully.
2. **`sessionsRepo.create`** takes `{ agentId, agentVersion, packageId, packageVersion }`; the
   `INSERT … SELECT` also joins `package_versions` + `packages` to confirm the given package
   version belongs to the scope's teacher and the given agent (same defense-in-depth as the
   existing agent/version join) — a wrong or missing package is `not_found`, matching the existing
   agent-version behaviour.
3. **`turnConfigStoreFor.load`** (`packages/db/src/repositories/ports.ts`), right after the
   existing session-ownership/open/agent check and before loading the agent version, style card
   and locale: if `session.packageId !== e.packageId || session.packageVersion !== e.packageVersion`,
   call one new repository method (below) and return `null` — the same fail-closed path as every
   other `TurnConfigStore.load` mismatch, so `entitle` gives `no_access` with no extra harness code.
4. **One new `sessionsRepo` method**, e.g. `endOnPackageChange(scope, sessionId)`: in one
   transaction, idempotently (a) sets `sessions.ended_at = now()` where it is still the scope's own
   open session (no error if it is already ended — a retry after a transient failure is safe), and
   (b) sets `learner_profiles.last_summary = NULL` for that `(teacherId, studentId)` (no error if
   there is no profile row yet). Bundling both writes in `sessions.ts` mirrors the existing
   cross-table precedent in `learner.ts`'s `evidenceEventsRepo.append` (one repo file, one
   transaction, more than one table) — chosen over two separate new repository methods so the
   isolation test gains one new case instead of two, and so a partial failure can't end the
   session without also dropping the pre-change summary (both idempotent, so a thrown error here
   just makes `entitle` retry the whole thing as `no_access, retryable: true`, already covered by
   the existing "a store that throws is no_access (retryable)" test).
5. **Any package or version change ends the session**, not only a downgrade: the check does not
   try to tell whether a change removed modules or only added them. A version bump of the *same*
   package normally only adds content (access filter point 7 already makes that safe for
   retrieval going forward), so this is slightly stricter than strictly necessary for safety, but
   it keeps the rule simple, matches the task title's literal "package **or** its version changes",
   and avoids a second class of "is this change safe" logic next to the access filter's existing
   one. Noted as a decision below, not an open question — it is not a UX regression worth a
   contracts-level distinction, and it is easily reversed later (compare allowed-module sets
   instead) without any port change.
6. **No distinction by `Entitlement.source`.** Subscription, teacher-preview and eval sessions are
   pinned and checked the same way; a teacher editing their own package while previewing just
   restarts the preview session next turn, same as a student's downgrade.

## Files to create

- `packages/db/migrations/0009_<name>.sql` + regenerated `packages/db/migrations/meta/0009_snapshot.json`
  and updated `_journal.json` (via `corepack pnpm --filter @edmate/db db:generate`, not hand-written).
- `packages/db/test/session-package.int.test.ts` — the new Postgres integration tests (task 3.16,
  alongside `turn-config.int.test.ts` and `session-state.int.test.ts`, which cover adjacent ADR-0004
  / ADR-0005 ground and are left alone except where noted below).

## Files to modify

- `packages/db/src/schema/learning.ts` — `sessions`: add `packageId`/`packageVersion` columns;
  import `packages` from `./agents.js`.
- `packages/db/src/repositories/sessions.ts` — `SessionRow` gains `packageId`/`packageVersion`;
  `NewSession` zod schema and `create()` gain and validate them; new `endOnPackageChange` method.
- `packages/db/src/repositories/learner.ts` — touched only insofar as `endOnPackageChange` writes
  `learner_profiles` from `sessions.ts` (no change to `learnerProfilesRepo` itself expected, but if
  the builder instead wants the write inside `learner.ts` for ownership reasons, that's an
  in-task call, not a scope change).
- `packages/db/src/repositories/ports.ts` — `turnConfigStoreFor.load`: the mismatch check and call.
- `packages/db/test/isolation-seed.ts` — the base per-pair `sessions` insert gets
  `packageId: ids.pkg(t), packageVersion: 1` (matches each pair's seeded subscription so every
  existing test keeps seeing a session that still matches its package).
- `packages/db/test/access-seed.ts` — the five extra sessions it inserts each get a `packageId`/
  `packageVersion` matching what their entitlement actually resolves to today (`ses_preview_a` and
  `ses_eval_a` → `pkg_a` v2; the others → whatever they already pin to), so none of task 3.2/3.13's
  passing tests start seeing a spurious mismatch.
- `packages/db/test/repositories.int.test.ts` — the `sessions.create` isolation case's `attempt`
  gains a valid `packageId`/`packageVersion`; its `mismatches` gains one case for a package that
  isn't the given agent's/scope's; one new `CASES['sessions.endOnPackageChange']` entry (required —
  `CASES` is typed `Record<RepositoryMethod, IsolationCase>`, so a new repository method without a
  case fails `tsc`); the one other direct `repos.sessions.create(...)` call (the "ghost student"
  test) gets the two new required fields.
- `packages/db/test/session-state.int.test.ts` — its one `repos.sessions.create(...)` call gets the
  two new required fields.
- `packages/db/test/turn-config.int.test.ts` — no behaviour change expected (its fixture session
  already matches its package after the access-seed update above); re-run as a regression check.
- `packages/harness/src/testing/memoryAccess.ts` — `MemorySession` gains `packageId`/
  `packageVersion`; the `session()` builder takes them; `twoTeacherWorld()`'s nine sessions get
  values matching what each one's entitlement already resolves to in the existing passing tests
  (worked out below); `memoryTurnConfigStore.load` mirrors the db adapter's mismatch → `null` (and,
  for realism, marks the fixture session ended — there is no in-memory learner-profile concept to
  mirror the summary clear, so that half is Postgres-only, per the module's own "same semantics as
  the db adapters" comment, matched as closely as the fixture allows).
- `packages/harness/src/pipeline/steps/entitle.test.ts` — one new case/describe block: the session's
  own `packageId`/`packageVersion` no longer matching the entitlement → `no_access`.
- `packages/harness/src/testing/memoryAccess.test.ts` — extend the matching `describe` block the
  same way (mismatch → `null` from `load`, `no_access` from `entitle`), next to the existing
  `it.each` ownership-mismatch cases.
- `packages/harness/src/access/property.test.ts` — no required change (the property only asserts
  invariants over whatever `load` returns, and our change only adds another way to return `null`,
  already an accepted outcome); optionally strengthen `checkInvariant` to also assert
  `session.packageId === pkg.id && session.packageVersion === pkg.version` when a result is
  returned, mirroring the existing `agentVersion` assertion. Worth adding, not required.
- `packages/harness/README.md` — a short note under buildContext/entitle about the session-package
  pin, matching the file's existing habit of documenting each step's behaviour.

### Working out the fixture pins (so no existing test breaks)

`twoTeacherWorld()`'s sessions, from what each one's entitlement already resolves to in passing
tests today: `ses_1a` → `pkg_a` v2 (`sub_1a`'s live version); `ses_1a_ended` → `pkg_a` v2 (already
ended, inert); `ses_1a_draft` → `pkg_a_draft` v1; `ses_2a` → `pkg_a` v1 (`sub_2a`, paused, never
reaches `load`); `ses_1b` → `pkg_b` v1 (`sub_1b`, ended, never reaches `load`); `ses_2b` → `pkg_b`
v1 (`sub_2b`'s trial, the one case that does reach `load` and must keep passing); `ses_preview_a` →
`pkg_a` v2 (preview resolves the newest version); `ses_preview_a_draft` → `pkg_a_draft` v1;
`ses_eval_a` → `pkg_a` v2 (`EVAL` fixture's pinned version in `entitle.test.ts`).

The Postgres seed (`isolation-seed.ts` + `access-seed.ts`) is simpler: every pair's base session
pins to `pkg_<teacher>` v1 (matching `sub_<pair>`'s seeded `packageVersionId`), and the five extra
`access-seed.ts` sessions pin to whatever their agent/package already is in that seed (`ses_preview_a`
and `ses_eval_a` → `pkg_a` v2, since both pin `agt_a` v2 and preview/eval resolve `pkg_a`'s newest/
pinned version 2 there).

## Tests first

1. `packages/db/test/session-package.int.test.ts` (new): seed via `access-seed`; for a session
   pinned to `pkg_a` v1 (or v2):
   - control: no package change → `load` still returns the full config; session stays open;
     `learner_profiles.last_summary` untouched.
   - **downgrade**: `UPDATE subscriptions SET package_version_id = <a different package's version>`
     (raw SQL, matching the file's existing style) → `load` is `null`, `entitle` is `no_access`,
     `sessions.ended_at` is now set, `learner_profiles.last_summary` is `NULL` even though the seed
     gave it one.
   - **version change**: same `packageId`, a new `package_versions` row at a higher version,
     subscription moved to it → same three assertions.
   - idempotency: calling `load`/`entitle` again on the same now-ended session is still `no_access`
     (already covered by the existing "an ended session" case) and does not throw on the
     already-cleared summary.
   - a fresh `sessions.create` under the new package, then `messages.history` on it is `[]` and
     `learnerProfiles.get` has no `lastSummary` — the literal "keeps no access … through history,
     sources or summary" check.
   - `sessions.create`'s new validation: a `packageId`/`packageVersion` that isn't the given
     agent's/teacher's is `not_found` and writes nothing.
2. `packages/harness/src/testing/memoryAccess.test.ts` / `pipeline/steps/entitle.test.ts`: the
   in-memory mirror of the mismatch → `null`/`no_access` case.
3. Run the full existing suites (`turn-config.int.test.ts`, `repositories.int.test.ts`,
   `session-state.int.test.ts`, `entitle.test.ts`, `property.test.ts`, `memoryAccess.test.ts`) after
   the fixture updates above, to prove nothing already-passing regresses.

## Files out of bounds

- `apps/web/**`: no route creates a session or submits a turn yet (confirmed: no caller of
  `sessions.create` outside tests exists in the repo). "Start a fresh one" is therefore proven at
  the mechanism level (a new session under the new package starts empty) — wiring a client-visible
  "your session ended, starting a new one" flow is for whichever task builds `POST /api/sessions`.
- `packages/contracts/**`, `docs/adr/**`: no change (see "Why no contracts change" above).
- `packages/harness/src/access/**`, `packages/harness/src/pipeline/steps/entitle.ts`: no change —
  the mismatch is invisible above the `TurnConfigStore` port; `entitle` already treats `null` as
  `no_access`.
- `packages/harness/src/pedagogy/**` (where `profile.lastSummary` reaches the system prompt, task
  3.4/`compose.ts`): unchanged — it already just renders whatever `ProfileStore.get` returns; once
  the db adapter clears the column, there is nothing left to render.
- `.claude/**`, `content/**`: untouched.

## Risky paths touched (checked against `risk-paths.txt`)

- `packages/db/src/repositories/**` (`sessions.ts`, `ports.ts`, possibly `learner.ts`, `index.ts`)
  → **# reviewers: security-reviewer** (required; this is the access-filter/session-ownership
  group). The handoff logs a `risk: high` decision for this group, per rule 6.
- `packages/db/src/schema/**` and `packages/db/migrations/**` are not separately listed, but travel
  with the above; recommend **database-reviewer** too given the new FK column, the `NOT NULL`
  migration guard, and the cross-table transactional write (not required by the risk-paths glob,
  but matches past practice on schema/migration PRs in this repo).
- Everything else touched (`packages/harness/src/testing/**`, `*.test.ts` files) is outside every
  glob in `risk-paths.txt`.
- No `packages/contracts/**` or `docs/adr/**` change → architect/typescript-reviewer are not
  required by rule 2, though **typescript-reviewer** is worth including as a normal quality
  reviewer given the new zod schema and repository signatures.

**Reviewers to request: security-reviewer (required), database-reviewer, typescript-reviewer.**

## Decisions this plan is making (not escalating — stated with rationale, not open)

1. **Any package or version change ends the session, not only a downgrade.** See Design point 5.
   Reversible later without a contracts change.
2. **One combined `endOnPackageChange` method** (ends the session and clears the summary in one
   transaction) instead of two separate port-adjacent calls, to keep the isolation-test surface
   smaller and the two writes atomic. See Design point 4.
3. **`sessions.create` validates the given package against the given agent/teacher** (defense in
   depth, mirroring the existing agent-version check) rather than trusting the caller.

No open questions for the human: the mechanism, its scope and its test shape are all determined by
the existing ADR-0004 pattern and the task's own wording.

## Status

**READY.**

## Lead answers (18 Oct 2026)

- Decisions 1–3 agreed: any package or version change ends the session; one combined `endOnPackageChange`; `sessions.create` validates the package against the agent and teacher.
- The migration must not lose data: existing sessions get the package pin backfilled from their entitlement where one exists, or are ended. Log which.
- Reviewers: security-reviewer (opus, required), database-reviewer (sonnet), typescript-reviewer (sonnet). risk: high entry.
- Builder: tdd-guide on opus when a builder slot frees up.
