# Task 12.4: Regulated-subject flag set manually by staff before publish

## Acceptance (verbatim)
> flagged agents cannot publish without staff approval.

## How it will be shown
- **packages/db int tests (Phase B, the acceptance proof):** on a real Postgres,
  (a) staff flag an agent `health` → `publish.startRun` is refused `PublishRefusedError` with
  reason `regulated_unapproved`, and no agent version or run is written;
  (b) staff approve → `startRun` succeeds and the new agent version's config carries
  `regulatedSubject: 'health'` from the staff flag;
  (c) a run started before the flag (or before a revoke) is refused at `goLive` with the same
  reason: the agent stays as it was, no `agent.publish` audit row, and the worker ends the run
  `error` with `errorCode: 'regulated_unapproved'` (its existing `errorCodeOf` path);
  (d) an unflagged agent publishes exactly as before (all existing publish tests stay green);
  (e) changing the subject clears the approval, so (a) applies again.
- **Staff writes are audited (Phase A int tests):** `agent.regulated_flag` and
  `agent.regulated_approval` audit rows with `actorRole: 'staff'`, before and after; a non-staff
  caller is `scope` and writes nothing.
- **Web (Phases C and D):** route tests for the staff API (401/403 for student and teacher, strict
  bodies); view tests for `/staff/agents`; the teacher's publish page shows the new refusal text.
- Manual check in the Phase D handoff: grant staff locally (`db:grant-role`), flag the demo agent,
  press Publish as the teacher and see the refusal, approve it in `/staff/agents`, publish again.

## Context already in place (read, not rebuilt)
- `AgentConfigSchema.regulatedSubject` (`'investing' | 'health' | 'law'`, optional) already exists
  in contracts and is read by the harness (disclaimers, adviceGuard, wider judge coverage per the
  4.8 decision). **No contracts change and no ADR.** Today nothing sets it: `publish.startRun`
  only copies it forward from the previous agent version.
- `publish.ts` (8.7a): `startRun` and `goLive` both take the lock order advisory lock → profile
  `FOR SHARE` → agent `FOR UPDATE` → run `FOR UPDATE`, and refuse with `PublishRefusedError`
  (`PublishRefusal` union). The worker (`apps/worker/src/gate/processor.ts`, `errorCodeOf`) and
  the studio API (`apps/web/src/studio/publish.ts`, `fromError`) already pass any `reason` through
  as a fixed word, so **neither needs a code change**; only `PublishView.tsx` maps reasons to text
  (unknown reasons fall back to the generic text, so the block works even before Phase D).
- Staff pattern (12.1, matched by 12.2 and 12.5): reads check `users.role = 'staff'` with a plain
  select; writes take `lockRole` (`packages/db/src/role-lock.ts`, `FOR SHARE`) in the same
  transaction, then an `insertAuditEntry` row with `actorRole: 'staff'`. apps/web: `withRole(['staff'])`,
  `handlers.ts` next to `route.ts`, fixed error codes, `cache-control: no-store`, `describeError`
  logging, client views that `safeParse`; pages call `requireRole(['staff'])` before any read.

## Design (decided here; questions below may change it)
- The flag lives on the `agents` row (db-level, staff-only), not in contracts:
  `regulated_subject text null` (check: `investing | health | law`, the 12.5a "text plus check"
  pattern, so `_shared.ts` and `schema/index.ts` are not touched), `regulated_approved_at
  timestamptz null`, `regulated_approved_by text null` (FK users). Checks: approval columns are
  both null or both set, and approval needs a subject.
- **The column is the only source of an agent's subject.** `startRun` writes the column's value
  into the new version's `regulatedSubject` (no longer copied from the previous version). The
  migration backfills the column from each agent's newest version config where one is set
  (one `UPDATE`, nothing dropped or deleted), so no existing subject is lost; backfilled agents
  start unapproved (Q3).
- **Publish rule:** flagged and not approved → refused `regulated_unapproved`. Checked in
  `startRun` and again in `goLive` under the agent `FOR UPDATE` lock; `goLive` also refuses when
  the run's agent version subject differs from the agent's current subject (staff changed the flag
  after the run started), so a version never goes live without the subject staff set.
