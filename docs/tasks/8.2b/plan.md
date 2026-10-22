# 8.2b plan: web-link (and YouTube) uploads in the upload centre

Deferred from 8.2 by the human (B-31, answered 21 Oct 2026: "defer to a follow-up after the thin
slice"); the thin slice is done. Depends on 8.2 (DONE). Board risk: risky.

Status: **READY for web links (Phases A-C). YouTube is BLOCKED on Q1** (no robust key-free way to
get a transcript; see "YouTube" below). Recommendation: build web links now, move YouTube to a new
board task (8.2c) once the human answers Q1.

## Acceptance (verbatim)
"a teacher adds a web link or YouTube video and it reaches ready or a fixed failure reason; private
and internal addresses are refused."

### How it's shown (no real internet anywhere, rule 4)
1. **Web link reaches `ready`**: `apps/worker/test/ingest.int.test.ts` (real Postgres/Redis, a stub
   `WebFetcher` returning a recorded HTML fixture) enqueues a `web` job through the real
   `Queue`/`Worker`; the document reaches `ready` and `retrievalRepo.search` finds its chunks.
2. **Fixed failure reasons**: the same int test drives a refused address (`failed/forbidden`), a
   non-HTML page (`failed/unsupported`), and a site that 5xx's on every attempt
   (`failed/provider_error` after the last attempt, never stuck in `processing`).
3. **Private and internal addresses refused**: `packages/ingest/test/fetch/webFetch.test.ts` and
   `linkUrl.test.ts` (fake transport, fake resolver) cover every range below; the
   `apps/worker/src/webLink/pinnedTransport.test.ts` local-server test (a `node:http` server on
   127.0.0.1) proves the connection goes to the pinned address only, sends no cookie or
   credential, enforces size and time limits, and that a refused URL opens **zero** connections.
4. **Teacher flow**: `apps/web` route tests (add link -> 201, row `processing`, job enqueued with the
   URL; private/YouTube/http URL -> 400, nothing written) and `UploadsView.test.tsx` (link form,
   status words for the new reason codes, polling flips a link row to Ready).
5. YouTube: **not shown until Q1 is answered**. Until then a YouTube URL is refused at create with
   a fixed message ("YouTube links aren't supported yet; upload the video file instead"), which
   the board's accept line does not cover, hence the split recommendation.

## What already exists (reuse, don't rebuild)
- `packages/ingest/src/fetch/webFetch.ts` (task 5.1): https only, no userinfo, exact-host
  allowlist, every resolved address must be public, manual redirects (max 3) re-checked per hop,
  HTML-only, streamed byte cap, 15 s timeout, URL never in an error. `address.ts`:
  `isPublicAddress` refuses 0/8, 10/8, 100.64/10, 127/8, 169.254/16 (metadata), 172.16/12,
  192.168/16, 192.0.0/24, 192.0.2/24, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4 and up; IPv6
  only 2000::/3 minus 2001:0::/32 (Teredo), 2001:db8::/32 and 2002::/16 (6to4), so ::, ::1,
  fe80::/10, fc00::/7, ff00::/8, 64:ff9b::/96 (NAT64), 100::/64 and ::/96 compat are refused;
  `::ffff:a.b.c.d` is judged as its IPv4.
- `parseWebLink` / `parseHtml` (cheerio, already a dependency) and `indexDocument`'s
  `ParsedSource` branch. `stubWebFetcher` for tests.
- 8.2's lifecycle: `documents.create` / `updateStatus` / `delete`, `enqueueIngest`, the
  processor's stale-replace guard (`chunks.insertManyIfStorageKey`), the upload-centre polling.

### The gap this task closes (the SSRF core)
`webFetch` resolves the name, checks the addresses, then calls `fetch(url)`, which **resolves
again**: a DNS-rebinding host can answer public first and 127.0.0.1 second (TOCTOU). Fix: the
fetcher resolves once per hop, checks every address, picks one, and hands that address to a
**transport that connects to exactly it** (no second lookup). The production transport is
`node:https.request` with a `lookup` option that always returns the pinned address; TLS SNI and
certificate checks still use the URL's host name. Node built-ins only; **no new dependency**
(undici's `Agent({ connect: { lookup } })` would do the same but is a new direct dependency).

## Data model: no packages/db change (deliberate)
A link document is a normal `documents` row: `kind: 'material'`, `storageKey` =
`teachers/<teacherId>/documents/<documentId>/<uuid>.link` (built on the server). **No object is
stored under a `.link` key**: the key is the ingest attempt's token, so the existing stale guard
and job-id hashing work unchanged. The URL travels **only in the ingest job payload** (Redis), never
in a DB column or a log line; the row's `sourceTitle` is the teacher's title, else the redacted
`host + path` (no query string, so a token in a query never lands in the DB).
Why: avoids a migration while 11.1a and 9.6c are building in `packages/db` (migration number and
journal collisions), and keeps `packages/db/src/repositories/**` (risky path) untouched.
Cost (accepted for MVP, logged as a decision): a failed link can't be retried in place; the
teacher deletes it and adds it again. A `source_url` column can come later (M13) if teachers ask.

## Allow-list modes (Q2, non-blocking: the code supports both, env picks)
`EDMATE_WEB_LINK_HOSTS` (worker env):
- unset or empty: web links refused (`failed/forbidden`), fail closed;
- a comma list of bare hosts: exact-host match (today's `allowedHosts` semantics);
- exactly `*`: any host whose resolved addresses are all public.
In every mode: https only, port 443 only (an explicit other port is refused, no port scanning),
no userinfo, a host-name denylist (`localhost`, `*.localhost`, `*.local`, `*.internal`,
`*.home.arpa`, a single-label name), IP literals must be public. WHATWG URL parsing already
normalises decimal/octal/hex IPv4 forms (`https://2130706433/` becomes 127.0.0.1) before the check.
Recommendation: `*` for the pilot (teachers paste arbitrary article links; the IP checks and pinning
are the real guard). `docker/env.example` documents it; compose sets `*` for the dev worker.

## Fetch limits (decisions, not blockers)
- Page cap 5 MB (decompressed); `ingest`'s 20 MB document cap stays for files.
- 15 s total across all hops (existing), plus a 5 s connect/headers timeout in the transport.
- Redirects: at most 3, each hop re-resolved, re-checked, re-pinned; https to http refused.
- Content types: `text/html`, `application/xhtml+xml` only (a linked PDF is `unsupported`;
  follow-up if teachers ask).
- Request headers are a fixed allowlist: `user-agent: EdmateBot/0.1`, `accept`,
  `accept-encoding: identity`. No `cookie`, no `authorization`, no proxy, no keep-alive agent
  (`agent: false`); `Set-Cookie` is never read or sent back. If a server compresses anyway, the
  transport decompresses with `node:zlib` streaming and the cap counts decompressed bytes (a gzip
  bomb test).
- robots.txt is not consulted: one teacher-initiated fetch of a page they chose, like a link
  preview (decision, logged).
- Per-teacher link quota: not in this task (the worker's concurrency 1 throttles fetches); it joins
  8.2a's existing "per-teacher quota or rate limit on create" item.

## YouTube (BLOCKED, Q1)
There is no robust, key-free, terms-compliant way to fetch a YouTube transcript:
- The YouTube Data API `captions.download` needs OAuth by the video's owner, a Google Cloud OAuth
  client and app verification for a sensitive scope: a key and a new outbound integration (ADR).
- The unofficial `timedtext` / InnerTube transcript endpoints need no key but are undocumented,
  have broken repeatedly as YouTube changed its player, and automated access is against YouTube's
  terms; building on them would be a guess.
- Downloading the audio (yt-dlp) and transcribing with Whisper: a new binary dependency, against
  the terms, and a per-minute model cost.
- oEmbed is key-free and official but returns only the title and thumbnail.
**Options for the human (Q1):**
a) Ship web links now; YouTube becomes board task 8.2c: the teacher uploads the caption file they
   download from YouTube Studio for their own video (`.vtt`/`.srt`, a new upload type, no call to
   YouTube at all), and the video file path that already works (Whisper) stays available.
   **Recommended**: the PRD says "owned YouTube videos", owners can export both, no key, no terms
   risk.
b) a) plus, later, the official Data API with the owner's OAuth consent (needs an ADR and a
   Google Cloud project; pre-pilot only if teachers find the export step too much).
