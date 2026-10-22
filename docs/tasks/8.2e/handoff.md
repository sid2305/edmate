# 8.2e handoff: 8.2d review fixes and the web-link ingest job (Phase B of 8.2b)

Status: DONE

- Branch: `m8/8.2e-web-link-job` (pushed from the local `work-82e`)
- Worktree: `.claude/worktrees/agent-a60f8f4c3e76eb59c`
- Tool calls used: 64

## Summary

**Step 1: 8.2d review fixes** (commit "8.2e: 8.2d review fixes ...")
- Host lookup now uses a cancellable `dns.promises.Resolver`. It sends A and AAAA queries, times out after 5 s with 2 tries, and is cancelled at the fetch deadline. It replaces `dns.lookup`.
- "No such name" and "not a public address" now get the same refusal: `forbidden`, "names a host that isn't a public site". A transient DNS failure (SERVFAIL, timeout, no code) is a retryable `provider_error`.
- The fetch deadline is now a plain AbortController plus a timer, so tests can drive it with fake timers.
  - A lookup that settles after the deadline is handled.
  - A `cancel()` that throws or rejects never hides the real result.
- `redactUrl` is removed; nothing used it.
- 3fff::/20 (RFC 9637 documentation) is refused, and the ADR-0014 range list says so.
- Every trailing dot is stripped from a host (`localhost..`). IP literals are judged on that bare host, which closes an SSRF bypass: `https://127.0.0.1../` reached loopback.
- Pinned transport:
  - sets `rejectUnauthorized: true` explicitly;
  - a synchronous throw from `request()` becomes the fixed "connection failed" error, with no timer left behind;
  - JSDoc moved to the right function.
- New real-TLS tests use a throwaway certificate made by `openssl` at test time:
  - a trusted CA connects and the pinned address gets the right SNI;
  - a self-signed certificate is refused, even with `NODE_TLS_REJECT_UNAUTHORIZED=0`;
  - a host-name mismatch is refused.

**Step 2: Phase B** (packages/queue, apps/worker)
- `IngestJob` accepts `fileKind: 'web'` and a `url`, which is https, at most 2048 characters and must parse. A `url` is required exactly when `fileKind` is `web`.
- `enqueueIngest` sets `removeOnFail: true` for web jobs, so the URL leaves Redis once the job fails for the last time. Other kinds keep the 7-day/1000 failed-job history.
- The worker processor handles web jobs:
  - It re-checks the link (`checkWebLinkUrl`): YouTube gives `unsupported`, any other refusal gives `forbidden`.
  - With no fetcher configured, a web link gives `unsupported`.
  - Otherwise it runs `parseWebLink` through the pinned `WebFetcher` and indexes the result as a parsed source with headings.
- Last-attempt rule, for every job kind: a retryable failure on the job's final attempt marks the document `failed`, using the error's code or `provider_error` for an unexpected error, so it is never stuck in `processing`. The raw error is not kept as the cause.
- `apps/worker/src/index.ts` builds the web fetcher from `EDMATE_WEB_LINK_HOSTS`. If the value is malformed, only web links are switched off, and the log line carries a code, never the value.
- `docker/env.example` and `docker/compose.yaml` add `EDMATE_WEB_LINK_HOSTS` (default `*`).

## Files

- docs/adr/0014-web-link-egress.md
- packages/ingest:
  - src/fetch/address.ts, src/fetch/linkUrl.ts, src/fetch/webFetch.ts, src/index.ts
  - test/fetch/address.test.ts, test/fetch/urlTable.ts, test/fetch/webFetch.test.ts
- packages/queue: src/queues.ts, src/index.ts, test/queues.test.ts
- apps/worker:
  - src/index.ts
  - src/ingest/processor.ts, src/ingest/processor.test.ts
  - src/webLink/index.ts, src/webLink/pinnedTransport.ts, src/webLink/pinnedTransport.test.ts
  - src/webLink/pinnedTransport.tls.test.ts (new)
  - test/webLinkServer.ts
  - test/ingest.int.test.ts
- docker/env.example, docker/compose.yaml (my lines only)

