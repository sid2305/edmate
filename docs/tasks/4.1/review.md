# 4.1 review — APPROVE
Reviewers: safety-reviewer (opus), typescript-reviewer (sonnet), silent-failure-hunter (sonnet)

All three reviewed 8f3b92b. typescript-reviewer and silent-failure-hunter approved. safety-reviewer found one HIGH: a later rewrite was never re-checked by the guards that had already run. One fix round (8f315b7) fixed it, along with the cheap MEDIUMs and LOWs, and safety-reviewer's re-verification approved. Harness 2,186 tests pass; `src/guardrails` is at 100% coverage. The 2,000-chain property test passes, and the secret scan is clean.

## Findings
- [HIGH] [fixed] packages/harness/src/guardrails/chain.ts:156 — guards that already ran never re-checked a later rewrite (e.g. grounding re-inserting a withheld answer). Now every guard runs a second pass over the final text; a rewrite or block on that pass becomes `block` (`rewrite_unverified`), and an escalate still escalates.
- [MEDIUM] [fixed] packages/harness/src/guardrails/chain.ts:29 — the raw `failure.error` could quote unscrubbed input or model output. Now only `errorName` is kept, capped at 100 characters.
- [MEDIUM] [fixed] packages/harness/src/guardrails/chain.ts:123 — a `block` result still carried `text`. Text now exists only on `ok` and `escalate`.
- [MEDIUM] [fixed] packages/harness/src/guardrails/chain.ts:126 — an empty guard list returned ok. Now it returns `failed` (`empty`).
- [MEDIUM] [fixed] packages/harness/src/guardrails/chain.ts:120 — a framework failure looked like a guard's own block. There is a new `failed` outcome, and the event carries `pass` and `cause`.
- [MEDIUM] [fixed] packages/harness/src/guardrails/chain.ts:113 — an async observer that rejected caused an unhandled rejection. Thenables are now caught.
- [LOW] [fixed] packages/harness/src/guardrails/guard.ts:16 — the step's cancel didn't reach the guard in flight. Now it is linked.
- [LOW] [fixed] packages/harness/src/guardrails/chain.ts:66 — guards were read live, and undeclared names reached the trace. Now the guard list is snapshotted and the trace shows `(undeclared)`.
- [LOW] [fixed] packages/harness/src/guardrails/chain.ts:650 — `checkChain` widened to `unknown`. Now it is generic.
- [LOW] [deferred 4.2] packages/harness/src/guardrails/chain.ts:219 — the second pass needs each rewriting guard to return ok on its own output (placeholders like `[phone]` must not match). This is an acceptance line for 4.2 and for every later rewriting guard.
- [LOW] [deferred 4.3] packages/harness/src/guardrails/chain.ts:219 — the text returned with an escalate may include unchecked rewrites. The 4.3 and 4.5 steps save it but always reply with the caring template.
- [LOW] [deferred 4.3] packages/harness/src/guardrails/chain.ts:204 — one cancel listener per guard run is never removed (at most about 18 per turn). Add removal if `CancelToken` gains it.
