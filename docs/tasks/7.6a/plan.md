# 7.6a plan — live sweep follow-ups

READY (lead-written plan, 21 Oct 2026; the work is the 7.6 review's deferred findings, see docs/tasks/7.6/review.md and the handoff's open points).

Budget: 60 tool calls.

Risky paths: packages/harness/src/guardrails/blockReplies.ts (one cast removed) — reviewers: code-reviewer.

## Steps (test-first)
1. **Second provider.** apps/cli/src/commands/chat/gateway.ts `createChatGateway` builds an `openai-compatible` adapter factory too, following `judgeGateway.ts`'s per-provider pattern and the existing `@edmate/gateway` openai-compatible adapter. The sweep passes each live-models.yaml entry's provider and `baseURL`. Its key comes from an env var only (name it after the existing pattern; document it in EVAL_USAGE), and is never logged. Test with scripted gateways: a two-entry yaml (anthropic plus openai-compatible) sweeps both.
2. **Sweep resilience.** `runModelSweep` wraps each (model, suite) pair; a failure is recorded in `summary.json` (an error field per pair) and the sweep continues; exit code 1 if any pair failed.
3. Empty-suite detection by a typed or named loader error (packages/evals loader), not by message text.
4. Thread cost as a required value; drop `report.cost!`.
5. `--models` together with `--fixtures` or `--report` is rejected with a usage error.
6. Drop the `as string[]` cast in `isBlockReply`.
7. Add a comment on the live-models schema in packages/evals/src/liveModels.ts saying the schema must never gain a key field.

Do not add new models to evals/live-models.yaml and never edit prices.yaml USD values; picking the low-cost second provider is the human's call before the live run.
