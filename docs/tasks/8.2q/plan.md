# Plan 8.2q: upload-centre race, retry and quota hardening

## Goal (board accept line, verbatim)
"a replace during complete answers 409 and leaves the row unchanged; a failed S3 delete is
retried before it is logged; create past the limit answers 429; web and db tests green."

How this is shown: each clause gets its own red-then-green test (listed under "Tests first"
below) plus a short manual note in the handoff showing the request/response shape (409 body,
retried-then-logged delete, 429 body) — no real S3/Redis/Postgres call, per rule 4.

## Context
Deferred from `docs/tasks/8.2a/plan.md`'s "Defer" section (items 1-3 below) and
`docs/tasks/8.2a/review.md`'s MEDIUM/LOW findings tagged `[deferred 8.2q]` (items 4-6). Board
title (`docs/board/tasks.yaml`, id `8.2q`) names six items; this plan does all six in one task
since they're all LOW/MEDIUM severity, non-urgent, and touch few files:

1. **Replace-during-complete race**: `complete` (`apps/web/src/studio/routes.ts:337`) calls
   `b.documents.updateStatus(scope, id, 'processing')` with no compare on `storageKey` — a
   `replace` landing between `complete`'s `head()` read and this write silently processes the
   *old* file under the *new* key's identity. Needs a compare-and-set, same shape as
   `documents.failIfStorageKey` (`packages/db/src/repositories/chunks.ts:434-458`, added by 8.2i).
2. **Failed S3 deletes are only logged**: `dropObject` (`routes.ts:242-249`) calls
   `b.storage.deleteObject(key)` once and logs-and-swallows any error. Needs a bounded retry
   (2-3 attempts) before logging and giving up.
3. **No per-teacher quota on `create`**: `addLink` already has `linkRateLimit` (8.2f,
   `routes.ts:371`); `create` (`routes.ts:269-312`) has none. Reuse the existing generic
   `LinkRateLimiter` interface (`apps/web/src/studio/linkRateLimit.ts:20-27` — just
   `take(teacherId): Promise<boolean>`, nothing link-specific in its shape) as a second limiter
   instance with its own prefix/limit, wired the same way `linkRateLimit` is in
   `apps/web/src/studio/runtime.ts:24,37-38,72,87,132-140`.
4. **Ingest sweep never reconciles stale `uploading` rows** (8.2a review MEDIUM): a signing
   failure in `create` whose cleanup delete *also* fails (`routes.ts:300-307`) leaves a row stuck
   in `uploading` forever — `ingestSweepRepo.staleProcessing`
   (`packages/db/src/repositories/ingestSweep.ts:31-55`) only selects `status = 'processing'`.
   `STATUS_FROM.failed` (`chunks.ts:156-158`) already allows `uploading` as a from-state for
   `failIfStorageKey`, so only the sweep's read query needs to widen its status filter to
   `['processing', 'uploading']` — no repository-write change needed.
