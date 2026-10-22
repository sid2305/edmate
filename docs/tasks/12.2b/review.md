# 12.2b review — APPROVE

Reviewers: security-reviewer (sonnet; also as typescript-reviewer and code-reviewer), database-reviewer (sonnet), lead

Takedowns are staff-only: create, lift and list return `scope` to anyone else and write nothing. Every create, lift and linked report review commits with its audit row in one transaction. The single notTakenDown predicate is wired into every student-facing read: retrieval rank (text, vector, term stats), material and leakCheck, chunks.listForModule and reports' cited documents. An agent takedown suspends the agent, and only lift restores it. Report linking is scoped to the teacher. The lock order matches publish.ts. The two-connection test against publish.goLive passed in both queue orders when the database reviewer ran it on its own container (58/58). EXPLAIN shows takedowns_target_idx. No migration.

## Findings
- [LOW] [wontfix] packages/db/test/repositories.int.test.ts — a cosmetic reformat of existing CASES lines (whitespace only); the branch merges cleanly with main and no running build edits this file.
- [LOW] [wontfix] packages/db/src/repositories/index.ts — import-order nit.
