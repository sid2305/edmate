# 2.7 review — APPROVE
Reviewers: security-reviewer (opus), database-reviewer (sonnet), silent-failure-hunter (sonnet)

security-reviewer probed the storage-host allowlist (userinfo, `\@`, trailing dot, IDN/punycode, ports, decimal IP, IPv6 — all rejected; the parsed host is the one fetched), confirmed same-host https redirects only (max 3), no signed URL in errors, traces or metering rows, provider error bodies dropped, the OpenAI key passed as a Secret with no env fallback, and `test:live` excluded from `test` and CI. database-reviewer confirmed migration 0006 is chained correctly, aborts loudly on wrong-size vectors, and uses a cosine HNSW index matching the schema. silent-failure-hunter confirmed ordered offsets, loud failures on bad chunks and embedding batches, and metering of failed attempts, then re-verified its findings at b3404a4. Gateway 405 tests (100% coverage), db 360.

## Findings
- [HIGH] [fixed] packages/gateway/src/transcriber/source.ts:819 — a download that ended short of its declared length was transcribed as if complete. It now throws a retryable truncated-download error. Re-verified by silent-failure-hunter.
- [MEDIUM] [fixed] packages/gateway/src/transcriber/whisper.ts:1125 — an empty chunk mid-recording was skipped as silence. It now fails the recording; only a final tail under 1 s is skipped, with an anomaly in the trace. Re-verified by silent-failure-hunter.
- [LOW] [fixed] packages/gateway/src/transcriber/whisper.ts:33 — 1 GiB default cap with ~3x peak memory. Default 600 MB, single allocation from content-length.
- [LOW] [wontfix] packages/db/migrations/0006_chunk_embedding_dimension.sql:11 — HNSW index uses pgvector's default tuning. See decision log 18 Oct 2026.