5. **No test for `create`'s cleanup-delete-fails branch** (8.2a review LOW): the code at
   `routes.ts:300-307` already catches a cleanup-delete throw, logs `studio.create_cleanup_failed`
   and rethrows the original signing error — just needs a test asserting that shape (test-only,
   bundled with item 1 since both touch `routes.test.ts`'s `create`/`complete` cases).
6. **`UploadsView.onAddLink` has no unmount guard** (8.2a review MEDIUM) and **`S3_REGION` is
   missing from `REQUIRED_IN_PRODUCTION`** (8.2a review LOW, both
   `apps/web/src/storage/presign.ts:54-59` and `apps/worker/src/storage/roundtrip.ts:49-54`) are
   bundled as a small cleanup phase — same "cheap and local" shape as 8.2a's own Phase A/B items,
   no new design needed (the `mounted` ref pattern already exists in `UploadsView.tsx:110-230`
   for every other handler; `onAddLink`, read above, is the one holdout).

## Coordination (other builders active now)
- **6.4b** (`m13/6.4b-session-end-claim`) is in `packages/db/src/repositories/sessions.ts` — this
  plan never touches that file.
- **6.3c** is in `packages/contracts` and `packages/harness` — this plan never touches either
  package.
- **11.4d** is in `apps/worker/src/ingest/ffmpegChunker.ts` — this plan touches
  `apps/worker/src/ingest/sweep.ts` and `apps/worker/src/storage/roundtrip.ts` only, a different
  file in the same app; no overlap.
- **packages/db change named explicitly**: this plan edits two files under
  `packages/db/src/repositories/` — `chunks.ts` (new `markProcessingIfStorageKey` method on
  `documentsRepo`, alongside the existing `failIfStorageKey`) and `ingestSweep.ts` (widen
  `staleProcessing`'s status filter). Neither file is `sessions.ts`; no wait on 6.4b is needed,
  but both are still under the risky `packages/db/src/repositories/**` glob (see below).

## Files touched
- `packages/db/src/repositories/chunks.ts` (+ `packages/db/test/documents.int.test.ts`) — new
  `markProcessingIfStorageKey(scope, id, expectedStorageKey)` on `documentsRepo`, same
  compare-and-set shape as `failIfStorageKey` but sets `status: 'processing'` (via
  `STATUS_FROM.processing`), clearing no failure reason change needed since processing has none.
  Returns `{ updated: boolean }`.
- `packages/db/src/repositories/ingestSweep.ts` (+ int test) — `staleProcessing`'s WHERE widens
  from `eq(documents.status, 'processing')` to `inArray(documents.status, ['processing',
  'uploading'])`; update the doc comment (the "excludes uploading" sentence becomes wrong and must
  be rewritten, not just the code).
- `apps/web/src/studio/routes.ts` (+ `routes.test.ts`) — `complete` calls the new method instead
  of plain `updateStatus` and returns a new 409 (`MSG.replacedDuringUpload` or similar) when
  `updated === false`; `dropObject` retries `deleteObject` 2-3 times (fixed small attempt count,
  no backoff config needed at this volume) before its existing log-and-swallow; `create` takes a
  new `b.createRateLimit` before writing the row (mirrors `addLink`'s `linkRateLimit.take`
  placement — before any write, so a limited teacher gets nothing written) and returns 429 on
  refusal, 503 on a limiter error (same shape as `addLink`'s `studio.link_rate_limit_unavailable`
  branch, new event name e.g. `studio.create_rate_limit_unavailable`); the `StudioBackend`
  interface (`routes.ts:38-50`) gains `markProcessingIfStorageKey` to its `documents` `Pick<...>`
  list and a new `createRateLimit: LinkRateLimiter` field; a new test for the cleanup-delete-fails
  branch in `create` (item 5).
- `apps/web/src/studio/runtime.ts` — a second rate-limit hook (`createRateLimit(redisUrl, log)`),
  same wiring pattern as `linkRateLimit` (new prefix, e.g. `edmate:studio:createrate`, own Redis
  error handler, own limit/window — recommend reusing `LINK_RATE_LIMIT`/`LINK_RATE_WINDOW_MS`
  defaults from `linkRateLimit.ts` unless the lead wants a different number; flagged as an open
  question below).
- `apps/web/src/studio/runtime.test.ts` — asserts the new hook is called and wired onto the built
  backend, same shape as the existing `linkRateLimit` assertion.
- `apps/worker/src/ingest/sweep.ts` (+ `sweep.test.ts`) — no behaviour change here; the widened
  query already returns the stale `uploading` rows and `failIfStorageKey`'s existing from-state
  list already accepts them, so this file's job loop needs no edit. A regression test confirms a
  stale `uploading` row (not just `processing`) is now marked failed by a run.
- `apps/web/app/teacher/uploads/UploadsView.tsx` (+ `UploadsView.test.tsx`) — `onAddLink` gets the
  same `if (!mounted.current) return;` guard after its `await addLink(...)`, mirroring `refresh`/
  `send`/`finish`/`onDelete`.
- `apps/web/src/storage/presign.ts` (+ `presign.test.ts`) and
  `apps/worker/src/storage/roundtrip.ts` (+ `roundtrip.test.ts`) — `S3_REGION` joins
  `REQUIRED_IN_PRODUCTION`'s array in both files; the existing placeholder-reject check
  (`value === DEV_DEFAULTS[name]`, added by 8.2a) already covers it once it's in the list — no new
  check logic, just the one extra array entry in each file plus a test case per file.

Out of bounds: `packages/db/src/repositories/sessions.ts` (6.4b), `packages/contracts/**`,
`packages/harness/**` (6.3c), `apps/worker/src/ingest/ffmpegChunker.ts` (11.4d),
`apps/web/src/auth/**`, `apps/web/app/api/sessions/**`, `apps/web/src/chat/**`,
`packages/harness/src/pedagogy/**`, `packages/harness/src/pipeline/**` (standing brief
exclusions).

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/db/src/repositories/chunks.ts` and `packages/db/src/repositories/ingestSweep.ts` both
  match `packages/db/src/repositories/**` → **reviewers: security-reviewer** (the glob's mandated
  group), plus **database-reviewer** by this repo's standing convention for every `packages/db`
  change (8.2a, 8.2i, 8.2p precedent). code-reviewer and typescript-reviewer run as usual.
- No other file in this plan is on a risk-paths.txt glob (`apps/web/src/studio/**`,
  `apps/web/src/storage/**`, `apps/worker/src/storage/**`, `apps/worker/src/ingest/**` and
  `apps/web/app/teacher/uploads/**` are not listed).
- Because `packages/db/src/repositories/**` is touched, the whole PR needs a **`risk: high`**
  decision at handoff (merge-gate rule): draft — "packages/db/src/repositories/chunks.ts gains a
  `markProcessingIfStorageKey` compare-and-set read-then-write (same shape and risk as 8.2i's
  `failIfStorageKey`, no new access path); `ingestSweepRepo.staleProcessing` widens its status
  filter to also catch stale `uploading` rows (a cross-teacher scheduled read, same scope as
  before, no new column or write path). Reviewed by security-reviewer and database-reviewer
  because both files are under the risky glob."

## Tests first (red then green; no real model, storage, Redis or network call — rule 4)
- `packages/db/test/documents.int.test.ts` (real Postgres, new case): `markProcessingIfStorageKey`
  with the current storageKey from `uploading`/`processing`/`failed` succeeds and returns
  `{ updated: true }`; a mismatched storageKey, wrong status (`ready`) or another teacher's id all
  return `{ updated: false }`, row unchanged.
- `packages/db/test/repositories.int.test.ts` or a sweep-focused int test (new case):
  `ingestSweepRepo(db).staleProcessing` now returns a stale `uploading` row (old `updated_at`,
  non-null storageKey) alongside a stale `processing` row; a fresh `uploading` row (within
  `STUCK_PROCESSING_MINUTES`) is excluded.
- `apps/web/src/studio/routes.test.ts` (new cases): `complete` when a concurrent `replace` has
  changed `storageKey` since the row was read returns 409 and `b.documents.updateStatus`/write is
  never called with the stale key (fake `markProcessingIfStorageKey` returns `{ updated: false }`);
  `dropObject`'s caller (`remove` or `replace`) with a `deleteObject` fake that fails twice then
  succeeds completes with no error logged, and failing on every attempt still logs exactly once
  after the last attempt; `create` past the fake rate limiter's cap returns 429 with nothing
  written (fake `documents.create` asserted never called); a limiter that rejects (store
  unreachable) returns 503, same shape as `addLink`'s existing case; `create`'s cleanup-delete-fails
  branch (signing throws, then `documents.delete` also throws) still surfaces the original signing
  error and logs `studio.create_cleanup_failed` once.
- `apps/web/src/studio/runtime.test.ts` (new case): the built backend's `createRateLimit` comes
  from the new hook, called with the same `redisUrl`/`log` shape as `linkRateLimit`.
- `apps/web/app/teacher/uploads/UploadsView.test.tsx` (new case): unmount the component mid-flight
  during a pending `addLink` promise; assert no React "state update on an unmounted component"
  warning (spy on `console.error`) and no throw.
- `apps/web/src/storage/presign.test.ts` and `apps/worker/test/storage/roundtrip.test.ts` (new
  case each): `S3_REGION` set to its exact `DEV_DEFAULTS` value under production throws the
  `S3_REGION_placeholder` code; a non-placeholder region still passes; dev/test are unaffected.
- `apps/worker/src/ingest/sweep.test.ts` (new case): a fake `staleProcessing` returning a stale
  `uploading` row is still marked failed by one run, same as a `processing` row (no code change
  expected here — this test documents that the existing job loop already handles it once the
  repository widens its query).

## Gate commands (per changed package)
- `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
- `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`
- `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...`
- `python3 .githooks/secret-scan.py --all` (every phase; the storage tests touch existing
  placeholder strings only, no new secrets, but run clean each phase regardless).

## Phases and budget

### Phase A — replace-during-complete race + cleanup-delete-fails test (packages/db, apps/web)
Items 1 and 5. Files: `packages/db/src/repositories/chunks.ts` (+ `documents.int.test.ts`),
`apps/web/src/studio/routes.ts` (`complete`'s new compare-and-set call, the `StudioBackend`
interface's `documents` `Pick` gains `markProcessingIfStorageKey`, a new 409 message) + the two
new `routes.test.ts` cases. Risky path (`packages/db/src/repositories/chunks.ts`):
security-reviewer + database-reviewer required; draft the `risk: high` decision here (it covers
Phase D's `ingestSweep.ts` touch too — one decision entry at handoff, not two). Gate:
`@edmate/db...`, `@edmate/web...`.
**Budget: 45 tool calls.**

### Phase B — dropObject retry (apps/web only)
Item 2. Files: `apps/web/src/studio/routes.ts` (`dropObject` only), `routes.test.ts` (new retry
cases). No risky path. Gate: `@edmate/web...`.
**Budget: 25 tool calls.**

### Phase C — create rate limit (apps/web only)
Item 3. Files: `apps/web/src/studio/routes.ts` (`create`, `StudioBackend.createRateLimit` field),
`routes.test.ts`, `apps/web/src/studio/runtime.ts`, `runtime.test.ts`. No risky path (reuses the
existing `LinkRateLimiter` type/factories from `linkRateLimit.ts` unchanged). Gate:
`@edmate/web...`.
**Budget: 30 tool calls.**

### Phase D — ingest sweep reconciles stale uploading rows (packages/db, apps/worker)
Item 4. Files: `packages/db/src/repositories/ingestSweep.ts` (+ int test),
`apps/worker/src/ingest/sweep.test.ts` (regression case only, no `sweep.ts` edit expected — see
"Tests first"). Risky path (`packages/db/src/repositories/ingestSweep.ts`): same
security-reviewer + database-reviewer group as Phase A; no second `risk: high` decision needed,
fold into Phase A's at handoff. Gate: `@edmate/db...`, `@edmate/worker...`.
**Budget: 25 tool calls.**

### Phase E — UploadsView unmount guard + S3_REGION in both storage configs (apps/web, apps/worker)
Item 6. Files: `apps/web/app/teacher/uploads/UploadsView.tsx` (+ test),
`apps/web/src/storage/presign.ts` (+ test), `apps/worker/src/storage/roundtrip.ts` (+ test). No
risky path. Gate: `@edmate/web...`, `@edmate/worker...`.
**Budget: 25 tool calls.**

Each phase gets a fresh builder that reads this plan and the previous phase's handoff; each ends
in a green commit with a short "state after this phase" note. Phase C can run independently of
Phase B's result (different sub-area of the same file) but should still follow it in sequence to
avoid a merge conflict in `routes.ts`/`routes.test.ts` — do not parallelize B and C in two
worktrees against the same branch.

**Budget: 150 tool calls (5 phases, packages: @edmate/db, @edmate/web, @edmate/worker)**

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (tests, typecheck, lint, and secret-scan only — no real
model, storage, Redis or network calls per rule 4).

## Exit conditions
`Status: DONE` when all five phases are green (gate commands above) and the handoff's acceptance
evidence shows the four accept-line clauses: a replace-during-complete request gets 409 with the
row unchanged; a `dropObject` failure is retried (2-3 attempts visible in the test) before any
log line; a `create` past the new limit gets 429 with nothing written; `@edmate/db`,
`@edmate/web` and `@edmate/worker` all pass typecheck/lint/test. `Status: PARTIAL` if a phase goes
past roughly 1.5x its budget, or if a fix surfaces a need to touch a file outside this plan's list
(e.g. `packages/db/src/repositories/sessions.ts`, or anything in `packages/contracts`/
`packages/harness`) — stop and hand that back to the lead rather than absorbing scope creep or
colliding with 6.4b/6.3c's in-flight work.

## Reviewers
code-reviewer and typescript-reviewer on every phase (standard). security-reviewer and
database-reviewer on Phases A and D (risky `packages/db/src/repositories/**` path). No
architect/ADR needed (no contracts or prompt-pack behaviour change).

## Open questions
1. **What limit/window should `create`'s new rate limit use?** Recommendation: reuse
   `LINK_RATE_LIMIT`/`LINK_RATE_WINDOW_MS` (20/hour) as a starting default — uploads and links are
   both "add content" actions at the same pilot scale, and a separate number would need its own
   justification the brief doesn't give. The lead can tune it later without a design change (the
   limiter takes `opts.limit`/`opts.windowMs` already).
2. **Exact 409 message/code for the `complete`-race case**: proposed `MSG.replacedDuringUpload =
   'The file was replaced before the upload finished.'`, error code `validation` (409), same
   family as the existing `REPLACE_REFUSAL_MESSAGE` 409s. Recommendation: proceed with this unless
   the lead prefers a distinct error code (e.g. `conflict` instead of `validation`) for the
   client to branch on — no existing route in this file uses a `conflict` code today, so
   `validation`+409 (already precedented at `routes.ts:324,419,441`) is the smaller change.
3. **Should Phase D rename `staleProcessing`/`StaleProcessingDocument`** now that it also returns
   `uploading` rows? Recommendation: no — renaming ripples into `sweep.ts`'s `IngestSweepDeps`
   type and its own tests for no behavioural gain; update only the doc comment to describe both
   statuses, as 8.2a did for comment-only drift elsewhere.

READY

## Lead answers (27 Oct 2026)
- **Q1:** reuse LINK_RATE_LIMIT / LINK_RATE_WINDOW_MS as the create limit's default, as recommended.
- **Q2:** MSG.replacedDuringUpload with code 'validation' and HTTP 409, as recommended.
- **Q3:** no rename; update the doc comments only.
- **Stale uploading threshold:** the sweep's 30-minute STUCK_PROCESSING_MINUTES is twice the 15-minute upload URL lifetime (UPLOAD_URL_TTL_SECONDS in apps/web/src/storage/presign.ts), so an upload that started on a valid URL has finished or failed by then. Say this in the sweep's doc comment, naming both constants, so a later change to either one is checked against the other.
- **Phases:** one builder per two or three phases is fine (A+B, C+D+E) if each stays under about 70 tool calls.
