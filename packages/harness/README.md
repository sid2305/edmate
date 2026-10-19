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
- **entitle** resolves the entitlement server-side from `{ studentId, agentId, deps.entitlementSource }` only (client package, module or skill ids are never read), refuses `null`, paused and ended, loads the config through `deps.turnConfig` (ADR-0004: the session must be the entitlement's and open; the agent is at the session's pinned version) and checks every object belongs to the entitlement (`src/access`). For subscriptions it then takes one message from the package's rolling 24-hour `dailyMessageLimit` (`limit_reached`). Any failure is `no_access`.
- **Limits** are in-memory sliding windows on the injected clock (`createTurnLimits(clock)`, built once by the composition root). A restart resets them; task 3.14 makes the daily count durable behind the same `TurnCounter` interface.
- **Testing:** `twoTeacherWorld()`, `memoryEntitlementStore(world, opts)` and `memoryTurnConfigStore(world)` mirror the db adapters (`entitlementStoreFor`, `turnConfigStoreFor`); `accessTurns()` runs turns through `runTurn` with the real admit and entitle.

## buildContext (task 3.4)

- Loads the learner profile (with `lastSummary`) and the last 40 messages concurrently, trims history oldest first to 16,000 UTF-16 units (the newest message is always kept, cut if it alone is longer), and builds one retrieval query from the latest message plus the latest agent message.
- Retrieval only through `RetrievalIndex.search(q, { teacherId, allowedModuleIds }, 5)`; every chunk returned is checked again and one outside the scope fails the step (`RetrievalScopeError`, the runner's `ask_teacher` fallback). `probe` runs over `lockedModuleIds` only (skipped when there are none) and only its `hit` is read. History plus chunk text stays within `MAX_CONTEXT_CHARS` (32,000; no tokenizer in the harness).
- Parses the session's raw help state (on `Entitled`, from `TurnConfigStore.load`, ADR-0005) with `parseSessionHelp`; anything invalid is rung 0 and `INITIAL_HELP_STATE`. The parsed `helpState` (with `answerKey`) stays out of `TurnContext`, events and traces; 3.6/3.8 thread it into decide and commit (`serializeSessionHelp`).
- **Testing:** `memoryRetrieval({ chunks, probe? })` and `retrievalWorld()` (allowed, locked and other-teacher chunks; out-of-scope text carries `OUT_OF_SCOPE_TEXT`).

## Guardrails (task 4.1, `src/guardrails`)

- **Phases and order:** `GUARD_ORDER` lists every guard per phase in the build plan's guard-table order: `scrub` (`piiScrub`), `pre` (`distressDetect`, `moderationIn`, `jailbreak`), `post` (`answerLeak`, `lockedLeak`, `grounding`, `adviceGuard`, `personaBoundary`, `tone`). That list decides run order; registration order never does.
- **Guard:** `{ name, phase, run(text, ctx, cancel) → { result: GuardResult, usage } }`. A factory closes over what the guard needs; `Ctx` is phase-specific and owned by each guard task.
- **Registry:** `new GuardRegistry<Ctx>(phase)`. `register` throws (`GuardRegistryError`) for an undeclared, duplicate, wrong-phase or malformed guard. `ordered()` returns the registered guards in declared order and skips ones not built yet; `missing()` lists those (4.9 adds the completeness test).
- **Chain:** `runGuardChain(registry.ordered(), text, ctx, { phase, clock, timeoutMs, cancel?, onGuardOutcome? })` never rejects. Outcomes:
  - `ok` with `text`: every guard passed on the final text.
  - `block` (`cause: 'verdict' | 'rewrite_unverified'`, `blockedBy`): a guard blocked, or the verification pass did not accept a rewrite. No `text`.
  - `escalate` with `text` and `alert`.
  - `failed` with `failure: { name, cause, errorName? }` (`empty`, `undeclared`, `out_of_order`, `error`, `invalid_result`, `timeout`, `cancelled`): the guards broke, so treat it like `block` (fail closed). No `text`, no raw error.
- **Verification pass:** when any guard rewrote, every guard runs once more on the final text; a rewrite or block there is `block` / `rewrite_unverified` ("rewrite once; else safe reply"). An escalate still escalates.
- **Time and cancel:** each guard has its own `timeoutMs` slice on the injected clock; the step's `cancel` token cancels the in-flight guard and fails the chain. The trace entries are `GuardTrace` (`{ name, ok, action? }`, action `failed` for framework failures, `(undeclared)` for an undeclared name), never reason or text.
- **Safety-event seam:** `onGuardOutcome({ name, phase, pass, outcome, cause? })` fires once per guard run; a throw or a rejected promise from it is ignored. Persistence (`safety_events`) waits for its ADR (lead answer Q1).
- **Wiring:** the `scrub` phase is wired (4.2, below). The `preGuard` and `postGuard` step stubs still fail closed; 4.3 and 4.5 wire their phases the same way when they land each phase's first guard.

## PII scrub (task 4.2, `src/guardrails/piiScrub.ts`, `src/pipeline/steps/scrub.ts`)

- **What it removes:** phone numbers (fixed group shapes, `+CC`, spaced digits, a bare 10-digit number only next to a phone keyword), emails (also `[at]`, `(at)`, fullwidth `＠`), Luhn-valid card numbers (and a CVV or expiry only in the same message as one), OTP-like codes next to an OTP keyword, the student's own name after an introduction ("my name is", "mera naam", "मेरा नाम", "I'm", "myself", "call me", "main … hoon"), and every `LocalePack.piiPatterns` match (Aadhaar-like, PAN and UPI ids come from the pack). Street addresses are out of scope. Each match becomes a placeholder: `[card]`, `[phone]`, `[id]`, `[otp]`, `[email]`, `[name]`.
- **Unicode:** matching runs on a copy with every decimal digit folded to ASCII and invisible format characters shown as a space or dropped; the same spans are redacted in the original text.
- **Fail closed:** locale patterns compile with exactly `'gu'`; one that doesn't compile throws `PiiPatternError`, the chain returns `failed`, and the turn ends `guard_blocked`. The scrub runs to a fixed point, so `piiScrub` returns `ok` on its own output (the chain's verification pass).
- **Step:** `scrub` scrubs `input.text` and every string (and PII-shaped number) in `input.skillPayload`. Any chain outcome but `ok` throws `ScrubFailedError` whose `cause` is `{ guardCause, errorName? }` only; the runner reports it on `finished.background` (`task: 'runner'`). Transcripts (2.7) arrive as `input.text`, so they are scrubbed the same way; text inside images is 4.2b.
- **Testing:** `indiaLocalePackWithPii` / `IN_PII_PATTERNS` from `@edmate/harness/testing` (a stopgap until 3.10's real `content/locales/IN.yaml`, which must pass the same tests).
- **Testing:** `fakeGuard(name, phase, resultOrFn, { usage?, spy? })` from `@edmate/harness/testing`.

## Replacing a stub

Every step lives in its own file under `src/pipeline/steps/`. Until its task lands, a step throws `StepNotImplementedError`, so the runner applies its failure policy (admit, entitle and preGuard fail closed). To build a step, replace the body in its file and keep the `Steps['<name>']` type; `defaultSteps` picks it up.

## Testing (`@edmate/harness/testing`)

`virtualClock()`, `sequentialIds()`, `testDeps()`, `testSteps(overrides)` (happy-path doubles with a call log), `driveTurn(run, clock)`, the scripted gateway and the contracts fixtures. Tests never call a real model (rule 4).
