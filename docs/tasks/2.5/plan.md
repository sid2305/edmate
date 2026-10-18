# Task 2.5: Limits — rolling 24-hour message limit per package; monthly cost alarm per teacher

Board: `python3 .claude/skills/board/board.py show 2.5` · Milestone M2 · deps: 2.4, M0 · branch `m2/2.5-limits` · **risky** (see Risky paths touched).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Limits: rolling 24-hour message limit per package; monthly cost alarm per teacher that alerts
staff and the teacher, and pauses free packages only (paid students keep access until a staff
decision)."
Accept: "the limit returns `limit_reached` with a friendly message; the alarm fires at the threshold
with the stated effects."

## What 3.2 already built (do not duplicate)

Task 3.2 (done) already implements the rolling 24-hour message limit per package, because `entitle`
needed it to fail closed: `packages/harness/src/pipeline/limits.ts` (`SlidingWindow`/`TurnCounter`,
86,400,000 ms window) and `packages/harness/src/pipeline/steps/entitle.ts` lines 35-43 (key
`${studentId}:${packageId}`, `pkg.dailyMessageLimit`, subscriptions only, throws
`TurnRejection('limit_reached', false)`). The 3.2 plan's own open question 7 says: "3.2 owns the
`limit_reached` check at entitle; 2.5 keeps the cost alarm and the friendly message, and may swap in
a durable counter" — lead accepted this. Durable/shared counters are 3.14's job (M7), not this task's.

**So 2.5 adds exactly two things:**
1. A real friendly message on the `limit_reached` rejection (today it's the generic
   `` `turn rejected: limit_reached` ``).
2. The monthly cost alarm per teacher: aggregation, threshold, alert, and pausing free packages.

## Part A — friendly `limit_reached` message

### The gap
The wire-level `error` `TurnEvent` is `z.strictObject({ type: 'error', code, retryable })` (frozen,
`packages/contracts/src/turn.ts:249`) — no `message` field, ever. `TurnRunResult` (`types.ts:192`)
carries only `trace` and `background`, not the rejection either. So today a friendly string has
nowhere to go on the wire; it can only live on the `TurnRejection` Error instance itself
(`errors.ts`'s optional `message` param), for whoever builds the student-facing surface later (no
`apps/web` chat route or CLI turn-runner exists yet) to read via `catch`/logging.

### Design (additive, no contracts change, no ADR)
Follow the exact `FallbackReplies` precedent (3.1 decision: "Fallback texts are injected") already
in `packages/harness/src/pipeline/types.ts:38-43` (`safeReply(lang)`, `distress(lang, locale)`):
- Add `limitReached(lang: Lang): string` to `FallbackReplies`.
- `entitle.ts` line 41: `throw new TurnRejection('limit_reached', false,
  deps.fallbackReplies.limitReached(lang))` instead of the default message (lang resolved the same
  way other steps get it — check how `route`/`postGuard` currently obtain `lang` for `safeReply`,
  likely from the loaded locale/entitlement, and match it).
- `testing/testSteps.ts`'s `testDeps()` default `fallbackReplies` gets a built-in English default
  (matching how `safeReply`/`distress` already default), so existing 3.1/3.2 tests needing no
  override keep passing.
- A test in `entitle.test.ts` (extending the existing `limit_reached` suite at line 201) asserts
  `TurnRejection.message` is the injected friendly string, not the generic fallback.

This is the most that can be shipped today without an ADR; the "stated effect" (friendly text
reaching the actual student) is a future web/CLI task's job once that surface exists — flagged as
Open question 1 below, not blocking.

## Part B — monthly cost alarm per teacher

### Scope split from money
This is **not** `packages/payments/**` (that is a different, frozen-money ledger, still out of
bounds per build plan § rule — "a paid package starts with no payment" until M10). This alarm reads
only `usage_ledger` (2.4) and acts on `subscriptions.status`, which `entitle` already respects
(`paused`/`ended` → `no_access`).

### Cost aggregation
New read on `usage_ledger` (`packages/db/src/repositories/usage-ledger.ts`), teacher-scoped like
every other repository, not student-scoped:
- `sumForTeacherSince(scope: TeacherScope, since: string): UsageTotals`-shaped result, but
  **excluding `source = 'eval'`** rows (decision log: eval is billed to Edmate, not the teacher;
  `teacher_preview` and `subscription` both count against the teacher). Mirrors `sumForStudent`'s
  `recorded`/`unknown`/`unpriced` split exactly (decision log note for 2.5/13.5: "`sum()` skips
  NULL... report the `unknown`/`unpriced` counts next to any cost" — an unknown/unpriced call is
  never silently treated as `$0` when deciding whether a teacher crossed the threshold).