c) Unofficial transcript scraping (key-free, fragile, terms risk). Not recommended.
Until answered, YouTube hosts (`youtube.com`, `www.`/`m.`/`music.youtube.com`, `youtu.be`,
`youtube-nocookie.com`, `www.youtube-nocookie.com`) are refused at create (400, words that point to
"upload the video file"), and the worker refuses them too (`failed/unsupported`) as a backstop.

## ADR: yes, a short one (in Phase A)
No contracts change and no new dependency, so rule 2 isn't triggered by code. But this is the
first production egress to hosts the operator doesn't control, and ADR-0005 Decision 5 already set
the precedent of recording an SSRF policy as an ADR. Plan: **ADR-<next free number, 0014 unless
taken>-web-link-egress.md**, text from `architect`, file written by the Phase A builder: the
pinned-address rule, the refused ranges, the three allow-list modes, the limits above, "URL never
logged or stored", and "YouTube is not fetched (Q1)". Reviewers: architect, security-reviewer,
typescript-reviewer; the lead approves and logs it `risk: high`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- Phase A: `docs/adr/**` (the new ADR) -> **architect, security-reviewer, typescript-reviewer**.
  `packages/ingest/**` and `apps/worker/src/webLink/**` match no glob.
- Phase B: none (checked). `packages/queue/**`, `apps/worker/src/ingest/**`,
  `apps/worker/src/index.ts`, `apps/worker/test/**`, `docker/**` match no glob;
  `apps/worker/src/alerts/**` is not touched.
