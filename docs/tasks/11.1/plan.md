# 11.1 Schedule live classes with an external link, attach to packages, invites and reminders (24 h and 1 h)

## Acceptance (verbatim)

- Build plan 11.1: "Schedule live classes with an external link, attach to packages, invites and
  reminders (24 h and 1 h)." *Accept:* **only entitled students receive the link.**
- PRD T9 (teacher): "Schedule live classes, attach them to packages, collect questions in
  advance." *Accept:* "Subscribers on that package get the invite and a reminder; MVP may use an
  external video link."
- PRD S9 (student): "Join live classes and send questions in advance." *Accept:* "Reminder 24
  hours and 1 hour before."
- Question-queue collection (11.2) and recording ingestion (11.4) are separate tasks; out of
  bounds here.

## How it will be shown

1. A teacher opens `/teacher/live-classes` (direct URL, no nav link yet — same precedent as
   8.5/8.9/9.3), schedules a class with a title, an external Meet/Zoom link and a start time, and
   attaches it to one or more of their own packages. The class appears in their list at once.
2. Signing in as a student with a live (`trial`/`active`) subscription to an attached package,
   `/home` shows a new "Upcoming live classes" section: title, start time, the join link, and a
   label that changes as the start time nears (`reminder_24h` inside 24 h, `reminder_1h` inside
   1 h, `starting_soon` inside 5 min — exact cut points are the builder's to pick inside those
   windows). A student with no live subscription to any attached package, or a subscription
   that is `paused`/`past_due`/`ended`, never sees the class. Scheduling a class with `startsAt` a
   few minutes out makes the nearest label visible immediately in a demo, with no clock mocking.
3. A second teacher, or a student of a different package, never sees the class (repo-level test
   plus a manual check in the same demo).

## Decision: in-app only for this task; no email/SMS send (recommend accepting, not blocking)

`packages/db/src/identity/README.md` is explicit: *"Only `apps/web/src/auth/**` should use
`identity`"* — that store is the only path to a user's email, and repository rule 9 forbids any
repository from selecting from `users` at all. `apps/worker` (where a scheduled "send the 24h/1h
reminder" job would have to live) cannot reach a student's email under either rule today. The
project's own precedent for "a notification to a student" is in-app only pending a vendor
decision: 5.10's `notifications` table is in-app only ("email and push wait, decision B-25"), and
4.3's safety-alert notifier is still log-only ("real delivery waits for a vendor decision") even
though B-25 picked Resend for *production* email generally.

Given that, this plan builds "invite" and "24h/1h reminder" as a **live, pull-based view**: the
student's own upcoming, entitled classes, with a window label computed from `now` vs `startsAt`
every time `/home` is loaded — not a background job, not a queue, not an email. This needs no new
migration, no BullMQ worker, and no identity-boundary change, which keeps this task small and
removes any change to `packages/db/src/identity/**` or `apps/web/src/auth/**` entirely.

The real gap this leaves: a student who never opens the app in the hour before class gets no
nudge. Recommended fix, **not** part of this task: once a vendor decision widens background-job
access to a student's email (the same gap 4.3's `AlertNotifier` already has), add a worker job
that sends an actual email at 24 h and 1 h before `startsAt`, reusing this task's
`listUpcomingForStudent` query. I'd log this as a tracked follow-up (`11.1a` or similar) rather
than block 11.1 on it.

## Phase A — packages/db: the `live_classes` repository

`live_classes` and `class_questions` already exist (migration `0001_data_model.sql`,
`packages/db/src/schema/operations.ts` lines 56-87) with exactly the columns this task needs
(`teacherId`, `packageIds text[]`, `title`, `startsAt`, `link`). **No schema change, no new
migration.**

Files:
- `packages/db/src/repositories/live-classes.ts` (new). `liveClassesRepo(db)`:
  - `create(scope: TeacherScope, input: { title, link, startsAt, packageIds })`: validates `link`
    as an `http(s)` URL, `startsAt` as a future ISO timestamp, `packageIds` as 1..20 ids; checks
    every id is one of the scope's own packages before writing (else `not_found`, nothing
    written — same shape as `outline.replaceOutline`'s module check). Writes one
    `live_class.schedule` audit row (`after: { title, startsAt, packageIds }`; include if the
    phase budget allows — every other studio mutation in this folder does one, see
    README.md "Agent bootstrap and packages").
  - `listForTeacher(scope: TeacherScope)`: the scope's own classes, soonest first.
  - `listUpcomingForStudent(scope: StudentScope, options?: { now?: string })`: the scope's own
    teacher's classes with `startsAt > now` whose `packageIds` overlap the *base* package id of
    the scope's own live subscription (`findLive`'s join: `subscriptions` → `packageVersions` →
    `packageVersions.packageId`), where the subscription's `status` is `trial` or `active` only
    (see "Open questions" below) — never `paused`, `past_due` or `ended`. Returns `{ id, title,
    link, startsAt }[]`, soonest first; the window label (`reminder_24h`/`reminder_1h`/
    `starting_soon`/`later`) is computed from `startsAt` vs `now` either here or in Phase C's
    loader — pick one place and say so in the handoff.
