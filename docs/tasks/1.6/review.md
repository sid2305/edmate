# 1.6 review — APPROVE
Reviewers: security-reviewer (sonnet), database-reviewer (sonnet)

security-reviewer confirmed the log is append-only, `listForTeacher` hides student rows, `checkActor` blocks teacher/student impersonation, errors are scrubbed and all SQL is parameterised, then re-verified the redaction fix at 8b0eeb3 by hand (compound, nested, mixed-case keys and email/phone values redacted; `clientIp`, `ipAddress`, `userBio` caught; `subscriptionId`, `description`, `biology` untouched). database-reviewer confirmed the atomic ownership-checked insert, capped deterministic lists backed by indexes, and bounded JSON. 237 db tests.

## Findings
- [HIGH] [fixed] packages/db/src/repositories/redact-json.ts:16 — redaction matched exact keys only, so `studentEmail`, `parentName`, `guardianPhone`, `fullName` stored raw personal data. Keys containing a denylisted term are redacted (`ip`/`bio` as whole words), plus email- and phone-shaped values. Re-verified by security-reviewer.
- [LOW] [fixed] packages/db/src/repositories/redact-json.ts — cross-script homoglyph keys can bypass the fold; documented in a code comment.
- [LOW] [wontfix] packages/db/migrations/0002_audit_log_scope.sql:1 — new NOT NULL columns have no backfill. See decision log 18 Oct 2026.
- [LOW] [wontfix] packages/db/src/schema/operations.ts:163 — no ts-leading index for a cross-teacher retention sweep. See decision log 18 Oct 2026.
