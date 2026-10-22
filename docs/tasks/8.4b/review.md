# 8.4b review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings
- [HIGH] [fixed] apps/web/src/studio/styleCardClient.ts — call() did not catch a malformed JSON body on a 200, so the promise rejected; now returns provider_error, with a test. Verified by the lead.
- [HIGH] [fixed] apps/web/app/teacher/style-card/StyleCardView.tsx — onDraft/onSave reset the busy flags only after the await, so a throw left the buttons disabled; now try/catch/finally with the error alert, with a test. Verified by the lead.
- [LOW] [deferred 8.4c] apps/web/app/teacher/style-card/StyleCardView.tsx — a late draft response can overwrite text the teacher already saved; ignore stale results.
