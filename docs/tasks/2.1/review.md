# 2.1 review — APPROVE
Reviewers: security-reviewer (opus), typescript-reviewer (sonnet)

security-reviewer probed a scratch copy of the key type: the value never appeared via util.inspect (incl. showHidden), JSON, string conversion, util.format, error `cause`, structuredClone, spreading, Object.entries/ownKeys or a Proxy; Zod issues and source errors never leave the module; env lookups use own properties only. typescript-reviewer re-ran the gateway gates (65 tests, `src/keys` 100%), confirmed no `any`, exact pins and minimal exports, and that the leak tests have a positive control.

## Findings
- [LOW] [wontfix] packages/gateway/src/keys/load.ts:95 — the caller's provider id is copied into error messages. See decision log 18 Oct 2026.
- [LOW] [deferred 2.2] packages/gateway/src/keys — `@ai-sdk/openai` falls back to `OPENAI_API_KEY` when no key is passed; 2.2's adapters must always pass `apiKey`, with a test.
- [LOW] [wontfix] packages/gateway/src/keys/load.ts:88 — `raw as string` relies on `keyProblem` rather than a type guard. See decision log 18 Oct 2026.
- [LOW] [wontfix] packages/gateway/src/keys/load.ts:121 — generic cast in `get()`. See decision log 18 Oct 2026.
