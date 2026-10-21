# 5.3 review — APPROVE

Reviewers: security-reviewer (opus), code-reviewer (sonnet), typescript-reviewer (sonnet), database-reviewer (sonnet), rag-pipeline-reviewer (sonnet)

Rounds:
- **Interim (Phases A and B).** security-reviewer (sonnet) reviewed Phase A at c2b77eb and Phase B at 7c116bc, approving both. It also covered the database side for Phase A.
- **Final head (9cfea80).** security-reviewer (opus) checked the Phase C and D changes and traced the access filter end to end over the full-text, vector, hybrid and IDF paths. code-reviewer, typescript-reviewer, database-reviewer and rag-pipeline-reviewer reviewed the whole branch. All approved, and none found a CRITICAL or HIGH.
- **Gold set.** Under MVP first (20 Oct 2026) the lead checked and signed the 38 items in the recall gold set, `content/demo-teacher/qa-recall.yaml` (`reviewed_by: lead`):
  - every expected heading exists in the demo notes, and the answers spot-checked are there;
  - none of the out-of-course topics appears in the notes.
- **Still open.** The "with embeddings" recall assertion waits on B-24, tracked as 5.3b.

## Findings

- [MEDIUM] [deferred 5.3a] packages/db/src/repositories/retrieval.ts:214 — `vectorRows` orders by (distance, id), so the planner never uses the HNSW index and scans exactly; the iterative-scan guard test can't fail. Fine at pilot scale. Fix: an inner `ORDER BY distance LIMIT` with the scope, then the id tie-break outside (database-reviewer; first raised by security-reviewer in Phase A)
- [MEDIUM] [deferred 5.3a] packages/db/src/repositories/retrieval.ts:230 — two extra IDF queries per search; batch them into one once a teacher's corpus grows (database-reviewer)
- [MEDIUM] [deferred 5.3a] packages/db/src/repositories/leakCache.ts — entry memory is unbounded: full-corpus shingles per allowed-set key, up to 64 entries. Cap the material per build or intersect allowed ids with owned ids before keying (security-reviewer, Phase B)
- [MEDIUM] [deferred 5.3a] packages/db/src/repositories/retrieval.ts:43 — coverageThreshold is calibrated on only 8 out-of-course items, and 1 of the 8 (CSV, 0.513) clears 0.5. Widen the out-of-course set or add a margin (rag-pipeline-reviewer)
- [MEDIUM] [deferred 5.3b] packages/db/test/recall.int.test.ts:185 — real-vector hybrid recall is skipped until B-24, and VECTOR_ZERO is still provisional (rag-pipeline-reviewer)
- [LOW] [deferred 5.3a] packages/db/src/repositories/retrieval.ts:234 — a term the 'simple' parser splits oddly could make `to_tsquery` raise, so that turn's search fails closed. Use `plainto_tsquery` or test unusual Unicode (security-reviewer)
- [LOW] [deferred 5.3a] packages/db/src/repositories/retrieval.ts:219 — `SET LOCAL hnsw.iterative_scan` lasts until the outer transaction ends if a caller passes a `Tx`. Harmless today, since it only affects recall; revisit with the HNSW query rewrite (security-reviewer)
- [LOW] [deferred 5.3a] packages/db/src/repositories/retrieval.ts — `CandidatesSchema` has no `.max()` on count or length (security-reviewer, Phase B)
- [LOW] [deferred 5.3a] packages/db/src/repositories/retrieval.ts — imports the whole `@edmate/harness` barrel for `lockedIndex`; add a scoped subpath export (security-reviewer, Phase B)
- [LOW] [deferred 5.3a] packages/db/scripts/record-demo-embeddings.ts:1 — the header says `node … .ts --live`; state the Node version or the type-stripping flag it needs (typescript-reviewer)
- [LOW] [deferred 5.3a] content/demo-teacher/qa-recall.yaml — the scoring constants are tuned to one Python-basics course, with no way to recalibrate per course (rag-pipeline-reviewer)
- [LOW] [fixed] content/demo-teacher/qa-recall.yaml — all 38 gold items were `reviewed_by: pending`; the lead signed them (rag-pipeline-reviewer)
- [LOW] [fixed] packages/db/src/repositories/retrieval.ts — NOTE_MATCH_FLOOR and TEXT_HALF were provisional; Phase D calibrated them (security-reviewer, Phase A)
