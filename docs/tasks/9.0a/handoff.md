# 9.0a handoff: web runtime, image and compose wiring (9.0 Phase A: W1-W4, W6)

- **Status:** DONE
- **Branch:** `m9/9.0a-web-wiring` (built on local `work-90a`)
- **Worktree:** `.claude/worktrees/agent-a7afc7f8b6969956e`
- **Tool calls used:** 38 (budget 60)

## What changed

- `apps/web/Dockerfile` (W1): the runtime image also copies `content/prompt-packs` and `content/skills`, which the turn runtime reads.
- `docker/compose.yaml`:
  - `web` (W2-W4, W6): `EDMATE_MARKET` (default `US`), `EDMATE_CHAT_AGENTS` (default `demo-agent`), `EDMATE_ANTHROPIC_API_KEY` (no default), `EDMATE_DEV_MODEL` (empty default, so off).
  - `worker` (D3, D4): now a map that merges `*app-env` and adds `EDMATE_OPENAI_API_KEY` (no default) and `EDMATE_INGEST_EMBEDDINGS` (default `off`). The worker starts reading the second one in Phase B (9.0b). Until 9.0b merges, the line does nothing.
- `docker/env.example`: documents `EDMATE_MARKET`, `EDMATE_CHAT_AGENTS`, `EDMATE_DEV_MODEL` (local only, what it does, never a substitute for review) and `EDMATE_INGEST_EMBEDDINGS`.
- `apps/web/src/turn/devModel.ts` (new, W6/D2):
  - `devModelEnabled(env)`: unset or empty means off. The dev model is on only when the value is exactly `scripted` and `AUTH_URL` parses as `http:` on host `localhost`, `127.0.0.1` or `[::1]`, with no userinfo. Anything else throws `TurnUnavailableError('EDMATE_DEV_MODEL')`.
  - `devModelAdapter(model)`: a `ModelAdapter` with id `anthropic`.
    - `stream`: every reply starts `[dev model]` and quotes the first `[1] …` material block, the way `compose.ts` renders it. With no material it gives a fixed "no material" line. It then sends a usage step, priced by the real meter.
    - `generateObject`: returns the first fixed "all clear" candidate the schema accepts. The candidates cover moderation, jailbreak, distress, grounding, advice, route intent, route fallback and session summary. It throws on any other schema.
    - `embed`: throws.
  - `devFactories()`: replaces only `factories.anthropic`. The router, guards, pricing and commit stay real.
- `apps/web/src/turn/runtime.ts`: `build()` calls `devModelEnabled(env)` first. When it passes, the build uses `devFactories()` and logs one `turn.dev_model_on` line; no key is read. Otherwise it behaves as before.
- `apps/web/test/turn-backend.ts`: an optional `gateway` override, which replaces the scripted gateway and the judge wrappers.
- Tests:
  - `devModel.test.ts` (new).
  - `runtime.test.ts`: 4 dev-model cases, plus a `loadProviderKeys` call counter.
  - `routes.test.ts`: one real `defaultSteps` turn through the dev adapter.
  - `src/deploy/stack-config.test.ts` (new): text checks over the Dockerfile and compose file, each also run against a mutated copy of the text.

## State after A
The image ships every content dir the web reads at run time. Compose wires the market, the chat agents, key passthrough and the dev-model flag. `EDMATE_DEV_MODEL=scripted` works on localhost only and fails closed anywhere else.

## Evidence

Red first:
- `vitest run src/turn/runtime.test.ts src/turn/devModel.test.ts` before the runtime wiring:
  - × on localhost, builds with no provider key, logs turn.dev_model_on and loads no key
  - × anywhere else, or with AUTH_URL unset, fails closed by its code alone
  - × only the exact value turns it on: yes or Scripted fail closed, even with a key
  - Tests: 3 failed | 31 passed
- `vitest run src/deploy/stack-config.test.ts` before the Dockerfile and compose edits: Tests: 8 failed | 5 passed. The failures were the prompt-packs and skills copies, market, chat agents, Anthropic key, dev model, OpenAI key and ingest embeddings.
- The route test first ran with "What is a fraction?". The memory retrieval found no word overlap, so the turn went to ask_teacher. I changed the question so the material is retrieved.

