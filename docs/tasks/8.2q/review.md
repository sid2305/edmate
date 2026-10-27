# 8.2q review — APPROVE

Reviewers: security-reviewer, database-reviewer, typescript-reviewer, code-reviewer

## Findings
- [HIGH] [fixed] routes.ts (apps/web/src/studio/) the `markFailed` calls inside `complete` (input_too_large, unsupported_type, enqueue_failed) used a plain status update, so a replace that landed mid-`complete` could have its new document marked failed by the stale request. Fix round 1 moved all four call sites to the key-compared `failIfStorageKey`, so losing the race does nothing. security-reviewer re-verified: fixed, no new finding (security-reviewer).
- [HIGH] [fixed] ingestSweep.ts (packages/db/src/repositories/) the widened `staleProcessing` filter (`status IN ('processing','uploading')`) was not served by the processing-only partial index, so the sweep would scan the whole table. Fixed on main by 8.2r: migration 0041 builds `documents_sweep_updated_at_id_idx` with the wider predicate CONCURRENTLY, then drops the old index. database-reviewer re-verified on 8.2q merged with main: fixed, no drift, no new finding (database-reviewer).
- [LOW] [wontfix] ingestSweep.ts (packages/db/src/repositories/) INGEST_SWEEP_LIMIT (1000) was not reconsidered now that stuck `uploading` rows count too (database-reviewer).

## Verdict
Pass. Both HIGHs are fixed and re-verified by the reviewers who raised them. code-reviewer and typescript-reviewer found nothing. The compare-and-set write, the sweep widening, the dropObject retry and the create rate limit are sound. Lead decisions cover the risky paths, the LOW and the budget.
