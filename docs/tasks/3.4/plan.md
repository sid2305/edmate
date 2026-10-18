# Task 3.4: `buildContext`

Board: `board.py show 3.4` · M3 · deps 2.6, 3.1, M0 (all done) · branch `m3/3.4-build-context` · planner: sonnet.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "`buildContext`: history trim, last summary, access-filtered retrieval, locked `probe`, style card, persona"
Accept: "never exceeds model context; retrieval cannot be called without `allowedModuleIds` (type-checked); probe results contain no text."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| History trim, deterministic | `historyTrim.test.ts`: a token-budget table (empty history; under budget; over budget drops oldest first; a single message longer than the budget is kept and nothing else is; same input twice → identical output; no `Date`/`Math.random`). |
| Last summary | `buildContext.test.ts`: `ctx.profile.lastSummary` equals exactly what `ProfileStore.get` returned; absent when the profile has none. |
| Access-filtered retrieval | `buildContext.test.ts` + `retrievalQuery.test.ts`: every `RetrievalIndex.search` call carries `{ teacherId: e.entitlement.teacherId, allowedModuleIds: e.entitlement.allowedModuleIds }`; a compile-time check (`// @ts-expect-error`) that `search` cannot be called without a `scope`; the query is built from the latest message plus the most recent agent question in history (so a bare "42" answer still retrieves); `memoryRetrieval.ts`'s fake throws if asked to search outside its own filter, proving `buildContext` never widens it. |
| Locked `probe` | `buildContext.test.ts`: `probe` is called with `{ teacherId, moduleIds: e.entitlement.lockedModuleIds }`; `lockedHit` equals the fake's `hit`; the probe is skipped (and `lockedHit: false`) when `lockedModuleIds` is empty; the `{ hit, score }` return type structurally cannot carry text (type-level, no runtime test needed). |
| Style card | `buildContext.test.ts`: `buildContext` makes no call to load a style card (it is already on `Entitled` per ADR-0004); the returned `BuiltContext` has no `styleCard` field (the runner assembles it from `Entitled`, unchanged). |
| Persona | `buildContext.test.ts`: `persona` is `undefined` on every case (no persona source exists before 3.11/5.8); a `skill_action` for `mock_interview` still returns `persona: undefined`, and the pedagogy fallback (3.5, already shipped) handles that by falling back to `coach`. |
| Help state | `buildContext.test.ts`: the session's raw `helpState` (via the extended `TurnConfigStore`, see below) is parsed into `{ rung, help }`; an empty, missing or malformed blob defaults to rung 0 and `INITIAL_HELP_STATE`; a valid blob round-trips; the rung is clamped to 0–4 before being placed in `BuiltContext.helpRung`. |
| Never exceeds model context | `buildContext.test.ts`: a fixture with many long messages and many large chunks still serialises (history text + retrieved chunk text) under `MAX_CONTEXT_CHARS`; the trim always keeps the latest student message. |
| Runner integration | `runner.test.ts` (existing file, new cases): a full turn with the real `buildContext` reaches `decide`/`generate` with a `TurnContext` that passes `TurnContextSchema`; a `buildContext` that throws or times out still produces a valid turn via the existing `fallbackContext` path (no change needed there beyond the new field). |
| Purity | `buildContext.ts`, `historyTrim.ts`, `retrievalQuery.ts` import only `@edmate/contracts`, `zod` and sibling harness modules; the 0.1 purity lint passes; no `Date.now`/`Math.random` outside the injected clock. |
| Gates | `turbo run typecheck lint test --filter=@edmate/harness...` green; `turbo run typecheck lint test --filter=@edmate/contracts...` and `--filter=@edmate/db...` green (both touched, see below); root secret scan clean. |

## Design

### What's already built (3.1/3.2/3.13, read only except where noted)
- The runner already calls `steps.buildContext(env, e)` concurrently with `preGuard`/`route`, under a 300 ms budget, and already has a fallback (`fallbackContext`) for when it throws or times out — `ask_teacher`, as the spec requires. 3.4 only has to write the happy path.
- Style card and locale are loaded once at `entitle` (ADR-0004) and live on `Entitled`; `buildContext` does not load them again (build plan note under step 6, "already loaded by entitle").

