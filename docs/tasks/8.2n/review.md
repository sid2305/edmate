# 8.2n review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer

All three reviewed 07e77745. No CRITICAL or HIGH findings. Every title item is done and tested; the YouTube refusal test fails if the words revert (code-reviewer checked by reverting them); replace updates documents.kind both ways under the teacher-scoped FOR UPDATE, and `transcribe` comes only from the static upload-type table. MEDIUM and LOW findings are deferred to 8.2o.

## Findings

- [MEDIUM] [deferred 8.2o] apps/web/src/studio/routes.ts:393 — replace flips a live-class-linked transcript row to material while live_class_id stays set (create guards this; replace does not).
- [LOW] [deferred 8.2o] packages/db/src/repositories/chunks.ts — replace still accepts a teacher_note row despite the "no file to replace" comment.
- [LOW] [deferred 8.2o] apps/web/src/studio/files.ts — `transcribe` duplicates the queue's refine rule; add an IngestJobSchema parse test.
- [LOW] [deferred 8.2o] packages/db/src/repositories/chunks.ts — the material|transcript union is not named in db.
- [LOW] [deferred 8.2o] apps/web/src/studio/routes.test.ts — the YouTube refusal sentence is copied into three files.
