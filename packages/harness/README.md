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

## Replacing a stub

Every step lives in its own file under `src/pipeline/steps/`. Until its task lands, a step throws `StepNotImplementedError`, so the runner applies its failure policy (admit, entitle and preGuard fail closed). To build a step, replace the body in its file and keep the `Steps['<name>']` type; `defaultSteps` picks it up.

## Testing (`@edmate/harness/testing`)

`virtualClock()`, `sequentialIds()`, `testDeps()`, `testSteps(overrides)` (happy-path doubles with a call log), `driveTurn(run, clock)`, the scripted gateway and the contracts fixtures. Tests never call a real model (rule 4).