### The step (`packages/harness/src/pipeline/steps/buildContext.ts`)
`buildContext(env, s: Entitled): Promise<BuiltContext>`, two phases so the retrieval query can use history:
1. **Concurrent:** `deps.profiles.get(input.studentId, s.entitlement.teacherId)` and `deps.transcripts.history(input.sessionId, HISTORY_FETCH_LIMIT)`.
2. **Trim + query, then concurrent:** `historyTrim(messages, budget)` (deterministic, oldest dropped first, latest student message always kept); `retrievalQuery(input, history)` builds one string from the latest message plus the most recent `agent` message (the active problem), per 3.5 plan Q2 so a bare "42" still retrieves. Then, concurrently: `deps.retrieval.search(query, { teacherId, allowedModuleIds: s.entitlement.allowedModuleIds }, RETRIEVAL_K)` and, only if `s.entitlement.lockedModuleIds.length > 0`, `deps.retrieval.probe(query, { teacherId, moduleIds: s.entitlement.lockedModuleIds })`.
3. Parse the session's raw help-state blob (see below) into `{ rung, help }`, defaulting fully on any failure.
4. Return `{ profile, history: trimmed, retrieved, lockedHit, helpRung: rung, helpState: help }`; `persona` is omitted (always `undefined` — no persona source exists before 3.11/5.8; 3.5's skill rules already handle a missing persona).

Constants (provisional, like 3.5's coverage threshold; revisit at 7.6): `HISTORY_FETCH_LIMIT = 40` messages, `MAX_CONTEXT_CHARS` (a conservative character budget covering trimmed history + retrieved chunk text, leaving room for the system prompt, style card and generation — harness purity forbids a tokenizer dependency, so size is counted in UTF-16 characters, not tokens), `RETRIEVAL_K = 5`.

### The help-state gap (open question 1 — read before building)
No port currently returns a session's `help_state`. `TurnConfigStore.load` (ADR-0004) returns only `{ agent, pkg, styleCard, locale }`; the db adapter already reads the session row (including `help_state`) to check ownership, then discards it (`packages/db/src/repositories/ports.ts`, `turnConfigStoreFor`). `ProfileStore` and `TranscriptStore` don't carry it either. This is a real gap, not an oversight to design around.

**Recommendation:** extend `TurnConfigStore.load`'s return type to add `helpState: unknown` (the raw JSON, unvalidated — matching `packages/db/src/repositories/sessions.ts`'s own comment, "No contract type exists for it; help_state's shape belongs to 3.5"). This reuses the session row the adapter already fetches, so it costs nothing extra inside `entitle`'s 50 ms budget, unlike a new port (ADR-0004's own "Alternatives" rejected four separate stores for exactly this reason). It is a `packages/contracts` change, so it needs ADR-0005 (extends ADR-0004, which stays unrewritten per that ADR's own convention) and is reviewed by architect, security-reviewer and typescript-reviewer; the lead logs a `risk: high` decision on merge.

Knock-on changes, all within this task:
- `packages/contracts/src/ports.ts`: `TurnConfigStore.load` return type gains `helpState: unknown`.
- `packages/harness/src/access/entitlement.ts` (**risky: security-reviewer**): `TurnConfig` and `checkTurnConfig` pass `helpState` through untyped (it is not validated at this layer, same as the db repo's own comment says — validation is `buildContext`'s job via `HelpStateSchema` plus a local rung field).
- `packages/harness/src/pipeline/types.ts`: `Entitled` gains `helpState: unknown`; `BuiltContext` gains `helpState: HelpState` (the parsed, defaulted pedagogy type) alongside the existing `helpRung`.
- `packages/harness/src/pipeline/steps/entitle.ts`: passes `cfg.value.helpState` through into the returned `Entitled`.
- `packages/harness/src/pipeline/policies.ts`: `fallbackContext` returns `helpState: INITIAL_HELP_STATE` too (new required field).
- `packages/harness/src/pipeline/runner.ts`: `assemble()` currently does `TurnContextSchema.safeParse({ ...e, ...b, intent, attempt })`; since `TurnContextSchema` is a `strictObject`, `b.helpState` must be destructured out **before** that spread (an unrecognised key fails the whole turn). The runner keeps the parsed `helpState` in a local variable for 3.6 to thread into `decide` once it exists — **3.4 does not change `Steps['decide']`'s signature**; that is 3.6's wiring task and is better designed together with the `PedagogyDecision` vs. `PolicyResult.next` question (3.6 still has to decide how `next.help`/`next.helpRung` get back to `commit`, since `PedagogyDecision` the frozen contract has no `next` field — out of scope here, flagged for 3.6's plan).
- `packages/db/src/repositories/ports.ts` (**risky: security-reviewer**, already required by the contracts group): `turnConfigStoreFor`'s `load` returns the already-fetched `session.helpState`.
- `packages/harness/src/testing/memoryAccess.ts`: `MemorySession` gains `helpState` (default `{}`); `memoryTurnConfigStore` returns it, matching the db adapter's semantics.
- The new help-state blob's shape is `{ rung: 0|1|2|3|4 } & HelpState` (rung alongside 3.5's `HelpStateSchema` fields) — `buildContext` owns parsing it, with a local schema; any parse failure (missing, malformed, wrong types) defaults to rung 0 and `INITIAL_HELP_STATE`. This is a safe default, not a leak risk: it only restarts the student's place on the ladder (logged as a decision, risk: low), it never widens `mustNotReveal` or retrieval.

If the lead prefers not to touch `access/**`, `db/**` and a new ADR inside this task, the fallback is to ship `buildContext` with `helpRung: 0` and `helpState: INITIAL_HELP_STATE` always (matching today's `fallbackContext` behaviour) and open a follow-up task for the port extension, the same pattern as 3.14 deferring durable counters from 3.2. **Recommendation is the first option** — 3.5's plan already committed to "3.4 loads it" (lead answer, Q1 accepted as recommended), and the extension is small and reuses an existing call.

### Retrieval fake (`packages/harness/src/testing/memoryRetrieval.ts`)
An in-memory `RetrievalIndex`: `search` filters its chunk list to `teacherId` and `allowedModuleIds` and throws `UnusedPortError`-style if asked without a scope (impossible by type, so this is really "ignores extra chunks outside the scope, proven by a test that configures chunks both inside and outside and asserts only the inside ones return"); `probe` checks `moduleIds` against a configured "locked hit" set and returns `{ hit, score }` only. Exported from `packages/harness/src/testing/index.ts` alongside a couple of demo-shaped chunks (reusing `demoChunk` from contracts fixtures where possible) for `buildContext.test.ts` and later tasks (5.3/5.4) to reuse.

## Files

Create:
- `packages/harness/src/pipeline/steps/buildContext.ts`, `buildContext.test.ts`
- `packages/harness/src/pipeline/steps/historyTrim.ts`, `historyTrim.test.ts`
- `packages/harness/src/pipeline/steps/retrievalQuery.ts`, `retrievalQuery.test.ts`
- `packages/harness/src/testing/memoryRetrieval.ts`, `memoryRetrieval.test.ts`
- `docs/adr/0005-session-help-state-in-turn-config.md` (text from architect; this file written by the builder)

Modify:
- `packages/contracts/src/ports.ts` (`TurnConfigStore.load` return type)
- `packages/contracts/test/types.test.ts` / `spec-types.ts` if either asserts the port's shape
- `packages/harness/src/access/entitlement.ts`, `entitlement.test.ts` (risky: security-reviewer)
- `packages/harness/src/pipeline/types.ts` (`Entitled`, `BuiltContext`)
- `packages/harness/src/pipeline/steps/entitle.ts`, `entitle.test.ts`
- `packages/harness/src/pipeline/policies.ts`, `policies.test.ts` (`fallbackContext`)
- `packages/harness/src/pipeline/runner.ts`, `runner.test.ts` (`assemble()` exclusion; new buildContext integration cases)
- `packages/harness/src/testing/memoryAccess.ts`, `memoryAccess.test.ts`
- `packages/harness/src/testing/testSteps.ts` (happy-path `buildContext`/`entitle` stubs keep compiling with the new fields)
- `packages/harness/src/testing/index.ts` (export the new retrieval fake)
- `packages/harness/src/pedagogy/helpState.ts` comment (now accurate: "3.4 loads it")
- `packages/db/src/repositories/ports.ts`, and its integration test `packages/db/test/turn-config.int.test.ts` (risky: security-reviewer)
- `packages/harness/vitest.config.ts` only if a per-path threshold is added for the new files (recommend keeping the default 80%; not required by acceptance)

Out of bounds:
- `packages/harness/src/pipeline/steps/decide.ts` (stays a stub; 3.6 wires it)
- `packages/harness/src/guardrails/**`, `packages/harness/src/skills/**`, `packages/harness/src/roleplay/**`
- `content/**` (prompt packs, persona templates — 3.11/5.8)
- Real `RetrievalIndex`/embeddings implementation (5.3), the property test and the `locked` eval suite (5.4)
- `apps/**`, `evals/**`

## Tests first (tdd-guide order)
1. `historyTrim.test.ts`, then `historyTrim.ts`.
2. `retrievalQuery.test.ts`, then `retrievalQuery.ts`.
3. `memoryRetrieval.test.ts`, then `memoryRetrieval.ts`.
4. Contracts: a failing `TurnConfigStore` type/fixture test for the new field, then the `ports.ts` change (needs the ADR merged first — see Open questions on sequencing).
5. `entitlement.test.ts` pass-through cases, then `entitlement.ts`.
6. `entitle.test.ts`, `policies.test.ts`, `runner.test.ts` new cases, then the corresponding small changes.
7. `buildContext.test.ts` (all rows above), then `buildContext.ts`.
8. `packages/db` integration test, then the adapter change.
9. Full gate run, both packages.

## Risky paths touched
- `packages/harness/src/access/**` → **security-reviewer** (pass-through of the new `helpState` field in `checkTurnConfig`/`TurnConfig`).
- `packages/db/src/repositories/**` → **security-reviewer** (the `turnConfigStoreFor` adapter change).
- `packages/contracts/**`, `docs/adr/**` → **architect, security-reviewer, typescript-reviewer** (ADR-0005, the `TurnConfigStore` change). This is a contracts change; the plan includes the ADR (text from architect, file written by the builder) and logs a `risk: high` decision on merge, per rule 2.
- `packages/harness/src/guardrails/**`, `content/**`: **not touched**.

Recommended reviewers overall: typescript-reviewer and code-reviewer for the harness-internal plumbing (runner, types, testing), plus the three named above for the contracts/access/db slice. No safety-reviewer needed (this task adds no new teaching or safety decisions; coverage/locked logic stays in 3.5).

## Open questions (recommendations)
- **Q1 Help-state loading.** No port exists for `sessions.help_state`. Recommend extending `TurnConfigStore.load` with raw `helpState: unknown` (ADR-0005, as designed above) over a brand-new port, because it reuses the session row the adapter already fetches and keeps one call inside `entitle`'s budget (ADR-0004's own reasoning). Alternative: ship `buildContext` with `helpRung: 0`/`INITIAL_HELP_STATE` always and defer the port to a 3.14-style follow-up task. Needs architect sign-off on the ADR either way; not a human-blocking decision (ADR-0004 itself was handled entirely within the team).
- **Q2 `decide`'s signature.** Threading `helpState` into `decide.run` (so 3.6 can use it, and so `commit`/3.8 can persist `next`) is left to 3.6, because `PedagogyDecision` (the frozen contract `decide.run` must return) has no `next` field — that tension is 3.6's to resolve, possibly with its own small ADR-adjacent design note (not a contracts change, since `Steps`/`PolicyResult` are harness-internal). Flagging here so 3.6's plan starts from it instead of rediscovering it.
- **Q3 Context budget.** No tokenizer is allowed (harness purity: contracts, zod, mathjs, own modules only), so "never exceeds model context" is enforced with a conservative UTF-16 character budget, not a token count. Recommend a provisional constant now, recalibrated at 7.6 alongside the other provisional budgets (3.5's coverage threshold, `maxOutputTokens` table). Risk: low, reversible.
- **Q4 Persona.** No persona content or store exists before 3.11/5.8. Recommend `persona` is always `undefined` in this task; 3.5's skill rules already fall back to `coach` when it's missing. Risk: low.
- **Q5 Retrieval `k` and probe skip.** Recommend `RETRIEVAL_K = 5` and skipping `probe` entirely when `lockedModuleIds` is empty (an all-access package). Both provisional; 5.3/5.4 may change them. Risk: low.

## Lead answers (18 Oct 2026)

- Q1: the contracts change moves to task 3.15 (ADR-0005, combined with 2.7's Transcriber port; architect designs the help-state shape). 3.4 builds after 3.15 merges and uses what it adds.
- Q2: threading helpState into decide/commit is 3.6/3.8's job; note it in the handoff.
- Q3: provisional character budget, revisit at 7.6. Q4: persona stays undefined. Q5: k=5; skip the probe when lockedModuleIds is empty. All logged.
