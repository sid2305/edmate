# @edmate/harness

The turn pipeline and teaching engine. Pure TypeScript: it imports only `@edmate/contracts`, `zod`, `mathjs` and its own modules (build plan rule 3). Everything else (database, model gateway, queues) reaches it through the ports in `@edmate/contracts`.

## Pipeline order (`src/pipeline`)

```
admit → entitle → scrub (step 3, regex PII)
      → [ preGuard (step 3 checks) ‖ route ‖ buildContext ]   concurrent
      → escalate (distress)  ─────────────────────────────►  done → meter ‖ commit → trace
      → decide → generate → postGuard → done → meter ‖ commit → trace
```

`runTurn(input, { deps, steps })` returns `{ events, finished }`. `events` ends with exactly one `done` or `error`; `finished` never rejects and lists background failures (meter, commit, trace, alert delivery). Timeouts, failure policies and the trace follow build plan § Turn pipeline spec; `STEP_SPEC` in `spec.ts` holds the numbers and the "On failure" text.

Determinism: `deps.clock` (`now`, `sleep`) and `deps.ids` are injected. Nothing in `src/` uses real timers.

## Step interface (`src/pipeline/types.ts`)

Each step takes a `StepEnv` (`input`, `deps`, `cancel`, `turnId`) and returns a typed result; it never mutates shared state. The runner checks each result against a schema (`results.ts`); a result that fails counts as the step failing. Only `generate` gets an `emit` function, so event order never depends on scheduling. Steps report errors with meaning by throwing `TurnRejection(code)` (admit, entitle) or `TurnAbort(code)` (generate).

## admit and entitle (task 3.2)

- **admit** checks the input limits from `LIMITS` (text ≤ 4,000 code points and ≤ 8,000 UTF-16 units, ≤ 2 attachments, skill payload ≤ 16 KB of JSON → `input_too_large`) and then the rate limit (10 admitted turns per student per trailing 60 s → `rate_limited`, retryable; not for `eval`). It does not authenticate: the caller merges the signed-in `studentId` first.
- **entitle** resolves the entitlement server-side from `{ studentId, agentId, deps.entitlementSource }` only (client package, module or skill ids are never read), refuses `null`, paused and ended, loads the config through `deps.turnConfig` (ADR-0004: the session must be the entitlement's and open; the agent is at the session's pinned version; task 3.16: the session must also be pinned to the entitlement's package and version, else the store ends it, the db adapter clears the pair's last summary, and the load is `null`, so a student whose package or version changed starts a fresh session with no earlier history, sources or summary) and checks every object belongs to the entitlement (`src/access`). For subscriptions it then takes one message from the package's rolling 24-hour `dailyMessageLimit` (`limit_reached`). Any failure is `no_access`.
- **Limits** are in-memory sliding windows on the injected clock (`createTurnLimits(clock)`, built once by the composition root). A restart resets them; task 3.14 makes the daily count durable behind the same `TurnCounter` interface.
- **Testing:** `twoTeacherWorld()`, `memoryEntitlementStore(world, opts)` and `memoryTurnConfigStore(world)` mirror the db adapters (`entitlementStoreFor`, `turnConfigStoreFor`); `accessTurns()` runs turns through `runTurn` with the real admit and entitle.

## buildContext (task 3.4)

- Loads the learner profile (with `lastSummary`) and the last 40 messages concurrently, trims history oldest first to 16,000 UTF-16 units (the newest message is always kept, cut if it alone is longer), and builds one retrieval query from the latest message plus the latest agent message.
- Retrieval only through `RetrievalIndex.search(q, { teacherId, allowedModuleIds }, 5)`; every chunk returned is checked again and one outside the scope fails the step (`RetrievalScopeError`, the runner's `ask_teacher` fallback). `probe` runs over `lockedModuleIds` only (skipped when there are none) and only its `hit` is read. History plus chunk text stays within `MAX_CONTEXT_CHARS` (32,000; no tokenizer in the harness).
- Parses the session's raw help state (on `Entitled`, from `TurnConfigStore.load`, ADR-0005) with `parseSessionHelp`; anything invalid is rung 0 and `INITIAL_HELP_STATE`. The parsed `helpState` (with `answerKey`) stays out of `TurnContext`, events and traces; 3.6/3.8 thread it into decide and commit (`serializeSessionHelp`).
- **Testing:** `memoryRetrieval({ chunks, probe? })` and `retrievalWorld()` (allowed, locked and other-teacher chunks; out-of-scope text carries `OUT_OF_SCOPE_TEXT`).

## Replacing a stub

Every step lives in its own file under `src/pipeline/steps/`. Until its task lands, a step throws `StepNotImplementedError`, so the runner applies its failure policy (admit, entitle and preGuard fail closed). To build a step, replace the body in its file and keep the `Steps['<name>']` type; `defaultSteps` picks it up.

## Testing (`@edmate/harness/testing`)

`virtualClock()`, `sequentialIds()`, `testDeps()`, `testSteps(overrides)` (happy-path doubles with a call log), `driveTurn(run, clock)`, the scripted gateway and the contracts fixtures. Tests never call a real model (rule 4).
