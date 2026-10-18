# 2.2 review — APPROVE
Reviewers: security-reviewer (opus), typescript-reviewer (sonnet), silent-failure-hunter (sonnet)

security-reviewer confirmed keys are revealed only when each SDK client is built, errors keep only the HTTP status and a fixed message, neither SDK falls back to env vars (the sentinel test is real), the base URL comes from config, and unknown tools throw. typescript-reviewer confirmed the adapters match the contracts port, use the current AI SDK API, round-trip tool names, and pin exactly (145 tests then; 171 after the fix round, 100% coverage). silent-failure-hunter re-verified its findings at 3795731.

## Findings
- [HIGH] [fixed] packages/gateway/src/adapters/sdk-adapter.ts:117 — truncated ('length') or filtered ('content-filter') answers passed as complete. Now a GatewayError with reason `truncated` / `content_filter`, for stream and generateObject, tested per provider. Re-verified by silent-failure-hunter.
- [MEDIUM] [fixed] packages/gateway/src/adapters/sdk-adapter.ts:81 — missing usage reported as zero tokens. Now no usage chunk; real zeros stay zeros. The OpenAI-compatible SDK's own zero-filling of partial usage is a documented limit for 2.4. Re-verified by silent-failure-hunter.
- [MEDIUM] [fixed] packages/gateway/src/adapters/sdk-adapter.ts:94 — stopping a stream early didn't cancel the provider request (still billing). AbortController aborted in `finally`; tested. Re-verified by silent-failure-hunter.
- [LOW] [fixed] packages/gateway/src/adapters/openai-compatible.ts:45 — base URL now must be https unless the host is local.
- [LOW] [deferred 5.5] packages/gateway/src/adapters/sdk-adapter.ts:61 — tool arguments aren't checked against the tool's input schema; the tool registry (5.5) validates them before running a tool.
- [LOW] [wontfix] packages/gateway/src/adapters/sdk-adapter.ts:151 — `result.output as T` cast may be unnecessary. See decision log 18 Oct 2026.
