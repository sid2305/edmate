# 11.1b handoff — teacher studio: live classes, schedule and list

## Summary

Phase B of task 11.1: `/teacher/live-classes`, a direct-URL studio page (no nav link, same
precedent as 8.5/8.9/9.3) where a teacher schedules a live class with a title, an https-only
join link, a start time and 1..20 of their own packages, and sees their own scheduled classes,
soonest first. Built on 11.1a's merged `liveClasses` repository (`create`, `listForTeacher`);
`packages/db` was not touched.

The teacher id always comes from the session (`ctx.principal.userId` / `requireRole`'s
`Principal`), never the request body. The route validates `link` as `https://` only (rejecting
`http://`) and caps it at 2048 characters before the repository's own stricter URL/zod checks
run; a package id that is not the teacher's own surfaces as the repository's `not_found` (404),
nothing written.

## Files

- `apps/web/app/api/studio/live-classes/route.ts` (new) — `GET`/`POST`, `withRole(['teacher'],
  …)`. No edit to `apps/web/src/auth/**`; `/api/studio/**`'s existing catch-all policy covers it.
- `apps/web/src/studio/liveClasses/routes.ts` (new) — the two handlers (`LiveClassesBackend`
  interface naming only `create`/`listForTeacher`), on the `questions/` folder's own pattern.
- `apps/web/src/studio/liveClasses/runtime.ts` (new) — real wiring (`serverDatabase().repos`).
- `apps/web/src/studio/liveClasses/index.ts` (new) — barrel (`liveClassesHandlers`).
- `apps/web/src/studio/liveClasses/loadLiveClasses.ts` (new) — the page's server-side load
  (classes + the teacher's packages, for the picker), same precedent as 8.9's `loadQuestions`.
- `apps/web/src/studio/liveClasses/scheduleLiveClassAction.ts` (new) — the client's `POST` call;
  never rejects, settles to a fixed error code on any network/body failure.
- `apps/web/app/teacher/live-classes/page.tsx` (new) — the guard, then `loadLiveClasses`, then
  `LiveClassesView`. Does not edit `apps/web/app/teacher/view.tsx`.
- `apps/web/app/teacher/live-classes/LiveClassesView.tsx` (new) — the form (title, link,
  `datetime-local` start, one checkbox per package) and the list. The body read is wrapped in
  try/catch (inside `scheduleLiveClassAction`) and the whole submit is wrapped in
  try/catch/finally around the busy flag (lessons: "a studio page that trusts a 200 response gets
  stuck").
- `apps/web/messages/en.json` (edit) — one new top-level key, `liveClassesStudio` (teacher
  strings only), appended at the end of the file. No other namespace touched.
- Tests: `apps/web/src/studio/liveClasses/routes.test.ts`,
  `apps/web/app/teacher/live-classes/page.test.tsx`,
  `apps/web/app/teacher/live-classes/LiveClassesView.test.tsx`.

## Tests

- `routes.test.ts`: GET returns only the signed-in teacher's own classes; POST schedules with the
  session's teacher id (never the body); a non-`https://` link, a link over 2048 characters, a
  malformed body, an unknown field (strict) and an over-cap body are each 400/413 with nothing
  written; a repository `not_found` (a package id that isn't the teacher's own) is 404, a
  repository `invalid` is 400; an unknown error is a logged 500 with the error name only (no
  title/link text in the log); a backend that can't be built is 503.
- `page.test.tsx`: the guard runs before any database read; on success, reads only that teacher's
  classes and packages and passes them to the view; a refused guard reads nothing.
- `LiveClassesView.test.tsx`: empty state; an existing class renders with its join link
  (`target="_blank"`, `rel="noopener noreferrer"`); a full submit calls `scheduleLiveClass` with
  the right fields, adds the new class to the list and clears the form; a missing field is a
  client-side validation error with nothing sent; a thrown/malformed reply and a `{ ok: false }`
  reply both show an error and re-enable the Schedule button (not stuck disabled).
- Unedited `apps/web/src/auth/route-coverage.test.ts` still passes (ran as part of the full
  `@edmate/web` suite below) — confirms no policy change was needed.

## How it is shown

Sign in as a teacher, open `/teacher/live-classes` directly (no nav link yet). Fill in a title,
an `https://` join link, a start time and tick at least one package, then Schedule — the class
appears in the list below at once, with its join link opening in a new tab.

## Gate

`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — 34/34 tasks successful
(includes `@edmate/contracts`, `@edmate/db`, `@edmate/gateway`, `@edmate/harness`,
`@edmate/ingest`, `@edmate/content` as dependencies; `@edmate/db`'s integration tests skip with no
local Postgres, same as every other builder run in this repo).

`python3 .githooks/secret-scan.py --all` — clean.

`git diff --stat` against `origin/m11/11.1b-studio-live-classes` for `apps/web/src/auth/**` and
`apps/web/app/teacher/view.tsx` — empty (no change to either).

## Decisions

### 22 Oct 2026 · 11.1b A route-level https-and-length check sits in front of the repository's own URL validation · decided by builder · risk: low
- Decided: `apps/web/src/studio/liveClasses/routes.ts`'s `CreateSchema` accepts any non-empty
  `link` string up to 2048 characters, then a separate check rejects anything not starting
  `https://`, before the input reaches `liveClassesRepo.create` (which does its own stricter
  `http(s)` + URL-shape zod check). This gives a route-level `validation` 400 for a non-https or
  over-length link without needing to duplicate the repository's full URL regex at the route.
- Why: the lead note asked for an explicit route-level check ("https only, at most 2048
  characters") in addition to whatever the repository already enforces; the repository's own
  schema already rejects `http://` (its `HTTP_URL` regex matches both schemes, then
  `z.url({ protocol: /^https?$/ })` would still accept `http`), so the route needed its own
  narrower gate to enforce https-only ahead of the write.
- risk: low — additive validation only, no schema or contracts change.

### 22 Oct 2026 · 11.1b A standalone `liveClasses/` composition root, mirroring `studio/questions/` · decided by builder · risk: low
- Decided: built `routes.ts`/`runtime.ts`/`index.ts` as their own folder
  (`apps/web/src/studio/liveClasses/`), not an extension of the shared `studio/{routes,
  runtime}.ts` files.
- Why: the plan names this precedent explicitly ("on the `questions`/`packages` pattern"); it
  also keeps this task's diff from touching files other in-flight studio work may be editing.
- risk: low — new files only.

## Left to do

None for this phase. Follow-ups already tracked in the 11.1 plan (not this task): edit/cancel a
scheduled class (11.1d, M13); a real email/SMS reminder once a vendor decision widens
`apps/worker`'s access to a student's email.

Status: DONE

Tool calls used: 62 (harness count; the builder reported 34)
