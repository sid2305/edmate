# 13.4 plan — Privacy rights per the locale pack's `privacyLaw`: per-user export and delete, retention jobs

## Acceptance (verbatim, build plan line 734)
"jobs tested; export complete." (deps: M11, M12, M8, M9 — all merged already)

## How it will be shown
- `packages/db` test run (`corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`)
  plus the disposable-container int tests showing the new repository methods and (if a migration
  lands) its up/down.
- `apps/worker` test run showing the retention schedule/processor unit tests and an int test
  against a disposable Postgres, proving a dry run reports counts and a live run purges/anonymises
  only past-cutoff rows, never safety_alerts/payments/audit_log.
- `apps/web` test run showing `GET /api/me/export` (root, all teacher pairs) and `DELETE /api/me`
  against a fake backend, plus the existing `/api/me/**` auth-policy and clearance-scan tests still
  green (no policy row needs to change — `DELETE /api/me` is already reserved in
  `apps/web/src/auth/policy.ts:47`).
- `python3 .githooks/secret-scan.py --all` clean on every phase.

## What already exists (checked before planning; the gap is smaller than the title suggests)
- **Per-agent export** (9.6b): `GET /api/me/export/:agentId` and `.../notes` (PDF) —
  `apps/web/src/export/buildExport.ts`, `pdf.ts`, `notes.ts`, `routes.ts`. Scoped to one
  student–teacher pair, not account-wide.
- **Per-agent memory export + reset** (6.5): `GET`/`DELETE /api/me/memory/:agentId` —
  `apps/web/src/memory/routes.ts`, `learnerProfiles.reset`.
- **No root-level export** (`GET /api/me/export` with no agentId, PRD line 529) and **no account
  delete** exist yet. `apps/web/src/auth/policy.ts:47` already reserves
  `{ pattern: '/api/me', methods: ['DELETE'], access: ['student'] }` — the route handler itself is
  missing (`apps/web/app/api/me/**` has only `memory/[agentId]` and `export/[agentId]`, no bare
  `route.ts`).
