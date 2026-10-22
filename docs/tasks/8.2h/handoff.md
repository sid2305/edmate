# 8.2h handoff: 8.2e review follow-ups (web-link ingest)

Status: DONE

- Branch: `m8/8.2h-web-link-followups` (pushed from the local `work-82h`)
- Worktree: `.claude/worktrees/agent-a5f62b685b2c68f7f`
- Tool calls used: 34 (this resumed run; an earlier interrupted builder left a draft patch that was applied, checked and finished)

## Summary

- **Last-attempt failed write (MEDIUM, processor.ts).** `failWith` now re-reads the row and writes `failed` only if it still holds the storageKey this job started with. A replaced row (`uploading`, or `processing` under the newer job) or a deleted one is a `stale_skipped`; a db outage on the re-read is rethrown for a retry. packages/db has no storageKey-conditional status write, so this is a read-then-write: a replace that lands in the few milliseconds between the re-read and the write can still be marked failed (see Decisions and Left to do).
- **Web jobs get 2 attempts (MEDIUM, packages/queue).** `WEB_INGEST_ATTEMPTS = 2` overrides `RETRY.attempts` (5) for `fileKind: 'web'` only; the backoff is unchanged. File jobs keep 5.
- **Stuck-processing sweeper: not built.** Every documents read in packages/db is teacher-scoped (`get`, `listForTeacher`); a sweeper needs a cross-teacher "processing and older than N" read, which is a packages/db change (out of bounds). Left to do.
- **LOWs:**
  - `webLinkRefusal` refuses a host that still ends in `..` after WHATWG parsing (`https://example.org../`) as `invalid_url`. One trailing dot (a fully qualified name) is still accepted. IP literals are judged first, so `127.0.0.1..` stays `private_address`.
  - The pinned transport's SNI host goes through `bareHostName` (every trailing dot stripped, lower-cased); `bareHostName` is now exported from `@edmate/ingest`.
  - Resolver: 2 s per query, 2 tries (c-ares doubles, so at most 6 s per family). Once one family answers with addresses, the other gets `FAMILY_GRACE_MS` (500 ms) before the resolver is cancelled; an empty first answer keeps waiting.
  - `NO_SUCH_NAME` and `errorCode` are exported from address.ts and used by webFetch.ts (one list).
  - processor.ts: the `fileKind` cast is gone (a `plan` union narrows by branch); `failWith` takes `IngestErrorCode`.
  - processor.test.ts: the misnamed "deleted meanwhile" test is renamed (it is a `ready` row); `as never` casts replaced with `satisfies IngestProcessorDeps['repos']`.
  - Prettier applied to touched lines only (the files were already unformatted on main elsewhere).

## Files

- apps/worker/src/ingest/processor.ts, processor.test.ts
- apps/worker/src/webLink/pinnedTransport.ts, pinnedTransport.test.ts
- packages/ingest/src/fetch/address.ts, linkUrl.ts, webFetch.ts, src/index.ts
- packages/ingest/test/fetch/address.test.ts, urlTable.ts
- packages/queue/src/index.ts, test/queues.test.ts

## Tests (failing first, then passing)

- processor.test.ts: "a replace before the last-attempt failed write of a link is a stale skip"; "a replace before the last-attempt failed write leaves the new row uploading (replace in flight) / processing (the new job has started), not failed"; "a replace before a permanent failure write leaves the new row alone too"; "a document deleted before the last-attempt failed write is a stale skip"; "a db outage on the re-read before the failed write is rethrown for a retry" (all 6 failed before the processor change, pass after).
- pinnedTransport.test.ts: "the SNI servername drops every trailing dot, as the host checks do (8.2h)" (got `teacher-site.test.`); "an IP-literal host gets no SNI servername" with a new `93.184.216.34..` row (got an IP-like SNI).
- queues.test.ts: "a web job gets only WEB_INGEST_ATTEMPTS tries so a slow site cannot hold the ingest slot"; "a file job keeps its failed copy for the usual time and every retry".
- address.test.ts: "queries with a short per-query limit ...", "does not wait for a dropped AAAA query once A has answered", "keeps waiting when the first family answered with nothing", NO_SUCH_NAME / errorCode cases.
- urlTable.ts: "a public name with an empty last label" and "... three trailing dots" refused as `invalid_url`.

Gate:
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest... --filter=@edmate/queue... --filter=@edmate/worker...` -> `Tasks: 38 successful, 38 total`
- `python3 .githooks/secret-scan.py --all` -> clean

## ADR-0014 wording the lead should change

- Decision 6 (line 40): "The resolver allows 5 s per query and 2 tries, inside that 15 s." -> "The resolver allows 2 s per query and 2 tries (at most 6 s per family, inside that 15 s); once one family answers with addresses, the other gets 500 ms before the lookup is cancelled and its answers are treated as missing."
- Decision 9 / consequences (line 48): add "A link job gets 2 attempts (file jobs keep 5), so a slow site can hold the one ingest slot for at most two fetch deadlines."
- Decision 1 (around line 23): "TLS SNI and the certificate check use the URL's host name" -> "... use the URL's host name with every trailing dot stripped; a host ending in an empty label (`example.org..`) is refused as an invalid URL."

## Decisions

### 22 Oct 2026 · 8.2h Web-link jobs get 2 attempts; SNI and empty-label hosts tightened · decided by builder · risk: high
- Decided: `enqueueIngest` gives `fileKind: 'web'` jobs `attempts: 2` (`WEB_INGEST_ATTEMPTS`); file jobs keep 5. The pinned transport's SNI uses `bareHostName`, and `webLinkRefusal` refuses a host ending in `..` as `invalid_url` (one trailing dot still allowed). Required reviewer: security-reviewer (ingest egress, ADR-0014).
- Why: SEC MEDIUM from the 8.2e review (a slow teacher site held the concurrency-1 ingest slot ~75 s per link) and the SEC/TS LOWs on the checked name differing from the name on the wire.
- risk: high

### 22 Oct 2026 · 8.2h Failed write re-reads the row and compares storageKey (no db change) · decided by builder · risk: medium
- Decided: before writing `failed`, the processor re-reads the document and skips (stale) unless its storageKey matches the one the job started with; this applies to every `failWith`, not only the last-attempt path. It is a read-then-write, not a compare-and-set.
- Why: packages/db is out of bounds and has no storageKey-conditional status update; the remaining window is the time between the re-read and the write. A true compare-and-set (`documents.updateStatusIfStorageKey`) is Left to do.
- risk: medium

### 22 Oct 2026 · 8.2h Resolver: 2 s x 2 tries and a 500 ms grace for the second family · decided by builder · risk: medium
- Decided: `RESOLVER_OPTIONS = { timeout: 2_000, tries: 2 }`; once A or AAAA answers with addresses the other gets `FAMILY_GRACE_MS = 500` before the resolver is cancelled.
- Why: TS LOW: with 5 s x 2 tries a dropped AAAA query used up the 15 s fetch deadline even when A answered at once.
- risk: medium

## Left to do

- Stuck-`processing` sweeper: needs a new cross-teacher packages/db read (documents in `processing` older than a cut-off), then a worker repeatable job that marks them `failed`/`provider_error` through a storageKey-conditional write. Board task needed (db + worker).
- `documents.updateStatusIfStorageKey` in packages/db (a true compare-and-set for the failed write), then switch `failWith` to it.
- ADR-0014 wording edits above (lead).
