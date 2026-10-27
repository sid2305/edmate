# Task 12.3d: Repeat-infringer handling — flag to staff, staff decide on suspension

## Acceptance (verbatim, B-63, 27 Oct 2026, `docs/decisions/log.md`)
> A teacher with 3 upheld copyright takedowns in any rolling 12 months is flagged to staff as a
> repeat infringer. Staff decide whether to suspend the teacher; a suspended teacher's agent takes
> no new students, and current students keep access until staff act. Nothing is suspended
> automatically. The threshold (3) and window (12 months) are settings.

## How it will be shown
A new staff-only page, `/staff/repeat-infringers`, lists every teacher whose **active** `copyright`
takedowns created in the last `REPEAT_INFRINGER_WINDOW_DAYS` (365) number at least
`REPEAT_INFRINGER_THRESHOLD` (3) — both named, exported constants ("settings" per B-63; see Lead
answer 1) — and who is not already `rejected`. A banner on `/staff` ("N teachers flagged as repeat
infringers", same shape as 12.5c's safety-alerts banner) links to it when the count is non-zero.
Staff act with the **existing** reject flow (8.1/9.3e's `teacherProfiles.setVerification`, reused
byte-for-byte via `/api/staff/verifications`'s `decide`): rejecting a flagged teacher already (a)
blocks new subscriptions and hides the package page (9.3c, B-46) and (b) ticking the existing
"safety concern" checkbox additionally cuts off current students at once (9.3e). Nothing here is
automatic: a teacher stays flagged until a staff user visits the page and acts (or does nothing).
Shown via: `apps/web` route tests (mocked backend: threshold/window edges, already-rejected
excluded, cap, non-staff forbidden), a `route.int.test.ts` against real seeded takedowns, view/page
tests including jest-axe, and a manual note in the handoff (seed 3 copyright takedowns on one
teacher locally, confirm the banner and list show it, reject it, confirm it drops off the list and
new-start blocking already works per 9.3c's existing int tests).

## Why this needs no new table, column or contracts change
- **No migration.** `takedowns` (`status`, `reason`, `target`) already exists (12.2); nothing new
  is written. The "flag" is a read computed from existing active takedowns, not a stored row — it
  disappears on its own once a flagged teacher is no longer `active`-copyright-eligible (lifted
  takedowns, or already rejected), with no "dismiss" state to invent.
- **No contracts change.** `reason`/`category` already includes `'copyright'`
  (`packages/db/src/repositories/map.ts`'s `REPORT_CATEGORIES`); `takedowns.status` already has
  `'active'`/`'lifted'`. Nothing in `packages/contracts` is touched.
- **No new write path.** "Suspend" is the existing `teacherProfiles.setVerification({ status:
  'rejected' })` (optionally `safety: true`), already wired at `/api/staff/verifications` (task
  8.1, 9.3e, 9.3f). This task adds no POST route and no repository write method.
- **The only genuinely new read** is a pure aggregation over data two existing repository methods
  already return: `takedowns.listActiveForStaff` (12.2b: id, kind, targetId, teacherId,
  **teacherSlug**, **category**, **createdAt**, capped at `TAKEDOWNS_ACTIVE_MAX_LIMIT` = 200) and
  `teacherProfiles.findBySlugForStaff` (9.3f: any-status lookup by slug). **`packages/db` is not
  touched at all.**

## Context already in place (read, not rebuilt)
- `packages/db/src/repositories/takedowns.ts`: `listActiveForStaff` (returns `StaffTakedownRow[]`,
  newest first, active only, any kind) and `countUpheld` (12.3b's unbounded, no-window read — not
  used here; see Decisions on why this task reads `listActiveForStaff` instead of extending
  `countUpheld`).
- `packages/db/src/repositories/teacher-profiles.ts`: `setVerification` (8.1, 9.3e — rejection
  blocks new starts via 9.3c's verified-join; `safety: true` additionally takes down live agents
  at once) and `findBySlugForStaff` (9.3f — any-status lookup, used by this task to get
  `verificationStatus`, `name`, `email`, `displayName`, `subject` for each flagged slug).
- `apps/web/app/api/staff/verifications/handlers.ts`: `enrichQueueRows` (9.3h — one
  `listActiveForStaff` call, N parallel per-row `audit.findLastVerifyForStaff`/
  `findSubjectHistoryForStaff` calls, "no batched read needed at this scale") and `toLookupItem`/
  `toQueueItem` (9.3f) — **this task imports and reuses these three exports directly**, so a
  flagged row is shape-identical to a slug-lookup row.
- `apps/web/app/staff/verification-row.tsx`: `<VerificationRow>` renders a `QueueItem`/`LookupItem`
  with reason box, safety checkbox, Approve/Reject buttons, reading all its copy from the `staff`
  i18n namespace. **Reused as-is** on the new page (no new row component): "Approve" here means
  "reviewed, no action"; "Reject" means suspend.
- `apps/web/app/staff/client.ts`: `decide`, `MAX_REASON_CHARS`, `QueueItemSchema`/`LookupItemSchema`
  — reused as-is for the suspend action and response validation.
- `apps/web/app/staff/page.tsx` / `apps/web/app/api/staff/reports/{route.ts,handlers.ts}`: the exact
  precedent for a GET-only staff route (`withRole(['staff'], handlers.list)`) and a banner wired
  into the shared `/staff` page (12.5c's `alertsBanner`, read via try/catch, hidden on failure).
- `apps/web/src/auth/policy.ts` line 54: `{ pattern: '/api/staff/**', methods: ['GET','POST'],
  access: ['staff'] }` already covers the new route; **not edited**.

## Files to create
- `apps/web/app/api/staff/repeat-infringers/handlers.ts`:
  - `export const REPEAT_INFRINGER_THRESHOLD = 3`
  - `export const REPEAT_INFRINGER_WINDOW_DAYS = 365`
  - `export const REPEAT_INFRINGERS_MAX_LIMIT = 50` (same `*_MAX_LIMIT` precedent as the other staff
    lists)
  - `export async function listRepeatInfringersForStaff(repos, by, now = Date.now())`: the shared
    helper (9.3h's "page and API can never drift" pattern) —
    1. `listActiveForStaff(by)`; group by `teacherId` (skip null), keep rows with `category ===
       'copyright'` and `Date.parse(createdAt) >= now - REPEAT_INFRINGER_WINDOW_DAYS * 86_400_000`;
    2. keep groups with `length >= REPEAT_INFRINGER_THRESHOLD`; skip a group whose `teacherSlug` is
       null (can't be looked up or acted on);
    3. `findBySlugForStaff(by, slug)` per surviving slug, in parallel; drop `null` and
       `verificationStatus === 'rejected'` rows (already suspended — nothing left to flag);
    4. `enrichQueueRows(repos, by, survivingRows)` then `.map(toLookupItem(...))` (both imported
       from `../verifications/handlers`);
    5. sort by slug, cap at `REPEAT_INFRINGERS_MAX_LIMIT`.
  - `export function createStaffRepeatInfringersHandlers(backend)`: `{ list: Handler }`, same shape
    as `createStaffReportsHandlers` — calls the helper, returns `{ teachers: LookupItem[] }` (same
    field name and item shape as the verifications queue/lookup replies, so the existing
    `QueueSchema`/`LookupItemSchema` validate it with no new client-side schema needed). Repository
    `scope`/`invalid` on the outer `by` maps to 403 `forbidden`; anything else is `provider_error`
    with only the error's name logged (never a reason or note).
- `apps/web/app/api/staff/repeat-infringers/route.ts`: `GET = withRole(['staff'], handlers.list)`
  only — no POST (suspension goes through `/api/staff/verifications`, unchanged).
- `apps/web/app/api/staff/repeat-infringers/route.test.ts` (mocked backend): non-staff → 403; empty
  → `{ teachers: [] }`; one teacher with 2 in-window copyright takedowns → excluded; 3 in-window →
  included; a 4th copyright takedown older than 365 days → excluded from the count; a non-copyright
  category active takedown → excluded; a flagged teacher already `rejected` → excluded; a flagged
  slug that `findBySlugForStaff` returns `null` for → excluded; the cap; an unexpected throw → 500
  `provider_error` with the response body never containing a reason/note/email.
- `apps/web/app/api/staff/repeat-infringers/route.int.test.ts`: real repos — seed one teacher with 3
  active copyright takedowns inside the window (flagged), one with 2 (not flagged), one with 3 but
  one lifted (not flagged, matches `countUpheld`'s "a lifted one was reversed and does not count"
  precedent), one with 3 but already `rejected` (not flagged); confirm the flagged teacher drops out
  after `setVerification({status:'rejected'})` is called directly against the repo (no need to
  re-test 9.3c's new-start blocking here — that is 9.3c's own int test).
- `apps/web/app/staff/repeat-infringers/page.tsx`: `requireRole(['staff'])`; try/catch calling
  `listRepeatInfringersForStaff(serverDatabase().repos, principal.userId)` for first paint (the same
  helper the API route calls — never two code paths); `AppShell`, no new nav item (reached only via
  the `/staff` banner, same as `/staff/alerts`); `NextIntlClientProvider` messages include **both**
  `staff` (needed by the reused `<VerificationRow>`) and `staffRepeatInfringers` (this page's own
  copy) namespaces.
- `apps/web/app/staff/repeat-infringers/view.tsx`: `StaffRepeatInfringersView` — a trimmed
  `StaffQueueView` (no slug-search form, no pending-queue concept): holds `teachers: LookupItem[] |
  null`, `busy`, `error`, `notice` state; `onDecide` calls `decide` (imported from `../client`) and,
  on success, filters the acted-on teacher out of the list (same as `StaffQueueView`'s non-lookup
  branch); `onReload` calls this page's own `loadFlagged`. Renders each row with the existing
  `<VerificationRow item={item} currentStatus={item.verificationStatus} .../>` (imported from
  `../verification-row`). Reuses the `staff` namespace's own `approved`/`rejected`/`rejectedSafety`
  and `errors.*` keys for the notice/error text (see Decisions) — only `title`, `intro`, `empty`,
  `reload`, `reloading` are new, under `staffRepeatInfringers`.
- `apps/web/app/staff/repeat-infringers/client.ts`: `loadFlagged()` — a GET wrapper for
  `/api/staff/repeat-infringers`, parsed with the **existing** `QueueSchema`/`LookupItemSchema`
  (imported from `../client`), same settle-never-reject contract as `loadQueue`. No new schema.
- `apps/web/app/staff/repeat-infringers/page.test.tsx`, `view.test.tsx` (+ jest-axe: list, empty,
  fallback), `client.test.ts` — mirror the existing `staff/page.test.tsx`/`StaffQueueView`/
  `client.test.ts` test shapes.

## Files to modify (shared, append-only)
- `apps/web/app/staff/page.tsx`: one more try/catch banner, same shape as the existing
  `alertsBanner` block — reads `listRepeatInfringersForStaff(repos, principal.userId)` and shows
  `t('repeatInfringersBanner', { count })` linking to `/staff/repeat-infringers` when `count > 0`; a
  failed read hides the banner and logs only the error's name, same as the alerts banner. No other
  line in this file changes.
- `apps/web/app/staff/page.test.tsx`: add cases for the new banner (present, absent at zero, hidden
  on a failed read) — append, don't restructure the existing alert-banner cases.
- `apps/web/messages/en.json`: append **one** key to the existing `staff` block
  (`repeatInfringersBanner`, parameterized with `count`) and **one new top-level** `staffRepeatInfringers`
  block (`title`, `intro`, `empty`, `reload`, `reloading`). No existing key is touched or reordered.

## Files explicitly out of bounds
`packages/db/**`, `packages/contracts/**`, any `migrations/**`, `apps/worker/**`,
`apps/web/src/auth/**` (policy already covers `/api/staff/**`; not edited), `content/**`,
`.claude/**`, `.github/**`, `.githooks/**`. If any of these turn out to need a change, stop at
`Status: PARTIAL` and name the mismatch rather than widening scope.

## Tests first
Every file above: write the failing test (threshold/window edge, already-rejected exclusion, cap,
403, jest-axe) before the implementation, per `tdd-workflow`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `apps/web/app/api/staff/**` (new `repeat-infringers/` route) — reviewers: **security-reviewer**.
- `apps/web/app/staff/**` (new `repeat-infringers/` page + edited `page.tsx`) — same group,
  reviewers: **security-reviewer**.
- Not touched: `packages/db/src/repositories/**`, `packages/contracts/**`, `docs/adr/**`,
  `apps/worker/src/alerts/**`, `.claude/**`, `.github/**`, `.githooks/**`.
- No migration (nothing new is written) — database-reviewer is not gate-required.
- A `risk: high` decision is planned for the handoff (the security-boundary group above), naming:
  the threshold/window as code constants, "upheld" = active + `copyright` + in-window (matching
  12.3b's `countUpheld` precedent), already-`rejected` teachers excluded from the flag, and
  "suspend" = the existing `setVerification` reject path with no new write code.

## Open questions / Lead answers (none block the build; each has a recommendation)
1. **Where do the threshold (3) and window (365 days) "settings" live?** No settings table or admin
   UI exists yet, and adding one is out of proportion to this task. *Recommendation (adopted):*
   named, exported constants in `handlers.ts` (`REPEAT_INFRINGER_THRESHOLD`,
   `REPEAT_INFRINGER_WINDOW_DAYS`), the same shape as `STAFF_QUEUE_MAX_LIMIT`,
   `TAKEDOWNS_ACTIVE_MAX_LIMIT` and `ALERT_ESCALATION_MS` elsewhere — changeable in one place by a
   code change, not live-tunable. Revisit if ops ever needs to change these without a deploy.
2. **"Any rolling 12 months" vs. calendar months.** *Recommendation (adopted):* 365 days, not
   calendar-month arithmetic — consistent with the rest of the codebase's day/ms-based windows and
   simple to test.
3. **`listActiveForStaff`'s 200-row cap could under-count at scale.** At pilot scale this is not a
   real risk (nowhere near 200 active takedowns platform-wide). *Recommendation:* accept for now;
   if active-takedown volume ever approaches the cap, give `countUpheld`-style aggregation its own
   windowed, per-teacher-grouped query in `packages/db` instead of reading the capped staff list.
   Not built here.
4. **Should an already-`rejected` teacher still show up (so staff can review history)?**
   *Recommendation (adopted):* no — once `rejected`, nothing is left for this view to prompt staff
   to do; their existing-takedown history is already visible via the verifications console's slug
   lookup (9.3f/9.3h), unchanged by this task.
5. **Does suspending here also cut off current students immediately?**
   *Recommendation (adopted):* staff's choice, via the existing "safety concern" checkbox already
   on `<VerificationRow>` (9.3e) — ticking it cuts access at once; leaving it unticked matches
   B-63's "current students keep access until staff act" for a plain rejection (9.3c/B-46 already
   built this exact behaviour). No new flag or column is added for this task.

## Budget
Budget: 110 tool calls (1 phase, apps/web only — no packages/db change)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm/turbo typecheck, lint and test for `apps/web` only, and
the secret scan)

## Exit conditions
`Status: DONE` when: the `apps/web` gate (typecheck, lint, test) is green after merging origin/main;
every test above exists and failed first; jest-axe passes on the new view's list/empty/fallback
states; the secret scan is clean; the manual check (seed, flag, suspend, drop off the list) is
recorded in the handoff; and the `risk: high` decision is logged for the security-boundary group.
`Status: PARTIAL` past about 90-100 tool calls with the gate not green, or if any file outside this
plan's list (especially `packages/db/**` or `packages/contracts/**`) turns out to need a change —
stop and hand back with the mismatch named, rather than widening scope.

## Lead answers (27 Oct 2026)
The lead accepts recommendations 1-5 above as written: constants in `handlers.ts`, a 365-day window, the 200-row cap accepted for the pilot, rejected teachers left off the list, and the existing "safety concern" checkbox as staff's choice for an immediate cutoff. The banner and page copy are English only (English-only pilot).
