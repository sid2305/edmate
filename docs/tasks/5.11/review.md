# 5.11 review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

One fix round (f71a696); typescript-reviewer re-checked it and found it fixes the ScriptedGateway path only.

## Findings

- [HIGH] [deferred 5.11a] packages/ingest/src/outline/draftOutline.ts:72 — the fix branches on ZodError, but the real gateway maps a schema failure to GatewayError('validation', retryable false), so real traffic still gets provider_error/retryable true. Same at packages/ingest/src/styleCard/draftStyleCard.ts:78. Fix: branch on the gateway's validation code and test that error shape.
- [MEDIUM] [fixed] packages/ingest/src/styleCard/draftStyleCard.ts:62 — the word-limit schema failure surfaced as provider_error retryable (fixed for ScriptedGateway; the real-gateway part is the HIGH above).
- [MEDIUM] [deferred 5.11a] packages/ingest/src/outline/draftOutline.ts:85 — modules are drafted one after another; they are independent and could run in parallel.
- [LOW] [deferred 5.11a] packages/ingest/src/outline/draftOutline.ts — draftFailed() gives one message for every cause.
