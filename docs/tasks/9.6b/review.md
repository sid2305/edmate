# 9.6b review — APPROVE

Reviewers: security-reviewer (sonnet), typescript-reviewer (sonnet), code-reviewer (sonnet), lead

## Findings

- [HIGH] [fixed] docs/tasks/9.6b/handoff.md — the handoff was missing from the branch (code-reviewer HIGH, security-reviewer LOW). The lead recovered it word for word from the builder's transcript and committed it (see the lead decision in the handoff).
- [MEDIUM] [deferred 9.6g] apps/web/src/export/notes.ts — answeredPairs matches a teacher's answer to its question by timestamp only, so two questions answered close together can swap answers in the notes PDF. The builder logged it as a decision; it reads only this student's own messages, so nothing leaks.
- [MEDIUM] [deferred 9.6g] apps/web/src/export/routes.ts — a double `as unknown as` cast wires the db cursor type into ExportBackend; it is safe at run time (the repository still validates) but hides shape drift.
- [LOW] [deferred 9.6g] apps/web/src/export/pdf.ts — the bullet (U+2022) is added after the WinAnsi clamp, so every bulleted line prints a stray quote mark, and its width is not counted when wrapping.
- [LOW] [deferred 9.6g] apps/web/src/export/pdf.ts — toWinAnsi does not strip 0x80-0x9F, and the width table has no Latin-1 supplement entries.
- [LOW] [deferred 9.6g] apps/web/src/export/routes.ts — fromError does not log the error name on the 500 path (the same as the existing memory routes).

Verified: the student id comes only from the session and the teacher from agents.owner; the export has no read path to help_state, answer keys, teacher-only fields or safety events, and a test checks the serialised JSON for them; paging uses a keyset cursor with a 200-page ceiling that throws instead of truncating; the PDF escapes `\`, `(` and `)` and strips control characters; both routes send no-store and nosniff, and the download filename comes from a validated agent id; the clearance-scan exception mirrors the memory page.