## Tests

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest... --filter=@edmate/queue... --filter=@edmate/worker...` → `Tasks: 38 successful, 38 total`
  - ingest: 543 passed, fetch/** at 100% branches
  - queue: 27 passed
  - worker unit: processor 35 passed
- Integration: `TEST_DATABASE_URL=… TEST_REDIS_URL=… vitest run test/ingest.int.test.ts` → `Tests 9 passed (9)`, run against my own throwaway containers (pg-82e-test, redis-82e-test), which were removed afterwards. The new cases are:
  - web link to ready, then a scoped search finds the chunks;
  - a private address gives failed/forbidden with no fetch;
  - a PDF content type gives failed/unsupported;
  - a 503 on every attempt gives failed/provider_error after 2 attempts. The dead-letter entry holds no URL or host, and no Redis key under the suite prefix holds the URL marker.
- No test touches the real internet: the fetcher uses a fake resolver and transport, or `stubWebFetcher`; the TLS tests use localhost.
- `python3 docs/adr/check-headings.py` → exit 0
- `python3 .githooks/secret-scan.py --all` → clean

## Decisions

### 22 Oct 2026 · 8.2e The job payload carries the URL; failed web jobs are removed from Redis · decided by builder · risk: high
- Decided: The web link's URL travels only in the BullMQ job payload (`IngestJob.url`); Postgres keeps a `.link` storage key and the title. Web jobs are enqueued with `removeOnFail: true` (and `removeOnComplete: true`), so the URL leaves Redis when the job finishes or fails for the last time. The dead-letter copy keeps only refs. The URL is never logged and never put in an error message.
- Why: Plan Decision 9 and the lead's answers say the URL must not be stored in Postgres or logged. Removing the job on failure stops the URL from sitting in Redis's failed-job history for 7 days. An integration test checks that no Redis key holds it.
- risk: high (it sets where a teacher's URL may live)

### 22 Oct 2026 · 8.2e ADR-0014 adds 3fff::/20 and switches to a cancellable resolver · decided by builder · risk: high
- Decided: ADR-0014 now also refuses 3fff::/20 (RFC 9637 documentation space) and strips every trailing dot from a host. Names are now looked up with `dns.promises.Resolver` (A and AAAA, 5 s timeout, 2 tries), which is cancelled at the fetch deadline. It replaces `dns.lookup`.
- Why: These are 8.2d review findings: a lookup that could not be cancelled, a missing documentation range, and `localhost..`. The Resolver skips /etc/hosts and search domains, which is stricter, and a hung lookup can't outlive the deadline.
- risk: high (it edits an egress ADR, a risky path)

### 22 Oct 2026 · 8.2e "No such name" and "not public" get one refusal · decided by builder · risk: medium
- Decided: NXDOMAIN, NODATA, an empty answer and a non-public address all fail as `forbidden` with the same message. Other DNS failures are a retryable `provider_error`.
- Why: Two different answers would let a teacher probe which internal names exist. One message hides that difference.
- risk: medium

### 22 Oct 2026 · 8.2e IP literals are judged after stripping trailing dots · decided by builder · risk: medium
- Decided: `webLinkRefusal` checks IP literals on the host with its trailing dots removed.
- Why: I found this while fixing `localhost..`. WHATWG treats `127.0.0.1..` as a domain, but once the dots are stripped it is loopback, and the fetch could reach it. Table rows now cover it.
- risk: medium

### 22 Oct 2026 · 8.2e Last-attempt rule for every ingest job · decided by builder · risk: medium
- Decided: When a retryable failure happens on the final attempt (`attemptsMade + 1 >= opts.attempts`, where a missing `attempts` counts as 1, matching BullMQ), the document is marked `failed`: with the IngestError's code, or `provider_error` for an unexpected error. The raw error is not kept as the cause. If the database itself is down while writing that status, the job still throws a retryable error.
- Why: Without this rule, a site that is down on every attempt, or a provider outage, left the document `processing` forever. This was the lead's answer for Phase B. The rule applies to file jobs too, because they had the same gap.
- risk: medium

### 22 Oct 2026 · 8.2e TLS tests make a throwaway certificate with the openssl CLI · decided by builder · risk: low
- Decided: `pinnedTransport.tls.test.ts` creates an EC certificate in a temporary directory with `openssl req -x509` when the tests run, and deletes it afterwards. No key is committed and no dependency is added.
- Why: The rules say no new dependency and no committed key files. openssl ships with macOS and the CI images.
- risk: low

### 22 Oct 2026 · 8.2e Only the first checked address is tried · decided by builder · risk: low
- Decided: Every resolved address must be public, but the transport connects only to the first one. There is no fallback to the others.
- Why: ADR-0014 already accepts this. A fallback adds more surface for little gain at pilot scale.
- risk: low

## Left to do (8.2f, Phase C)

- The web route enqueues `{ fileKind: 'web', url }` with a `.link` storage key, and checks the link with `checkWebLinkUrl` before creating the row.
- Studio wording for the `forbidden` failure ("this link can't be read: it isn't a public site") and the `unsupported` failure (YouTube or not an HTML page).
- The default title is the host only, never the path or query.
- apps/web already typechecks against the new `IngestJob` type; no change is needed there yet.
