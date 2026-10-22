# 8.2d review — APPROVE

Reviewers: architect (opus), security-reviewer (opus), typescript-reviewer (opus; also as code-reviewer), lead

All three approve, with no CRITICAL or HIGH findings. Each hop does one DNS lookup, every address must be public, and the socket connects only to the checked address. Security confirmed this by hand: a TLS connection to a pinned 127.0.0.1 for a host not in DNS was rejected on the certificate. A 512 MB brotli bomb stayed bounded. TypeScript re-ran the ingest and worker suites (38/38 green). Nothing calls the fetcher in production until 8.2e, so every code finding goes to 8.2e, which works in the same files. The lead made the ADR wording fixes here and accepted ADR-0014.

## Findings
- [MEDIUM] [fixed] docs/adr/0014-web-link-egress.md — no mention that an IP-literal host sends no SNI; added.
- [MEDIUM] [fixed] docs/adr/0014-web-link-egress.md — no mention that content-length and content-encoding are dropped after decompressing, or of x-gzip; added.
- [MEDIUM] [deferred 8.2e] packages/ingest/src/fetch/webFetch.ts — redactUrl is exported and keeps the path, which can carry a share token; delete it or make it host-only.
- [MEDIUM] [deferred 8.2e] packages/ingest/src/fetch/linkUrl.ts — only one trailing dot is stripped, so localhost.. passes the name denylist (the address check still refuses it).
- [MEDIUM] [deferred 8.2e] packages/ingest/src/fetch/address.ts — dns.lookup can't be cancelled, so slow-DNS links can tie up the libuv pool past the deadline (noted in the ADR Consequences).
- [MEDIUM] [deferred 8.2e] apps/worker/src/webLink/pinnedTransport.ts — the timer is armed before client is assigned; a synchronous throw from request() crashes the worker, and the raw error is not wrapped.
- [MEDIUM] [deferred 8.2e] packages/ingest/src/fetch/webFetch.ts — untilAborted throws on an aborted signal before handling the promise, so an async cancel() leaves an unhandled rejection.
- [LOW] [fixed] docs/adr/0014-web-link-egress.md — the deploy egress rule now names board task 8.2g.
- [LOW] [fixed] docs/adr/0014-web-link-egress.md — the status is now Accepted.
- [LOW] [deferred 8.2e] apps/worker/src/webLink/pinnedTransport.ts — set rejectUnauthorized: true explicitly.
- [LOW] [deferred 8.2e] packages/ingest/src/fetch/webFetch.ts — "could not be resolved" vs "non-public address" lets a teacher probe internal names; use one message.
- [LOW] [deferred 8.2e] packages/ingest/src/fetch/address.ts — refuse 3fff::/20 (RFC 9637 documentation range), and add it to the ADR range table.
- [LOW] [deferred 8.2e] apps/worker/src/webLink/pinnedTransport.test.ts — no test of the real https path (pin, SNI, certificate rejection), and none that cancel() closes the socket mid-body.
- [LOW] [deferred 8.2e] packages/ingest/src/fetch/webFetch.ts — transient DNS errors (EAI_AGAIN) are not retryable; a cancel() rejection masks the real error; only the first checked address is tried.
- [LOW] [deferred 8.2e] packages/ingest/test/fetch/webFetch.test.ts — deadline tests use real 20-100 ms timers (flaky under load); use fake timers. Also the odd Promise.reject idiom, a misplaced JSDoc block and a duplicate import in apps/worker/src/webLink/index.ts.
