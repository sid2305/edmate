# 8.2f handoff: add a web link in the upload centre (Phase C of 8.2b)

Status: DONE

- Branch: `m8/8.2f-web-link-ui` (pushed from the local `work-82f`)
- Worktree: `.claude/worktrees/agent-acfd9fabf5aa0d1c3`
- Tool calls used: 48 (harness count for the resume run; the builder reported 24; the first run, stopped mid-build, was not counted)

## Summary

Teachers can add a web link in the upload centre next to the file picker. The route checks the
URL with the shared, pure `checkWebLinkUrl` (ADR-0014) before writing anything, takes a
per-teacher rate-limit token, writes the document row (`.link` storage key, title = given or the
host-only `displayTitle`), marks it `processing`, and enqueues `{ fileKind: 'web', url }`. The
list view shows a `source: 'file' | 'link'` tag; a link row has Delete only (no Replace, no Try
again -- a failed link is deleted and re-added, per the 8.2b plan's Q3).

- `apps/web/src/studio/files.ts`: `newLinkKey(teacherId, documentId)` builds
  `teachers/<teacherId>/documents/<documentId>.link` (no random suffix: one link per document,
  and `.link` can't collide with a file extension); `isLinkKey(key)`. `.link` stays out of
  `UPLOAD_TYPES`, so `complete` already refuses it (400) with no change there.
- `apps/web/src/studio/routes.ts`: new `addLink` handler, a strict `{ moduleId, url, sourceTitle?
  }` body; `checkWebLinkUrl` runs first (free, no quota, no write) and every refusal code maps to
  a fixed 400 message, including `youtube_unsupported`. The rate limiter is taken only after the
  URL shape passes, and before the row is created, so a capped teacher gets nothing written. A
  rate-limiter error is 503 with a fixed message, never the underlying error. `replace` now 400s
  with a fixed "can't be replaced" message for a `.link` row; `remove` skips the S3 delete for a
  link; `view()` adds `source`.
- `apps/web/app/api/studio/links/route.ts` (new): `POST`, `withRole(['teacher'], …)`.
- `apps/web/src/studio/linkRateLimit.ts` (new): a per-teacher fixed-window limiter, 20 links/hour.
  `redisLinkRateLimiter` uses one Lua script (`INCR` + `PEXPIRE` in the same round trip, via
  `redis.defineCommand`) so a crash between the two calls can never leave a key with no TTL --
  unlike `apps/web/src/discovery/rateLimit.ts`'s separate calls, which is fine for that advisory,
  fail-open limiter but not for this one. A store error rejects the promise; the route's `catch`
  turns that into a 503, failing closed. `fakeLinkRateLimiter` (in-memory, injectable clock) and
  `failingLinkRateLimiter` back the tests; no real Redis in any test.
- `apps/web/src/studio/runtime.ts`: `StudioHooks.linkRateLimit(redisUrl, log)` builds the limiter
  on its own ioredis connection (`maxRetriesPerRequest: 1`, so a dead Redis fails fast rather than
  queuing forever); wired into `StudioBackend.linkRateLimit`.
- `apps/web/src/studio/uploadClient.ts`: `addLink(input)` posts to `/api/studio/links`;
  `DocumentView.source`.
- `apps/web/app/teacher/uploads/UploadsView.tsx`: an "Add a web link" form (url + optional title)
  with its own busy flag and try/catch/finally (lessons.md); link rows render with Delete only;
  the server's fixed `message` is shown directly when present (it already covers the per-code
  refusal, including YouTube), falling back to the generic error word.
- `apps/web/messages/en.json`: added `uploads.linkUrl`, `uploads.linkUrlPlaceholder`,
  `uploads.linkTitle`, `uploads.addLink`, and `uploads.reasons.forbidden` (my lines only, appended
  inside the existing `uploads` namespace; merged `origin/main` before pushing).

## Default title (host only, no path)

`checkWebLinkUrl`'s `displayTitle` already returns the host only (`bareHostName`,
`packages/ingest/src/fetch/linkUrl.ts:85`), matching ADR-0014 Decision 9 and the 8.2e handoff's
note that this finding is already closed. `addLink` uses `body.sourceTitle ?? checked.displayTitle`
with no further changes needed in `apps/web`; `packages/ingest` was not touched.

## Files

- apps/web/app/api/studio/links/route.ts (new)
- apps/web/app/teacher/uploads/UploadsView.tsx, UploadsView.test.tsx
- apps/web/src/studio/files.ts, files.test.ts
- apps/web/src/studio/linkRateLimit.ts, linkRateLimit.test.ts (new)
- apps/web/src/studio/routes.ts, routes.test.ts
- apps/web/src/studio/runtime.ts, runtime.test.ts
- apps/web/src/studio/uploadClient.ts, uploadClient.test.ts
- apps/web/messages/en.json (new `uploads.*` keys only)
- docs/tasks/8.2f/plan.md (copy of the relevant 8.2b plan sections, per setup)

