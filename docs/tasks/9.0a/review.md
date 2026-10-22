# 9.0a review — APPROVE

Reviewers: security-reviewer (sonnet), typescript-reviewer (sonnet, code and TypeScript)

## Findings

- [LOW] [deferred 9.4a] apps/web/src/turn/devModel.test.ts — the generateObject tests use hand-copied schemas instead of the harness exports; one route-level test does use the real schemas.
- [LOW] [deferred 9.0b] docker/compose.yaml — the worker's EDMATE_INGEST_EMBEDDINGS=off has no effect until 9.0b merges.
- [INFO] apps/web/src/turn/devModel.ts — the local-only check trusts AUTH_URL; accepted in the lead decision (risk: medium).
