# 8.2e review — APPROVE

Reviewers: architect (opus), security-reviewer (opus), typescript-reviewer (opus; also as code-reviewer), lead

All three reviewers approved with no CRITICAL or HIGH findings. The security reviewer re-tested every 8.2d fix the handoff claims (trailing-dot IP literals on the first link and on redirects, the cancellable resolver, one refusal for "no such name" and "not public", 3fff::/20, explicit `rejectUnauthorized`, the timer crash and close masking) and confirmed the URL lives only in the job payload, web jobs leave Redis when they finish or fail, and logs carry only ids and fixed codes. The TypeScript reviewer re-ran the ingest, queue, worker and web gates (20/20) and the ingest integration tests (9/9) in a scratch clone, and checked `isLastAttempt` against BullMQ's retry rule. The architect's ADR MEDIUM and the ADR wording LOWs are fixed by the lead on this branch (ADR text only). The code MEDIUMs and LOWs are deferred to 8.2h, 8.2f and 8.2g.

## Findings
- [MEDIUM] [fixed] docs/adr/0014-web-link-egress.md:5,87 — the 8.2e range and resolver changes weren't marked as an amendment. Status and Reviewers now say "Amended in 8.2e" with its reviewers (lead edit).
- [MEDIUM] [deferred 8.2h] apps/worker/src/ingest/processor.ts:266 — on the last attempt a retryable failure marks the row failed without checking it still has the job's storageKey, so an old job's last retry can mark a replaced row failed while the new job's chunks are live. Write the failed status only when the storageKey matches, with a test.
- [MEDIUM] [deferred 8.2h] packages/queue/src/index.ts:160 — web jobs get 5 attempts on a concurrency-1 ingest worker, so a slow teacher-chosen site holds the only slot for about 75 s per link. Fewer attempts for web jobs (or their own queue); the per-teacher link-add limit goes to 8.2f.
- [LOW] [fixed] docs/adr/0014-web-link-egress.md:24 — IP literals are judged after stripping every trailing dot; now stated.
- [LOW] [fixed] docs/adr/0014-web-link-egress.md:40 — the resolver limit (5 s per query, 2 tries) is now in Decision 6.
- [LOW] [fixed] docs/adr/0014-web-link-egress.md:21 — "every address" now says what happens when one family fails transiently.
- [LOW] [fixed] docs/adr/0014-web-link-egress.md:78 — the tests line names the real-TLS tests, which fail (not skip) without openssl.
- [LOW] [wontfix] docs/tasks/8.2b/plan.md:165 — displayTitle is already the host only (`bareHostName`, linkUrl.ts:85).
- [LOW] [deferred 8.2g] packages/ingest/src/fetch/address.ts:113-131 — the c-ares resolver ignores /etc/hosts and split-horizon DNS; say so in the deploy guide.
- [LOW] [deferred 8.2h] docs/tasks/8.2e/handoff.md:94 — a DB write failing on the final attempt leaves the document `processing`; a stuck-processing sweeper.
- [LOW] [deferred 8.2h] packages/ingest/src/fetch/linkUrl.ts:62 — a host still ending in dots after parsing is accepted (Host and SNI differ from the checked name); refuse it.
- [LOW] [deferred 8.2h] apps/worker/src/webLink/pinnedTransport.ts:62 — SNI strips one trailing dot, the checks strip all; use bareHostName.
- [LOW] [deferred 8.2h] packages/ingest/src/fetch/address.ts:93 — 5 s × 2 tries with allSettled can use up the 15 s deadline when AAAA is dropped; shorter timeout or a grace after the first family.
- [LOW] [deferred 8.2h] apps/worker/src/ingest/processor.ts:242,182 — a `fileKind` cast and an untyped `failWith(code: string)`.
- [LOW] [deferred 8.2h] packages/ingest/src/fetch/address.ts:90, webFetch.ts:216 — duplicated NO_SUCH_NAME set and code reader.
- [LOW] [deferred 8.2h] apps/worker/src/ingest/processor.test.ts:587 — misnamed test and `as never` casts.
- [LOW] [deferred 8.2h] apps/worker/src/ingest/processor.ts:220, packages/queue/src/index.ts:156 — new lines not prettier-formatted.