- `packages/db/src/repositories/index.ts` (edit): one import line, one
  `liveClasses: guardAll('liveClasses', liveClassesRepo(db))` line. Append only; do not reorder
  existing entries.
- `packages/db/src/repositories/README.md` (edit): a short "Live classes (task 11.1)" section
  following the file's existing style (see "Adding a method").
- Whatever the README's "Adding a method" section requires: a `CASES` entry per new method in
  `packages/db/test/repositories.int.test.ts`, and coverage in `packages/db/test/scope.test.ts`'s
  bad-scope sweep. Read that section again before writing the methods — it changes how the
  methods must be shaped (scope first, scope validated before any SQL), not just how they are
  tested.

### Tests (Phase A)

- `create` rejects a package id that is not the scope's own (`not_found`, nothing written), a
  non-`http(s)` link, and a `startsAt` in the past (`invalid`).
- `listForTeacher` returns another teacher's classes as `[]` when called with that teacher's own
  scope only — i.e. two teachers' classes never mix.
- `listUpcomingForStudent`: a student with an `active` subscription to an attached package sees
  the class; a student with no subscription, a subscription to a package *not* attached, a
  `paused` subscription, a `past_due` subscription, and an `ended` subscription all see nothing;
  a class whose `startsAt` has already passed never appears, however entitled the student is.
- The required `CASES`/`scope.test.ts` coverage from the README passes (bad scope on every new
  method throws `RepositoryError('scope')` before any SQL).

### Exit check (Phase A)

