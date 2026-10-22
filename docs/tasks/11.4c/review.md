# 11.4c review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer

All three reviewers approved. Every check in the brief passed: submit stays disabled until a file, a module and both checkboxes are set; liveClassId and rightsDeclared: true are sent; the 24 MB pre-check runs before create; one busy flag in try/catch/finally resets the form after success and after failure; payloads go through safeParse with a fallback; the page reads only the signed-in teacher's data; fixtures hold no personal data. The one gap is the one the builder flagged: a recording whose upload fails stays "Uploading" and the 5 s poll keeps running while the page is open. The upload centre already behaves the same way, so both are fixed together in 11.4g.

## Findings
- [MEDIUM] [deferred 11.4g] apps/web/app/teacher/live-classes/RecordingUpload.tsx:155 — a failed PUT or complete leaves the row "uploading", so LiveClassesView.tsx:115 polls every 5 s without bound while the page is open; report a failed row and cap the poll (same gap in the upload centre).
- [LOW] [deferred 11.4g] apps/web/app/teacher/live-classes/RecordingUpload.tsx:107 — the create→PUT→complete chain has no unmount guard; skip state updates and onRecording once unmounted.
- [LOW] [deferred 11.4g] apps/web/app/teacher/live-classes/LiveClassesView.tsx:118 — the poll has no attempt or time cap for a stuck upload (security-reviewer's view of the MEDIUM).
