# 8.2f review — APPROVE

Reviewers: security-reviewer (sonnet; also as typescript-reviewer and code-reviewer), lead

The security reviewer read the link route, the studio routes, files, rate limiter, runtime and upload client, the uploads view and messages, with their tests. URL validation reuses the reviewed packages/ingest linkUrl check (ADR-0014) and runs before any write or quota spend. The module id is scoped to the teacher through the existing SQL join. The per-teacher rate limit is one atomic Lua INCR+PEXPIRE and fails closed. `.link` keys are kept out of every S3 call in complete, replace and remove. Errors are fixed strings, rendered as React text (no XSS path), and the strict schemas refuse client-sent teacherId, storageKey and fileKind. Tests cover cross-teacher rate-limit isolation and that the list never returns the URL or storage key. No findings.

## Findings

None.
