# 11.1d Edit and cancel a scheduled live class; 11.1 review fixes

## Acceptance (verbatim)

- Board 11.1d accept: "a teacher can edit or cancel a class, with tests."
- Board 11.1d title (full): "11.1 follow-ups: edit and cancel a scheduled live class; email
  reminders if the human picks B-45 option (b); 11.1a review: cap the meeting link length in
  CreateInputSchema and decide https only; listUpcomingForStudent returns each class once when a
  student holds two subscriptions whose packages share it (DISTINCT); a LIMIT on both list reads;
  11.1b review LOWs: per-class aria-label on the studio join links, a test at the exact
  2048-character link boundary."
- **Email reminders are out of scope.** The human answered B-45 "in-app only" (not option (b), a
  real email/SMS send); 11.1's own decision already built the reminder as a pull-based `/home`
  read, no background job. This task does not touch `packages/queue/**`, `apps/worker/**`, or
  `packages/db/src/identity/**`.

## How it will be shown

1. Teacher opens `/teacher/live-classes` (same direct URL as today), schedules a class, then
   before it starts clicks **Edit** on it, changes the title, link and/or start time, and saves —
   the list shows the new values at once. After `startsAt` passes, or once the class is
   cancelled, Edit (and Cancel) no longer appear for that class (repo-level test plus a manual
   check in the demo).
2. The teacher clicks **Cancel** on an upcoming class, confirms (same `window.confirm` pattern as
   `apps/web/src/memory/ResetMemoryButton.tsx`), and the class now shows **Cancelled** in their own
   list, with no Edit/Cancel controls. A second teacher gets `not_found` calling either route on
   the first teacher's class id (repo-level test).
3. A student who was seeing that class on `/home` (entitled, upcoming) now sees it marked
   **Cancelled** instead — no join link, no window label (`reminder_24h` etc.), no "ask a
   question" form — until its original `startsAt` passes, at which point it drops from the list
   like any other past class. Demoed by scheduling a class a few minutes out, cancelling it as
   the teacher, and reloading `/home` as the entitled student — no clock mocking.

## Decision: a cancelled class is marked, not dropped, on the student side

Keeping it visible (status `cancelled`) instead of silently removing it is the one that matches
how every other status field in this codebase works (a document's `uploading`/`processing`/
`ready`/`failed`, an eval run's `queued`/`running`/`passed`/`failed`/`error`): the row stays, the
status is shown, nothing silently vanishes. The alternative (drop it) would make a class that was
visible a minute ago — maybe already flagged `starting_soon` — disappear with no explanation,
which is the shape of bug `docs/lessons.md`'s UI lessons warn about (state changing with nothing
telling the user why). It also costs nothing extra: `listUpcomingForStudent` already filters on
`startsAt > now`, so a cancelled class still drops off on its own once that time passes; no new
filtering logic is needed, only a `status` field to show instead of the window label and the link.

## Decision: not in scope, called out so the builder doesn't drift into them

