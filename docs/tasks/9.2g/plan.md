# 9.2g plan: staff see the public display name on the verification queue; two mismatch cases
fixed

Board: milestone M13 · risk medium · deps `9.2d` (done), `9.3e` (done). One branch, one PR, two
phases (packages/db then apps/web): non-negotiable rule 1 — this task does not merge to `main`
until **both** phases are built and the combined gate (`@edmate/db` + `@edmate/web`) is green.
English only (pilot). No contracts change, no migration (reads an existing column).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "9.2d plan Q2 follow-up: staff see the public display name when they verify a teacher
(listPendingForStaff returns displayName; verification-row.tsx shows it), so staff approve the
name students will see; the two mismatch cases at
packages/db/test/repositories.int.test.ts:2478 use a valid displayName so they reach the
duplicate-profile and slug checks (9.2d code-review LOW)"
Accept: "db and web typecheck, lint and test green; a test shows the display name in the staff
verification row."

### How it is shown (paste into the Phase B handoff)

| Item | Evidence |
|---|---|
| `listPendingForStaff` returns `displayName` | `packages/db/test/teacher-profiles.int.test.ts`: the oldest-first exact-shape test's two row literals gain `displayName` (the value each teacher was created with); `packages/db/test/repositories.int.test.ts`'s isolation-grid `check` for `teacherProfiles.listPendingForStaff` asserts the row's key set includes `displayName`. |
| `findBySlugForStaff` returns it too (same shared row type and mapper) | Covered by the same `map.ts` schema change; `repositories.int.test.ts`'s `findBySlugForStaff` grid case is read-only shape, unchanged behaviourally, still green. |
| `verification-row.tsx` shows it | `apps/web/app/staff/view.test.tsx`: the existing "lists each pending teacher..." test gains an assertion that each row shows its display name, distinct from the declared sign-in name, proving the two fields are not conflated. |
| The two mismatch cases reach the right check | `packages/db/test/repositories.int.test.ts`'s `teacherProfiles.create` mismatch cases "a second profile for the same teacher" and "another teacher's slug" use a well-formed (2+ character) `displayName`, so a run against real Postgres fails on the duplicate-profile / slug-collision constraint, not on `DisplayName`'s length check. |
| No contracts change | `git diff origin/main -- packages/contracts docs/adr` is empty. |

## Design

`teacherProfiles.listPendingForStaff` and `findBySlugForStaff` (12.1a / 9.3f) already join `users`
for `name`/`email` and share one row type, `TeacherVerificationQueueRow`, and one mapper,
`toTeacherVerificationQueueRow` (`packages/db/src/repositories/map.ts`). Both selects add one more
column, using the exact `coalesce` expression discovery.ts already uses for the same column
(9.2d):

```
displayName: sql<string>`coalesce(${teacherProfiles.displayName}, ${teacherProfiles.slug})`,
```

Staff then see the same effective name — the teacher's own display name, or the slug when unset —
that a student would see on `/teachers`, not the raw nullable column. This is a read-only addition
to an existing query; no schema or migration change. The shared type and mapper mean
`findBySlugForStaff` (9.3f's slug lookup, used when staff re-open an already-decided teacher) gets
the field for free, matching the board title's note that the two methods share one row shape.

`apps/web`'s staff console re-shapes the same row through `toQueueItem`/`toLookupItem`
(`handlers.ts`) into `QueueItem`, validated client-side by `QueueItemSchema` (`client.ts`), and
rendered by `verification-row.tsx`. All three gain the one field, end to end.

## Files

### Phase A: packages/db (budget 50)

Tests first:
- `packages/db/test/teacher-profiles.int.test.ts`: in `listPendingForStaff`'s "a staff user sees
  only pending teachers, oldest first, ties broken by id, with name and email joined" test, add
  `displayName: 'Mr Beta'` to the `rowB` literal and `displayName: 'Ms Alpha'` to A's inline
  literal (the two teachers were created with those display names a few lines above; the test
  already uses `toEqual`, exact shape).
- `packages/db/test/repositories.int.test.ts`:
  - `teacherProfiles.listPendingForStaff`'s `check`: the `Object.keys(row).sort()` exact-keys
    assertion gains `'displayName'` in the array (keep the array sorted, matching the existing
    style).
  - `teacherProfiles.create`'s `mismatches`: the two cases "a second profile for the same
    teacher" and "another teacher's slug" change their `displayName: 'X'` to a well-formed value
    (2+ characters, e.g. `'XX'`), with a one-line comment next to each matching the one already on
    the third case a few lines below ("a student scope id"): `displayName` must be well-formed so
    the case reaches the check it is named for, not `DisplayName`'s own length refinement (9.2d
    code-review LOW, fixed here). Do not touch any other case in this file, and do not touch the
    `subscriptions.listLiveForStudent` grid case (lines ~2020-2089, ~6569-6632): another task
    (9.4f) is editing it right now.
