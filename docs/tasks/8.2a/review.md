# 8.2a review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer, database-reviewer, silent-failure-hunter

## Findings
- [MEDIUM] [deferred 8.2q] apps/web/src/studio/routes.ts — if the signing fails and the cleanup delete also fails, an uploading row survives; the ingest sweep only scans processing rows (security-reviewer)
- [MEDIUM] [deferred 8.2q] apps/web/app/teacher/uploads/UploadsView.tsx — onAddLink has no unmount guard, unlike refresh, send, finish and onDelete (typescript-reviewer)
- [LOW] [deferred 8.2q] apps/web/src/studio/routes.ts — no test for the cleanup-delete-fails branch (database-reviewer, silent-failure-hunter)
- [LOW] [deferred 8.2q] apps/web/src/storage/presign.ts — S3_REGION is not in REQUIRED_IN_PRODUCTION, also in apps/worker/src/storage/roundtrip.ts (silent-failure-hunter)
- [LOW] [wontfix] apps/worker/src/storage/roundtrip.ts — production storage-config check duplicated with apps/web/src/storage/presign.ts; see the lead decision (typescript-reviewer)
- [LOW] [wontfix] packages/db/src/repositories/modules.ts — list() has no row limit, same as ids(); see the lead decision (database-reviewer)
