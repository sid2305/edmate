# 8.2 review — APPROVE
Reviewers: security-reviewer (opus), database-reviewer (sonnet), code-reviewer (sonnet), typescript-reviewer (sonnet)

Rounds: database-reviewer and security-reviewer (sonnet) on Phases 1–2 (8db6eca); security-reviewer (opus) on Phase 3 (bfe556c); code-reviewer and typescript-reviewer on the whole diff, and security-reviewer (opus) on the fix round plus Phase 4 (bfe556c..056c4d4). Risky paths: `packages/db/src/repositories/**` and `apps/web/src/auth/policy.ts`, both reviewed by security-reviewer; risk: high decisions are in the handoff. Every final verdict was APPROVE with no CRITICAL or HIGH. The manual dev-stack run is deferred (see the handoff decision).

## Findings
- [MEDIUM] [fixed] apps/worker/src/ingest/processor.ts:85 — the storageKey check and the chunk insert were separate round trips, so a replace committed in between let old-file chunks land; now one INSERT…SELECT (chunks.insertManyIfStorageKey), f18a429.
- [MEDIUM] [fixed] apps/worker/src/storage/client.ts:18 — getObjectBytes read the whole object before the 20 MB cap; now streams with a byte guard, f18a429.
- [LOW] [fixed] apps/worker/src/ingest/processor.ts — re-read per insert batch; removed by the single-statement insert, f18a429.
- [LOW] [fixed] apps/web/src/studio/routes.ts:284 — replace signed the URL after startReplace; now signs first, so a signing failure commits nothing, 056c4d4.
- [LOW] [fixed] apps/web/src/storage/presign.ts:37 — production fell back to dev credentials and http; now fails closed with a code-only log, 056c4d4.
- [LOW] [fixed] apps/web/src/studio/runtime.ts:63 — a second database pool; now shares serverDatabase(), 056c4d4.
- [MEDIUM] [deferred 8.2a] apps/worker/src/storage/roundtrip.ts:44 — the worker's storageConfigFromEnv still falls back to dev credentials, the edmate-dev bucket and http under production, and its error quotes the endpoint; must be fixed before any deploy.
- [MEDIUM] [deferred 8.2a] apps/web/src/studio/routes.ts:215 — create writes the row before signing, so a signing failure leaves an orphan uploading row (the teacher can delete it); sign first as replace does.
- [LOW] [deferred 8.2a] apps/web/src/studio/routes.ts:256 — replace during complete can race; compare-and-set on the storage key, answering 409.
- [LOW] [deferred 8.2a] apps/web/src/studio/routes.ts:181 — failed S3 deletes are only logged; needs a retrying delete.
- [LOW] [deferred 8.2a] apps/web/src/studio/routes.ts:208 — no per-teacher quota or rate limit on create.
- [LOW] [deferred 8.2a] apps/web/src/storage/presign.ts:74 — production accepts explicitly set dev placeholder credentials.
- [LOW] [deferred 8.2a] docker/compose.yaml:112 — S3_ALLOW_HTTP 'true' on a NODE_ENV=production service; the deploy docs must say production never sets it.
- [LOW] [deferred 8.2a] apps/web/app/teacher/uploads/UploadsView.tsx — setState after awaits with no unmount guard.
- [LOW] [deferred 8.2a] packages/db/src/schema/content.ts:88 — composite index (teacher_id, created_at desc, id desc) for listForTeacher.
- [LOW] [deferred 8.2a] packages/db/migrations/0017_document_status.sql:3 — NOT VALID plus VALIDATE for the check at scale.
