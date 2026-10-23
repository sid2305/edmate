# 11.4g review — APPROVE

Reviewers: code-reviewer, typescript-reviewer

Both reviewed the build and re-verified the fix round. A failed PUT or complete call now reports a failed row. Each pending row has its own poll window, so a row stuck past the cap no longer stops a newer row from polling. Upload progress events after unmount are ignored. The new key `uploads.pollTimeout` is used on both pages, and the tests use fake timers.

## Findings
- [HIGH] [fixed] apps/web/app/teacher/live-classes/RecordingUpload.tsx:159 — the progress callback updated state after unmount; it is now gated by `alive`, and a test fires a late progress event.
- [MEDIUM] [fixed] apps/web/app/teacher/live-classes/LiveClassesView.tsx:122 — one shared poll-cap clock; the window is now per row.
- [MEDIUM] [fixed] apps/web/app/teacher/uploads/UploadsView.tsx:116 — the same fix, per-row windows.
- [LOW] [fixed] apps/web/app/teacher/live-classes/RecordingUpload.tsx:175 — a comment explains the failed-row guard's reliance on stage order.