- No change needed to `teacher-profiles.test.ts` (no-DB unit test): `DisplayName`,
  `CreateInput`/`UpdateInput` are unchanged by this task.

Source:
- Modify `packages/db/src/repositories/map.ts`: `TeacherVerificationQueueRowSchema` gains
  `displayName: z.string().min(1)` (placed after `slug`, before `subject`, matching
  `TeacherProfileRowSchema`'s own field order); the exported type comment gains one clause;
  `toTeacherVerificationQueueRow`'s `row` parameter type gains `displayName: string;` and the
  mapped object gains `displayName: row.displayName,`.
- Modify `packages/db/src/repositories/teacher-profiles.ts`:
  - `listPendingForStaff`'s select: add
    `` displayName: sql<string>`coalesce(${teacherProfiles.displayName}, ${teacherProfiles.slug})`, ``
    (placed after `slug`, before `subject`, matching the schema order above).
  - `findBySlugForStaff`'s select: the same line, same placement.
  - The two doc comments above these methods (lines ~412-419 and ~443-452) each gain one clause
    noting the row now also carries the public display name (slug-fallback), same source as
    discovery's public reads, so staff approve the name students will see.
- Modify `packages/db/src/repositories/README.md`: the two existing mentions of
  `teacherProfiles.listPendingForStaff` (§ 9's "name and email" sentence, § 11's "name and email"
  sentence) each gain ", and the public display name (slug-fallback, same source as discovery's
  public reads)" or similarly short wording. Comment-only; no code change.
- `packages/db/src/repositories/index.ts`: no change expected (the type is already re-exported).