- Window: **calendar month in UTC**, not a rolling 30 days — the spec deliberately says "rolling
  24-hour" for messages but just "monthly" for the alarm; recommend calendar-month to keep it simple
  and country-neutral (reset at UTC midnight on the 1st). Flagged as Open question 2.
- Index: the existing `usage_ledger_teacher_id_student_id_created_at_idx` (teacher_id, student_id,
  created_at) has `student_id` between the two columns a teacher-wide monthly scan needs, so it
  cannot efficiently range-scan "this teacher, this month, every student." Plan a new additive
  migration adding `index (teacher_id, created_at)` (or `(teacher_id, created_at) where status =
  'recorded'`, since only recorded rows sum a real cost) for this task. Flag to database-reviewer.

### Threshold
No numeric threshold exists anywhere in the spec, contracts, or decision log. Recommend a single
platform-wide constant (not per-teacher yet — no billing plan tiers exist before M10), shipped as
plain config (same posture as `prices.yaml`: a reviewable, non-secret file or a `LIMITS`-style
constant in the alarm module), with a placeholder value the lead can change without a build. Matches
precedent ("Reversible: yes; 7.6 tunes the numbers on cost data" — decision log). Flagged as Open
question 3 (the dollar figure is a business decision, not something to invent silently).

### Who runs it, and what a "fire" does
Monthly, teacher-wide aggregation is not a per-turn concern — it does not belong in
`packages/harness`'s pipeline (rule 3: harness purity; also nothing in `PipelineDeps` is teacher-wide
or scheduled). It belongs beside `apps/worker`'s existing BullMQ scaffold
(`apps/worker/src/worker.ts`), as a new job the composition root schedules (actual cron/schedule
wiring is infra, out of bounds for this task — this task builds the job function and lets a caller
invoke it per teacher or for all teachers).

`apps/worker/src/alarms/costAlarm.ts` (new):
```ts
checkTeacherCost(teacherId, { usageLedger, subscriptions, audit, notify, clock, thresholdMicroUsd })
```
- Sums the teacher's calendar-month cost via `usageLedger.sumForTeacherSince`.
- At/above threshold **and not already paused this month** (idempotent — see Open question 4):
  - Notify staff and the teacher (see Alert below).
  - Pause only the teacher's **free** subscriptions: a new `subscriptions` repo method,
    `pauseFreeForTeacher(scope: TeacherScope, now)`, which updates `status = 'paused'` for every
    live (`status <> 'ended'`) subscription whose `package_versions.config->pricePerMonth->
    amountMinor = 0` (joined, since "free" is a `PackageConfig` fact, not a subscriptions column),
    scoped to that teacher, and returns the affected ids. Paid subscriptions (`amountMinor > 0`) are
    never touched — "paid students keep access until a staff decision" is already true by
    construction, since `entitle` only refuses `paused`/`ended`.
  - One `audit` row per pause action (`action: 'subscription.pause_cost_alarm'`,
    `target: 'teacher:<id>'`, `before`/`after` status, `reason`: threshold and month). The existing
    `AuditEntryInput.actorRole` enum (`'student'|'teacher'|'staff'`, defined locally in
    `audit.ts`, not a contracts type) has no automated-system value — flagged as Open question 5
    rather than silently overloading `'staff'` with a fake id.