- **Approval** stands until staff revoke it or change the subject (Q1). Re-setting the same subject
  is a no-op and keeps the approval.
- **Lock order for staff writes:** `lockRole` (staff user `FOR SHARE`) → agent `FOR UPDATE`. Publish
  never locks a users row and takedowns (12.2b) use the same order, so no cycle; state this in the
  new file's header (lessons: lock order).

## Phases
Four phases, board ids 12.4a to 12.4d. Order: A first; then B and C in parallel (B is packages/db
`publish.ts` only, C is apps/web staff API only; they share no files); D after C. B and D also
share no files.

### Phase A: packages/db, migration and staff repository (12.4a, cap 75 tool calls)
Start after 12.5a merges (it takes migration 0022 and edits `meta/_journal.json`); merge
origin/main right before `drizzle-kit generate` and regenerate if the number is taken.
Files:
- `packages/db/src/schema/agents.ts`: the three columns and two check constraints.
- `packages/db/migrations/00NN_<name>.sql` plus `meta/00NN_snapshot.json` and `meta/_journal.json`
  (shared): generated `ALTER TABLE agents ADD COLUMN ...` and the checks, plus one hand-added
  backfill `UPDATE agents SET regulated_subject = <newest agent_versions.config->>'regulatedSubject'>`
  where present. Additive: no drop, no delete.
