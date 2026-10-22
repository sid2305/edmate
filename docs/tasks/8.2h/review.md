# 8.2h review — APPROVE

Reviewers: security-reviewer (sonnet; also as typescript-reviewer and code-reviewer), lead

The security reviewer checked the ingest fetcher, resolver, pinned transport, queue and worker changes with their tests. SSRF protections hold: resolve once, pin the first address and require every address to be public; redirects are re-checked and re-pinned per hop; IPv4-mapped IPv6 and the private and reserved ranges are covered; certificates are always verified; there is no second DNS lookup at connect time. The `..` refusal and the bareHostName SNI match the resolved host. The 2 s x 2 resolver race with the 500 ms grace is correct and covered by fake-timer tests. Link jobs read their attempts from job.opts (2), file jobs keep 5. Errors never carry the URL or host. The stale-skip tests cover a replace mid-flight, a deleted row and a db outage on the re-read. The ADR-0014 wording change goes to 8.2i, since docs/adr needs its own reviewers.

## Findings

- [MEDIUM] [deferred 8.2i] apps/worker/src/ingest/processor.ts:171 — failWith re-reads the row then writes; this is not a compare-and-set, so a replace between the two can still be marked failed (documented in the handoff decision, risk: medium); a db-level compare-and-set on the file key replaces it.
- [LOW] [deferred 8.2i] apps/worker/src/webLink/pinnedTransport.ts:69 — the Host header keeps one trailing dot while SNI uses bareHostName; not exploitable (address pinned, cert checked), only inconsistent.
- [LOW] [deferred 8.2i] packages/ingest/src/fetch/address.ts:140 — the family grace only arms after a non-empty answer; the all-transient-failure path relies on allSettled and is undocumented.
- [LOW] [deferred 8.2i] docs/adr/0014-web-link-ingest.md:40 — still says 5 s per query and omits WEB_INGEST_ATTEMPTS and FAMILY_GRACE_MS.
