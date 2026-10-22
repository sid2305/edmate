# 8.2l review — APPROVE
Reviewers: architect (opus), security-reviewer (sonnet), typescript-reviewer (opus), code-reviewer (sonnet)

No CRITICAL or HIGH findings. The ADR-0014 amendment matches the 8.2c plan's Phase C draft word for word and doesn't widen egress (it records B-47). The caption rows reuse the fixed upload type table and the 20 MB document cap, and `complete` re-checks the stored object's content type. The typescript-reviewer re-ran the web gate: 34 of 34 tasks green. The lead added the 8.2c reviewers line to the ADR (architect LOW). The MEDIUM and the other LOWs are deferred to 8.2n.

## Findings
- [MEDIUM] [deferred 8.2n] apps/web/src/studio/routes.test.ts:380 — the YouTube refusal test only matches "YouTube", so reverting the new words still passes; assert the exact string (typescript-reviewer, architect)
- [LOW] [deferred 8.2n] apps/web/src/studio/uploadClient.test.ts:165 — the YouTube fixture still uses the old words (typescript-reviewer, architect)
- [LOW] [deferred 8.2n] apps/web/src/studio/routes.test.ts:547 — the complete route is tested for .vtt only, not .srt (typescript-reviewer)
- [LOW] [deferred 8.2n] apps/web/src/studio/routes.ts:347 — pre-existing: replace keeps documents.kind, so a PDF replaced by a .vtt stays material; the needs-transcription rule lives in routes, not on UploadType (architect, typescript-reviewer)
- [LOW] [deferred 8.2n] apps/web/app/teacher/uploads/UploadsView.test.tsx:120 — an unneeded HTMLInputElement cast (typescript-reviewer)
- [LOW] [fixed] docs/adr/0014-web-link-egress.md:87 — Reviewers named only the 8.2e amendment's reviewers; the lead added the 8.2c line (architect)
- [LOW] [wontfix] apps/web/src/studio/files.ts:46 — no byte sniffing of caption files; the same as every upload type, and the server re-checks the stored content type (security-reviewer)
- [LOW] [wontfix] apps/web/src/studio/uploadClient.ts:60 — contentTypeFor prefers the extension over a mismatched browser type; client-side only, the server re-checks (security-reviewer)
