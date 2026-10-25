# 9.3k plan — staff see a teacher's subject-edit history; two 9.3h review follow-ups

Status: **BLOCKED** (one open decision; everything else below is ready to build once it's
answered — see Q1)

## Acceptance (verbatim from the board)

> a staff view test shows a teacher's past subject changes on a queue row; web typecheck, lint and
> test green.

Board title also carries two 9.3h review follow-ups, not in the acceptance line above but in
scope per the lead's prompt: a `view.test.tsx` case for a lookup-found row with the takedown/
last-decision lines (9.3h review MEDIUM), and dropping `lastDecision.reason` from the staff API
payload (9.3h review LOW).

## The blocker (read first)

**Subject edits are not audited today.** I read every write path:

- `packages/db/src/repositories/teacher-profiles.ts`'s `update()` (the only place a teacher's
  `subject` column changes) is a single `UPDATE ... RETURNING` statement with a `CASE` that resets
  `verificationStatus` to `pending` when the stored subject differs from the incoming one (8.1c,
  human answer B-30). It does not call `insertAuditEntry` — the file imports it only for
  `setVerification`'s `teacher.verify` row (line 18 import, used once, at line ~313).
- `apps/web/src/studio/profile.ts` (the only caller of `teacherProfiles.update`) does not write an
  audit row either; it just forwards the patch.
- `auditLog`'s own append-only contract (`packages/db/src/repositories/README.md`: "no update or
  delete") and `audit.ts`'s header both describe what gets recorded — a subject change is not one
  of the listed events. Nothing elsewhere in `packages/db/src/repositories/**` writes a
  `teacher.subject` (or similarly named) action.

So "staff see a teacher's subject-edit history ... from audit_log" cannot be built: there is no
history in `audit_log` to read. Per the brief, I'm not inventing a new audit write to manufacture
it — that's a write to a locked, already-reviewed method (`update()`, whose single-statement shape
is itself an 8.1c safety property: "a single statement leaves no window for a concurrent
`setVerification` to be overwritten or skipped") and it needs the human's go-ahead.

### Q1 (blocking): should `teacherProfiles.update()` start writing a `teacher.subject` audit row?

**Recommendation: yes**, shaped like this, as a separate follow-up task once answered (not bundled
with the two ready items below):

- A new action `teacher.subject`, written only when `p.subject !== undefined` **and** the value
  actually changes (same condition the existing `CASE` already tests) — not a per-call no-op write.
- `before`/`after` carry `{subject}` only (never bio/languages, never a reason — `update()` takes
  no actor-supplied reason at all, so there is nothing free-text to accidentally store beyond the
  subject string itself, which is this feature's own point).
- Actor is the teacher themself (`actorRole: 'teacher'`, `actor: teacherId'`) — matches
  `checkActor`'s existing rule and every other self-service write in this repository.
- To keep the "no read-then-write window" property 8.1c protects, the old subject must come from
  the *same* statement, not a separate `SELECT ... FOR UPDATE` beforehand (that would reopen the
  race 8.1c closed). A `WITH old AS (SELECT subject FROM teacher_profiles WHERE user_id = ...),
  upd AS (UPDATE ... RETURNING ...) SELECT upd.*, old.subject AS prev_subject FROM upd, old`-shaped
  CTE keeps it to one statement; the audit insert happens after, in the same transaction, only when
  `prev_subject <> subject`. This needs its own careful test (concurrent update + a racing
  `setVerification`, mirroring 8.1c's and 8.1b's own tests) before it ships.
- New staff-facing read: `audit.findSubjectHistoryForStaff(by, teacherId, limit)`, same shape and
  precedent as 9.3h's `findLastVerifyForStaff` (staff-only `lockRole` check, no lock, `invalid`
  before SQL, bounded by a `limit` capped the same way `AUDIT_MAX_LIMIT` caps other reads), filtered
  to `action = 'teacher.subject'`, ordered `ts desc, id desc`, served by the existing
  `audit_log_teacher_id_ts_idx` (teacher_id, ts) — **no migration**.
- Bound: last 10 changes (same order of magnitude as other staff-console caps in this codebase;
  10 is enough to show a pattern of back-and-forth edits without the row growing unbounded).

If the human says no (or "not now"), 9.3k becomes just the two items below, and the board title's
subject-history wording moves to a new, explicitly-scoped future task once there is something in
`audit_log` to read — this plan does not propose any other way to get the history (no derived
table, no separate audit-equivalent store).

## What's ready now regardless of Q1 (not blocked)

Both of 9.3h's review follow-ups are independent of Q1 and can build today if the lead wants to
split them into their own smaller task while Q1 is open. I've designed them fully below so the
plan is usable either way (as 9.3k's whole scope if Q1 comes back "no", or as a same-day split if
the lead wants the easy part moving now).

## Context (read before building)

