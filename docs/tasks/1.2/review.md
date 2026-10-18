# 1.2 review — APPROVE
Reviewers: security-reviewer (opus), database-reviewer (sonnet), typescript-reviewer (sonnet)

security-reviewer confirmed every WHERE carries the scope, writes check ownership in the same statement (INSERT…SELECT) or transaction, message and trace queries go through sessions, ids are validated before any SQL, no SQL is built from raw input, and the root export has no db handle; CI ran the isolation test on real Postgres (16 methods, 0 leaks each). database-reviewer confirmed index use, caps, deterministic ordering, atomic ownership-checked writes and bounded pool settings. typescript-reviewer confirmed jsonb columns are typed against contract shapes with compile-time checks, the TranscriptStore port matches exactly, and the public/internal export split is enforced. security-reviewer re-verified both fixes at e5c8df4.

## Findings
- [MEDIUM] [fixed] packages/db/src/repositories/errors.ts:68 — unexpected driver errors carried query params (student ids, message text) into error messages. Every method now throws RepositoryError with only the pg code and constraint; tested with an unreachable host and a real statement timeout. Re-verified by security-reviewer.
- [LOW] [fixed] packages/db/src/repositories/messages.ts:54 — a message id from another student's session returned `invalid`, so ids could be probed. Now `not_found`. Re-verified by security-reviewer.
- [LOW] [deferred 8.9] packages/db/src/repositories/teacher-questions.ts:1295 — listForStudent isn't covered by a composite (teacher_id, student_id, created_at) index; capped at 200. Add the index with the questions inbox.
- [LOW] [wontfix] packages/db/src/repositories/scope.ts:12 — scope types are structural, not branded. See decision log 18 Oct 2026.