- Phase C: none (checked). `apps/web/app/api/studio/**`, `apps/web/src/studio/**`,
  `apps/web/app/teacher/**`, `apps/web/messages/en.json` match no glob; `apps/web/src/auth/**` is
  not touched (`/api/studio/**` already allows POST and DELETE for teachers only).
- Not touched by any phase: `packages/contracts/**`, `packages/db/**`, `.claude/**`, `.github/**`.
- **Recommended beyond the gate:** security-reviewer on Phases B and C too (SSRF is the task's
  core, board risk: risky). Every phase logs a `risk: high` decision on merge (the egress policy,
  the job carrying the URL, the link route).

## Shared files (another builder may touch them)
- `apps/web/messages/en.json` (Phase C): append only, inside the existing `uploads` namespace;
  merge `main` first, never reorder.
- `apps/worker/src/index.ts` (Phase B) and `packages/queue/src/queues.ts` (Phase B): 11.1a (live
  classes) may add a worker or queue there; merge `main` first and keep edits to the ingest block.
- `docker/env.example`, `docker/compose.yaml` (Phase B): one env line each.
- `packages/db/**`: **not touched** (11.1a and 9.6c are building there).
- `docs/adr/` numbering (Phase A): take the next free number at build time, after merging `main`.

## Phase A: the pinned, SSRF-safe fetcher (packages/ingest + apps/worker transport + ADR)
### Files to create/modify
- `packages/ingest/src/fetch/webFetch.ts` (edit): replace the `fetch` option with a
  `transport: PinnedTransport` port, `(req: { url: URL; address: string; family: 4 | 6; headers;
  signal }) => Promise<TransportResponse>` where `TransportResponse` is a small own interface
  (`status`, `header(name)`, `body: AsyncIterable<Uint8Array>`, `cancel()`), not a WHATWG
  `Response` (avoids its 204/304 body quirks). `checkTarget` returns the chosen address (every
  resolved address must be public, as today; pin the first). Add: the `'*'` mode
  (`allowedHosts: readonly string[] | 'any-public'`), port 443 only, the host-name denylist, https
  to http redirect refused, the fixed request headers, `content-encoding` handling (identity; or
  gzip/deflate/br decompressed by the transport and capped), page cap default 5 MB.
- `packages/ingest/src/fetch/linkUrl.ts` (new): `checkWebLinkUrl(raw)` (pure, no DNS):
  parse, https, no userinfo, length <= 2048, port 443, denylisted names, IP literal must be
  public, YouTube host -> `{ ok: false, code: 'youtube_unsupported' }`; returns the normalised URL
  and `displayTitle` (`host + path`, max 500). Shared by the web route (Phase C) and the fetcher.
- `packages/ingest/src/fetch/address.ts` (small edit): also refuse the IANA special-purpose blocks
  inside 2001::/23 that pass today (2001:2::/48 benchmarking, 2001:10::/28 and 2001:20::/28
  ORCHID); add test rows for `::`, `100::/64` and the compat form, which are already refused.