- **No retention job** exists anywhere in `apps/worker` (checked: `alarms`, `insights`, `alerts`,
  `ingest`, `gate`, `commit`, `webLink` — no `retention` folder). `packages/db/src/schema/operations.ts:176`'s
  comment on `safety_alerts` ("Retention is 13.4's") and build-plan line 508 ("sessions/messages:
  Retention job applies") are this task's two explicit hooks.
- **No retention field anywhere.** `packages/contracts/src/locale.ts`'s `compliance` block is
  `{ privacyLaw, minAge, dataRegion, grievance, parentalConsentRequired }` — no retention-days
  field. `content/locales/US.yaml`'s `privacyLaw`/`dataRegion`/`grievance` are all `pending`, with
  an explicit header comment: "Agents must never fill in a helpline number, contact, law or
  reviewer here: only a person may." So this task **does not** add retention numbers to
  `content/locales/US.yaml`, and does not touch `privacyLaw`/`dataRegion`/`grievance` at all — see
  Open question 1.

## Phase A — packages/db: account-delete and retention repository methods
Files (new unless noted):
- `packages/db/src/repositories/users.ts` — add/extend (check first) an `anonymise(studentId)`
  method: overwrites `name`, `email`, `phone` with null/placeholder, does **not** delete the row
  (subscriptions/sessions/audit_log all foreign-key to `users.id`); writes one `audit_log` row
  (`actor: studentId`, `action: 'account.delete'`) in the same transaction.
- `packages/db/src/repositories/retention.ts` — purge/anonymise queries, one method per table,
  each taking a cutoff date and returning a row count, read-only `dryRun` mode by default:
  `purgeOldSessions`, `purgeOldTraces` (`turn_traces`), `purgeOldTranscriptChunks` (only
  `kind = 'transcript'` rows past cutoff, never `material`/`teacher_note`). Explicitly out of
  scope: `safety_alerts`, `payments`/`ledger_entries`/`payouts`/`invoices`, `audit_log`,
  `webhook_events`, `eval_runs`/`eval_results` — the comment on each method says why (legal,
  financial, or append-only compliance record), so a reviewer never has to guess.
- `packages/db/src/repositories/index.ts` — wire the two new repos in.
- `packages/db/migrations/00NN_users_anonymised_at.sql` (only if a `deleted_at`/`anonymised_at`
  column is needed to block sign-in post-delete — builder confirms against `packages/db/src/schema/users.ts`
  before adding; if an existing boolean/status column already serves, skip the migration).
- Tests first: `packages/db/test/repositories.int.test.ts` (shared, additive) — new
  `describe('task 13.4: ...')` blocks for `users.anonymise` (idempotent, scoped, leaves
  safety_alerts/payments/audit_log untouched) and `retention.*` (dry run reports counts and changes
  nothing; live mode only touches past-cutoff rows; a future-dated cutoff changes nothing).

## Phase B — apps/worker: retention schedule and processor
Files:
- `apps/worker/src/retention/config.ts` — one plain, non-legal TS config: `RETENTION_DAYS` per
  table (e.g. `sessions: 730`, `turnTraces: 90`, `transcriptChunks: 730`), each value commented
  "placeholder pending counsel sign-off (see 13.4 open question 1)"; a top-level `DRY_RUN` flag
  (default `true`) that only ever reports counts, following the fail-closed pattern 3.10 used for
  unverified helplines — nothing is actually purged in production until a human flips it.
- `apps/worker/src/retention/schedule.ts` / `workers.ts` / `index.ts` — same shape as
  `apps/worker/src/insights/schedule.ts` / `weeklyInsights.ts` / `index.ts` (BullMQ repeatable job,
  daily, calls `retention.purge*` with each table's cutoff and `DRY_RUN`, logs counts via the
  existing `logSink` pattern).
- Tests first: `apps/worker/src/retention/schedule.test.ts`, `workers.test.ts` (fake clock, fake
  queue, no real db/model calls per build-plan rule 4) and `apps/worker/test/retention.int.test.ts`
  (disposable container, same pattern as `test/commit.int.test.ts`) proving dry run changes
  nothing and live mode (test-only override of `DRY_RUN`) only removes past-cutoff rows.

## Phase C — apps/web: root export and account delete
Files:
- `apps/web/src/export/accountExport.ts` (new) — aggregates every live/ended subscription pair for
  the signed-in student (`subscriptions.listForStudent` or equivalent) and calls the existing
  `buildExport()` per pair, plus account-level fields (`users` row minus internal ids, `consents`
  rows for that user). Paginated/capped like `buildExport` already is; `complete: false` plus a
  named `truncated` section on any cap hit — never a silent truncation.
- `apps/web/app/api/me/export/route.ts` (new) — `GET`, `withRole(['student'], ...)`, no params,
  wraps `accountExport`. Covered by the existing `/api/me/**` GET policy row (no policy.ts change).
- `apps/web/src/account/delete.ts` (new) — the `DELETE /api/me` handler: calls `users.anonymise`
  for the signed-in student's own id only (never a client-given id), then signs the student out
  (clears the session cookie the same way the existing sign-out path does — builder checks
  `apps/web/src/auth/index.ts` for the existing helper before writing a new one).
- `apps/web/app/api/me/route.ts` (new) — `DELETE`, wires `delete.ts` to the already-reserved policy
  row (`apps/web/src/auth/policy.ts:47` — not edited).
- Tests first: `accountExport.test.ts`, `delete.test.ts`, `app/api/me/route.test.ts`,
  `app/api/me/export/route.test.ts` — fake backend only (rule 4); a do-not-leak regex scan over the
  serialized root export for `help_state`/`helpState`/`mustNotReveal`/`answerKey`, same as 9.6b's
  scan; a test that `DELETE /api/me` never accepts a body-supplied studentId/teacherId.

## Files out of bounds
- `content/locales/US.yaml` — not touched (privacyLaw/dataRegion/grievance stay `pending`, counsel
  only; see Open question 1).
- `packages/contracts/**` — no new field added for this task (would need an ADR with architect,
  security-reviewer and typescript-reviewer; avoided per the brief — see Open question 1).
- `apps/web/src/auth/policy.ts` — not edited; the `DELETE /api/me` row already exists.
- `packages/db/src/repositories/subscriptions.ts`, `safety-alerts` repo, payments/ledger tables —
  read-only at most (for aggregation), never purged or anonymised by this task.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (Phases A and C's handler calling into it) —
  **reviewers: security-reviewer**.
- `apps/worker/src/alerts/**` — not touched; `apps/worker/src/retention/**` is a new folder, not
  currently on the risk list (it is not `alerts/**`). Flagging it to the architect anyway as a
  likely risk-paths.txt gap, since it purges personal data — the plan asks for security-reviewer on
  Phase B as a precaution even though the glob doesn't technically require it.
- If Phase A adds a migration: database-reviewer, per risk-paths.txt's note that migrations
  deleting/changing data are risky (merge_gate.py detects this, not a path glob).
- `apps/web/src/auth/**` — **not touched** (see Files out of bounds), so security-reviewer is not
  triggered by that glob; Phase C still gets security-reviewer anyway because it's a new
  account-deletion surface, named explicitly in the handoff's `## Decisions` as `risk: high`.
- `content/locales/**`, `packages/contracts/**` — **not touched**, so no code-reviewer/ADR trigger
  from those globs.
- Every phase's handoff logs a `risk: high` decision per CLAUDE.md non-negotiable 6, naming the
  personal-data surface touched.

## Open questions (none block Phase A or B from starting; see below for C)
1. **Retention periods**: the locale pack has no retention field and `privacyLaw`/`dataRegion` are
   counsel-pending. Recommendation: ship Phase B with placeholder day-counts in a worker-only
   config (not in `content/locales/**`), defaulting to dry-run/report-only, same fail-closed
   pattern as unverified helplines (3.10); a human flips `DRY_RUN` off per table only after
   counsel sets real numbers. Does not block Phase A or B starting.
2. **What an account delete keeps**: recommendation above (anonymise `users`/`consents`/message
   text; keep `safety_alerts`, payments/ledger, `audit_log` untouched, since those tables already
   store no name/email/phone by design). Needs the human's sign-off before Phase C ships to real
   students; Phase C can still be built and tested now against that recommendation.
3. **Legal holds**: no spec for a delete request arriving during an open safety escalation or
   payment dispute. Recommendation: `users.anonymise` checks for an unacknowledged `safety_alerts`
   row or an open dispute for that student and defers (queues) rather than deletes. Does not block
   Phase A (the check is additive); flag to the human before Phase C's handler ships.
4. **Minors and parents**: no parent-initiated export/delete path exists or is planned here; for
   the pilot (student's own authenticated request only) this is out of scope — recommend a new
   board follow-up task, not a 13.4 blocker.
5. **"Complete" export's scope**: recommendation is account-wide (all teacher pairs + account
   fields), reading PRD line 529's bare `/api/me/export` as distinct from 9.6b's per-agent route.
   Flag to the human for confirmation; Phase C's design already matches this reading, so it is not
   blocking.

## Budget
Budget: 115 tool calls (3 phases: A ~35, B ~35, C ~45; packages/db, apps/worker, apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (migrations, tests, secret scan only)

## Exit conditions
- `Status: DONE` when all three phases' tests are green, the secret scan is clean, no real student
  data appears in any fixture, and each phase's handoff names its `risk: high` decision.
- A phase stops at `Status: PARTIAL` past ~40 tool calls with no green test run, or if a file
  outside its own phase's list needs changing (e.g. Phase C discovering `policy.ts` actually needs
  an edit) — hand back to the lead rather than expanding scope.