- 9.3h (`docs/tasks/9.3h/{plan,handoff,review}.md`) built `enrichQueueRows` (`apps/web/app/api/
  staff/verifications/handlers.ts`) and `audit.findLastVerifyForStaff` (`packages/db/src/
  repositories/audit.ts`), shared by `list`, `lookup` and `page.tsx`'s SSR first paint. Its review
  left two follow-ups, both below.
- `apps/web/app/staff/verification-row.tsx` renders `activeTakedowns`/`lastDecision` the same way
  for a queue row and a lookup-found row (one component, `VerificationRow`) — confirmed by reading
  it; the review's MEDIUM is a test gap, not a behaviour gap.
- `LastDecision.reason` (`handlers.ts`) flows from `audit.findLastVerifyForStaff`'s own return
  (which keeps `reason` — that repository method is a general-purpose read, untouched here) through
  to the API body and the zod schema, but `verification-row.tsx` never reads `item.lastDecision.
  reason` — confirmed by reading the component. The fix is dropping it from the `apps/web` payload
  shape only (the `LastDecision` interface in `handlers.ts` and `LastDecisionSchema` in
  `client.ts`), not from `audit.findLastVerifyForStaff`'s db-layer return type.
- 8.1b (teacher-verification follow-ups) merged since 9.3h's plan was written, so `teacher-
  profiles.ts` is no longer an out-of-bounds file on another branch — it's fair game for Q1's
  follow-up task once answered, not for this plan's ready items (neither touches it).
- Lessons: "A check that silently skips looks like a pass" (a parser/schema that quietly drops
  data without saying so is a known failure shape here) — applies to Q1's `WHERE prev_subject <>
  subject` guard: get the comparison wrong and every edit silently stops being recorded, with no
  signal. "Two writers that lock the same rows in different orders deadlock" (8.7a) — Q1's new
  write adds no new lock (audit insert touches only `audit_log`), but its own test plan should
  still prove it against a racing `setVerification` the way 8.1c already does for the status reset.

## Design — ready items (build now or when Q1 resolves)

1. `apps/web/app/api/staff/verifications/handlers.ts`: `LastDecision` drops `reason`;
   `enrichQueueRows` maps `audit.findLastVerifyForStaff`'s result through `{status, ts}` only
   (the repository call and its return type are unchanged — only what's copied into the API shape
   changes).
2. `apps/web/app/staff/client.ts`: `LastDecisionSchema` drops `reason`.
3. `apps/web/app/staff/view.test.tsx`: one new case under the "find a teacher by slug (9.3f)"
   describe block — `findTeacherBySlug` resolves a `LookupItem` with a non-empty `activeTakedowns`
   and a non-null `lastDecision`, asserting the same takedown-count and last-decision-line text
   9.3h's queue-row cases already assert, now on the row rendered from a lookup (mirrors the
   existing "shows a verified teacher with its current status..." case's shape).
4. Update every fixture/assertion across `apps/web/app/api/staff/verifications/{route.test.ts,
   route.int.test.ts}`, `apps/web/app/staff/{client.test.ts,page.test.tsx,view.test.tsx}` that
   currently builds or expects a `lastDecision` with a `reason` key — drop `reason` from the
   expected/constructed object (the mock `audit.findLastVerifyForStaff` stubs in `route.test.ts`
   keep returning `reason` from the *repository* mock, since that return type is unchanged; only
   the asserted API-body shape loses it).
5. No `en.json` change (no new copy; the two existing `lastDecision*` keys are untouched).

## Design — Q1's follow-up, if approved (not this plan's build; sized here for the next plan)

### Phase A: `packages/db` (risky: `packages/db/src/repositories/**`)
- `teacher-profiles.ts`'s `update()`: CTE-shaped single statement capturing the pre-update subject;
  a `teacher.subject` audit insert in the same transaction, guarded by the real change condition.
- `audit.ts`: new `findSubjectHistoryForStaff(by, teacherId, limit)` (staff-only, bounded, same
  shape as `findLastVerifyForStaff`).
- Tests first: a concurrent-update test (racing `setVerification`, same style as 8.1c/8.1b's own),
  `audit.test.ts` invalid-input cases, `repositories.int.test.ts` grid entry, `scope.test.ts`
  exclusion line. Coverage: 100% statements/functions/lines maintained.
- Estimated budget: ~45 tool calls.

### Phase B: `apps/web` (risky: `apps/web/app/api/staff/**`)
- `enrichQueueRows` gains the subject history (one more per-row call, same parallel pattern as
  `lastDecision`); `QueueItem`/`LookupItem` gain `subjectHistory: {subject: string, ts: string}[]`;
  zod schemas mirror it; `verification-row.tsx` renders it as a list (dates + subject names only);
  `en.json` gains its copy keys; `page.tsx` SSR wiring.
- Tests first: unit, route, route.int, client, view, page tests following the exact pattern 9.3h
  used for `activeTakedowns`/`lastDecision`.
- Estimated budget: ~50 tool calls.

(These two phases are an estimate for whichever future task builds Q1's "yes" — not this plan's
build list, and not commissioned by this plan.)

## Files to create / modify (this plan's ready items only)

- `apps/web/app/api/staff/verifications/handlers.ts` — drop `reason` from `LastDecision` (item 1).
- `apps/web/app/staff/client.ts` — drop `reason` from `LastDecisionSchema` (item 2).
- `apps/web/app/staff/view.test.tsx` — new lookup-row case (item 3).
- `apps/web/app/api/staff/verifications/route.test.ts`, `route.int.test.ts` — drop `reason` from
  asserted bodies (item 4).
- `apps/web/app/staff/client.test.ts`, `page.test.tsx` — drop `reason` from asserted/constructed
  `lastDecision` objects (item 4).

## Files out of bounds

`packages/db/src/repositories/teacher-profiles.ts`, `packages/db/src/repositories/audit.ts` — Q1
is unanswered; this plan's build does not touch either. `packages/db/**` entirely (no db change
needed for the ready items). `apps/web/app/staff/verification-row.tsx`'s rendering logic — unchanged,
only its test coverage widens. `apps/web/app/{home,learn}/**`, `packages/db/src/repositories/
{subscriptions,agents}.ts` (unrelated, 9.3i territory). `packages/contracts/**` (no new error code).
Any migration (none needed either way: Q1's design reuses `audit_log` and its existing index).

## Risky paths touched (checked against risk-paths.txt)

- `apps/web/app/api/staff/verifications/handlers.ts` — group `apps/web/app/api/staff/**`:
  required `security-reviewer`; recommended also `code-reviewer`.
- Not risky by path: `apps/web/app/staff/**` (console UI/tests), `apps/web/app/staff/client.ts`
  (not under `apps/web/app/api/**`), this plan. No `packages/db/**`, no contracts, no ADR, no
  migration, no harness or locale change in this plan's build.
- If Q1 is answered "yes" and a future task builds it: `packages/db/src/repositories/audit.ts` and
  `.../teacher-profiles.ts` both fall under `packages/db/src/repositories/**` (required
  `security-reviewer`; recommended `database-reviewer` for the CTE/lock-order change,
  `code-reviewer`, `typescript-reviewer`) — that task's handoff logs its own `risk: high` decision.
  This plan's build logs none (its two changes are payload-shape-only, `risk: low`).

## Decisions to log (handoff `## Decisions`, risk: low)

1. "9.3k's board title asked for a teacher's subject-edit history from `audit_log`, but subject
   edits are not audited today (`teacherProfiles.update()` writes no audit row). Built only the two
   9.3h review follow-ups (drop `lastDecision.reason` from the staff API payload; a lookup-row
   `view.test.tsx` case); the subject-history half stays open pending Q1 (see plan)."

## Open questions

- **Q1 (blocking, see above):** should `teacherProfiles.update()` start writing a `teacher.subject`
  audit row (recommended design above), enabling a later `audit.findSubjectHistoryForStaff` and a
  `subjectHistory` field on the staff console? Recommended: yes, as its own follow-up task (not
  this one), given the lock-order/CTE care it needs.
- Q2 (non-blocking): if Q1 is "yes", should the bound be 10 changes or some other N? Recommended:
  10 (matches this console's other caps' order of magnitude).

## Budget

Budget: 25 tool calls (1 phase, apps/web only) — **for the ready items only; this plan does not
commission Q1's build.**

## Allowed tools

Read, Grep, Glob, Edit, Bash (pnpm typecheck/lint/test for `@edmate/web`, the secret scan, git
add/commit/push on the task branch only). No Write needed (no new files).

## Exit conditions

- `Status: DONE`: the ready items above are built (tests first), `@edmate/web` typecheck/lint/test
  green, secret scan clean, handoff written with `Tool calls used:` and the `risk: low` decision —
  **and** the handoff names Q1 as still open (does not silently drop the board title's main ask).
- Stop at `Status: PARTIAL` past ~25 calls, or if dropping `reason` breaks an assertion this plan
  didn't anticipate in a way that needs a design change.
- This plan itself stays `Status: BLOCKED` at the top until the human answers Q1; a builder should
  not start from it without the lead first deciding whether to (a) wait for Q1, (b) split off just
  the ready items under this same task id, or (c) open a new task id for Q1's "yes" path.

## Lead answers (25 Oct 2026)
- Scope split. 9.3k now builds only the ready items: the lookup-row view.test.tsx case, and dropping `lastDecision.reason` from the apps/web staff payload (the db-layer return keeps it). Read this plan's Status as **READY** for that scope.
- Subject-edit history moves to new board task 9.3m, blocked on the human's answer to Q1 (blockers B-58). The Q1 follow-up design above is the starting point for 9.3m's plan.
- Q2 belongs to 9.3m and is not decided here.
- Reviewers: security-reviewer (required for apps/web/app/api/staff/**) and code-reviewer. The lead logs a `risk: high` merge decision for the staff API path.
- Budget: 25 tool calls; stop at 32.