### Alert: a new, local type, not `AlertSink`
`AlertSink.raise(a: SafetyAlert)` (frozen, `packages/contracts/src/ports.ts:121`) is typed to
`SafetyAlert` specifically: `kind: 'distress'|'abuse'|'misuse'|'other'`, and **required**
`studentId`/`sessionId` fields that make no sense for a teacher-wide, no-student-involved cost event.
Reusing it would mean inventing fake student/session ids to satisfy a frozen schema — rejected.
Following the exact precedent set by 2.2's `AdapterCapabilities` and 2.4's `MeterSink`/
`MeteringWarning` ("capabilities/types live beside the port, not inside it... no contract change
means no ADR"), this task adds a **new, local, non-contracts type**:
```ts
// apps/worker/src/alarms/types.ts
export interface CostAlarmEvent {
  readonly teacherId: string;
  readonly monthStartIso: string;
  readonly costMicroUsd: number;
  readonly thresholdMicroUsd: number;
  readonly unknownCalls: number;   // never silently folded into costMicroUsd
  readonly unpricedCalls: number;
  readonly pausedPackageIds: readonly string[];
}
export interface CostAlarmSink {
  notify(e: CostAlarmEvent): Promise<void>;
}
```
No real email/SMS vendor is chosen anywhere in the repo yet (checked the decision log: none exists
for auth magic-links, 4.3's `SafetyAlert` delivery, or anything else) — ship a log-based stub
(structured JSON line, same posture as `meteredGateway.ts`'s `defaultWarn`) as the default, and an
in-memory fake for tests that asserts on calls. Real delivery is explicitly deferred, same pattern as
2.4 deferring durable retry to 3.8 and 3.1 deferring real `AlertSink` delivery to 4.3's worker.
Flagged as Open question 6 (which future task/ADR picks the vendor and wires both this and 4.3 to
it — likely one decision, not two).

### Files

**Create**
- `packages/harness/src/pipeline/types.ts` — add `limitReached(lang): string` to `FallbackReplies`
  (modify, not create).
- `apps/worker/src/alarms/types.ts`, `costAlarm.ts`, `costAlarm.test.ts`.
- `apps/worker/src/alarms/logSink.ts` (default `CostAlarmSink`) + test.
- `packages/db/src/repositories/usage-ledger.ts` — `sumForTeacherSince` (modify).
- `packages/db/src/repositories/subscriptions.ts` — `pauseFreeForTeacher` (modify).
- One Drizzle migration: new index on `usage_ledger(teacher_id, created_at)`.
- `docs/tasks/2.5/handoff.md` (builder), `docs/tasks/2.5/review.md` (reviewers).

**Modify**
- `packages/harness/src/pipeline/steps/entitle.ts` (friendly message), `entitle.test.ts`,
  `testing/testSteps.ts`.
- `packages/db/src/repositories/usage-ledger.ts`, `subscriptions.ts`, `audit.ts` (actorRole, if Q5
  says extend it), `index.ts` (no new repo object, same repos), `README.md` (new isolation cases).
- `packages/db/test/repositories.int.test.ts` / isolation `CASES` table (new methods).
- `apps/worker/src/index.ts` (export the alarm module if it should be public from the package).

**Out of bounds**
- `packages/contracts/**`, `docs/adr/**` — no change; see Design for how both the friendly message
  and the alarm avoid needing one.
- `packages/payments/**` and the money ledger (`payments`/`payouts`/`ledger_entries`/`invoices`) —
  different system, M10.
- Durable/shared message-limit counters — 3.14.
- Real email/SMS delivery for the alarm, and any vendor choice — deferred (Open question 6).
- Scheduling/cron wiring (when the job actually runs in production) — infra, not this task; the job
  function is callable and testable, invocation cadence is a deployment concern.
- 3.2's `entitle.ts` message-limit *mechanism* (key, window, take) — already built; this task only
  changes the message text on the existing `TurnRejection`.
- Cost dashboard (13.5) — reads the same rows later, not built here.

## Tests first (Vitest, TDD)

1. `pipeline/types.ts` / `entitle.test.ts`: `limit_reached` rejection carries the injected
   `fallbackReplies.limitReached(lang)` text, not the generic default; default `testDeps()` still
   passes existing suites unchanged.
2. `usage-ledger` unit: bad scope throws `RepositoryError('scope')` before SQL, matching every other
   method (scope.test.ts pattern).
3. `usage-ledger.int.test.ts` (Postgres): `sumForTeacherSince` — seeded rows across two students,
   mixed `recorded`/`unknown`/`unpriced`/`eval`-sourced calls for one teacher, plus a second teacher's
   rows and rows from last month: result includes only this teacher, this month, non-`eval` rows;
   `unknown`/`unpriced` counts are reported and never folded into `costMicroUsd` (same invariant
   2.4's `sumForStudent` test already proves at student grain).
4. `subscriptions.int.test.ts`: `pauseFreeForTeacher` — a teacher with one free and one paid live
   subscription → only the free one becomes `paused`; a second teacher's free subscription is
   untouched (isolation); an already-`ended` subscription is not resurrected; returns the paused ids.
5. `apps/worker/src/alarms/costAlarm.test.ts` (fake repos/clock/sink, no real Postgres, no real
   model/payment calls per rule 4): below threshold → no notify, no pause; at/above threshold →
   `notify` called once with the right `CostAlarmEvent` (including unknown/unpriced counts), free
   subscriptions paused, one audit row per pause; a second check in the same month does not pause or
   notify again (idempotency, Open question 4); a teacher with zero free subscriptions still gets
   notified (paid-only teachers aren't silently skipped).
6. `logSink.test.ts`: default sink logs one structured line, no student data (there isn't any in
   `CostAlarmEvent`, but assert it stays that way).

Commands: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/db... --filter=@edmate/worker...`.

## Risky paths touched

Checked every planned path (including new folders) against `.claude/skills/merge-gate/risk-paths.txt`:

- `packages/db/src/repositories/**` — **matched.** Group: "The access filter... money... keeping
  each teacher's and student's data apart." **Reviewers required: security-reviewer.** This task
  modifies `usage-ledger.ts`, `subscriptions.ts`, and possibly `audit.ts` in that folder — branch is
  risky; needs a `risk: high` decision entry in the handoff.
- `packages/harness/src/pipeline/**`, `apps/worker/src/alarms/**` — not listed as risk-paths.txt
  globs on their own (note: `apps/worker/src/alerts/**` is listed and safety-reviewer-owned, but this
  task's new folder is `apps/worker/src/alarms/**`, a cost concern, not the trust/safety `alerts`
  path — different folder, confirmed not a glob match; still worth a sanity check by the lead since
  the name is easy to confuse with the risky `alerts/**` path).
- `packages/contracts/**`, `docs/adr/**` — untouched; no contracts change, no ADR.
- `packages/payments/**`, `apps/web/app/api/webhooks/**`, `apps/web/src/auth/**`,
  `packages/gateway/src/keys/**` — untouched.
- `packages/harness/src/guardrails/**`, `content/**`, `evals/suites/safety/**`,
  `evals/suites/locked/**`, `apps/worker/src/alerts/**`, `content/locales/**` — untouched.
- `.claude/**`, `.github/**`, `.githooks/**` — untouched.

**Risky: `packages/db/src/repositories/**` → security-reviewer required; plan a `risk: high`
decision entry** (e.g. "a monthly, teacher-wide cost read and a bulk subscription-status write,
scoped and audited the same way as every other repository"). Database-reviewer recommended (not
gate-required) for the new index migration and the free-package join.

## Open questions (lead can decide; none blocks the build)

1. **Where does the friendly `limit_reached` text actually reach a student?** Today, nowhere on the
   wire (frozen `TurnEvent`/`TurnRunResult` carry no message). Recommendation: ship it on the
   `TurnRejection` instance now (Part A), so whichever future task builds the web chat route or CLI
   turn surface can read `error.message` without this task guessing that surface's shape; that
   future task decides how (or whether) to add a `message`-carrying channel, by ADR if it needs the
   wire format to change.
2. **Calendar month vs rolling 30 days for "monthly."** Recommendation: calendar month in UTC — the
   spec's own wording distinguishes "rolling 24-hour" (messages) from plain "monthly" (alarm).
3. **The dollar threshold.** No figure exists anywhere in the spec/decision log. Recommendation: one
   placeholder platform-wide constant (not per-teacher; no plan tiers exist before M10), explicitly
   provisional, tuned later by 7.6's cost data, per the existing "7.6 tunes the numbers" precedent.
4. **Idempotency: does a teacher get re-notified/re-paused every time the job runs after crossing
   the threshold once that month?** Recommendation: no — track "already alarmed this month" (e.g. a
   small marker, perhaps the audit log itself: "has an unresolved
   `subscription.pause_cost_alarm` audit row this month for this teacher" is query-able without a
   new table) so a staff decision to unpause isn't immediately re-paused by the next run.
5. **`audit.actorRole` has no automated/system value.** It's a local `audit.ts` enum, not a
   contracts type, so extending it to add e.g. `'system'` is additive and not an ADR matter — but it
   is a repository-layer change other tasks might also want. Recommendation: add `'system'` now
   (this task is the first automated actor); alternative is attributing the action to a fixed
   `'staff'` sentinel id, which the lead may prefer to avoid a schema/enum change.
6. **Real delivery vendor for staff/teacher notification.** No vendor is chosen anywhere yet (checked
   against auth magic-links and 4.3's `SafetyAlert` delivery too — same gap). Recommendation: ship
   the log stub now; flag that whichever task picks a vendor should wire both this and 4.3's alert
   delivery to it, so the platform doesn't end up with two different notification vendors.

## Decisions (filled in after lead answers; logged to docs/decisions/log.md on merge)

Pending.

Status: **READY** — nothing above blocks starting the build; all six open questions have a
recommended default the builder can take and log if the lead doesn't answer first.

## Lead answers (18 Oct 2026)

1. The friendly message lives on TurnRejection.message now; it reaches students when the web turn surface (3.7 / M8) renders it. Note in the handoff.
2. Calendar month in UTC.
3. Threshold: provisional default 50 USD (50_000_000 micro-USD) per teacher per calendar month, configurable; revisit with the cost data in 7.6. Rows with NULL cost count as unknown: the alarm event reports how many, never treats them as zero.
4. Idempotent: once staff unpause a package, the alarm does not re-pause it in the same month (store the override); it can alert again.
5. Add a `system` actor role (local enum, additive).
6. Log-based alarm stub now; real delivery later (same gap as 4.3).
- Reviewers: security-reviewer, database-reviewer, typescript-reviewer; risk: high entry.
- Task 3.15 builds in parallel (contracts, harness/testing, db ports.ts for turnConfigStoreFor). Avoid those files; before your final push merge origin/main, regenerate the lockfile, renumber the migration if needed, re-run gates.