- `packages/ingest/src/index.ts` (edit): export `checkWebLinkUrl`, `isYouTubeHost`,
  `PinnedTransport`, `TransportResponse`, `WEB_PAGE_MAX_BYTES`.
- `apps/worker/src/webLink/pinnedTransport.ts` (new): `createPinnedTransport({ request?, timeoutMs })`;
  default `request` is `node:https`'s, called with the URL, `lookup` returning only the pinned
  address (handles both the `all: true` array form and the single-address form),
  `autoSelectFamily: false`, `agent: false`, `servername` = the URL host, fixed headers,
  `signal`; never `rejectUnauthorized: false`. Streams the body; decompresses via `node:zlib` if
  needed. Never puts the URL in an error.
- `apps/worker/src/webLink/index.ts` (new): `createWorkerWebFetcher(env)`: parses
  `EDMATE_WEB_LINK_HOSTS` (unset = refuse all; `*`; or a list; a bad entry fails at startup with a
  code, not the value), wires `createWebFetcher` + `systemResolveHost` + the pinned transport.
- `docs/adr/<NNNN>-web-link-egress.md` (new; text from architect).
### Tests first (red before code)
- `packages/ingest/test/fetch/webFetch.test.ts` (fake transport + fake resolver; ingest's
  no-network rule stays): the transport receives the address the resolver returned and the
  resolver is called **once per hop** (a rebinding resolver that answers public then 127.0.0.1
  never yields 127.0.0.1 to the transport); refused: `http:`, userinfo, port 8443, `localhost`,
  `foo.internal`, `printer.local`, single-label, `127.0.0.1`, `2130706433`, `0x7f.1`, `0.0.0.0`,
  `10.0.0.1`, `100.64.0.1`, `169.254.169.254`, `172.16.0.1`, `192.168.1.1`, `[::1]`,
  `[::ffff:127.0.0.1]`, `[::ffff:7f00:1]`, `[fe80::1]`, `[fc00::1]`, `[64:ff9b::a00:1]`,
  `[2002:7f00:1::]`; a name resolving to any one private address among public ones; a redirect to
  each of those and to `http:`; a 4th redirect; non-HTML; a body over the cap with and without
  `content-length`; a gzip body that inflates past the cap; timeout. In `'*'` mode a public host
  passes; with an empty list everything is refused. No error message contains the query string.
- `packages/ingest/test/fetch/linkUrl.test.ts`: the same URL table, YouTube hosts, display title
  drops the query and fragment.
- `apps/worker/src/webLink/pinnedTransport.test.ts`: a `node:http` server on 127.0.0.1 (the
  transport's injected `request` is `http.request`, since a local TLS server would need a committed
  private key, which the secret scan refuses); the URL host is `teacher-site.test` (not in DNS) and
  the request still lands, proving the pin; the server sees `host: teacher-site.test`, no
  `cookie`/`authorization` even after a `Set-Cookie` response; the body cap and the gzip-bomb cap
  hold; a server that never answers hits the timeout; the default `request` is `https.request`
  (spy) with no `rejectUnauthorized: false` and `servername` set.
- `apps/worker/src/webLink/index.test.ts`: env parsing (unset, `*`, list, bad entry), and the real
  composition refuses `https://127.0.0.1/` and `https://localhost/` with the local server counting
  **zero** connections.
### State after this phase
A worker-side `WebFetcher` exists that never connects anywhere but a checked, pinned public
address; nothing calls it yet. `pnpm turbo run typecheck lint test --filter=@edmate/ingest...
--filter=@edmate/worker...` green; `python3 docs/adr/check-headings.py` passes; secret scan clean.

## Phase B: the job, the processor and the lifecycle (packages/queue + apps/worker)
Depends on Phase A merged.
### Files to create/modify
- `packages/queue/src/queues.ts` (edit): `IngestFileKindSchema` gains `'web'`; `IngestJobSchema`
  gains `url` (https, max 2048), required exactly when `fileKind === 'web'` and refused otherwise
  (same refine pattern as `mimeType`). `jobId.ingest` unchanged (keyed on the `.link` key).
