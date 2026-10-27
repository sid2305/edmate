# 8.2r review — APPROVE

Reviewers: database-reviewer, code-reviewer, typescript-reviewer

## Findings
- [MEDIUM] [deferred 8.2s] content.ts (packages/db/src/schema/) documents_teacher_id_created_at_id_idx declares createdAt.desc() and id.desc() without .nullsFirst(), so the drizzle snapshot says NULLS LAST while the hand-written SQL uses the Postgres default (NULLS FIRST); harmless at runtime today because the query and the index agree (database-reviewer).
- [LOW] [wontfix] _journal.json (packages/db/migrations/meta/) entry 41's `when` is earlier than entries 39 and 40; drizzle orders by idx, so this is cosmetic (database-reviewer).

## Verdict
Pass. The migration is safe on a live table: the CHECK is swapped inside one transaction, the new sweep index is built CONCURRENTLY before the old one is dropped (both IF [NOT] EXISTS), and the EXPLAIN tests cover both the current and 8.2q's widened sweep query. code-reviewer and typescript-reviewer found nothing. 8.2q also edits packages/db/test/ingest-sweep.int.test.ts, so main is merged into 8.2q after this lands.