Green:
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web... --concurrency=1` with `TEST_REDIS_URL=redis://127.0.0.1:56390`:
  - Tasks: 34 successful, 34 total
  - @edmate/web Tests: 876 passed (876)
  - Coverage: `devModel.ts` 100 % lines, 95.8 % branches; `turn/runtime.ts` 100 % lines.
- `python3 .githooks/secret-scan.py --all`: clean, no findings.

Environment note: the shared `edmate-redis-1` container on 56379 (another session's stack) answers `MISCONF` (it can't write to disk). The `@edmate/queue` integration suite therefore skipped and failed its 100 % coverage gate. I ran the gate against a throwaway `redis:7.4.6-alpine` on 127.0.0.1:56390 (no persistence), then stopped it. This has nothing to do with this change.

## Deviations
- The `turn.dev_model_on` line goes through `ServerLog.error`, because `ServerLog` has only `error`. That makes it a loud line, which suits a switch that stands in for the classifiers.
- Grounding, advice, route and summary schemas are not exported from `@edmate/harness`, so `devModel.test.ts` checks copies of them. The route-level test runs the real ones: moderation, distress, jailbreak, grounding and advice all pass through real `defaultSteps`, the turn reaches `done`, and there is no `error` event.

## Review recommendation
`security-reviewer` should read `apps/web/src/turn/devModel.ts` and the `runtime.ts` change (D2), even though neither path is on the risky list. Also `code-reviewer` and `typescript-reviewer`.

## Decisions

### 22 Oct 2026 · 9.0a Dev model `EDMATE_DEV_MODEL=scripted`, local only · decided by builder · risk: medium
- Decided: The plan's D2. The scripted provider adapter is honoured only when the value is exactly `scripted` and `AUTH_URL` is `http:` on `localhost`, `127.0.0.1` or `[::1]` with no userinfo. Any other value, or any other or unset `AUTH_URL`, fails the runtime closed (`EDMATE_DEV_MODEL`, 503, with the reason code only in the log). It replaces only `factories.anthropic`. Replies start `[dev model]` and quote the first retrieved material. Classifiers get fixed all-clear verdicts, and unknown schemas and `embed` throw. Compose leaves it off by default.
- Why: The compose image runs with `NODE_ENV=production`, so the guard can't depend on `NODE_ENV`. A builder needs a chat turn end to end with no key, and the router, guards, pricing and commit should stay real.
- risk: medium. It stands in for the safety classifiers, so a security reviewer should read the guard.

### 22 Oct 2026 · 9.0a Compose defaults for the local stack · decided by builder · risk: low
- Decided: The plan's D4. On `web`: `EDMATE_MARKET` defaults to `US`, `EDMATE_CHAT_AGENTS` to `demo-agent`, and `EDMATE_ANTHROPIC_API_KEY` has no default. On `worker`: `EDMATE_OPENAI_API_KEY` has no default.
- Why: Without them the production-mode image answers 503 (`EDMATE_MARKET`, `provider_key`) and `/home` shows no chat. US is the first region.
- risk: low

### 22 Oct 2026 · 9.0a Compose sets `EDMATE_INGEST_EMBEDDINGS` to `off` for the worker · decided by builder · risk: medium
- Decided: The plan's D3, compose line only. The worker gets `EDMATE_INGEST_EMBEDDINGS: ${EDMATE_INGEST_EMBEDDINGS:-off}`, and `env.example` documents it. The worker behaviour is Phase B (9.0b).
- Why: Chat retrieval is full text today (9.4), so the local stack needs only one key. It is an explicit setting, never a silent fallback.
- risk: medium

### 22 Oct 2026 · 9.0a `turn-backend` test helper takes a whole-gateway override · decided by builder · risk: low
- Decided: When `memoryBackend({ gateway })` is given a gateway, that gateway replaces both the scripted gateway and the judge wrappers.
- Why: That way the dev adapter has to satisfy every real classifier and judge schema in a real `defaultSteps` turn.
- risk: low
