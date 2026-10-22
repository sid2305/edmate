# 12.3b review — APPROVE

Reviewers: security-reviewer, code-reviewer, typescript-reviewer

All three reviewers ran on the branch diff (packages/db chunks.ts, takedowns.ts, map.ts and tests). The security-reviewer found no issues. Every touched read and write stays teacher-scoped, and `countUpheld` takes a strict TeacherScope. The builder's risk: medium decision is sound and tested: the takedown.create audit row is staff-written, has no foreign key to documents, and so still proves ownership after the teacher deletes the document. `rightsDeclared` is `z.literal(true).optional()` per the lead's answer, and a false or malformed value is `invalid` before any SQL. Two LOWs are deferred to 12.3e.

## Findings
- [LOW] [deferred 12.3e] packages/db/src/repositories/chunks.ts — a startReplace JSDoc continuation line lost its leading asterisk (fails prettier --check).
- [LOW] [deferred 12.3e] packages/db/test/documents.int.test.ts — non-null assertions after `expect(...).not.toBeNull()`; narrow with a guard instead.
