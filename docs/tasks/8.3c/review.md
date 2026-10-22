# 8.3c review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings
- [HIGH] [fixed] apps/web/src/studio/outlineClient.ts — call() did not catch a malformed JSON body on a 200; now returns provider_error, with a test. Verified by the lead.
- [HIGH] [fixed] apps/web/app/teacher/outline/OutlineView.tsx — load, save and generate had no catch and no busy flag (unhandled rejection, concurrent saves); now try/catch/finally with a busy flag that disables Save and Generate, with tests. Verified by the lead.
- [MEDIUM] [fixed] apps/web/app/teacher/outline/OutlineView.tsx — the initial fetch set state after unmount; now guarded by an ignore flag.
- [LOW] [deferred 8.3d] apps/web/app/teacher/outline/OutlineView.tsx — Split silently does nothing when the title is empty or no chunk is picked; show a validation message.
- [LOW] [deferred 8.3d] apps/web/src/studio/outlineClient.ts — asJson casts the body to T without runtime validation (same pattern as uploadClient.ts).