- `packages/queue/test/queues.test.ts` (edit): the new schema cases.
- `apps/worker/src/ingest/processor.ts` (edit): `IngestProcessorDeps.webFetcher?: WebFetcher`;
  a `web` job runs `checkWebLinkUrl` (a YouTube or refused URL -> `failed/unsupported` or
  `failed/forbidden`), then `parseWebLink(url, webFetcher, row.sourceTitle)` -> a `ParsedSource`
  (`headings: true`) -> `indexDocument`, through the same stale guard and status writes; no
  `webFetcher` configured -> `failed/unsupported`. **Last-attempt rule (fixes an 8.2 gap the
  accept line needs):** a retryable `IngestError` or unexpected error on the job's final attempt
  (`attemptsMade + 1 >= opts.attempts`) marks the document `failed` with its code
  (`provider_error` for a non-IngestError) instead of leaving it `processing` forever; this also
  covers file jobs. `IngestJobLike` gains optional `attemptsMade` and `opts.attempts`. The URL is
  never logged (log `documentId` and codes only).
- `apps/worker/src/ingest/workers.ts` (edit only if BullMQ's job fields need passing through).
- `apps/worker/src/index.ts` (edit, ingest block only): build `createWorkerWebFetcher(process.env)`
  and pass it in deps; a startup config error logs a code and disables only web links.
- `docker/env.example`, `docker/compose.yaml` (edit): `EDMATE_WEB_LINK_HOSTS` documented; `*` on
  the dev worker.
### Tests first
- `apps/worker/src/ingest/processor.test.ts`: web job -> `ready` (stub fetcher); refused URL ->
  `failed/forbidden`, nothing fetched; YouTube URL -> `failed/unsupported`; non-final retryable ->
  rethrown, still `processing`; final-attempt retryable -> `failed/<code>`; stale replace during a
  web fetch -> `stale_skipped`; no log line contains the URL or its query.
- `apps/worker/test/ingest.int.test.ts`: the cases in "How it's shown" 1-2 through the real
  `Queue`/`Worker`, plus: the dead-letter entry for a failed web job holds no `url` (only refs).
### State after this phase
A `web` job enqueued by hand is fully processed to `ready` or a fixed failure reason. `pnpm turbo
run typecheck lint test --filter=@edmate/queue... --filter=@edmate/worker...` green (int tests with
`TEST_DATABASE_URL`/`TEST_REDIS_URL`); secret scan clean.

## Phase C: add a link in the upload centre (apps/web)
Depends on Phase B merged.
### Files to create/modify
- `apps/web/src/studio/files.ts` (+ `files.test.ts`): `newLinkKey(teacherId, documentId)`
  (`.link`), `isLinkKey(key)`; `.link` is not in `UPLOAD_TYPES`, so `complete` refuses a link (400).
- `apps/web/src/studio/routes.ts` (+ `routes.test.ts`): `addLink`: strict body `{ moduleId, url,
  sourceTitle? }`; `checkWebLinkUrl` (400 `validation` with a fixed message per code, including
  YouTube); `documents.create` (title = given or `displayTitle`) -> `updateStatus('processing')` ->
  `enqueue({ teacherId, documentId, fileKind: 'web', url }, key)`; enqueue failure ->
  `failed/enqueue_failed`, 503. `replace` on a link -> 400 (delete and re-add). `remove` skips the
  S3 delete for a `.link` key. `view()` adds `source: 'file' | 'link'` (from the key).
  `StudioBackend` unchanged except the job type.
- `apps/web/app/api/studio/links/route.ts` (new): `POST`, `withRole(['teacher'], ...)`;
  `route-coverage.test.ts` picks it up.
- `apps/web/src/studio/uploadClient.ts` (+ `uploadClient.test.ts`): `addLink`,
  `DocumentView.source`.
- `apps/web/app/teacher/uploads/UploadsView.tsx` (+ `UploadsView.test.tsx`): an "Add a web link"
  form (url + optional title, try/catch/finally busy flag per lessons.md); link rows show the
  title and status, with Delete only (no Replace, no Try again); words for `forbidden`,
  `not_found`, `rate_limited`, `unsupported` (link wording) and the YouTube refusal.
- `apps/web/messages/en.json` (edit, shared): the new `uploads.*` strings.
### Tests first
`routes.test.ts`: cross-teacher module -> 404 with nothing written or enqueued; client-sent
`teacherId`/`storageKey`/`fileKind` refused (strict); every refused URL class -> 400, nothing
written; the enqueued job carries the URL and the `.link` key; `processing` is written before
enqueue (call order); the list view never includes the URL or key. Through the real guard:
anonymous 401, student/staff 403, cross-origin POST 403. `UploadsView.test.tsx`: add-link flow,
refusal words, polling flips a link row to Ready, a `<b>` title renders as text, jest-axe clean.
### State after this phase (web links done)
A teacher pastes a link, watches it go `processing` -> `ready`/`failed` with words for the reason,
and can delete it. `pnpm turbo run typecheck lint test build --filter=@edmate/web...` green;
`no-raw-html.test.ts` still clean; secret scan clean.

## Files out of bounds (every phase)
`packages/contracts/**`, `packages/db/**` (no migration, no repository change; flag to the lead if
that changes), `packages/harness/**`, `packages/gateway/**`, `apps/web/src/auth/**`,
`apps/worker/src/alerts/**`, `content/**`, `.claude/**`, `.github/**`. No new npm dependency in
any phase (Node built-ins `node:https`, `node:dns`, `node:zlib` only); if a builder thinks one is
needed, stop at PARTIAL and ask.

## Open questions
- **Q1 (BLOCKING for YouTube only):** how should YouTube transcripts be obtained? Options a/b/c
  above; recommendation a) (ship web links now; YouTube as 8.2c via the owner's caption-file
  export plus the existing video upload). The lead adds this to `.claude/blockers.md`.
