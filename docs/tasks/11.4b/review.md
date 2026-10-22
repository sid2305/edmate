# 11.4b review — APPROVE
Reviewers: security-reviewer, code-reviewer, typescript-reviewer

security-reviewer, code-reviewer and typescript-reviewer (all sonnet) reviewed the studio API for class recordings. A foreign, unstarted or missing class gives 404 before anything is signed or written; m4a, mp4 and webm over 24 MB get a 413 with the new message, with or without a class, while mp3 and wav keep 500 MB; rightsDeclared stays required. No CRITICAL or HIGH; the MEDIUM and LOW go to 11.4f.

## Findings
- [MEDIUM] [deferred 11.4f] apps/web/src/studio/routes.ts:208 — newFile picks the 413 message by comparing maxBytes with 24 MB instead of a splittable flag on UploadType.
- [LOW] [deferred 11.4f] apps/web/src/studio/files.ts:41 — media() takes a positional boolean.
