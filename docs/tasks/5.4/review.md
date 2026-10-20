# 5.4 review — APPROVE

Reviewers: security-reviewer (opus), code-reviewer (sonnet), typescript-reviewer (sonnet), database-reviewer (sonnet)

All reviewers approve with no CRITICAL or HIGH findings. security-reviewer reviewed Phase A at 79b2f15 and Phase B at 8a86d86. Security mutation-tested both phases: five harness filter breaks, the db allowed-module and teacher/ownership filters, and the raw-allowed cache key. Every break was caught by the property tests or the retrieval-leak test. Search scope is fixed from the entitlement. Every chunk is re-checked and rebuilt from known fields. `probeLocked` returns only `{hit, score}`. The tool filter lives in `access/`. leakCache is keyed on teacher, revision and owned ∩ allowed ids, and fails closed. Indexes cover every scope filter, and the leakCheck SLO holds (p95 4.3 ms).

## Findings
- [MEDIUM] [deferred 5.4a] packages/db/test/access-audit.test.ts:96 — rule 1 misses `db.query.chunks.findMany()` (the drizzle relational API on a schema-aware client), namespace imports (`t.chunks`), and SQL `from public.chunks`. Flag those forms too.
- [MEDIUM] [deferred 5.4a] packages/harness/src/access/scopedRetrieval.ts:62 — after an `isObject` check, `copyChunk` copies fields without runtime type checks, so a non-string `text` could reach the context; the runner's schema check limits this. Add a narrow zod Chunk schema at this boundary.
- [LOW] [deferred 5.4a] packages/harness/src/access/scopedRetrieval.ts:66 — the scope check reads each field, then the copy reads it again, so a getter could return different values. Copy first, then check the copy.
- [LOW] [deferred 5.4a] packages/harness/src/access/scopedRetrieval.ts:67 — the error message carries the raw `String(c.id)`. Include only short, well-formed ids.
- [LOW] [deferred 5.4a] packages/harness/src/access/scopedRetrieval.ts:84 — `k = Infinity` passes. Also require `Number.isFinite`, or cap k.
- [LOW] [deferred 5.4a] packages/harness/src/access/turn.property.test.ts — removing the access tools filter doesn't fail the whole-turn property, because policy filters first. Add a decide stub that names unentitled tools.
- [LOW] [deferred 5.4a] packages/db/test/access-audit.test.ts:107 — rule 2 treats any `scope` word before `;` as a scoped read. Require `${scope}`, `scoped(` or `eq(chunks.teacherId`.
- [LOW] [deferred 5.4a] packages/db/test/access-audit.test.ts:201 — rule 5 checks only the harness; apps can call `repos.retrieval.search` with every module. Extend it to `apps/*` when the apps are wired.
- [LOW] [deferred 5.4a] packages/db/test/access-audit.test.ts:19 — the scan skips `.cjs/.cts/.jsx` files and the scripts and bin folders. Destructured and bracket access is out of reach; widen the scan and note that limit in the README.
- [LOW] [deferred 5.4a] packages/db/src/repositories/retrieval.ts:426 — `index.hits()` runs synchronously on up to 2,048 × 65,536 characters, and the timeout can't interrupt it. Also cap the total number of characters.
- [LOW] [deferred 5.4a] packages/db/src/repositories/retrieval.ts:461 — `modules.ids` is read on every leakCheck, even when the cache is warm. Add a comment saying this is intentional; the SLO holds.

Not listed: code-reviewer's style nit in retrieval.ts (a redundant slice) needs no change.