- **`classQuestions.submit` (11.2a) does not check a class's `status`.** A student could still
  submit a pre-class question to a class that was since cancelled. This plan does not touch
  `packages/db/src/repositories/class-questions.ts` or `apps/web/src/studio/classQuestions*`
  (different task's files); Phase C only stops *rendering* the ask-a-question form for a
  cancelled class on `/home`, which covers the normal path. Log this gap as a follow-up, not a
  blocker.
- **Editing `packageIds`** (re-attaching a class to different packages) is not part of this task;
  the board accept and the human's framing both say title/time/link only.
- **The two "wontfix" findings** from 11.1b review (case-sensitive https check) and 11.1c review
  (sequential teacher-owner lookups on `/home`) are closed; do not reopen them here.
- **`docs/lessons.md` is at its cap (8 entries, cap is 3–8; a 9th breaks `python-harness` CI,
  per the lead's own notes).** If this task needs a fix round, do not add a new lessons entry
  without first checking with the lead — don't just add a 9th.

## Migration numbering (check before you start, and again before you open the PR)

`live_classes` (migration `0001_data_model.sql`) has no `status` column today, so this task adds
one via a real migration. **Migration `0025` is in flight in another task right now.** Before
writing any schema change: `ls packages/db/migrations/*.sql` and pick the next free number after
whatever is actually on `main` at that moment (it may be `0025` or `0026` by the time you start —
don't assume `0025` is free). Edit `packages/db/src/schema/operations.ts` first, then run
`pnpm --filter @edmate/db db:generate` (drizzle-kit) to produce the migration SQL, its
`meta/00xx_snapshot.json` and the `meta/_journal.json` entry together — do not hand-write any of
the three. Re-check `packages/db/migrations/*.sql` immediately before pushing: if another
migration landed on `main` in the meantime, merge `main` into your branch first (push to your own
branch; do not force-push, per the repo's no-rebase-on-pushed-branches rule) and re-run
`db:generate` so the number and the journal are consistent with what's actually on `main`.

## Phase A — packages/db: `status`, `update`, `cancel`, and the 11.1a/11.1b/11.1c review fixes

### Schema (migration)

- `packages/db/src/schema/operations.ts` — add to `liveClasses`: `status: text('status').notNull()
  .default('scheduled')`, plus a `check('live_classes_status_check', sql`${t.status} in
  ('scheduled', 'cancelled')`)` (same shape as `eval_runs_status_check`). Additive only: existing
  rows get `scheduled` from the default; no backfill script needed.
- Generated migration (see numbering note above) — additive column + check constraint only.
  `live_classes` is pilot-scale (one row per scheduled class), so a plain (not `NOT VALID`) check
  is fine; only use the `NOT VALID` + post-migrate `VALIDATE` pattern (`0009`/`0023`'s precedent,
  `packages/db/src/migrate.ts`'s `POST_MIGRATE_STEPS`) if `db:generate`'s own output or a reviewer
  says the table is big enough to care — it isn't, at this scale.

### Repository (`packages/db/src/repositories/live-classes.ts`)

- **Link: https only, length-capped (11.1a review MEDIUM, 11.1c review LOW).** Rename/redefine the
  URL check so it accepts only `https://…` (currently `http(s)`); add `LIVE_CLASS_LINK_MAX_LENGTH
  = 2048` (same cap the studio route already enforces in front of this) and `.max(...)` it in the
  link schema before the regex/`z.url` check. Apply to both `create`'s and the new `update`'s link
  field — factor the shared `title`/`link`/`startsAt` field schemas out of `CreateInputSchema` so
  `UpdateInputSchema` (below) doesn't duplicate the regex and length cap.
- **A LIMIT on both list reads (11.1a review LOW).** Add `LIVE_CLASS_LIST_MAX` (same precedent as
  `RECORDING_LIST_MAX` = 500) and `.limit(LIVE_CLASS_LIST_MAX)` to `listForTeacher` and
  `listUpcomingForStudent`.
- **One row per class, not one per qualifying subscription (11.1a review LOW).** Today's join
  (`liveClasses` → `subscriptions` → `packageVersions`) returns the same class twice when a
  student holds two live subscriptions whose packages both overlap the class's `packageIds`.
  Fix with `.selectDistinct(...)` in place of `.select(...)` on the four selected columns (id,
  title, link, startsAt are identical across the duplicate join rows, so `DISTINCT` collapses
  them cleanly), or rewrite the subscription/package-version join as a correlated `EXISTS` if you
  find that cleaner — pick one and say which, and why, in the handoff.
- **`status` on both row shapes.** Add `status: 'scheduled' | 'cancelled'` to `TeacherLiveClassRow`
  and to `UpcomingLiveClass` (export a shared `LiveClassStatus` type), selected and returned
  alongside the existing columns in `listForTeacher` and `listUpcomingForStudent`. Do **not**
  filter `listUpcomingForStudent`'s `WHERE` on status — a cancelled class with a future `startsAt`
  still belongs in the "upcoming" list (see the decision above); it only carries `status:
  'cancelled'` for the caller to act on.
- **New: `update(scope: TeacherScope, id: string, input: { title, link, startsAt })`.** Validates
  `id` (`IdSchema`) and `input` (the shared field schemas above, strict, no `packageIds`). In one
  transaction: locks the row `FOR UPDATE` by `id` AND `teacherId` (another teacher's or a missing
  id is `not_found`, before any further check). If the row's current `status` is `'cancelled'`,
  or its current `startsAt` is not in the future ("only before it starts" — the row's own
  `startsAt`, read inside the same lock, not a value the caller supplies), throw `invalid`.
  Otherwise update `title`/`link`/`startsAt` and write one `live_class.update` audit row — mirror
  `create`'s own choice to leave `link` out of the audit payload (`before: { title, startsAt }`,
  `after: { title, startsAt }` with the old/new values). Returns `{ updated: true }`.
- **New: `cancel(scope: TeacherScope, id: string)`.** Same lock. A missing/another-teacher's id is
  `not_found`. Already `'cancelled'` is an idempotent no-op: return `{ cancelled: false }`,
  nothing written, no audit row (a double-click Cancel must not error). `'scheduled'` but
  `startsAt` no longer in the future is `invalid` (the class already happened; this is not the
  no-op case). Otherwise set `status = 'cancelled'`, write one `live_class.cancel` audit row
  (`before: { status: 'scheduled' }`, `after: { status: 'cancelled' }`), return `{ cancelled:
  true }`.
- Update the file's and `packages/db/src/repositories/README.md`'s "Live classes (task 11.1a)"
  prose for the https-only link, the two new methods, the `status` field, and the per-call LIMIT.

### Tests (Phase A)

- `create`: the existing `CASES['liveClasses.create']` mismatches gain a `link: 'http://…'` case
  (now `invalid`, not accepted) alongside the existing `ftp://` one, and a case at
  `LIVE_CLASS_LINK_MAX_LENGTH + 1` characters (`invalid`); a link at exactly
  `LIVE_CLASS_LINK_MAX_LENGTH` is accepted (pairs with the route-level boundary test in Phase B).
- New `CASES['liveClasses.update']` and `CASES['liveClasses.cancel']` entries, write-scoped like
  `liveClasses.create`. **Important:** each attempt must create its own fresh class first and act
  on that — never mutate the shared per-teacher fixture class other `CASES` entries
  (`listForTeacher`, `listUpcomingForStudent`, `classQuestions.submit`) already depend on. Cover:
  another teacher's id (`not_found`); a non-https or over-length link, or a past `startsAt`, on
  update (`invalid`); editing or cancelling a class whose `startsAt` has already passed
  (`invalid`); cancelling twice (`{ cancelled: false }` the second time, nothing changed, no
  second audit row); a successful update/cancel visible in a fresh `listForTeacher` call.
- `listUpcomingForStudent`'s existing dedicated acceptance test gains: a student with two live
  subscriptions whose packages both carry one class sees it once, not twice; a cancelled class
  with a future `startsAt` still appears, with `status: 'cancelled'`.
- `test/scope.test.ts` needs no edit (its sweep is generic, per the README; confirm it still
  passes with the two new methods).

### Exit check (Phase A)

`source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
green, including the int tests against a disposable Postgres (same compose-up/down dance as
11.1a's handoff). `git diff --stat` shows exactly one new migration file, its matching
`meta/*_snapshot.json`, and `meta/_journal.json`'s own one-line addition.

## Phase B — apps/web: teacher studio edit/cancel UI (depends on Phase A merged)

`/api/studio/**`'s existing `ROUTE_POLICY` row allows `GET, POST, PUT, DELETE` for teachers (no
`PATCH`) — use `PUT` for edit and `DELETE` for cancel (soft; it never deletes the row) so this
phase needs **no edit to `apps/web/src/auth/**`**.

Files:
- `apps/web/app/api/studio/live-classes/[id]/route.ts` (new) — `PUT`/`DELETE`,
  `withRole(['teacher'], …)`, same shape as the sibling `route.ts`.
- `apps/web/src/studio/liveClasses/routes.ts` (edit) — widen `Work` to also receive `ctx:
  RoleContext` (mirror `apps/web/src/studio/routes.ts`'s `docId(ctx)` / `ParamsSchema` pattern
  exactly, reusing this file's existing `Id` regex for the path param); add `update` and `cancel`
  `Work`s and a shared `UpdateSchema` (title/link/startsAt, same https-and-length checks already
  in front of `CreateSchema` — factor them out once, use from both). Map the repository's
  `not_found`/`invalid` the same way `create`/`list` already do (the existing `run()` wrapper is
  generic over the error kind; no new branch needed there).
- `apps/web/src/studio/liveClasses/index.ts` (edit) — export `update`/`cancel` from
  `createLiveClassesHandlers`'s return.
- `apps/web/src/studio/liveClasses/runtime.ts` (edit) — wire the two new repo methods through.
- `apps/web/src/studio/liveClasses/updateLiveClassAction.ts` (new) — client call, `PUT`, same
  settle-never-reject shape as `scheduleLiveClassAction.ts`.
- `apps/web/src/studio/liveClasses/cancelLiveClassAction.ts` (new) — client call, `DELETE`, same
  shape.
- `apps/web/app/teacher/live-classes/LiveClassesView.tsx` (edit): for a class whose `status` is
  `'scheduled'` and that hasn't started (`hasStarted(c)` already exists in the file): an Edit
  control that opens an inline form (title/link/`datetime-local` start, pre-filled, Save/Cancel-
  edit) calling `updateLiveClassAction`, and a Cancel button that calls `window.confirm(...)`
  first (mirror `ResetMemoryButton.tsx`) then `cancelLiveClassAction`. A cancelled class shows a
  "Cancelled" label instead of either control. **11.1b review LOW fix:** the existing join `<a>`
  (currently just `{t('joinLink')}` text, identical on every row) gets `aria-label={t('joinLinkLabel',
  { title: c.title })}` so a screen-reader user can tell rows apart; keep the existing visible text.
  Every fetch keeps the lesson from `docs/lessons.md` ("a studio page that trusts a 200 response
  gets stuck"): try/catch the body read, try/catch/finally around each row's own busy flag (not
  the whole-page `busy`, so editing one class doesn't disable Save on another).
- `apps/web/messages/en.json` (edit) — new keys inside the existing `liveClassesStudio` namespace
  only (edit/cancel labels, the confirm text, the cancelled label, `joinLinkLabel`). Append; do not
  touch any other namespace (Phase C also edits this file, under `home` only — no overlap).
- Tests (edit/extend the existing files, same shape as their own current cases):
  `apps/web/src/studio/liveClasses/routes.test.ts` — PUT/DELETE success; another teacher's id is
  404 on both; non-https/over-length link or a past `startsAt` on PUT is 400; editing/cancelling
  an already-started or already-cancelled class is 400/handled per the repo's `invalid`/no-op; a
  link at exactly `LIVE_CLASS_LINK_MAX_LENGTH` characters succeeds on both POST and PUT (**the
  11.1b review LOW fix** — today's `routes.test.ts` only tests well over the cap). `LiveClassesView.
  test.tsx` — Edit flow updates the row in place; Cancel flow (confirm accepted vs. declined) and
  the resulting "Cancelled" label with no Edit/Cancel shown; the join link's `aria-label` includes
  the class title; a failed PUT/DELETE shows an error and re-enables that row's own controls (not
  stuck disabled).

### Exit check (Phase B)

`source ~/.nvm/nvm.sh && corepack pnpm turbo run turbo run typecheck lint test --filter=@edmate/web...`
green; `git diff --stat` touches no file under `apps/web/src/auth/**` and no `en.json` key outside
`liveClassesStudio`; `apps/web/src/auth/route-coverage.test.ts` (unedited) still passes.

## Phase C — apps/web: student `/home` shows a cancelled class as Cancelled (depends on Phase A; can run in parallel with Phase B)

Files:
- `apps/web/app/home/view.tsx` (edit) — inside the existing "Upcoming live classes" block: when
  `liveClass.status === 'cancelled'`, show `t('liveClasses.cancelled')` instead of the window
  label, and render neither the join `<a>` nor `<AskQuestionForm>` for that class. A `'scheduled'`
  class is unchanged from today.
- `apps/web/app/home/page.tsx` — likely no change (the repo already returns `status` on every row
  once Phase A merges, and `homeLiveClasses` just passes rows through); touch it only if the
  types don't flow through cleanly as-is.
- `apps/web/messages/en.json` (edit) — one new key, `home.liveClasses.cancelled`. Append inside the
  existing `home` namespace only.
- `apps/web/app/home/view.test.tsx` (edit) — a cancelled class (future `startsAt`) shows the
  Cancelled label, no join link, no ask-a-question form; a scheduled class is unaffected (existing
  cases for `later`/`reminder_24h`/`reminder_1h`/`starting_soon` and the join-link
  `target`/`rel` check stay green, unchanged).
- `apps/web/app/home/page.test.tsx` — only if `page.tsx` needed an edit above.

### Exit check (Phase C)

`source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`
green; the existing `chats`/`startable`/`paused` and non-cancelled live-class cases in
`page.test.tsx`/`view.test.tsx` are unchanged.

## Files out of bounds

- `packages/db/src/identity/**`, `apps/web/src/auth/**` — no change (PUT/DELETE already covered).
- `packages/contracts/**` — no change; `LiveClassStatus` etc. stay local to `packages/db`.
- `packages/queue/**`, `apps/worker/**` — no change; email/SMS reminders are out of scope (B-45).
- `packages/db/src/repositories/class-questions.ts`, `apps/web/src/studio/classQuestions*` (11.2a)
  — not touched; the cancelled-class/question-queue interaction is a follow-up, not this task.
- `apps/web/app/teacher/view.tsx`, any shared nav file — no change.
- `docs/lessons.md` — do not add an entry; it is at its cap (see decision above).

## Risky paths touched

- Phase A: `packages/db/src/repositories/live-classes.ts`, `packages/db/src/repositories/
  README.md` match `.claude/skills/merge-gate/risk-paths.txt`'s `packages/db/src/repositories/**`
  group → **security-reviewer required**. Recommend also `database-reviewer` (new migration),
  `code-reviewer` and `typescript-reviewer`, matching 11.1a's own precedent. Phase A's handoff
  needs a `risk: high` decision entry.
- Phases B and C: none (checked against risk-paths.txt — no `apps/web/src/auth/**`,
  `packages/contracts/**`, `.claude/**`, `.github/**`, `.githooks/**`, or payments/webhook path is
  touched; `/api/studio/**`'s existing policy row already allows `PUT`/`DELETE` for teachers).

## Open questions for the lead

None blocking. One judgment call worth a sentence in the handoff either way: cancelling an
already-cancelled class is treated as a no-op (`{ cancelled: false }`, not an error) rather than
`invalid`, so a double-click or a slow network retry on Cancel never shows an error toast.

## Budget

Budget: 190 tool calls (3 phases: A packages/db ~85, B apps/web studio ~75, C apps/web home ~30)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test/`db:generate` only; Phase
A's disposable-Postgres compose up/down for int tests, same as 11.1a's handoff — never touch the
running `edmate-*` stack).

## Exit conditions

- Phase A: `Status: DONE` when `@edmate/db` is green (including int tests), the migration/snapshot/
  journal are consistent with `main` at push time, and every Phase A test above passes; `Status:
  PARTIAL` past ~85 tool calls or if the migration-number check fails twice in a row (merge main,
  regenerate, and it still collides — stop and hand back).
- Phase B: `Status: DONE` when the new route + view controls are green and Phase B tests pass, with
  no edit outside its file list (especially `apps/web/src/auth/**`); `Status: PARTIAL` past ~75
  tool calls or if `PUT`/`DELETE` turn out not to be enough and a policy edit seems needed (stop
  and say so rather than editing `apps/web/src/auth/**`).
- Phase C: `Status: DONE` when `/home`'s existing tests plus the new cancelled-class cases pass and
  the diff stays inside `view.tsx`/`page.tsx`/`en.json`/their tests; `Status: PARTIAL` past ~30
  tool calls.
