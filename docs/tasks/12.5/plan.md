# Task 12.5: Safety alert inbox with acknowledgement

## Acceptance (verbatim)
> unacknowledged alerts escalate after 15 minutes.

## How it will be shown
1. **Worker integration test (real Redis + Postgres, Phase B):** a `SafetyAlert` raised through
   `queuedAlertSink` becomes a `safety_alerts` row, and the trust team gets a notice. With the
   escalation interval cut to about 300 ms (as in 4.3's `alert.int.test.ts`):
   (a) not acknowledged → the row gets `escalated_at` and `escalation_round >= 1`, and on-call is
   paged every interval;
   (b) acknowledged by a staff user via `safetyAlerts.acknowledge` before the first check → never
   escalated, never paged;
   (c) acknowledged after the first escalation → paging stops (0 pending checks), and one
   `safety_alert.ack` audit row exists.
2. **The real 15 minutes:** a unit test asserts that the worker's default interval and the sink's
   first-check delay are both `ALERT_ESCALATION_MS` = 900 000 ms. Phase C's view test checks the
   in-app escalation: an unacknowledged alert created 16 minutes ago shows as escalated or overdue,
   and one created 14 minutes ago does not.
3. **Web route and page tests (Phase C):** staff list and acknowledge, with the audit row. Non-staff
   users get 401 or 403. The page renders escalated alerts first.
4. The handoff records a manual check: grant staff locally with `db:grant-role`, raise a scripted
   alert, watch `/staff/alerts` mark it escalated, acknowledge it, then confirm the audit row and
   that the worker log shows no further `safety_alert.escalated` lines.

## What exists already (read, not rebuilt)
- 4.3 (`apps/worker/src/alerts/`): `alert.raise` sends `notify(alert, 'trust_team')`.
  `alert.escalate_check` runs round n, 15 minutes after the raise and then every 15 minutes. If
  the alert is not acknowledged, it schedules round n+1 first, then sends
  `notify(alert, 'on_call')`. The notifier is `logAlertNotifier` (a log line with ids only).
  `AckStore` is `redisAckStore`, and **nothing calls `acknowledge` today**, so every alert pages
  on-call forever (decision "4.3 Delivery and acknowledgement stand-ins").
- `@edmate/queue`: `ALERT_ESCALATION_MS`, `AlertRaiseJobSchema` and `AlertEscalateJobSchema` (the
  full `SafetyAlert` plus `round`). Unchanged by this task.
- Contracts `SafetyAlertSchema`: id, level, kind, studentId, teacherId, sessionId,
  `excerptRedacted` (scrubbed, at most 160 code points from distressDetect) and createdAt.
  **Unchanged: no contracts change and no ADR.** `AlertNotifier`/`AckStore` are worker-local types.
- 12.1: the staff console at `/staff`, the `/api/staff/**` policy row (`withRole(['staff'])`), the
  pattern of `handlers.ts` next to `route.ts`, and `lockRole` (`packages/db/src/role-lock.ts`).
- Spec routing: build plan l.438 says "`SafetyAlert` → worker → trust team inbox and email,
  retried until acknowledged; unacknowledged after 15 min escalates to the on-call lead". l.534
  puts "Safety alerts" in the **staff console**. B-13 (human) says the real delivery is SMS to the
  on-call phone plus an email backup, built in **4.3c** (M13, pilot gate), not here. The US locale
  pack holds no alert contacts, and this task adds none.

## What "escalate" does in-app (no SMS or email vendor yet)
When an alert is still not acknowledged 15 minutes after it was raised (and every 15 minutes after
that), the worker:
1. schedules the next check (unchanged);
2. marks the `safety_alerts` row escalated: `escalated_at` is set the first time,
   `escalation_round` is raised and `last_paged_at` is set to now;
3. calls `notify(alert, 'on_call')`. Until 4.3c this is still only a structured log line.

In the staff inbox, escalated alerts sort to the top with a visible "Escalated: unacknowledged for
N min, on-call paged k times" marker. The page re-reads every 30 s. As a backstop for a stopped
worker, the web layer also shows **overdue** for any unacknowledged alert whose `createdAt` is at
least `ALERT_ESCALATION_MS` old, even if the worker never marked it. `/staff` shows a banner with
the count of open and escalated alerts, linking to `/staff/alerts`.

**This needs the human (not built here):** until 4.3c, nobody is told outside the app. An
escalation reaches a person only if a staff member has the inbox open. Real paging needs vendor
accounts, an on-call phone and an email address, all supplied by the human as environment values
and never committed. That belongs to 4.3c, before real students. See Q2.

## Phases
There are three phases, one package each. A goes first. B and C both depend only on A's
repository and share no files, so the lead may run them in parallel.

### Phase A: packages/db, the `safety_alerts` table and repository (budget 75 tool calls)
Files:
- `packages/db/src/schema/operations.ts` (shared): add a `safetyAlerts` table:
  - `id` text pk (the contract's alert id);
  - `level`, `kind` (text plus check constraints from the contract enums);
  - `student_id`, `teacher_id`, `session_id` (FKs, following the existing `learning.ts`
    conventions);
  - `excerpt_redacted` text;
  - `created_at` (the alert's own time) and `received_at` default now();
  - `escalated_at` null, `escalation_round` int default 0, `last_paged_at` null;
  - `acknowledged_at` null, `acknowledged_by` FK users null, `ack_note` text null (500 chars at
    most).
  Add a partial index `(created_at, id) WHERE acknowledged_at IS NULL`.
  `packages/db/src/schema/index.ts` (shared): one export added.
- `packages/db/migrations/0022_<name>.sql` plus `meta/0022_snapshot.json` and `meta/_journal.json`
  (shared), generated by drizzle-kit. The migration is **additive only (CREATE TABLE/INDEX)**.
  Merge origin/main just before generating it: if another branch has taken 0022, regenerate.
- `packages/db/src/repositories/safety-alerts.ts` (new): `safetyAlertsRepo(db)` with:
  - `record(alert)`: system writer. Parse with `SafetyAlertSchema`. Insert-select through
    `ownSession(alert.sessionId, studentScope(alert))`, like `safetyEvents.record`, with
    `on conflict (id) do nothing`. Returns `{ written }`. A session that is not the alert's own is
    `not_found`.
  - `markEscalated(alert, round)`: upsert through the same scoping. On conflict it sets
    `escalation_round = greatest(existing, round + 1)`,
    `escalated_at = coalesce(escalated_at, now())` and `last_paged_at = now()`. It works even if
    `record` never ran.
  - `isAcknowledged(alertId)`: id-validated, so a missing row is `false`.
  - `listForStaff(by, { status: 'open' | 'all', limit })`: `by` must be staff (plain role read,
    as in `listPendingForStaff`), else `scope`. Open alerts come first, escalated before
    unescalated, oldest first. The cap is `SAFETY_ALERT_LIST_MAX_LIMIT` = 50. Columns are ids,
    level, kind, excerpt, the timestamps, the round, `acknowledgedBy` and `ackNote`, plus the
    teacher's public slug. **No student or teacher name, email or phone** (see Q3).
  - `acknowledge(by, { alertId, note? })`: one transaction. Lock order: `lockRole(by)` FOR SHARE,
    which must be `staff` or the call is `scope`; then the alert row FOR UPDATE, `not_found` if
    missing. If it is already acknowledged, return `{ acknowledged: false }` and write nothing.
    Otherwise set `acknowledged_at`, `acknowledged_by` and `ack_note`, and write an
    `insertAuditEntry(tx, teacherId, studentId, { actor: by, actorRole: 'staff', action:
    'safety_alert.ack', target: 'safety_alert:<id>', reason: note, before, after })` row in the
    same transaction. State the lock order in the file header (lessons: lock order).
- `packages/db/src/repositories/index.ts` (**shared, append-only**): register
  `safetyAlerts: guardAll('safetyAlerts', safetyAlertsRepo(db))` and add a type/const export line.
- `packages/db/src/repositories/README.md` (shared): add one section.
- Tests first:
  - `packages/db/test/safety-alerts.int.test.ts`:
    - `record` is idempotent, and another scope's session is `not_found`;
    - `markEscalated` raises the round monotonically, creates the row when it is missing, and
      leaves an acknowledged row's ack fields alone;
    - `listForStaff`: non-staff get `scope`, the ordering and the cap hold, `status` filters work,
      and no personal columns are returned;
    - `acknowledge`: non-staff get `scope` and nothing is written; a first ack writes exactly one
      audit row; a second ack is a no-op; an unknown id is `not_found`; two concurrent acks give
      exactly one audit row (two connections);
    - `isAcknowledged` flips.
  - `packages/db/test/safety-alerts.test.ts`: bad ids, a note over the cap, and an alert that does
    not match the schema are `invalid`.
  - `packages/db/test/leak.test.ts`: a driver error from `safetyAlerts.*` never carries the excerpt
    or the note.
- State after Phase A: the table and repository exist and are tested. Nothing writes to them yet.
  The db gate is green.

### Phase B: apps/worker, the alert worker persists and reads acks from the DB (budget 75)
Files:
- `apps/worker/src/alerts/types.ts`: add a worker-local `AlertStore`
  (`record(alert)`, `markEscalated(alert, round)`) next to `AckStore`.
- `apps/worker/src/alerts/dbStore.ts` (new): `dbAlertStore(repos.safetyAlerts)`, which implements
  `AlertStore` and `AckStore`. Its `acknowledge` throws "use the staff console": the worker never
  acknowledges.
- `apps/worker/src/alerts/processors.ts`:
  - **raise:** record, then notify the trust team. If record failed, still notify, log
    `safety_alert.store_failed` (ids and the error name only), then throw so BullMQ retries. A
    duplicate trust-team notice on retry is accepted, as the file header already says.
  - **check:** read the ack. **A failed ack read counts as not acknowledged**, so it pages and logs
    an error. If acknowledged, stop. Otherwise schedule the next round, then `markEscalated`. If
    that fails, log the error but do not throw: the next round retries it, and a throw would cause
    a page storm at the 30 s backoff. Then page on-call.
- `apps/worker/src/alerts/workers.ts`: pass the `store` option through.
  `apps/worker/src/alerts/index.ts`: export it.
- `apps/worker/src/index.ts` (**shared**: 11.3b and 8.2e are also wiring workers): the minimal
  edit is to replace `redisAckStore(connection)` with `dbAlertStore(db.repos.safetyAlerts)` and
  pass `store`. `ackStore.ts` stays exported but is no longer wired (Q6).
- Tests first:
  - `processors.test.ts`, extended with a fake store:
    - raise records and notifies, and a record failure still notifies, then throws;
    - check: unacknowledged → mark, schedule and page; acknowledged → nothing; a failed ack read →
      pages and logs an error; a failed mark → still pages and does not throw;
    - no log line carries the excerpt;
    - the default interval is `ALERT_ESCALATION_MS` = 900 000.
  - `dbStore.test.ts` (new) uses a fake repo.
  - `workers.test.ts` gets the new option.
  - `apps/worker/test/alertInbox.int.test.ts` (new, Redis + Postgres): the acceptance cases
    1(a), 1(b) and 1(c) above. The existing `alert.int.test.ts` stays Redis-only with an
    in-memory store.
- State after Phase B: every alert is stored, escalations are recorded on the row, and an ack in
  the DB stops paging. The worker gate is green.

### Phase C: apps/web, the inbox page and API (budget 90)
Files:
- `apps/web/app/api/staff/alerts/handlers.ts`, `route.ts`, `route.test.ts`, `route.int.test.ts`
  (all new; the 12.1b pattern):
  - `GET`: `?status=open|all`, via `listForStaff(session id)`. Each item gains `overdue`, computed
    with `@edmate/queue`'s `ALERT_ESCALATION_MS`.
  - `POST`: a strict body `{ alertId, note? }` (note trimmed, 500 chars at most), via
    `acknowledge`. A `by` or any unknown key is a 400.
  - Both are `withRole(['staff'])` and `cache-control: no-store`, with fixed error codes. The
    excerpt and the note are never logged or put in error bodies. The int test is gated on
    `TEST_DATABASE_URL` and fails under CI, as in 12.1b.
- `apps/web/app/staff/alerts/page.tsx`, `view.tsx`, `alert-row.tsx`, `client.ts`, plus
  `page.test.tsx`, `view.test.tsx` and `client.test.ts` (all new):
  - follow the lessons-file UI rules: zod `safeParse` on every reply with a fallback view,
    try/catch on body reads, try/catch/finally with one busy flag;
  - poll every 30 s, paused while an action is in flight; the excerpt is rendered as plain text;
  - escalated or overdue rows come first with the marker; acknowledging moves a row out of the
    open list;
  - jest-axe on the list, empty and fallback views.
- `apps/web/app/staff/page.tsx` or `view.tsx` (**shared**, 12.1's files): add a small banner
  ("N open safety alerts, M escalated") linking to `/staff/alerts`. A failed count read hides the
  banner and logs the error name only.
- `apps/web/messages/en.json` (**shared**): append one `staffAlerts` block only.
- State after Phase C: staff can see and acknowledge alerts in the app. The web gate is green.

## Files out of bounds
- `packages/contracts/**`: no change, no ADR.
- `packages/queue/**`: the constants and payloads already fit.
- `packages/harness/**`.
- `apps/worker/src/alerts/ackStore.ts`: left as is, unwired.
- `logSink.ts`: the real notifier is 4.3c.
- `apps/web/src/auth/**`: the policy row already covers `/api/staff/**`.
- `.claude/skills/merge-gate/risk-paths.txt`: adding `apps/web/app/staff/**` belongs to 12.1c.
- `content/locales/**`.
- Any helpline, contact, phone, email or reviewer value.

If one of these turns out to need a change, stop at `Status: PARTIAL`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- Phase A: `packages/db/src/repositories/**` → **security-reviewer**. The migration is additive
  (no drop or delete), so database-reviewer is not gate-required, but it is recommended for the
  new table, the lock order and the concurrent-ack test.
- Phase B: `apps/worker/src/alerts/**` (the student-safety group) → **code-reviewer** (MVP rule;
  safety-reviewer returns at 13.3). silent-failure-hunter is recommended for the retry and
  failure policy.
- Phase C: `apps/web/app/api/staff/**` → **security-reviewer**. `apps/web/app/staff/**` is not
  listed (12.1c), but treat it as staff-boundary code in the same review.
- Not touched: `packages/contracts/**`, `docs/adr/**`, `.claude/**`, `.github/**`, `.githooks/**`.
- Each phase's handoff logs a `risk: high` decision. Planned entries:
  - A: the `safety_alerts` table holds the scrubbed excerpt, and the ack is staff-only, audited and
    lock-ordered;
  - B: the DB is the ack source of truth, a failed ack read pages, and a failed escalation mark
    never stops a page;
  - C: the staff alert API boundary, and the excerpt is never logged.

## Open questions (none blocking; each has a recommendation)
1. **Who sees the inbox?** The spec puts it in the staff console (l.534), routes alerts to the
   trust team and the on-call lead (l.438), and teachers see only aggregated insights (decision of
   18 Oct). *Recommend:* staff only; teachers are neither shown nor told. Confirm.
2. **The on-call lead, and paging outside the app.** Only one `staff` role exists. *Recommend:* in
   the app, every staff user sees new and escalated alerts, with no new role. Real paging stays
   with 4.3c (B-13). **The human must accept** that until 4.3c merges an escalation reaches no one
   outside an open inbox. The human must also supply the vendor accounts, the on-call phone and
   the email address as environment values before the pilot.
3. **Student identity in the inbox.** *Recommend:* ids, kind, level, the scrubbed excerpt and the
   teacher slug only, with no student name or email. Whether and how staff contact a student is
   part of a response protocol the human should set at the pilot gate (4.3c or 13.3).
4. **What an ack needs.** *Recommend:* an optional note (500 chars at most, audited) and no
   outcome field. False-positive handling stays in 4.3c's alert-age or summarise policy.
5. **Retention of the excerpt.** *Recommend:* no expiry in 12.5. Add `safety_alerts` to 13.4's
   retention jobs; the human sets the period.
6. **The Redis ack store.** *Recommend:* the DB is the only source of truth. `redisAckStore`
   stays exported but unwired, and 4.3c's CLI ack calls the repository.

## Budget
Budget: 240 tool calls (3 phases, packages/db + apps/worker + apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm/turbo typecheck, lint and test for the touched package;
drizzle-kit generate in Phase A; docker for a disposable test Postgres or Redis; the secret scan)

## Exit conditions
**`Status: DONE`** per phase needs all of the following:
- that phase's package gate (typecheck, lint, test) is green after merging origin/main;
- its tests above exist and fail first;
- the secret scan is clean;
- the handoff has the `risk: high` decision.

Phase B's handoff carries the acceptance evidence (int test output for 1(a)-(c)). Phase C's
carries the manual check.

**`Status: PARTIAL`** in any of these cases:
- past about 90 calls in a phase with the gate not green;
- a file outside the phase's list needs changes (for example contracts, queue payloads or
  `policy.ts`);
- migration numbering conflicts that drizzle-kit cannot regenerate cleanly.

## Lead answers (22 Oct 2026)
- Phases run as board tasks: Phase A is **12.5a** (packages/db), Phase B is **12.5b** (apps/worker), Phase C is **12.5c** (apps/web). B and C start after A merges and share no files.
- Q1: staff only, as recommended.
- Q2: in the app, every staff user sees new and escalated alerts; no new role. The human is asked to accept that until 4.3c an escalation reaches no one outside an open inbox (blocker B-48); the build proceeds on the recommendation. Agents never fill in on-call phone numbers, emails or vendor accounts.
- Q3: ids, kind, level, the scrubbed excerpt and the teacher slug only; no student name or email. The response protocol is the human's, at the pilot gate.
- Q4: an optional audited note (500 chars max), no outcome field.
- Q5: no expiry in 12.5; `safety_alerts` is added to 13.4's retention jobs and the human sets the period.
- Q6: the DB is the only ack store; `redisAckStore` stays exported but unwired.
- Safety path: per the MVP rule, no safety-reviewer per PR until 13.3; the risk-path reviewers apply (security-reviewer for db and web, code-reviewer for worker alerts).
