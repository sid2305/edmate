# Handoff: 8.2q

Status: DONE

## Phase B

`dropObject` (`apps/web/src/studio/routes.ts`) now retries a failed `storage.deleteObject` up to
`DROP_OBJECT_ATTEMPTS = 3` times (no backoff -- a bucket error at this volume isn't timing
related) before logging `studio.object_delete_failed` and giving up. No API shape change; `remove`
and `replace` both call it unchanged.

Files: `apps/web/src/studio/routes.ts`, `apps/web/src/studio/routes.test.ts`.

Red then green: replaced the old single-attempt "logged and still 204" test (which would have
silently passed under the new retry, since its one `mockRejectedValueOnce` now succeeds on the
retry) with two cases:
- a delete failing twice then succeeding on the 3rd attempt: `deleteObject` called 3 times, `204`,
  `s.logs` empty, the object recorded deleted.
- a delete failing on every attempt: `deleteObject` called exactly 3 times, `204`, and
  `studio.object_delete_failed` logged exactly once (after the last attempt, not each one).

Both failed red (old code called `deleteObject` once) before the retry loop was added, then
passed.

State after this phase: `apps/web/src/studio/routes.test.ts` has 87 tests, all green; `remove`'s
and `replace`'s existing dropObject-adjacent tests (no stored file, link row, another teacher)
are untouched and still pass.

## Phase C

