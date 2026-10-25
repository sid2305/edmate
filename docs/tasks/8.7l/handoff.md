# Handoff: 8.7l — 8.7d/8.7e/8.7k review follow-ups (apps/web only)

Status: DONE

## What changed

- `apps/web/src/studio/publish.ts` — added `now(): Date` to `PublishBackend` and the exported
  `STALE_QUEUE_MS` constant (2 minutes). `latest()` now computes `stale(b, run)`: a `queued`/
  `running` run whose `createdAt` is older than `STALE_QUEUE_MS` relative to `b.now()` is shown
  as `status: 'error'`, `errorCode: 'stale'` in the view only (no write, no new repo call);
  `failedCases` is still only asked for a genuinely `'failed'` run status.
- `apps/web/src/studio/publish.test.ts` — added `now` to `Opts`/`memoryBackend` (default
  `'2026-10-22T10:00:00.000Z'`, matching the fixture's `createdAt` so every existing test stays
  non-stale unchanged); added three cases: a stale `queued` run, a stale `running` run, and a
  fresh `queued` run one ms inside the deadline staying `queued`.
- `apps/web/src/studio/publishRuntime.ts` — the real backend's `build()` now also returns
  `now: () => new Date()`.
- `apps/web/src/studio/publishClient.ts` — added `FETCH_TIMEOUT_MS` (15s) and wrapped the `fetch`
  call in `call()` with an `AbortController` that aborts after that timeout (the existing catch
  block already turns any `fetch` rejection, abort included, into `{ ok: false, status: 0, code:
  'provider_error' }`, so no new branch was needed there). Replaced `failure()`'s manual
  `as`-cast with a small `ErrorBodySchema` (`error.code` optional string, `reason` optional
  string) and `.safeParse`, defaulting to `'provider_error'` exactly as before on a parse failure
  (extra unknown fields are ignored by the schema, not merged into the result).
- `apps/web/src/studio/publishClient.test.ts` (new) — mocks `global.fetch`; covers (a) a normal
  success round-trip for `loadLatestRun`/`startPublish`, (b) a hung fetch using
  `vi.useFakeTimers()`/`vi.advanceTimersByTimeAsync` to advance past `FETCH_TIMEOUT_MS`, asserting
  the promise settles to a status-0 failure rather than hanging, (c) `failure()` via a
  well-formed error body, one with an extra unknown field, and one with malformed types (wrong
  field types), all through the one `safeParse` path.
- `apps/web/app/teacher/page.tsx` — wrapped the `changedSinceLastPublish` read in try/catch;
  on failure it logs `console.error('teacher_page.changed_since_publish_failed', <error name>)`
  (same style as `teachers/[slug]/page.tsx`'s `teacherScorecard` failure log) and defaults the
  flag to `false`, so the page still renders instead of throwing.
- `apps/web/app/teacher/page.test.tsx` — added a case where `changedSinceLastPublish` rejects:
  asserts the page still renders with no "changed" note, nothing throws, and the logged text
  does not contain the error's message/detail (only the error name).
- `apps/web/app/teachers/[slug]/page.tsx` — combined the per-agent `offers` `Promise.all(...)`
  and the `teacherScorecard(...)` call into one outer `Promise.all([offersPromise,
  scorecardPromise])`. `teacherScorecard`'s own try/catch is unchanged, so a scorecard-read
  failure still never makes the combined `Promise.all` reject — confirmed by running the
  existing `teachers/[slug]/page.test.tsx` suite unedited (including the
  scorecard-read-failure and repo-error-propagation cases).

## Evidence

- `corepack pnpm --filter @edmate/web exec vitest run src/studio/publish.test.ts
  src/studio/publishClient.test.ts src/studio/publishRuntime.test.ts` → `3 passed (3 files), 49
  passed (49 tests)`.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → all 10 tasks successful
  (typecheck, lint, test across the package); test summary: `Test Files 155 passed | 4 skipped
  (159)`, `Tests 2533 passed | 30 skipped (2563)`.
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Decisions

### 25 Oct 2026 · 8.7l STALE_QUEUE_MS value · decided by builder · risk: low
- Decided: `STALE_QUEUE_MS = 2 * 60 * 1000` (2 minutes).
- Why: the plan's own "Open questions" flagged this as a judgement call, not spec'd. The worker
  should claim a queued gate run almost at once, so 2 minutes is generous slack against a
  transient blip rather than a real expected wait; easy to retune later since it's a single
  exported constant with no persisted state depending on its value.

### 25 Oct 2026 · 8.7l /teacher page error-log style · decided by builder · risk: low
- Decided: on a `changedSinceLastPublish` failure, log
  `console.error('teacher_page.changed_since_publish_failed', err instanceof Error ? err.name :
  'unknown')` — a fixed code string plus the error name only, never the message or stack.
- Why: matches the existing house style in
  `apps/web/app/teachers/[slug]/page.tsx`'s `teacherScorecard` failure log (`console.error(
  'teacher_page.scorecard_read_failed', err instanceof Error ? err.name : 'unknown')`), which the
  plan's open question pointed at for consistency rather than inventing a new convention or a
  `ServerLog` wiring that `/teacher/insights/page.tsx` doesn't use either (that page has no
  read-failure path to copy from directly).

## Left to do

None for this task's scope. Deferred items (named in the plan, filed as follow-ups, not done
here): the `packages/db` NULL sub-select fix for `changedSinceLastPublish`'s outline query,
batching `start()`'s independent repo reads (needs a product call on the `ensureDefault`
write-before-fail change), and merging the duplicate "no published scorecard yet" test in
`teachers/[slug]/page.test.tsx`.

## Budget

Tool calls used: 24
