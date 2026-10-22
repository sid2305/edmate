# 8.7k review — APPROVE

Reviewers: security-reviewer (sonnet; also as typescript-reviewer and code-reviewer), lead

The security reviewer approved with no CRITICAL, HIGH or MEDIUM findings. It traced the new `changedSinceLastPublish` SQL column by column against the schema and against startRun's basis. Every sub-select is filtered by the scope's teacherId, never a request field, and the read returns a bare boolean. The isolation grid and leak.test.ts both cover it. The shared files (repositories.int.test.ts, leak.test.ts, en.json) have additive lines only. The builder ran the db (26/26) and web (34/34) gates green; the reviewer checked by reading, without a local Postgres. The LOWs go to 8.7l.

## Findings
- [LOW] [deferred 8.7l] apps/web/app/teacher/page.tsx:12-15 — the new read has no local try/catch, so a DB error breaks the whole /teacher page (before, it made no DB call). The note is informational: catch, log the error name and default to false.
- [LOW] [deferred 8.7l] packages/db/src/repositories/publish.ts — with no course row, the outline sub-select makes the OR chain SQL NULL, which reads as false. Harmless (publishing needs a course), but add a comment or a coalesce.
- [LOW] [wontfix] apps/web/app/teacher/page.tsx — `await TeacherView({ changedSincePublish })` instead of JSX, because the tests can't render an async Server Component as a JSX child; same as the welcome/age page precedent.