Gate (this phase's own `Status: DONE` bar):
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` green, db coverage threshold
  kept.
- Run `corepack pnpm turbo run typecheck --filter=...@edmate/db` once as a **diagnostic**, not a
  blocking check: it is expected to fail inside `apps/web` right now (the test files listed under
  Phase B below reference `TeacherVerificationQueueRow` and `QueueItem` by explicit type and will
  not compile until Phase B adds the field to their fixtures). Paste the list of failing
  `apps/web` files it names into the handoff so Phase B's builder has a checklist; do not try to
  fix them from Phase A (`apps/web/**` is out of bounds for Phase A).
- `python3 .githooks/secret-scan.py --all` clean.
- Do **not** open a PR or push to `main` after this phase: commit on the task branch
  (`m13/9.2g-staff-display-name`) and hand off; Phase B continues on the same branch.

State after Phase A: `listPendingForStaff` and `findBySlugForStaff` both return the public display
name (slug-fallback); the two mismatch cases exercise the right check; `apps/web`'s typecheck is
known-red until Phase B (expected, named in the Phase A handoff).

### Phase B: apps/web (budget 65)

Tests first:
- `apps/web/app/staff/view.test.tsx`: `ASHA` and `BEN` (`QueueItem` literals) each gain
  `displayName` (a value distinct from `name`, e.g. `displayName: 'Asha R.'` on `ASHA` whose
  `name` stays `'Asha Rao'`, and `displayName: 'Ben'` where `name` is also `'Ben'`
  — proving the empty/placeholder case renders fine too). Extend the existing "lists each pending
  teacher with slug, subject, declared name and email" test (rename its title to add "and display
  name") to also assert `within(asha).getByText('Asha R.')` is present, and that it is a different
  node from the declared-name text.
- `apps/web/app/staff/client.test.ts`: `ITEM` gains `displayName: 'Asha Public'` (flows into
  `LOOKUP_ITEM` via its existing `{ ...ITEM, ... }` spread; no other edit needed there). The
  "old-shaped reply" test is unaffected (it is already missing several required fields).
- `apps/web/app/api/staff/verifications/route.test.ts`: the `memory()` helper's
  `listPendingForStaff` and `findBySlugForStaff` mock implementations each add
  `displayName: p.displayName,` to their returned row object (reading the same
  `TeacherProfileRow.displayName` the `profiles` map already carries — no new state). The two
  exact `toEqual` response-shape assertions ("lists pending teachers for the session staff user,
  oldest first, no-store" and "finds a pending teacher by slug") each gain
  `displayName: 'Asha',` in every expected teacher object (the fixture's `add()` sets the same
  literal `displayName: 'Asha'` for every profile; this is a pre-existing simplification in this
  fixture, not a new one).
- `apps/web/app/staff/page.test.tsx`: optional, time permitting — add `displayName: 'Asha'` to
  `ROW` for consistency (its mock is untyped, so this is not required for either typecheck or the
  existing `toEqual` assertions to pass: a missing key compares equal to an `undefined`-valued key
  under `toEqual`). Skip if the phase is tight on budget; note the skip in the handoff.

Source:
- Modify `apps/web/app/staff/client.ts`: `QueueItemSchema` gains `displayName: z.string()` (placed
  after `slug`, before `subject`).
- Modify `apps/web/app/api/staff/verifications/handlers.ts`: the `QueueItem` interface gains
  `displayName: string;` (same placement); `toQueueItem` and `toLookupItem` each gain
  `displayName: row.displayName,` in their returned object.
- Modify `apps/web/app/staff/verification-row.tsx`: one new `<dt>`/`<dd>` pair,
  `{t('displayName')}` / `{item.displayName}`, placed before the existing `subject` pair (staff
  see the name students will see first, then the subject, then the identity-check fields `name`
  and `email`). One-line doc-comment addition at the top of the file noting task 9.2g.
- Modify `apps/web/messages/en.json` (`staff` key only): add `"displayName": "Public display
  name"` (placed before `"subject"`, matching the new field order in the row); optionally reword
  `"intro"` to mention it ("Check the public display name, declared name and email before you
  approve.") — small, same file, do only if it does not risk the budget.
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --filter=@edmate/db`
  green (this is the combined, non-diagnostic run that must now pass clean, confirming Phase A's
  diagnostic failures are all resolved), secret scan clean.
- Open the PR only after this phase; merge `origin/main` into the branch first if anything else
  landed on `apps/web/messages/en.json` or `apps/web/app/staff/**`/`apps/web/app/api/staff/**` in
  the meantime (shared, high-traffic files).

State after Phase B (task done): staff see the public display name on both the pending queue and
the slug lookup, before the declared sign-in name, so they approve the name students will
actually see; the two mismatch cases exercise the duplicate-profile and slug-collision checks they
are named for.

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` (no contracts change: `TeacherVerificationQueueRow` has
  no contract type, same precedent as `AuditRow`).
- `packages/db/src/repositories/discovery.ts`, `teacher-profiles.ts`'s `DisplayName`,
  `CreateInput`, `UpdateInput`, `setVerification`, `assertVerifiedForPublish` (unchanged by this
  task; 9.2d and 9.3e's code).
- `packages/db/src/repositories/retrieval.ts` and anything under `packages/harness/**` (another
  builder is in those files right now).
- `packages/db/test/repositories.int.test.ts`'s `subscriptions.listLiveForStudent` case (9.4f, PR
  pending) — touch only the two named `teacherProfiles.create` mismatch cases and the
  `teacherProfiles.listPendingForStaff` exact-keys list in this file.
- `apps/web/app/teacher/**` (onboarding; this task does not touch where a teacher sets the name,
  only where staff see it), `apps/web/src/studio/**`, `packages/db/src/cli.ts`,
  `packages/db/src/bin/**`, `docs/try-it.md`, `packages/db/migrations/**` (no migration this
  task).
- A builder that finds it needs any of these stops at `Status: PARTIAL` and names the file.

## Shared files and build order

- `packages/db/test/repositories.int.test.ts`: 9.4f is editing the
  `subscriptions.listLiveForStudent` grid case (different lines, ~2020-2089 and ~6569-6632) at the
  same time; this plan's edits are at the `teacherProfiles.create` mismatches (~2568-2609) and the
  `teacherProfiles.listPendingForStaff` grid case (~2754-2775) — far enough apart that both should
  merge cleanly, but Phase A merges `origin/main` before pushing regardless.
- `apps/web/messages/en.json` and `apps/web/app/staff/**` / `apps/web/app/api/staff/**`: high
  traffic; Phase B merges `origin/main` before pushing.
- One branch, one PR (rule 1): Phase A does not push to `main`; both phases land in one PR opened
  after Phase B.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/db/src/repositories/**` (map.ts, teacher-profiles.ts, README.md), `apps/web/app/api/
  staff/**` (handlers.ts, route.test.ts), `apps/web/app/staff/**` (client.ts, client.test.ts,
  verification-row.tsx, view.test.tsx, page.test.tsx) all fall under the same risk-paths.txt
  group. **Required reviewer: security-reviewer** (a staff-only identity-check surface changes
  shape). Recommended, not gate-required: `code-reviewer` (runs anyway) and `typescript-reviewer`
  (an exported type, `TeacherVerificationQueueRow`, gains a field read by another package — the
  "gate dependents" lesson). No `database-reviewer` need: no migration, no schema change, no drop
  or delete.
- `apps/web/messages/en.json`, `docs/tasks/9.2g/**`: no match.
- The PR's handoff logs the `risk: high` decision for this risky-path merge, naming the group and
  reviewer above, before the lead merges (rule 6).

## Open questions (each with a recommendation; none blocks the build)

- **Q1. Raw `display_name` (nullable) or the slug-coalesced value staff see?** Recommend the
  coalesced value (Design, above): staff then approve exactly what a student would see, matching
  the board title's "so staff approve the name students will see." The alternative (raw, nullable)
  would show staff a blank for any teacher who has not set one yet, which tells them less.
- **Q2. Does the public display name replace "Declared name" in the row, or sit alongside it?**
  Recommend alongside (scope decision, above): staff still need the sign-in name and email to
  check identity (12.1a's own reason for joining `users`); the display name is what they are
  approving for public use, a different question from who the person is. Dropping "Declared name"
  would also contradict 12.1a's row-shape test, which still expects it.

## Budget

Budget: 115 tool calls (2 phases: A 50, B 65; packages/db, apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test for `@edmate/db`,
`...@edmate/db` (diagnostic only in Phase A), `@edmate/web --filter=@edmate/db` combined in Phase
B, the secret scan, git add/commit/push on the task branch only — no push to `main` after Phase A
alone). No network beyond localhost, no real model or payment calls, no `db:generate` (no schema
change this task).

## Exit conditions

Phase A ends `Status: DONE` when its tests exist and pass, `@edmate/db`'s own
typecheck/lint/test/coverage gate is green, the dependents typecheck has been run once as a
diagnostic and its failing-file list is pasted into the handoff, and the secret scan is clean; it
stops at `Status: PARTIAL` past 50 tool calls, if a file under "Files out of bounds" needs a
change, or if it touches any line of `repositories.int.test.ts` outside the two named spots.

Phase B ends `Status: DONE` when its tests exist and pass, the combined
`@edmate/web --filter=@edmate/db` gate is green (the former diagnostic failures now resolved), the
secret scan is clean, and the "How it is shown" table is filled in with real evidence; it stops at
`Status: PARTIAL` past 65 tool calls or if a file under "Files out of bounds" needs a change. The
task as a whole is not `Status: DONE` (and the PR does not open) until both phases are on the one
branch and green together.

## Status

READY

## Lead answers (26 Oct 2026)
- Q1: the slug-coalesced display name, as recommended (staff approve what students will see).
- Q2: shown alongside "Declared name", as recommended.
- 9.4f has merged, so `repositories.int.test.ts` and `packages/db/src/repositories/README.md` are free for this task. 13.regate's Phase A runs in parallel in `packages/db/src/repositories/publish.ts` and `test/publish.int.test.ts`; don't touch those.