- `packages/db/src/repositories/regulated-subjects.ts` (new), `regulatedSubjectsRepo(db)`:
  - `REGULATED_SUBJECTS = ['investing', 'health', 'law']`, `REGULATED_LIST_MAX = 200`,
    `REGULATED_NOTE_MAX = 500`.
  - `listForStaff(by)`: plain staff role check (`invalid` malformed, `scope` non-staff); every
    agent newest first, capped: agent id, teacher slug, status, `liveVersion`, `regulatedSubject`,
    `approvedAt`, `approvedBy` (an id). No names, emails or phones.
  - `setSubject(by, { agentId, subject: Subject | null, note? }) → { changed }`: `lockRole` must be
    staff (else `scope`, nothing written), agent `FOR UPDATE` (`not_found`); same value → no-op;
    else set subject, clear approval, audit `agent.regulated_flag` (target `agent:<id>`, the
    agent's teacher id, before/after subject and approval, note as reason).
  - `setApproval(by, { agentId, approved: boolean, note? }) → { changed }`: same locks; approving
    an unflagged agent is `invalid`; same state → no-op; else set or clear `approved_at`/`by`,
    audit `agent.regulated_approval`.
  - `REGULATED_SUBJECTS` is checked equal to the contracts enum
    (`AgentConfigSchema.shape.regulatedSubject`) in a unit test, so the two can't drift.
- `packages/db/src/repositories/map.ts`: append the staff row schema and type.
- `packages/db/src/repositories/index.ts` (**shared, append-only**): register
  `regulatedSubjects: guardAll(...)` last, and one export line.
- `packages/db/src/repositories/README.md` (shared): one "Regulated subjects (12.4)" section.
- Tests first: `packages/db/test/regulated-subjects.int.test.ts` (flag, approve, revoke, subject
  change clears approval, no-ops write no audit row, non-staff `scope` with nothing written,
  approve unflagged `invalid`, list shape/order/cap with no personal columns, backfill covered by
  a migration test or a note), `packages/db/test/regulated-subjects.test.ts` (bad input `invalid`
  before SQL; enum mirrors contracts). **Shared, append-only:** `packages/db/test/repositories.int.test.ts`
  (`CASES` entries), `packages/db/test/scope.test.ts` (grid exclusions for `by`-first methods, as
  12.1a did), `packages/db/test/leak.test.ts` (a driver error never carries the note).

State after A: staff can flag and approve in the database; publish is not blocked yet.

### Phase B: packages/db, the publish block (12.4b, cap 55 tool calls)
Files:
- `packages/db/src/repositories/publish.ts`: add `'regulated_unapproved'` to `PublishRefusal`;
  `startRun` selects the agent's regulated columns in its existing `FOR UPDATE` read, refuses
  flagged-and-unapproved (before any write), and writes the column into the new version's
  `regulatedSubject`; `goLive` does the same check under its agent lock plus the version-subject
  comparison (reading the run's `agent_versions.config`, parsed with `stored`). Update the
  `startRun`/`goLive` doc comments. No change to lock order.
- Tests first, in `packages/db/test/publish.int.test.ts`: cases (a) to (e) above; the existing
  "carries the regulated subject" case is rewritten to set the subject through the staff repo.
- `apps/worker/src/gate/processor.test.ts`: one case that a `regulated_unapproved` refusal ends
  the run `error` with that code (test only; mirrors the existing `suspended` case).

State after B: the acceptance holds in the database and the worker.

### Phase C: apps/web, staff API (12.4c, cap 60 tool calls)
Files (new): `apps/web/app/api/staff/agents/route.ts`, `handlers.ts`, `route.test.ts`,
`route.int.test.ts` (gated on `TEST_DATABASE_URL`, like 12.1b):
- `GET`: `listForStaff(session id)`.
- `POST`: strict discriminated body `{ action: 'subject', agentId, subject: 'investing' | 'health' |
  'law' | null, note? }` or `{ action: 'approval', agentId, approved, note? }`; note trimmed, 500
  max; any `by` or unknown key is 400. Both `withRole(['staff'])`, `no-store`, repository error
  kinds to fixed codes, the note never logged.
- Int test: the staff POST flags an agent, `publish.startRun` is refused, the approval POST lets it
  start (needs Phase B merged; if C runs before B merges, it asserts only the stored flag and the
  publish part moves to D's int test).

### Phase D: apps/web, `/staff/agents` page and the teacher's refusal text (12.4d, cap 85 tool calls)
Files:
- New: `apps/web/app/staff/agents/page.tsx`, `view.tsx`, `agent-row.tsx`, `client.ts` and
  `page.test.tsx`, `view.test.tsx`, `client.test.ts`: `requireRole(['staff'])` first; one row per
  agent (teacher slug, status, subject select None/Investing/Health/Law with Save, Approve or
  Revoke with a confirm step, approved date); the 8.4b/9.5a rules (try/catch on body reads,
  try/catch/finally with one busy flag, `safeParse` with a fallback view); jest-axe clean.
- `apps/web/app/staff/page.tsx` (**shared**, 12.2e and 12.5c also edit it): append one nav entry
  to `/staff/agents`; nothing else.
- `apps/web/app/teacher/publish/PublishView.tsx` and `PublishView.test.tsx`: add
  `regulated_unapproved` to `START_ERROR_KEYS` and `RUN_ERROR_KEYS`, with a test for each.
- `apps/web/messages/en.json` (**shared**): append one top-level `staffAgents` block, and one
  `regulated_unapproved` key in each existing publish error block. Proposed teacher text: "Your
  agent covers a regulated subject (investing, health or law), so Edmate staff review it before it
  can be published. We'll let you know when it's approved." (the lead may reword; no contact,
  number or name in it).

## Files out of bounds
`packages/contracts/**`, `docs/adr/**`, `packages/harness/**`, `content/**`, `packages/db/src/schema/_shared.ts`,
`packages/db/src/schema/index.ts`, `packages/db/src/schema/operations.ts` (12.5a), `packages/db/src/role-lock.ts`
(imported only), `packages/db/src/repositories/{agents,subscriptions,takedowns,reports,safety-alerts,teacher-profiles}.ts`,
`apps/web/src/auth/**` (the `/api/staff/**` policy row already applies), `apps/web/src/studio/publish.ts`
(passes the reason through already), `apps/worker/src/**` (source), `apps/web/app/staff/view.tsx`
and `verification-row.tsx`, `.claude/**`. If one of these needs a change, stop at `Status: PARTIAL`.

## Tests first
Each phase writes its failing tests before the code (tdd-workflow). B's cases (a) to (c) are the
acceptance and must be seen red first.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` (Phase A: regulated-subjects.ts, map.ts, index.ts, README.md;
  Phase B: publish.ts) → **security-reviewer**. **database-reviewer** recommended for A (backfill
  `UPDATE`, check constraints, lock order) and B (no new lock, the goLive re-check); not
  gate-required because the migration drops and deletes nothing.
- `apps/web/app/api/staff/**` (Phase C) → **security-reviewer**.
- `apps/web/app/staff/**` (Phase D) is not a glob yet (12.1c adds it); ask **security-reviewer**
  anyway.
- Not risky (checked): `packages/db/src/schema/agents.ts`, `packages/db/migrations/**`,
  `packages/db/test/**`, `apps/worker/src/gate/processor.test.ts`, `apps/web/app/teacher/publish/**`,
  `apps/web/messages/en.json`. No contracts, ADR, harness, safety-group or `.claude/**` path.
- Not a path match, but worth naming: the staff flag now decides what `regulatedSubject` reaches
  the harness (disclaimers and the advice judge) on the next publish.
- Planned `risk: high` decisions: A (staff-only regulated flag and approval on `agents`, audited,
  lock order, backfill), B (publish refuses flagged-unapproved agents at start and go-live; the
  staff flag is the only source of the version's subject), C (staff agents API boundary), D (staff
  page and teacher refusal text).

## Questions (none blocking; each has a recommendation)
1. **Does approval cover every later publish, or only the next one?** *Recommend:* it stands until
   staff revoke it or change the subject. Each publish still runs the quality gate, advice group
   included. Per-publish review can be a later task if the pilot needs it.
2. **Flagging an agent that is already live.** *Recommend:* it stays live on its current version
   (12.4 governs publishing); its next publish needs approval. If it must come down now, staff use
   12.2's agent takedown. Auto-suspending on flag is a later option.
3. **Backfill from existing versions.** *Recommend:* yes, so no subject already in a version is
   lost; backfilled agents start unapproved. Real data has none today (pilot not live).
4. **Is the teacher told?** *Recommend:* only the publish refusal text for now; a studio badge or
   email ("awaiting Edmate review") is a follow-up with 12.2f.
5. **Who may flag and approve?** *Recommend:* any `staff` user, no new role, as in 12.1 and 12.5.
   The same staff user may flag and approve.

## Budget
Budget: 275 tool calls (4 phases, packages/db + apps/web)

Per phase: A 75, B 55, C 60, D 85.

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm/turbo typecheck, lint and test for the phase's package;
`drizzle-kit generate` in Phase A; docker for a disposable test Postgres, never the `edmate-*`
containers; the secret scan).

## Exit conditions
- **`Status: DONE`** for a phase when its package gate (typecheck, lint, test, int tests on a
  disposable Postgres) is green after merging origin/main, its tests were written first, the
  secret scan is clean, shared files were only appended to (en.json also gets the two named keys),
  and the handoff has its `risk: high` decision. The task is DONE when B and D are, and D's
  handoff records the manual check.
- **`Status: PARTIAL`** when a phase passes its cap (A 75, B 55, C 60, D 85) without a green gate,
  when a file out of bounds needs a change (for example contracts, the auth policy, the worker
  source or `studio/publish.ts`), or when the migration number cannot be regenerated cleanly.

## Lead answers (22 Oct 2026)
- Phases run as board tasks: Phase A is **12.4a** (packages/db, after 12.5a merges; take the next free migration number on `origin/main` when the build starts), Phase B is **12.4b** (packages/db `publish.ts`), Phase C is **12.4c** (apps/web staff API) and Phase D is **12.4d** (apps/web staff page and PublishView). B and C start after A merges and share no files; D starts after C.
- Q1: yes. Approval stays until staff revoke it or change the subject.
- Q2: yes. Flagging a live agent leaves it live on its current version; its next publish needs approval, and staff use 12.2's takedown if it must come down now.
- Q3: yes. Backfill the subject from agent versions; every agent starts unapproved.
- Q4: yes. The teacher sees only the refusal text when publishing; the studio badge waits for 12.2f.
- Q5: yes. Any staff user may flag and approve; no new role for the pilot. Each action writes an audit row.
- Reviewers: security-reviewer on every phase, plus database-reviewer on A and B. Per the MVP rule, no safety-reviewer per PR until 13.3.
