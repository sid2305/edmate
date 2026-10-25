# 13.3 findings — Phase C (worker, uploads and ingest, payments scope)

Reviewer: security-reviewer (sonnet), read-only, 25 Oct 2026.

**Verdict: PASS (no HIGH).** No CRITICAL, HIGH or MEDIUM findings in scope.

## Findings
- [LOW] apps/worker/src/webLink/pinnedTransport.ts — documentation drift. The plan calls 5.1a "only an allowlist mitigation", which is stale. `pinnedLookup` and `pinnedRequestOptions` pin the connection to the single public-checked address: no second DNS lookup, `autoSelectFamily: false`, TLS verification on. That is the DNS-rebinding fix that ADR-0014 / 8.2d shipped. No code fix is needed; this note records that the gap is closed.

## Checked clean
**SSRF.** packages/ingest/src/fetch/{address,webFetch}.ts:
- the public-address allow-list covers loopback, private, CGNAT, link-local (including the metadata address), ULA, documentation, benchmark, multicast, reserved, NAT64, 6to4, Teredo and IPv4-in-IPv6;
- every redirect hop is re-checked and re-pinned (at most 3);
- a 5 MB decompressed cap;
- a header allow-list;
- the URL never appears in errors.
Tests: apps/worker/src/webLink/*.test.ts.

**Uploads.** Storage keys are built on the server only. The presign signs ContentType and ContentLength. `complete` re-checks the object with an S3 HEAD before enqueueing. The unzipped-size cap bounds zip bombs.

**Storage client.** It counts bytes while streaming and accepts only server-built keys.

**Ingest processor.** Every call is scoped by the teacherId in the server-enqueued job.

**Alerts:**
- jobs are enqueued internally only;
- ack ids are pattern-checked;
- dbAlertStore.acknowledge throws, so only the staff console can acknowledge;
- the safety-event payload carries no text.

**Payments (deep review stays with 10.8):**
- no webhook route exists yet;
- the payments test suite disables every network primitive;
- provider keys are wrapped in a redacting Secret.
