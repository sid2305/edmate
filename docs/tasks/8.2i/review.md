# 8.2i review — APPROVE

Reviewers: security-reviewer, architect, typescript-reviewer, code-reviewer, database-reviewer

## Findings
- [HIGH] [fixed] apps/worker/src/webLink/pinnedTransport.ts — the Host header for an IPv6 literal lost its brackets, a regression from this branch (code-reviewer, typescript-reviewer)
- [HIGH] [fixed] apps/worker/src/ingest/sweep.ts — the sweep could fail a row whose ingest job was still queued or running, leaving indexed chunks under a failed row (database-reviewer)
- [MEDIUM] [fixed] apps/worker/src/webLink/pinnedTransport.ts — malformed IPv6 Host header (security-reviewer)
- [MEDIUM] [fixed] apps/worker/src/ingest/sweep.ts — no liveness signal for a slow job past 30 minutes (typescript-reviewer)
- [MEDIUM] [deferred 8.2p] packages/db/src/repositories/ingestSweep.ts — no index for status = 'processing' AND updated_at < cutoff (database-reviewer)
- [LOW] [fixed] apps/worker/src/webLink/pinnedTransport.ts — no IPv6-with-port Host bracket or test (architect)