`source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
green. No migration file is added (confirm the schema truly needs no change before writing code).

## Phase B — apps/web: teacher studio (schedule + list)

Depends on Phase A merged. Can run in parallel with Phase C (different files, same precedent as
other two-builder-slot work).

Files (all new):
- `apps/web/app/api/studio/live-classes/route.ts` — `GET`/`POST`, `withRole(['teacher'], ...)`.
  `/api/studio/**` is already covered by `ROUTE_POLICY`'s catch-all
  (`apps/web/src/auth/policy.ts` line 53) — no edit to any `apps/web/src/auth/**` file.
- `apps/web/src/studio/liveClasses/routes.ts` — the two handlers, on the `questions`/`packages`
  pattern (`readJson`, `errorBody`, a `LiveClassesBackend` interface naming only the repo methods
  it uses, per `apps/web/app/api/studio/packages/route.ts`'s own comment: the teacher id always
  comes from the session, never the body).
- `apps/web/src/studio/liveClasses/runtime.ts` — real wiring (`serverDatabase().repos`).
- `apps/web/src/studio/liveClasses/index.ts` — barrel (`liveClassesHandlers`), mirroring
  `studio/questions/index.ts`.
- `apps/web/app/teacher/live-classes/page.tsx` — loads the teacher's packages
  (`repos.packages.listForTeacher`) and existing classes (`repos.liveClasses.listForTeacher`);
  no nav link added (precedent: `apps/web/app/teacher/questions/page.tsx`'s own comment); do not
  edit `apps/web/app/teacher/view.tsx`.
- `apps/web/app/teacher/live-classes/LiveClassesView.tsx` — a form (title, link, a
  `datetime-local` start input, one checkbox per package) and a list of scheduled classes.
  Every fetch follows the lesson in `docs/lessons.md` "A studio page that trusts a 200 response
  gets stuck": catch the body read, and use try/catch/finally around the busy flag.
- `apps/web/messages/en.json` (edit): one new top-level key, e.g. `liveClassesStudio` (teacher
  strings only). Append at the end of the file; do not touch any other namespace, to keep this
  low-conflict against the other studio work in flight.
- Tests: `routes.test.ts`, `page.test.tsx` (or `page.test.ts` + a view test), `LiveClassesView.
  test.tsx`, following the sibling files' own test shapes 1:1.

### Tests (Phase B)

- `POST` rejects a package id that is not the teacher's own, a non-`http(s)` link and a past
  `startsAt`, each with the right error code; a teacher cannot see or edit another teacher's
  classes through this route.
- `GET` returns the teacher's own classes only.
- The view: a 200 with a malformed body does not leave the "scheduling…" button stuck disabled
  (the lesson above); a non-200 shows an error and re-enables the form.
- Route coverage: `apps/web/src/auth/route-coverage.test.ts` (unedited) still passes, confirming
  the new route needed no policy change.

### Exit check (Phase B)

`source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=apps-web...` (or the
web app's actual filter name) green; `git diff --stat` touches no file under
`apps/web/src/auth/**`.

## Phase C — apps/web: student home (upcoming live classes)

Depends on Phase A merged. Can run in parallel with Phase B.

Files (edits to two already-shared, actively-changing files — keep the diff to additive props and
one new block each):
- `apps/web/app/home/page.tsx` (edit): load `repos.liveClasses.listUpcomingForStudent(scope)`
  (via the same `open()`/`principal` pattern already used for `chats`/`startable`) and pass the
  result as a new `liveClasses` prop to `HomeView`.
- `apps/web/app/home/view.tsx` (edit): a third conditional block, "Upcoming live classes" —
  title, start time, the join link (`<a href={link}>`, `rel="noopener noreferrer"`,
  `target="_blank"` since it leaves the app), and the window label.
- `apps/web/messages/en.json` (edit): new keys inside the existing `home` namespace only
  (`home.liveClasses.*`) — do not touch `shell`, `teacher`, or any other namespace.
- Tests: `apps/web/app/home/page.test.tsx` and `apps/web/app/home/view.test.tsx` (edit, add
  cases), following their own existing shape for the `chats`/`startable` props.

### Tests (Phase C)

- A student with an entitled upcoming class sees it on `/home`; a student with none sees the
  existing placeholder, unchanged from before this task.
- The window label: a class far out shows `later`/no label; one inside 24 h shows the 24 h label;
  one inside 1 h shows the 1 h label — three fixed `now`/`startsAt` pairs passed to `HomeView`
  directly (pure component, no clock mocking needed, same as the file's existing tests).
- A link always opens in a new tab with `rel="noopener noreferrer"`.

### Exit check (Phase C)

`source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=apps-web...` green;
`apps/web/app/home/*.test.tsx`'s existing `chats`/`startable` cases are unchanged (a regression
in the existing home page is not an acceptable side effect of this task).

## Files out of bounds

- `packages/db/src/identity/**`, `apps/web/src/auth/**` — no change (see the decision above).
- `packages/contracts/**` — no change; `LiveClassRow` etc. stay local interfaces in
  `packages/db`, the same pattern as `subscriptions.ts`'s `LiveSubscription`. No ADR needed.
- `packages/queue/**`, `apps/worker/**` — no change; there is no background job in this task.
- `apps/web/app/teacher/view.tsx`, any shared nav file — no change (precedent: new studio pages
  are reachable by direct URL until a later task adds the nav link).
- 11.2 (question queue), 11.3 (weekly insights), 11.4 (recording ingestion) — not this task.

## Risky paths touched

- `packages/db/src/repositories/**` (Phase A: `live-classes.ts`, `index.ts`) — matches
  `.claude/skills/merge-gate/risk-paths.txt`'s `# reviewers: security-reviewer` group. Recommend
  also `database-reviewer`, `code-reviewer` and `typescript-reviewer`, matching recent precedent
  for this folder (e.g. 8.5a, 8.4a, 8.6b in the decision log). Phase A's handoff needs a
  `risk: high` decision entry.
- Phases B and C: none (checked against risk-paths.txt — no `apps/web/src/auth/**`,
  `packages/contracts/**`, `.claude/**`, `.github/**`, `.githooks/**`, or payments/webhook path
  is touched; `/api/studio/**`'s existing catch-all policy covers the new route with no edit).

## Open questions for the lead

1. **In-app only vs. a real email/SMS reminder.** Recommendation above: ship in-app/pull-based
   now; track real delivery as a follow-up once a vendor decision widens
   `packages/db/src/identity/**` access for `apps/worker` (shared gap with 4.3's `AlertNotifier`).
   Not blocking — I'd proceed with in-app unless told otherwise.
2. **Which subscription statuses count as "entitled" for the reminder.** Recommendation: `trial`
   and `active` only, not `paused` or `past_due` — a paused/past_due student can't use the agent
   today, so reminding them to join a live class is likely wrong. Low stakes either way; flagging
   because the accept criterion hinges on exactly this definition.
3. **Edit/cancel a scheduled class.** Not in the build plan's accept line; this plan ships
   create + list only. Recommendation: fine for MVP; add edit/cancel as a follow-up if a teacher
   needs it before the pilot.

## Lead answers (22 Oct 2026)
- Q1: accepted for now: in-app only, with no email or SMS. Asked the human as B-45; the build goes ahead on (a). Phase A's handoff logs this as a lead decision, risk: medium.
- Q2: accepted: only trial and active subscriptions count as entitled.
- Q3: accepted: create and list only; edit and cancel are a follow-up (11.1d, M13).
- Build order: Phase A after 9.3c merges (both edit packages/db repositories; A runs `git merge origin/main` before pushing). B and C can then run in parallel; both merge main before pushing (en.json).

## Budget

Budget: 230 tool calls (3 phases: A packages/db ~65, B apps/web studio ~95, C apps/web home ~70)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test only — no migration
generation is expected; if a builder finds the schema does need a change, stop and say so rather
than improvising one).

## Exit conditions

- Phase A: `Status: DONE` when `@edmate/db` is green and every Phase A test above passes; `Status:
  PARTIAL` past ~70 tool calls or if the schema turns out to need a change (stop and hand back).
- Phase B: `Status: DONE` when the studio route + page are green and Phase B tests pass, with no
  edit outside its file list; `Status: PARTIAL` past ~100 tool calls or if the home page or auth
  policy turns out to need a change.
- Phase C: `Status: DONE` when `/home`'s existing tests plus the new ones are green and the diff
  touches only the four listed files; `Status: PARTIAL` past ~75 tool calls or if anything beyond
  an additive prop/block is needed in `page.tsx`/`view.tsx`.