A second per-teacher rate limit on `create` (`apps/web/src/studio/routes.ts`), reusing the
existing generic `LinkRateLimiter` interface (`linkRateLimit.ts`) as its own instance --
`StudioBackend.createRateLimit`. Placed before `b.newDocumentId()`/`documents.create` (same
placement as `addLink`'s `linkRateLimit.take`), so a limited teacher gets nothing written. A
limiter rejection (store unreachable) logs `studio.create_rate_limit_unavailable` and answers 503,
same shape as `addLink`'s existing branch; a refused take answers 429 with the new
`MSG.createRateLimited` message (kept distinct from the link-specific wording).

`apps/web/src/studio/runtime.ts` gains a second hook, `createRateLimit(redisUrl, log)`, wired the
same way as `linkRateLimit` -- its own Redis error event
(`studio.create_rate_limit_redis_error`) and its own key prefix (`edmate:studio:createrate`),
reusing `LINK_RATE_LIMIT`/`LINK_RATE_WINDOW_MS` (20/hour) as the default per the lead's Q1 answer.

Files: `apps/web/src/studio/routes.ts`, `apps/web/src/studio/routes.test.ts`,
`apps/web/src/studio/runtime.ts`, `apps/web/src/studio/runtime.test.ts`.

Red then green: three new `create` cases (21st create in the window is 429 with nothing written
past 20 rows; a limited teacher's bucket is separate from another teacher's and from addLink's own
bucket; a store error fails closed 503, nothing written) all failed red (no `createRateLimit` on
the memory backend / no quota check in `create`) before the field and the check were added, then
passed. `runtime.test.ts`'s existing "builds once" test now also asserts
`h.createRateLimit` was called with the right `redisUrl`/`log`.

Adding `S3_REGION` to `REQUIRED_IN_PRODUCTION` (Phase E, below) also changed what
`storageConfigFromEnv` throws under a partial production config, so two `runtime.test.ts` cases
needed their env literals updated to include `S3_REGION` (one previously-missing field, one
already-complete config) so they keep testing what they said they test
(`S3_ACCESS_KEY_ID_missing` / `S3_ENDPOINT_not_https`) rather than tripping over the new
requirement first.

State after this phase: `routes.test.ts` has 90 tests, `runtime.test.ts` has 9 tests, all green.

## Phase E

1. `apps/web/app/teacher/uploads/UploadsView.tsx`'s `onAddLink` gets the same `mounted` guard every
   other handler already has: a check right after `await addLink(...)` before touching state, the
   same check in the `catch`, and the `finally`'s `setLinkBusy(false)` only runs while still
   mounted (the other handlers in this file have no `finally`, so this one extra guard was needed
   to fully silence the warning -- `setLinkBusy` is the one piece of state this handler updates
   that none of the `if (!mounted.current) return;`s above it would otherwise reach).
2. `S3_REGION` joins `REQUIRED_IN_PRODUCTION` in both `apps/web/src/storage/presign.ts` and
   `apps/worker/src/storage/roundtrip.ts`; the existing placeholder/missing checks cover it once
   it's in the list, no new check logic.

Files: `apps/web/app/teacher/uploads/UploadsView.tsx`, `UploadsView.test.tsx`,
`apps/web/src/storage/presign.ts`, `presign.test.ts`, `apps/worker/src/storage/roundtrip.ts`,
`roundtrip.test.ts`.

Red then green:
- a new unmount test mid-`addLink` (stubbed fetch that never resolves until after `unmount()`,
  same shape as the file's existing mid-upload unmount test): failed red with a React "state
  update on an unmounted component" `console.error` call before the guard was added, clean after.
- `presign.test.ts`/`roundtrip.test.ts`: `S3_REGION` added to the existing `it.each` lists that
  already walk `REQUIRED_IN_PRODUCTION` by name (missing/blank -> `S3_REGION_missing`; the dev
  placeholder value -> `S3_REGION_placeholder`), plus the "reads a complete https config" case
  now also asserts `region` on a non-placeholder value -- all failed red (the field wasn't
  required yet) before the array change, then passed. "keeps the dev and test defaults outside
  production" (unaffected by this change) stayed green throughout.

State after this phase: `UploadsView.test.tsx` has 39 tests, `presign.test.ts` has 20,
`roundtrip.test.ts` has 35, all green.

## Phase A

The replace-during-complete race (item 1) and a test for `create`'s cleanup-delete-fails branch
(item 5).

`packages/db/src/repositories/chunks.ts` gains `documentsRepo(db).markProcessingIfStorageKey(scope,
id, expectedStorageKey)`: the same atomic compare-and-set shape as `failIfStorageKey` (8.2i), but
moves the row to `processing` (via `STATUS_FROM.processing`, so it matches from `uploading`,
`processing` or `failed`) instead of `failed`, and clears any failure reason. A storageKey
mismatch, a wrong current status, a missing row or another teacher's row all return `{ updated:
false }` rather than throwing.

`apps/web/src/studio/routes.ts`'s `complete` now calls this instead of a plain
`updateStatus(scope, id, 'processing')` for its own processing write -- the compare-and-set closes
the window between `complete`'s `head()` read of storage and that write, during which a
concurrent `replace` could change the row's `storageKey` and reset it to `uploading`. `updated:
false` means a replace won that race; `complete` now answers 409 with the new
`MSG.replacedDuringUpload` message (code `validation`, per the lead's Q2 answer) and touches
nothing else -- the old row is no longer this request's to mark. `StudioBackend.documents`'s
`Pick<...>` gains `markProcessingIfStorageKey`.

Files: `packages/db/src/repositories/chunks.ts` (+ `packages/db/test/documents.int.test.ts`),
`apps/web/src/studio/routes.ts` (+ `routes.test.ts`), plus the cross-actor isolation grid in
`packages/db/test/repositories.int.test.ts` (a new case was required there: the grid's own
meta-test asserts it has an entry for every method `createRepositories` returns, so the new
repository method needed its own `IsolationCase`, not listed in the plan's files but required by
an existing test; a new fixture document per teacher, `mpDoc`, was added alongside the existing
`repDoc` fixture so the new case's ordering doesn't depend on any other case's side effects).

Red then green:
- `documents.int.test.ts`: a new `describe('markProcessingIfStorageKey', ...)` block (matches from
  each of the three allowed from-states; a storageKey mismatch, wrong status, missing/another
  teacher's row and a malformed id/key are all no-ops or `invalid`; no revision bump) -- all failed
  red with `repos.documents.markProcessingIfStorageKey is not a function` before the method was
  added, then passed (57 tests, up from 51).
- `repositories.int.test.ts`: the new `documents.markProcessingIfStorageKey` isolation case failed
  red (`has a case for exactly the methods createRepositories returns` -- a missing key) before
  the case and its `mpDoc` fixture rows were added, then passed (193 tests).
- `routes.test.ts`: two new/changed `complete` cases -- the existing "confirms the upload" order
  test now watches `markProcessingIfStorageKey` instead of `updateStatus`; a replace landing
  between `head()` and the processing write (faked by overriding
  `markProcessingIfStorageKey` to return `{ updated: false }`) answers 409 with the row's
  `storageKey`/`status` untouched by this request and nothing enqueued; the "delete racing the
  status write" case (previously expecting a `not_found`-shaped 404) now expects the same 409 a
  replace race gets, since both are the same `{ updated: false }` outcome from the one
  compare-and-set. A new `create` case (item 5) asserts that when the cleanup delete after a
  signing failure also throws, the original signing error still surfaces (through `run()`'s
  generic catch, as a 500) and `studio.create_cleanup_failed` is still logged once, before
  `studio.failed`. All failed red (the old plain `updateStatus` call, and no cleanup-delete test
  existed) before the change, then passed (87 tests).

State after this phase: `packages/db` and `apps/web` both typecheck and test green;
`markProcessingIfStorageKey` is wired end to end from the repository through `complete`'s 409.

## Phase D

Item 4: the ingest sweep now reconciles stale `uploading` rows, not just stale `processing` ones.

`packages/db/src/repositories/ingestSweep.ts`'s `staleProcessing` widens its `WHERE` from
`eq(documents.status, 'processing')` to `inArray(documents.status, ['processing', 'uploading'])`.
The doc comment above it (and the file header) is rewritten, not just the code: it explains *why*
`uploading` is included (a `create` whose signing failed and whose own cleanup delete also failed
leaves a row stuck in `uploading` forever, same shape as a crashed worker's stuck `processing`
row) and names both `STUCK_PROCESSING_MINUTES` (`apps/worker/src/ingest/sweep.ts`, 30 minutes) and
`UPLOAD_URL_TTL_SECONDS` (`apps/web/src/storage/presign.ts`, 15 minutes) per the lead's answer, so
a later change to either constant is checked against the other. No rename of
`StaleProcessingDocument`/`staleProcessing` (lead's Q3 answer: no). No write-path change --
`failIfStorageKey`'s existing `STATUS_FROM.failed` already accepts `uploading` as a from-state
(8.2i), so `apps/worker/src/ingest/sweep.ts`'s job loop needed no edit.

Files: `packages/db/src/repositories/ingestSweep.ts` (+ `packages/db/test/ingest-sweep.int.test.ts`),
`apps/worker/src/ingest/sweep.test.ts` (regression case only, as planned -- no `sweep.ts` edit).

Red then green:
- `ingest-sweep.int.test.ts`: the existing "returns only past-cutoff processing rows" case had its
  `uploading` row removed from the excluded list (it's no longer excluded); a new case seeds a
  stale `uploading` row and a fresh one, asserting the stale one is returned (with its storage key)
  and the fresh one is not. Both failed red (the old `eq(documents.status, 'processing')` excluded
  every `uploading` row) before the widen, then passed (5 tests, same count as before -- one case
  edited, one added, no others changed).
- `sweep.test.ts`: a new case feeds a fake `staleProcessing` returning one stale-`uploading`-shaped
  row (the row's own prior status never reaches this file -- `staleProcessing` already filtered
  before returning it) and asserts the job loop marks it failed exactly like any other row. This
  test documents the "no code change needed" claim rather than failing red on this file (as the
  plan said it would) -- it passed immediately, since `failIfStorageKey`'s own from-state list
  already accepted `uploading` before this task.

State after this phase: `packages/db` and `apps/worker` both typecheck and test green; a `create`
whose signing and cleanup both fail no longer leaves a permanently stuck `uploading` row -- the
next sweep run fails it.

## Fix round 1

Security-reviewer HIGH: `complete`'s new compare-and-set (`markProcessingIfStorageKey`) only
closed the replace-during-complete race for the processing-transition write. The three other
writes `complete` makes after its own `head()` read -- `markFailed(..., 'input_too_large')`
(line 361), `markFailed(..., 'unsupported_type')` (line 366), and `markFailed(..., 'enqueue_failed')`
after a successful CAS (line 390) -- still called `documents.updateStatus` with no storageKey
compare, so a `replace` landing at any of those points silently flipped the *replaced* document to
`failed` under the stale request's failure code.

All three now call the existing key-compared `documents.failIfStorageKey(scope, id, key, code)`
(8.2i) instead of `markFailed`/`updateStatus`. A lost race (`{ updated: false }` -- another
teacher's row, a mismatched key, or a status outside `STATUS_FROM.failed`) answers the same 409
`MSG.replacedDuringUpload` the processing-write CAS already uses, and touches nothing else: no
`dropObject` (the `replace` that won the race already dropped the old object itself), no further
write. `StudioBackend.documents`'s `Pick<...>` gains `failIfStorageKey`.

**Scope note on the finding's line list**: the finding's four line numbers (361, 366, 390, 436)
included line 436, which is `addLink`'s own `enqueue_failed` `markFailed` call, not `complete`'s.
`replace` refuses outright on a link-keyed row (`MSG.linkReplace`, `routes.ts:453-455`), so a link
document created by `addLink` can never be the target of a concurrent `replace` -- the race this
fix closes cannot occur there. Left `addLink`'s `markFailed` call unchanged; fixed only the three
call sites inside `complete`, matching the finding's own prose ("every write `complete` makes..."
and the brief's "complete must not fail a document that was replaced while it ran").

Files: `apps/web/src/studio/routes.ts`, `apps/web/src/studio/routes.test.ts`.

Red then green: the memory backend's `documents.failIfStorageKey` fake was added first (same
compare-and-set shape as `markProcessingIfStorageKey`'s fake); without the production-code change,
three new tests -- one per failure code, each overriding `failIfStorageKey` to return
`{ updated: false }` to simulate a replace landing mid-request -- failed red (the route still
called `updateStatus` unconditionally, so the response stayed 413/400/503 with the row marked
`failed`, not the 409 lost-race answer). After switching the three call sites to
`failIfStorageKey`, all three pass green: 409, `validation` code, row untouched (`uploading` for
the two pre-CAS cases, `processing` for the post-CAS enqueue case), nothing deleted/enqueued extra.
The existing non-race failure tests (`fails an object over the cap...`, `fails an object whose
stored type differs...`, `an enqueue failure marks the document failed...`) still pass unchanged,
since their storageKey still matches. `complete: failure marking races`'s old two-case test (which
exercised `updateStatus` throwing `not_found`/other) no longer applies now that `failIfStorageKey`
returns `{ updated: false }` instead of throwing for a missing/raced row -- replaced with a single
case asserting a genuine thrown error (not a `{ updated: false }` outcome) still surfaces as 500,
not swallowed.

State after this round: `routes.test.ts` has 90 tests, all green.

## Decisions

### 27 Oct 2026 · 8.2q markProcessingIfStorageKey and the widened sweep filter · decided by builder · risk: high
- Decided: `packages/db/src/repositories/chunks.ts` gains a `markProcessingIfStorageKey`
  compare-and-set read-then-write (same shape and risk as 8.2i's `failIfStorageKey`, no new access
  path); `ingestSweepRepo.staleProcessing` widens its status filter to also catch stale `uploading`
  rows (a cross-teacher scheduled read, same scope as before, no new column or write path).
  Reviewed by security-reviewer and database-reviewer because both files are under the risky
  `packages/db/src/repositories/**` glob.
- Why: the plan names this decision verbatim (its draft text, used here unchanged) as required by
  the merge-gate rule for any `packages/db/src/repositories/**` touch.

### 27 Oct 2026 · 8.2q dropObject retries 3 times total, no backoff · decided by builder · risk: low
- Decided: `DROP_OBJECT_ATTEMPTS = 3` (one try plus two retries), tried back-to-back with no delay
  between attempts.
- Why: the plan asked for "2-3 attempts... no backoff config needed at this volume" without
  picking a number; 3 total matches the plan's own upper bound and keeps the retry test
  synchronous (no fake timers needed).

### 27 Oct 2026 · 8.2q create's 429 uses its own message, not addLink's · decided by builder · risk: low
- Decided: added `MSG.createRateLimited` ("Too many uploads started...") instead of reusing
  `MSG.linkRateLimited` ("Too many links added...") for `create`'s 429.
- Why: the plan names a new log event (`studio.create_rate_limit_unavailable`) for the 503 branch
  but doesn't say whether the 429 message should differ from `addLink`'s; reusing the link-specific
  wording for a file/media upload would be confusing to a teacher, and the fixed-message pattern in
  this file (`REPLACE_REFUSAL_MESSAGE`, `LINK_REFUSAL_MESSAGE`) already treats each action's wording
  as its own constant.

### 27 Oct 2026 · 8.2q onAddLink's finally is guarded too, not just the line the plan named · decided by builder · risk: low
- Decided: the plan says to add the guard "after its `await addLink(...)`"; this also guards the
  `finally` block's `setLinkBusy(false)` (`if (mounted.current) setLinkBusy(false)`), since that's
  a `finally` and runs even when the guard right after the `await` returns early.
- Why: `onAddLink` is the only handler in this file with a `finally`-set busy flag; without this
  second guard, a return inside the guard above still lets the unmount-time `setLinkBusy(false)`
  run and the React warning the test checks for would still fire.

### 27 Oct 2026 · 8.2q fix round 1: addLink's own `markFailed` call left unchanged · decided by builder · risk: low
- Decided: fixed only `complete`'s three `markFailed` call sites (lines 361, 366, 390) to use
  `failIfStorageKey`; left `addLink`'s `enqueue_failed` `markFailed` call (line 436) as plain
  `updateStatus`, even though the security-reviewer finding's line list named it alongside the
  other three.
- Why: `replace` refuses a link-keyed row outright (`MSG.linkReplace`), so a document `addLink`
  creates can never be the target of the replace-during-complete race this fix closes -- there is
  no second request that could change its `storageKey` out from under `addLink`'s own write. The
  finding and the fix brief both describe the race as specific to `complete` ("complete must not
  fail a document that was replaced while it ran"); the 436 reference in the raw finding's line
  list appears to be a copy artifact from grepping every `markFailed` call site, not a second bug.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --filter=@edmate/worker`:
  all 14 tasks successful (12 on the first run before a prettier fix touched 5 test files; re-run
  after `prettier --write` stayed green at 12/12 for typecheck+lint). Two pre-existing lint
  warnings in `apps/web/test/lighthouse-a11y.test.ts` (unused eslint-disable directives), file not
  touched by this task.
- `corepack pnpm --filter @edmate/web exec vitest run --coverage`: 170 files / 2743 tests passed (4
  files / 31 tests skipped, unrelated), no coverage threshold errors. Statements 94.52%, branches
  91.09%, functions 91.31%, lines 95.91%.
- `corepack pnpm exec prettier --check` on the ten changed files: clean (after one `--write` pass
  mid-build; re-verified clean and re-ran the affected test files to confirm the formatting pass
  changed no behaviour).
- `python3 .githooks/secret-scan.py --all`: clean, no output.

## Phase A, D Gate

- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=@edmate/web...
  --filter=@edmate/worker...`: 44 tasks total. First run: `@edmate/db#typecheck` failed (the
  isolation grid's own meta-test needed a case for the new `markProcessingIfStorageKey` method --
  fixed by adding the case and its `mpDoc` fixture, see Phase A above); after the fix, 38
  successful. Of the remainder, `@edmate/cli#test` showed two unrelated failures under machine
  load (`test/chatDbRetrieval.int.test.ts`'s `beforeAll` hook timed out and
  `src/commands/chat/sameTopic.test.ts` timed out, both with a Postgres "terminating connection due
  to administrator command" error -- a load/connection-limit issue, not this task's files); re-run
  alone, both files passed clean. `src/commands/gate.test.ts`'s `full-scope change on the real
  suites (B-40)` case also failed once under the same load and passed alone on a separate re-run.
  None of these three files is in this plan's file list. Dev Postgres was reachable throughout (the
  int tests above ran, not skipped).
- Postgres-backed int tests touched by this task, each run alone and green:
  `packages/db/test/documents.int.test.ts` (57 tests), `packages/db/test/ingest-sweep.int.test.ts`
  (5 tests), `packages/db/test/repositories.int.test.ts` (193 tests).
- `corepack pnpm exec prettier --check` on the eight changed files: one needed `--write`
  (`packages/db/test/documents.int.test.ts`); re-verified clean and re-ran that file's tests after
  the formatting pass (57 tests, unchanged behaviour).
- `python3 .githooks/secret-scan.py --all`: clean, no output.

## Fix round 1 Gate

- `corepack pnpm --filter @edmate/web exec vitest run src/studio/routes.test.ts`: 90 tests, all
  green.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`: typecheck and lint green;
  3 test-suite failures under machine load, all `Test timed out in 5000ms` in files this task never
  touched (`app/learn/[agentId]/page.test.tsx`, `app/teacher/live-classes/RecordingUpload.test.tsx`,
  `app/learn/[agentId]/plan/page.test.tsx`) -- re-run each alone (`vitest run -t clearance
  app/learn`, `vitest run app/teacher/live-classes/RecordingUpload.test.tsx`, `vitest run -t axe
  app/learn`) and all passed clean.
- `corepack pnpm exec prettier --check` on the two changed files: clean.
- `python3 .githooks/secret-scan.py --all`: clean, no output.

## Budget

Phases B, C, E tool calls used: 64
Phases A, D tool calls used: 95
Fix tool calls used: 26
