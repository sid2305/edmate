**Status:** DONE

## Phase A

Built `packages/db` only, tests first.

- `packages/db/src/repositories/teacher-profiles.ts`: added `findBySlugForStaff(by, slug)` —
  staff-only, status-independent lookup by slug (no `verificationStatus` filter, unlike
  `listPendingForStaff`). Parses both `by` (`IdSchema`) and `slug` (`Slug`) before any SQL, then
  a read-only role check (`scope` if `by` is not staff), then selects + joins `users`, returning
  `TeacherVerificationQueueRow | null`. No change to `setVerification`, `takeDownAgentInTx` or any
  lock order.
- `packages/db/src/repositories/subscriptions.ts`: added `listUnavailableForStudent(studentId)`
  right after `listLiveForStudent` — same bare-id scope exception and `IdSchema.safeParse` guard,
  same four-table join, but the `agents` join uses `ne(agents.status, 'live')` instead of
  `eq(..., 'live')`; `where` keeps `ne(subscriptions.status, 'ended')`. Deliberately a separate
  method, not a flag on `listLiveForStudent` (which also feeds the live-classes question route,
  out of bounds here, unchanged).
- Tests (written first): `packages/db/test/teacher-profiles.test.ts` (malformed `by`/`slug` is
  `invalid` before any SQL, no DB touch — `noDb` proxy); `packages/db/test/teacher-profiles.int.test.ts`
  (new `describe('findBySlugForStaff ...')`: finds pending/verified/rejected teachers by slug,
  unknown slug is `null`, non-staff `by` is `scope`, malformed `by` is `invalid`, and the
  **acceptance case** — a verified teacher with a live agent found by slug, then safety-rejected
  exactly as 9.3e's existing pending-fixture case: agent `suspended`, one takedown row written);
  `packages/db/test/scope.test.ts` (exclusion comments for both new bare-id methods in the generic
  grid, plus each method's own "rejects a malformed id before any SQL" test, mirroring
  `listLiveForStudent`'s precedent); `packages/db/test/repositories.int.test.ts` (one grid case
  each: `teacherProfiles.findBySlugForStaff` — staff/non-staff split, finds each teacher by slug,
  unknown slug is `null`; `subscriptions.listUnavailableForStudent` — suspends teacher A's agent
  for the check's duration (restored in `finally`), own-rows-only across students, malformed-id
  grid).

### Gate

`corepack pnpm turbo run typecheck lint test --filter=@edmate/db --force`:
- typecheck: pass. lint: pass.
- test: **75 test files passed, 1600 tests passed, 4 skipped** (pre-existing, unrelated — HNSW and
  video-ingest suites that skip without extra services). No test file skipped for this change; no
  test was skipped that exercises the new methods.
- Coverage: `src/repositories/**` 100% statements/functions/lines, 98.42% branches (threshold
  90%, met); global 99.85% statements / 98.16% branches / 99.87% functions / 99.86% lines
  (thresholds 80%, met).

`python3 .githooks/secret-scan.py --all`: clean (no output).

## Phase B

Built `apps/web`'s staff console reaching a verified (or already-rejected) teacher, tests first.

- `apps/web/app/api/staff/verifications/handlers.ts`: added a `lookup: Handler` (GET
  `?slug=`). Missing/blank slug is 400 `validation`, before any repo call. Calls
  `teacherProfiles.findBySlugForStaff(ctx.principal.userId, slug)`; `200 {teacher: LookupItem |
  null}`; the same `RepositoryError` → `scope`/`invalid`/`not_found` → 403 mapping as `list`
  (read-only, no `not_found` distinction needed since the repo itself returns `null` for an
  unknown slug). Added `LookupItem` (`QueueItem & {verificationStatus}`) and `toLookupItem`.
  `decide` and `list` are byte-for-byte unchanged.
- `apps/web/app/api/staff/verifications/lookup/route.ts` (new file): `export const GET =
  withRole(['staff'], handlers.lookup)`, same shape as the existing `route.ts`.
- `apps/web/app/staff/client.ts`: `LookupItemSchema`/`LookupItem`, `findTeacherBySlug(slug,
  fetchImpl?)` — same settle-never-reject shape as `loadQueue`/`decide` (a network failure,
  non-2xx, unreadable JSON or wrong shape is a fixed error code; an unknown slug is `{ok: true,
  teacher: null}`, not a failure).
- `apps/web/app/staff/verification-row.tsx`: `VerificationRow` gains an optional
  `currentStatus?: 'pending'|'verified'|'rejected'` prop; when set, a `dt`/`dd` pair ("Current
  status" / the status) renders first in the row's definition list. The pending-queue list
  passes nothing (unchanged rendering).
- `apps/web/app/staff/view.tsx`: a "find a teacher" `<form>` (slug text input + Find button,
  disabled while blank/whitespace-only or busy) above the queue list, own `slug`/`found`/
  `notFound` state; `onFind` follows the same try/catch/finally, reset-on-every-action pattern as
  `onDecide`/`onReload` (lessons: "UI state and server replies: trust neither, reset
  everything"). A found teacher renders through the existing `VerificationRow` (with
  `currentStatus`); its `onDecide` reuses the same `decide` call as the queue — on success it
  clears `found` (instead of filtering a list) and shows the existing `notice`
  (approved/rejected/rejectedSafety), no new notice copy.
- `apps/web/messages/en.json` (`staff`): `lookupLabel`, `lookupPlaceholder`, `lookupButton`,
  `lookupBusy`, `lookupNotFound`, `currentStatusLabel`, `status.pending`/`verified`/`rejected`.
- `apps/web/app/staff/page.tsx`: untouched — the search box is entirely client-side (its own
  `client.ts` calls), so the server page needs no new read.
- Tests (written first): `route.test.ts` (new `lookup` describe: finds pending/verified/rejected
  by slug, unknown slug is `200 {teacher: null}`, missing/blank/whitespace slug is 400 with no
  repo call, non-staff is 403, an unexpected throw is 500 logging only the error name; plus
  guard/ROUTE_POLICY cases and a `lookup/route.ts` exports case); `route.int.test.ts` (one real
  round trip over Postgres: find teacher A — already verified by the preceding "staff approve"
  test — by slug, then POST a safety rejection for that `teacherId`: 200, the audit `after`
  carries `safety: true`; plus signed-out/non-staff 401/403 and an unknown-slug `null` case);
  `client.test.ts` (`findTeacherBySlug`: found/not-found/400-shape/network-failure/non-2xx/
  default-fetch cases, slug URL-encoding); `view.test.tsx` (new describe: type a slug, Find, see
  the row with its current status and Approve/Reject/safety checkbox; safety-ticked Reject sends
  `safety: true`, clears the found row, shows `rejectedSafety`; an unknown slug shows
  `lookupNotFound`; finding again replaces it with a found row; Find disabled while blank; error
  reply and thrown-call cases reset the busy flag; the pending queue itself never shows a
  current-status line; axe clean with a found row and a not-found message visible together).

### Gate

`corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force`:
- typecheck: pass. lint: pass.
- test: **155 test files passed, 2456 tests passed**, 0 skipped, 0 failed.
- Coverage thresholds met (task exits 0 across all 10 web tasks; no threshold failure reported).

`python3 .githooks/secret-scan.py --all`: clean (no output).

## Phase C

Built `apps/web`'s `/home` fix for B-49, tests first. A first attempt at this phase stopped
mid-way (the builder's machine slept); its work-in-progress was already a clean, complete match
for the plan, so this phase reviewed it against the plan item by item and found nothing to
change — it finished by running the gates and writing this section.

- `apps/web/src/chat/liveChats.ts`: `LiveChatDeps.subscriptions` gains
  `listUnavailableForStudent(studentId): Promise<readonly UnavailableChat[]>` (new
  `UnavailableChat = {agentId, teacherId}` type, exported). `homeLinks` calls it alongside
  `listLiveForStudent`, dedupes agent ids via `Set`, and returns a new `unavailable: string[]`
  field on `HomeLinks` (and `EMPTY`). No new try/catch: the existing single catch-and-log-and-
  return-`EMPTY` shape covers the new call too (one extra failure mode for one more read-only
  field is not worth splitting the function's error handling, per the plan).
- `apps/web/app/home/page.tsx`: threads `unavailable` from `homeLinks` into
  `<HomeView unavailable={unavailable} ... />`.
- `apps/web/app/home/view.tsx`: `unavailable?: readonly string[]` prop; when non-empty, one
  paragraph (`t('unavailableLine', {count: unavailable.length})`), placed after the existing
  chats/startable/paused block so it still shows alongside both the existing-chat case and the
  empty-state placeholder.
- `apps/web/messages/en.json` (`home`): `unavailableLine` ICU plural
  (`{count, plural, one {...} other {...}}`), same syntax `next-intl` already uses for
  `liveClasses` plurals in this file.
- Tests (written first): `apps/web/src/chat/liveChats.test.ts` (new `describe('unavailable ...')`:
  a suspended agent's subscription appears in `unavailable`, not `chats`; a `draft` agent too;
  dedupes repeated agent ids; a different student sees only their own rows; the function's
  existing shared-catch failure path still returns `unavailable: []` whether the first query or
  the new one throws); `apps/web/app/home/view.test.tsx` (new `describe('unavailable ...')`: absent
  when omitted/empty; singular line for exactly one; plural line for two or more; shown alongside
  an active chat with no teacher id/name leaking into the DOM, axe-clean; shown alongside the
  empty-state placeholder); `apps/web/app/home/page.test.tsx` (the stub `HomeView` mock and every
  `homeLinks` mock resolve now carry `unavailable`; one new case proves `unavailable` is threaded
  from `homeLinks` to `HomeView` unchanged).

### Gate

`corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force`:
- typecheck: pass. lint: pass.
- test: **157 test files passed, 2477 tests passed**, 0 skipped, 0 failed (up from Phase B's 155
  files / 2456 tests; no test file skipped for this change).
- Coverage thresholds met (task exits 0 across all 10 web tasks; no threshold failure reported).

`python3 .githooks/secret-scan.py --all`: clean (no output).

## Fix round

Reviewers (typescript-reviewer, code-reviewer) agreed on one HIGH: in `lookup`, a non-blank but
malformed slug ("Bad Slug", a space, a pasted URL, too short) made
`teacherProfiles.findBySlugForStaff` throw `RepositoryError('invalid', ...)`, which `lookup`'s
catch mapped to 403 `forbidden` ("Only staff can look up a teacher") — wrong error for a
malformed-input case, and inconsistent with `decide` in the same file, which already splits
`invalid`/`integrity` (400 validation) from `scope` (403).

- `apps/web/app/api/staff/verifications/handlers.ts` (`lookup`): the catch now switches on
  `error.kind` like `decide` does: `scope` and `not_found` stay 403 `forbidden` (per the plan,
  `not_found` here can only mean a session-id problem, same as `list`); `invalid` is now 400
  `validation`; `integrity`/`failed` fall through to the generic 500 `provider_error` path
  (`integrity` can't actually occur on a read, but is included for symmetry with `decide`).
- `apps/web/app/api/staff/verifications/route.test.ts`: the `findBySlugForStaff` memory mock now
  also throws `invalid` for a slug that fails the real repository's format (`Slug` in
  `packages/db`: 3–60 chars, lower-case alphanumeric segments joined by single hyphens), checked
  before the staff-role check (same ordering `setVerification`'s mock already uses for
  `reason`-then-`scope`). New `it.each` case: a malformed non-blank slug ("ab" too short,
  "Bad Slug" upper-case/space, "asha math" a space, a pasted URL) is 400 `validation`. The existing
  "a non-staff session is 403" case (valid slug `asha-math`) is unchanged and still passes, proving
  `scope` still maps to 403.
- No change to `apps/web/staff/**` UI: `MSG.lookupForbidden` already only shows on 403; a 400
  `validation` surfaces through the search form's existing generic error path (no new string
  needed).

### Gate

`corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force`:
- typecheck: pass. lint: pass.
- test: **157 test files passed (157), 2482 tests passed (2482), 0 skipped, 0 failed.**

`python3 .githooks/secret-scan.py --all`: clean (no output).

## Decisions

### 24 Oct 2026 · 9.3f a verified teacher is found by slug and safety-rejected through the unchanged decide call · decided by builder · risk: high
- Decided: a new staff-only, status-independent `findBySlugForStaff` read in `packages/db` and a read-only `lookup` route (`apps/web/app/api/staff/verifications/{handlers.ts,lookup/route.ts}`), a `findTeacherBySlug` client call and a search box in `apps/web/app/staff/view.tsx` that reuses `VerificationRow` and `decide` unchanged; `decide` and `list` are byte-for-byte unchanged.
- Why: `setVerification({safety:true})` already worked from any starting `verificationStatus` (9.3e), so the security review's MEDIUM was a console gap, not a repository one; proved over Postgres in `teacher-profiles.int.test.ts` and `route.int.test.ts` (find an already verified teacher by slug, safety-reject, 200, audit `after.safety === true`). `packages/db/src/repositories/**` and `apps/web/app/api/staff/**` are required-reviewer groups.

### 24 Oct 2026 · 9.3f a subscription whose agent is no longer live shows one blame-free line on /home · decided by builder · risk: low
- Decided: a read-only `listUnavailableForStudent` (separate from `listLiveForStudent`, which also feeds the live-classes question route) feeds one aggregate line in `homeLinks`, `HomeView` and `en.json`, with no teacher name and no link, deduped by agent id and placed after the chats, startable and paused block under the existing single catch.
- Why: B-49: such a subscription used to vanish from `/home` with no trace. Pause or cancel while suspended and the chat and plan pages' 404 stay unchanged (plan Q5, deferred to 9.3i: no payment is live, so nobody is billed for an agent they cannot reach).

### 24 Oct 2026 · 9.3f a malformed lookup slug is 400, not 403 · decided by builder · risk: high
- Decided: `lookup`'s catch in `apps/web/app/api/staff/verifications/handlers.ts` switches on `error.kind` like `decide`: `invalid` is 400 validation, `scope` and `not_found` stay 403 forbidden, and `integrity` and `failed` fall through to the generic 500.
- Why: the review's HIGH: a typo or pasted URL told staff they were not allowed, which is the wrong error and inconsistent with `decide` in the same file.

### 24 Oct 2026 · 9.3f tool calls over the plan's budget · decided by lead · risk: low
- Decided: accept 316 tool calls (harness count over phase A, phase B, the stalled and finishing phase C builders and the fixer) against the plan's 230.
- Why: phase C stalled when the Mac slept and its work was preserved and finished by a second builder, and one fix round ran; every phase finished with a green gate.

## Left to do

- Board follow-ups the lead already opened per the plan's lead answers: 9.3h (queue/lookup row
  shows active takedowns and last decision; subject-edit history) and 9.3i (pause/cancel for a
  subscription whose agent is suspended) — both deferred, not part of this task.

## Budget

Tool calls used: 316 (harness count across all builders and the fixer)
