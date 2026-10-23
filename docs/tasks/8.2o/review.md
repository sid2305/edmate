# 8.2o review — APPROVE
Reviewers: code-reviewer, security-reviewer

The 8.2n review follow-ups are in. Replace refuses a teacher note, and it refuses to turn a live-class-linked transcript into plain material. Both checks run inside `startReplace`'s own `FOR UPDATE` transaction, after the teacher-scoped `lockDocument`. Another teacher's document still gets `not_found`, so a caller can't learn whether a row exists. The route refuses with a fixed 409 message before any signed URL reaches the client. `FileChunkKind` is named once in packages/db. The upload-type `transcribe` flags are pinned against the queue's job schema. Neither reviewer found an issue at any severity. The code reviewer noted that the route's blanket catch on `invalid` would need a reason code if another `startReplace` guard is added later. That is a note for the future, not a finding.

## Findings
None.