- **Q2 (non-blocking):** pilot value of `EDMATE_WEB_LINK_HOSTS`: `*` (any public https site,
  recommended) or a named host list. The build supports both; only the env value changes.
- **Q3 (non-blocking):** a link's URL is not stored (only in the job), so a failed link is deleted
  and re-added rather than retried. Accept for MVP (recommended) or add a `source_url` column after
  11.1a/9.6c merge.

## Decisions to log on merge
- Phase A: the web-link egress policy (pinning, ranges, modes, limits, no robots.txt) and its ADR,
  `risk: high`.
- Phase B: the job carries the URL and nothing persists it; the last-attempt rule marks `failed`
  instead of leaving `processing`, `risk: high` (board task risky).
- Phase C: the link route and `.link` key, replace refused for links, `risk: high` (board task
  risky); YouTube refused at create until Q1, `risk: medium`.

## Budget
Budget: 190 tool calls (3 phases: A 70, B 55, C 65; packages/ingest, packages/queue, apps/worker, apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test/build, docker compose for
Postgres/Redis in Phase B, git on the task branch, the secret scan, `check-headings.py`). No network
fetches of real sites, no `curl` to the internet, no new packages.

## Exit conditions
- **DONE (per phase):** that phase's "State after this phase" holds, its tests were written first
  and are green for every package it touches (snapshots included, per lessons.md), the secret scan
  is clean, and the handoff has `Tool calls used:`, evidence and `## Decisions` (with `risk: high`
  where listed).
- **PARTIAL:** past ~85% of the phase budget (A 60, B 47, C 55) with work left; a file outside this
  plan needs changes (notably anything in `packages/db/**`, `packages/contracts/**` or
  `apps/web/src/auth/**`); a new dependency looks necessary; the pinned `lookup` can't be made to
  work with `node:https` on the repo's Node version; or anything YouTube beyond the refusal is
  needed before Q1 is answered.

## Lead answers (22 Oct 2026)
- Phases run as board tasks: Phase A is **8.2d**, Phase B is **8.2e**, Phase C is **8.2f**. YouTube is **8.2c**, which waits on Q1 (blocker B-47). Each phase has its own handoff in `docs/tasks/<phase id>/`.
- Q1: web links ship now, and YouTube hosts are refused with fixed words as the plan says. 8.2c follows the human's answer.
- Q2: build both modes. The dev and example env use `*` (any https site that resolves only to public addresses). The pilot value is part of B-47; until the human answers, `*` stands.
- Q3: accepted for MVP. A failed link is deleted and added again, and no `source_url` column is added.
- ADR: yes, ADR-0014 web-link egress. architect drafts the text before Phase A starts, the Phase A builder writes the file, and reviewers are architect, security-reviewer and typescript-reviewer (opus). Phases B and C also get security-reviewer.
