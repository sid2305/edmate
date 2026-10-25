# 13.3 findings — Phase A (DB scope and the access filter)

Reviewer: security-reviewer (sonnet), read-only, 25 Oct 2026.

**Verdict: PASS (no HIGH).** No CRITICAL or HIGH findings in scope.

## Findings
- [LOW] packages/db/src/repositories/chunks.ts:62-83, 100-117 — scope hygiene. The module-level helpers `insertTopicLinks` and `topicSources` take `teacherId` as a plain string instead of going through `teacherScope()`. Today their only caller is outline.ts, which validates scope first, so nothing bypasses it. But the scope.test.ts auto-discovery grid does not reach free functions. Fix: fold them into a scoped repo object, or add them to the grid explicitly.
- [LOW] packages/db/src/repositories/teacher-questions.ts:211-229; chunks.ts:68-86, 637-641 — raw SQL hygiene. These are hand-written INSERT ... SELECT and jsonb_to_recordset statements. Every value is a bound parameter or a schema-derived identifier, so they are not exploitable. They are flagged as the place where a future edit could reintroduce interpolation; the existing scope.test.ts raw-SQL guard stays as the regression guard.

## Checked clean
- The repositories scope.ts, map.ts, insert.ts and retrieval.ts: every query path has the teacher, module and takedown filters, and tsquery terms are bound.
- chunks.ts: writes are scoped INSERT ... SELECT, and lock ordering is correct.
- question-similarity.ts.
- teacher-questions.ts: lock order is correct.
- insights.ts: the privacy floor of at least 5 is enforced in SQL and again in zod, and the closed-week guard is in place.
- leakCache.ts: keyed per teacher and revision.
- harness access/{entitlement,scopedRetrieval,tools}.ts: all fail closed, and returned chunks are re-validated.

Existing coverage cited: packages/db/test/{scope,access-property.int,leak,leak-cache,retrieval-leak.int}.test.ts.
