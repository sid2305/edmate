# Handoff: 8.2q

Status: PARTIAL (Phases B, C and E done; A and D left)

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

## Decisions

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

## Budget

Phases B, C, E tool calls used: 64