## Tests

- `corepack pnpm turbo run typecheck lint test build --filter=@edmate/web...` → `Tasks: 35
  successful, 35 total`, exit 0 (includes `@edmate/db`'s suite, a transitive dependency; its int
  tests skip with no local Postgres, as usual).
- `routes.test.ts` "POST /api/studio/links (addLink, task 8.2f)": every `checkWebLinkUrl` refusal
  code -> 400 with its fixed message, nothing written, including YouTube; cross-teacher module ->
  404, nothing written or enqueued; client-sent `teacherId`/`storageKey`/`fileKind` refused
  (strict schema); the enqueued job carries the URL and the `.link` key; `processing` is written
  before enqueue (call order asserted); rate limit: the 21st call in a window -> 429
  `rate_limited`, nothing written on the refused call; a failing rate limiter -> 503, nothing
  written; `replace` on a link row -> 400; `remove` on a link skips the S3 delete; list view never
  includes the URL or storage key. Through the real guard (`ROUTE_POLICY`): anonymous 401,
  student/staff 403, cross-origin POST 403, a teacher succeeds.
- `UploadsView.test.tsx`: add-link happy path, refusal words shown from the server's fixed
  `message`, a link row shows Delete only (no Replace/Try again), a `<b>` title renders as text,
  jest-axe clean.
- `linkRateLimit.test.ts`: fixed-window behaviour (allows up to the limit, refuses after, resets
  after the window with an injectable clock), the failing fake rejects.
- No real network and no real Redis in any test: `checkWebLinkUrl` is pure; `enqueue` and the rate
  limiter are faked.

## How it is shown

A teacher pastes a URL in the upload centre's new "Add a web link" field (optional title), submits,
and the row appears `processing` -> polls to `ready`/`failed` with the same fixed-reason wording as
file uploads, plus a `forbidden` reason for a refused host. The row offers only Delete.

## Decisions

### 22 Oct 2026 · 8.2f The link route and `.link` key; replace refused for links · decided by builder · risk: high
- Decided: `POST /api/studio/links` creates a document with a `.link` storage key (no S3 object),
  checks the URL with the shared `checkWebLinkUrl` before any write, and enqueues
  `{ fileKind: 'web', url }` keyed on that storage key. `replace` on a `.link` row is refused
  (400, "delete and add again"); `remove` on a link skips the S3 delete.
- Why: this is the task's core surface (ADR-0014's policy reaches production here for the first
  time) and the plan calls for `risk: high` with security-reviewer named.
- risk: high (names security-reviewer as a required reviewer)

### 22 Oct 2026 · 8.2f YouTube refused at create, same fixed words as the worker · decided by builder · risk: medium
- Decided: `checkWebLinkUrl`'s `youtube_unsupported` code gets its own fixed 400 message at
  create time ("YouTube links aren't supported yet. Upload the video file instead."), so a
  teacher never reaches a queued job that 8.2e's worker would also refuse.
- Why: the plan's Decision list and ADR-0014 Decision 11 require this until Q1 (B-47) is
  answered; failing fast at the API avoids a pointless enqueue/failed round trip.
- risk: medium

### 22 Oct 2026 · 8.2f Per-teacher link rate limit: one Lua script, fail closed · decided by builder · risk: medium
- Decided: a new `apps/web/src/studio/linkRateLimit.ts`, not `packages/queue` or the existing
  `discovery/rateLimit.ts`. 20 links/teacher/hour, a single `INCR`+`PEXPIRE` Lua script (atomic,
  like `packages/queue/src/turnLimits.ts`'s pattern) behind a small `LinkRateLimiter` port; a
  store error rejects, and the route turns that into a 503 with a fixed code, never the
  underlying error or value.
- Why: added by the 8.2e review as a follow-up (no limit existed on adding links, which drive
  SSRF-checked egress and the ingest queue); `discovery/rateLimit.ts`'s separate INCR-then-PEXPIRE
  is fine for its own fail-open, advisory use but would leave a key with no TTL under a crash here,
  capping a teacher forever; this guard must fail closed, not open.
- risk: medium

## Left to do

None for this phase. Board task 8.2g (deploy guide egress rule) and 8.2c (YouTube, waiting on Q1 /
blocker B-47) are separate, already-tracked follow-ups named in ADR-0014 and the 8.2b plan.
