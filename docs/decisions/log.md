# Edmate decision log

Every decision the spec did not already make, in plain words, newest first. Agents write entries in their task's handoff, and the team lead copies them here when the PR merges. Your own decisions are logged too.

- **risk: low** · the agent decided and moved on
- **risk: medium** · the agent or lead decided; worth a skim
- **risk: high** · you decided, or the lead merged a risky change (contracts, ADRs, safety, access, payments, the harness) after its required reviewers; skim these first

Format and rules: `.claude/skills/merge-gate/SKILL.md`.

---

### 18 Oct 2026 · 3.13 TurnConfigStore port loads a turn's config at entitle · decided by team lead · risk: high
Decided: Contracts gain one additive port, `TurnConfigStore.load(entitlement, sessionId)`, which returns the agent, package, style card and locale pack for the turn, or null. `entitle` calls it and fails closed with `no_access` unless every loaded object belongs to the entitlement's teacher, agent, package version and market. No other contract changes (ADR-0004).
Why: pre-guards, escalation and the fallback context need the locale pack and style card before `buildContext`, and no port loaded them.
Alternatives: widen `EntitlementStore.resolve`; a port defined inside the harness (against ADR-0002); four separate stores.
Reversible: only by ADR.

### 18 Oct 2026 · 3.13 A session id is checked against the entitlement and pins the agent version · decided by team lead · risk: high
Decided: `TurnConfigStore.load` returns null unless the session row belongs to the entitlement's student, teacher and agent and is still open; `entitle` then fails with `no_access`. The agent is loaded at exactly the session row's `agent_version`, which the server sets when the session is created and never takes from the client, and must match the entitlement's agent and teacher. `Entitlement` does not change. Task 3.2 must test both checks.
Why: `sessionId` comes from the client, so on its own it could point at another student's session or pin an agent version the student should not get (security review of 3.13).
Alternatives: add the agent version to `Entitlement`; trust the session id because the entitlement was already resolved.
Reversible: only by ADR.

### 18 Oct 2026 · 3.12 `EvalCase` lives in `packages/evals`, not `packages/contracts` · decided by planner · risk: low
Decided: the case/check shape is a Zod schema owned by `packages/evals`.
Why: it is not in the Core contracts list and nothing outside the eval runner reads it; adding it to contracts would need an ADR.
Alternatives: add it to contracts for symmetry.
Reversible: Yes, by ADR if a second package needs the type.

### 18 Oct 2026 · 3.12 One generic `Recorder` for agent replies and judge outputs · decided by planner · risk: low
Decided: every agent reply and judge verdict goes through one record/replay mechanism, one JSON file per (case, turn, call) at `<fixtures>/<case>/turn-<n>/{agent,judge-<i>}.json`; replay never calls the live function and a missing fixture throws "run with --record first".
Why: "record/replay including recorded judge outputs" becomes one mechanism, and CI replay has no live call path.
Alternatives: a judge-only recorder plus ad hoc agent caching.
Reversible: Yes.

### 18 Oct 2026 · 3.12 No default judge model; `EDMATE_JUDGE_MODEL` required to record · decided by lead (human decision on pinning) · risk: low
Decided: `resolveJudgeModel()` reads `EDMATE_JUDGE_MODEL="<provider>:<model>"` and throws if unset; each recorded judge fixture stores the model that produced it. An `openai-compatible` judge also needs `EDMATE_JUDGE_BASE_URL`.
Why: the model mix is open until 7.6 and the judge is pinned per release by a human; a guessed id could be baked into fixtures.
Alternatives: hard-code a default id.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Agent under test is an injected `EvalAgent`; the CLI's agent stays unwired · decided by planner, accepted by lead (Q1) · risk: low
Decided: the runner takes a minimal `EvalAgent` (`reply({caseId, turnIndex, student, priorTurns}) → {text, sources?}`); `edmate eval` passes an agent that refuses every call until a pipeline exists. Replay still works with recorded agent fixtures.
Why: 3.1 is not built; a one-shot stand-in model would look like real coverage without guards, retrieval or persona.
Alternatives: wire a direct-to-model stand-in now.
Reversible: Yes; a later task passes a real agent.

### 18 Oct 2026 · 3.12 `edmate eval` lives in `apps/cli` · decided by planner · risk: low
Decided: `edmate eval <dir> [--fixtures <dir>] [--record] [--report <file>]`; fixtures default to `evals/fixtures`; exit 1 on any failing case or error. `run()` became async.
Why: the build plan's CLI-parity table names `edmate eval` under `apps/cli`.
Alternatives: a bin in `packages/evals`.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Case id charset only; `must_cite_source: false` means "no sources" · decided by planner, accepted by lead (Q2, Q3) · risk: low
Decided: ids must match `^[a-z0-9-]+$` (the `<suite>-<skill>-<nnn>` shape stays an authoring convention); `must_cite_source: false` asserts no sources, omitting it means don't care.
Why: skill names and numbering may change; an explicit "no sources" is useful for off-topic redirects.
Alternatives: enforce the full id shape; treat `false` as don't care.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Eval tests use the 2.6 scripted gateway via a devDependency on `@edmate/harness` · decided by builder · risk: low
Decided: `packages/evals` and `apps/cli` list `@edmate/harness` as a devDependency and import only `@edmate/harness/testing` in tests; no `src` file imports the harness.
Why: the lead asked for the scripted gateway in tests (rule 4); the runtime graph stays one-way (harness does not know evals, evals' shipped code does not need the harness).
Alternatives: a hand-written fake `ModelGateway` in evals.
Reversible: Yes.

### 18 Oct 2026 · 3.12 No vacuous passes; per-case errors; overwrite report · decided by reviewers (fix round 1) · risk: low
Decided: a case must have at least one turn with `expect` (schema), and a case where no check ran fails (runner). `runSuite` records a throwing case as failed with its error and keeps going; `runCase` still throws. `--record` lists every overwritten fixture key with a count in the summary.
Why: a check-free case would report a pass that proves nothing; one bad case shouldn't hide the rest of a run; re-recording should be visible in review.
Alternatives: allow check-free cases; abort the whole run on the first error; overwrite silently.
Reversible: Yes.

### 18 Oct 2026 · 3.12 Strict checks and loud failures · decided by builder · risk: low
Decided: string checks are case-insensitive substrings; `matches` regexes compile with `i` at load time; checks run in a fixed order (`must_contain`, `must_not_contain`, `matches`, `max_words`, `max_chars`, `must_cite_source`, `judge[i]`); an empty suite dir, a malformed recorded fixture or a malformed agent reply throws rather than scoring; fixture keys are restricted to lowercase `/`-joined segments.
Why: deterministic reports and no silent skips.
Alternatives: return `[]` for an empty dir; score malformed data as a fail.
Reversible: Yes.

### 18 Oct 2026 · Payments come last · decided by you · risk: high
Decided: Build and test the harness and the platform end to end first, then raise agent quality, and only then build payments (M10). Until M10, a paid package starts as an active subscription with no payment; checkout (new 10.8) and teacher earnings (new 10.7) move into M10, and M13 hardening no longer waits on M10 except the pilot readiness checklist (13.6).
Why: The product's value is the teacher's agent; money and payouts are not worth the effort until the whole thing works and the agent is good.
Alternatives: Keep payments in the platform build (9.3 checkout, 8.8 earnings, 9.7 with a payment sandbox).
Reversible: Yes; entitlements already come from subscriptions, so M10 only adds how a subscription gets paid for. The payment, refund and revenue-share answers above stay on record for M10.

### 18 Oct 2026 · Turn config loading · decided by team lead (architect's design) · risk: high
Decided: Add one contracts port, `TurnConfigStore`, recorded in ADR-0004 (task 3.13). `entitle` loads the agent, package version, style card and locale pack in one call and fails closed if any object doesn't belong to the entitled teacher. This moves style card and locale loading from buildContext to entitle, a deviation from the Turn pipeline spec.
Why: Scrub needs PII patterns and escalate needs helplines before buildContext runs; ADR-0002 keeps adapter-backed ports in contracts.
Alternatives: Widen EntitlementStore; a harness-only dependency; four separate stores.
Reversible: Yes, with another ADR.

### 18 Oct 2026 · Minimum learner age · decided by you · risk: high
Decided: Learners are 13+. In the US no parental consent is needed (COPPA covers under-13 only); in India 13–17 need verifiable parental consent (DPDP), so the age gate asks country and birth year.
Why: The product needs nothing that requires 18+; school-age learners widen reach. India's DPDP treats under-18s as children.
Alternatives: 18+ only; 13+ with no consent anywhere (rejected for the India legal risk).
Reversible: Yes, but raising the age later means offboarding existing learners. Note for 1.7 and M6: DPDP also bars tracking and behavioural monitoring of children, so learner memory for India under-18s needs a check before it ships.

### 18 Oct 2026 · Pilot market · decided by you · risk: high
Decided: The pilot runs in the US and India, with locale packs en-US and en-IN (English, Hindi, Hinglish).
Why: Keep focus on two markets rather than global; the Hindi and Hinglish evals already cover India.
Alternatives: India only; global English; wait for the Validate phase.
Reversible: Yes; more locale packs can be added later.

### 18 Oct 2026 · Payment providers · decided by you · risk: high
Decided: Razorpay in India (UPI AutoPay, Route split payouts) and a merchant of record (e.g. Paddle or Lemon Squeezy) in the US for sales tax, both behind the one Payments port.
Why: Recurring payments in India mostly run on UPI AutoPay, which merchants of record do not support; in the US a merchant of record removes state sales-tax work.
Alternatives: Razorpay plus Stripe Connect; Stripe in both markets.
Reversible: Yes; the Payments port keeps providers swappable.

### 18 Oct 2026 · Hosting region · decided by you · risk: high
Decided: One US cloud region for the pilot; add an India (Mumbai) region later if latency or data rules need it.
Why: One stack is cheapest; DPDP does not require this data to stay in India.
Alternatives: US and India regions; India only.
Reversible: Yes, with a data migration.

### 18 Oct 2026 · Pilot subjects · decided by you · risk: medium
Decided: The pilot targets specific practical skills, e.g. personal finance, Marketing 101 and starting a side hustle; anchor teachers are signed in the Validate phase.
Why: Narrow, practical courses suit daily practice with a teacher's agent.
Alternatives: Coding, exam prep, languages, professional skills.
Reversible: Yes. Personal finance falls under the regulated-subject advice guardrail and its eval suite.

### 18 Oct 2026 · Teacher view of conversations · decided by you · risk: medium
Decided: Teachers see aggregated insights by default; a student may opt in to share conversations.
Why: Protects student privacy while still giving teachers useful signal.
Alternatives: Aggregated only; full conversations.
Reversible: Yes.

### 18 Oct 2026 · Refund policy · decided by you · risk: medium
Decided: Students get a full refund within the first 7 days; none after.
Why: Simple and fair for trying a teacher; the board's recommendation.
Alternatives: Pro-rata; no refunds.
Reversible: Yes, for new subscriptions.

### 18 Oct 2026 · Moderation · decided by you · risk: medium
Decided: Provider moderation where available, a local classifier otherwise.
Why: Uses the strongest check each provider offers without running a GPU; the board's recommendation.
Alternatives: Classifier only; self-hosted Llama Guard.
Reversible: Yes.

### 18 Oct 2026 · Live classes · decided by you · risk: low
Decided: Live classes use the teacher's Google Meet or Zoom link; Edmate schedules them and ingests the recording for transcription.
Why: Far less work and cost than built-in video.
Alternatives: Built-in video.
Reversible: Yes.

### 18 Oct 2026 · Product name · decided by you · risk: low
Decided: Keep the name Edmate.
Why: Your call.
Alternatives: Rename before launch.
Reversible: Yes, before launch.

### 18 Oct 2026 · Deferred: revenue share, default model mix, legal entity · decided by you · risk: low
Decided: Revenue share and floor price and the default model mix wait for the cost and eval data from 7.6; the legal entity (company, social enterprise or non-profit) is decided before payments go live.
Why: Each needs data or context that does not exist yet.
Alternatives: Set them now.
Reversible: Yes.

### 18 Oct 2026 · 2.3 Fallback rule collapses to one check · decided by planner · risk: low
Decided: the router falls back only when the error is a `GatewayError` with `retryable: true`, nothing has been yielded yet for this `stream()` call, and a capable fallback adapter is configured. Everything else re-throws as is.
Why: `truncated`/`content_filter` are only ever paired with `retryable: false` in `adapters/errors.ts`, so checking `retryable` already covers "never fall back on a cut-off or filtered answer".
Alternatives: also check `reason` explicitly.
Reversible: yes.

### 18 Oct 2026 · 2.3 Router takes already-built adapters; a separate factory resolves ModelPolicy · decided by planner · risk: low
Decided: `Router` only sees `ModelAdapter` instances; `createRouter(policy, factories)` is the only place that turns policy strings into adapters.
Why: keeps fallback and capability logic testable with plain fakes and free of key or base-URL concerns.
Alternatives: one class that resolves the policy and routes.
Reversible: yes.

### 18 Oct 2026 · 2.3 Capability mismatch fails closed, never reroutes to fallback · decided by planner · risk: low
Decided: if the tier's adapter lacks a capability the request needs, the router throws a `validation` `GatewayError` before any call and does not try the fallback.
Why: it is a policy configuration bug, not a transient failure; rerouting would hide it.
Alternatives: try the fallback's capabilities before giving up.
Reversible: yes.

### 18 Oct 2026 · 2.3 Router tests reuse harness/testing via a devDependency · decided by planner · risk: low
Decided: `@edmate/gateway` gains `@edmate/harness: workspace:*` as a devDependency; router tests wrap `ScriptedGateway` and reuse `scriptedStreamProviderError`.
Why: the 2.6 fixtures name this task as their consumer; rule 3 limits what harness imports, not who uses its test helpers.
Alternatives: duplicate a script player in `packages/gateway/test`.
Reversible: yes.

### 18 Oct 2026 · 2.3 embed() is served by the main tier's adapter · decided by builder · risk: low
Decided: `Router.embed` uses `tiers.main` (and the fallback on a retryable error), since the `ModelGateway.embed` port has no tier.
Why: the plan did not say which tier embeds; main is the agent's primary adapter. Embeddings are platform-wide config, so a deployment that needs them routes `main` to an embedding-capable adapter or uses a separate gateway for indexing. With `DEFAULT_MODEL_POLICY` (Anthropic, no embeddings) `embed` throws `validation` without calling the provider.
Alternatives: the small tier; a separate embedding adapter in `RouterOptions` (would need a config shape the contract does not have).
Reversible: yes.

### 18 Oct 2026 · 2.3 Provisional default model ids · decided by builder · risk: low
Decided: `DEFAULT_MODEL_POLICY` = Anthropic `claude-haiku-4-5` (small) and `claude-sonnet-4-5` (main), no fallback; frozen and headed PROVISIONAL until 7.6.
Why: lead answer Q3 accepted a provisional Anthropic default; these ids match the ones already used in gateway tests.
Alternatives: a synthetic `unconfigured` provider that forces every caller to override.
Reversible: yes.

### 18 Oct 2026 · 2.3 Router coverage held at 100% · decided by builder · risk: low
Decided: `vitest.config.ts` adds a 100% threshold for `src/router/**`, beside keys and adapters.
Why: the fallback rule decides whether a second model may answer; every branch should stay tested.
Alternatives: the package's 80% default.
Reversible: yes.

### 18 Oct 2026 · 3.1 Clock and IdSource are harness types, not contracts ports · decided by planner · risk: low
Decided: `Clock`, `Cancel` and `IdSource` live in `packages/harness/src/pipeline/clock.ts`. `harness/testing`'s `Clock` is now `Pick<Clock, 'sleep'>`.
Why: They are parameters of the harness entry point, not adapters that db, gateway or worker implement. Every caller already imports the harness, and contracts stay frozen.
Alternatives: A contracts port by ADR.
Reversible: Yes (by ADR later).

### 18 Oct 2026 · 3.1 No production clock or id adapters in the harness · decided by planner · risk: low
Decided: 3.1 ships no `Date.now`/`setTimeout`/`randomUUID` adapters. The first real caller (3.9) provides them.
Why: They need real timers and Node or DOM lib types, which the harness tsconfig doesn't have.
Alternatives: Ship them in the harness behind a lib change.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Stubs fail closed · decided by planner · risk: low
Decided: Every unbuilt step throws `StepNotImplementedError`, so the runner applies that step's policy. The only stub that returns data is `route.onFailure`, and that data is the spec's own default (`on_task`/`none`). `decide.fallback` throws too, because an `ask` decision needs a composed prompt (3.5/3.6).
Why: A stub that succeeds (for example `entitle`) would fail open in production.
Alternatives: Happy-path stubs.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Only generate may emit events · decided by builder · risk: low
Decided: The concurrent steps and escalate get no `emit`. The runner sends `safety`, the escalate reply, `replace`, `done` and `error` itself. Events from `generate` are checked against `TurnEventSchema`. `done`/`error` from a step are invalid, and events sent after a step's timeout are dropped.
Why: Event order never depends on scheduling, and a failed step can't leave a stream half-written.
Alternatives: Give escalate an `emit` (the plan sketch).
Reversible: Yes.

### 18 Oct 2026 · 3.1 Escalate beats block · decided by planner · risk: medium
Decided: After the concurrent group, a preGuard `escalate` or a route intent of `distress` (including from `route.onFailure`) escalates. This happens even when preGuard blocked or failed.
Why: A distressed student must never just be blocked.
Alternatives: Block first.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Meter still runs after escalate and block · decided by planner · risk: low
Decided: `meter` runs whenever the turn has usage, including escalated and blocked turns. It is skipped when there is no usage.
Why: § Model gateway says every call is metered. "Skip to step 11" would lose the small-model usage from steps 3 and 4.
Alternatives: Skip meter on escalate.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Error codes where the spec names none · decided by planner · risk: low
Decided:
- admit throw or timeout → `rate_limited`, retryable.
- entitle throw or timeout → `no_access`, retryable. An invalid or mismatched entitlement → `no_access`, not retryable.
- preGuard failure → `guard_blocked`, retryable. A block verdict → `guard_blocked`, not retryable.
- generate failure, or a runner bug → `provider_error`, retryable.
- An invalid TurnContext even after the fallback → `no_access`, not retryable.
Why: There is no `internal` code and contracts are frozen.
Alternatives: A new error code by ADR.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Runner checks the entitlement against the turn · decided by builder · risk: low
Decided: Besides the schema check, the runner refuses (`no_access`) an entitlement whose `studentId` or `agentId` differs from the input, or whose status is `paused` or `ended`.
Why: Defence in depth: a buggy `entitle` (3.2) can't give one student another student's package.
Alternatives: Trust `entitle` entirely.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Step results are schema-checked · decided by builder · risk: low
Decided: Every step result is parsed with a zod schema built from the contracts (`results.ts`). A result that fails counts as the step failing. Guard trace entries are strict (`name`, `ok`, `action` only).
Why: A buggy step hits its failure policy instead of passing bad data along. No step can put guard reason text into a trace (ADR-0003).
Alternatives: Trust the TypeScript types.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Generate: 15 s per attempt; `replace ''` before a retry after streamed tokens · decided by planner · risk: low
Decided: Each generate attempt gets its own 15 s. If the first attempt had streamed tokens, `replace { text: '' }` is sent before the retry. A `TurnAbort` is final and is not retried.
Why: The student never sees two half-replies. A cost-ceiling abort must not spend more.
Alternatives: One 15 s budget for both attempts.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Alert retry: 250 ms doubling, 30 s cap, no attempt limit, 5 s per attempt · decided by builder · risk: low
Decided: `AlertSink.raise` is retried on the injected clock with backoff starting at 250 ms, doubling to a 30 s cap, with no attempt limit. Each attempt times out after 5 s. The alert is dispatched before the reply is sent, and `finished` waits for delivery. Each failed attempt is listed in `finished.background`.
Why: This is the literal reading of "retried until delivered". The 5 s per-attempt timeout (the builder's addition) stops a hanging sink from blocking retries. Durable delivery is 4.3's worker.
Alternatives: A bounded attempt count.
Reversible: Yes.

### 18 Oct 2026 · 3.1 An invalid TurnContext is treated as a buildContext failure · decided by planner · risk: medium
Decided: If `TurnContextSchema` (retrieved ⊆ allowed modules, same teacher, entitlement matches pkg/agent) rejects the assembled context, the runner retries with the step 6 fallback context and marks buildContext `fallback`. If that also fails, the turn ends with `no_access`. `decide` never sees an invalid context.
Why: An access-filter bug degrades to `ask_teacher` instead of leaking locked material.
Alternatives: End every such turn with an error.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Traces for turns that end early · decided by lead (plan Q1) · risk: low
Decided: Turns rejected at admit or entitle get no trace and no commit. Escalated turns are traced with intent `distress`. Escalated, blocked and errored-before-decide turns get move `redirect`. A turn whose scrub failed uses intent `on_task`.
Why: `TurnTrace.intent`/`move` are required, and a rejected turn never really happened (rate-limit spam would flood traces).
Alternatives: A trace for every request.
Reversible: Yes.

### 18 Oct 2026 · 3.1 All of buildContext runs in the concurrent group · decided by lead (plan Q2) · risk: low
Decided: All of step 6 runs alongside preGuard and route, with one 300 ms budget.
Why: This is a superset of "the retrieval part of 6", and it avoids a second budget after the group.
Alternatives: Only retrieval concurrent.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Fallback texts are injected · decided by lead (plan Q3) · risk: low
Decided: `PipelineDeps.fallbackReplies` supplies `safeReply(lang)` and `distress(lang, locale)`. If one of these throws, the bug is reported in `finished`. postGuard then uses an empty text. escalate uses the built-in last-resort reply (fix round 1). The `safety` event, `done` and alert delivery still happen.
Why: The harness can't use next-intl. The texts come from 3.10/3.11 packs.
Alternatives: Hard-coded English.
Reversible: Yes.

### 18 Oct 2026 · 3.1 meter and commit never see unscrubbed text · decided by builder · risk: medium
Decided: Background steps get the scrubbed input. If the scrub failed, `CommitRecord.input` is `null` and `env.input` has no `text`.
Why: PII the scrub couldn't remove must never be persisted.
Alternatives: Store the raw input.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Built-in last-resort distress reply · decided by lead (fix round 1, silent-failure-hunter) · risk: medium
Decided: When the escalate step gives no reply text and `fallbackReplies.distress` throws or returns empty, the runner sends `LAST_RESORT_DISTRESS_REPLY`. This constant is built into the runner, is country-neutral and has no numbers. Its wording was set by safety-reviewer in fix round 2: it says "I'm an AI" and points to someone you trust and local emergency services. The trace marks escalate `failed`, and the alert, message and trace are still saved.
Why: A distressed student must never get an empty reply. A constant can't fail the way an injected text source can.
Alternatives: An injected text only (the original design); end with an error.
Reversible: Yes. The text should be reviewed by the safety reviewer and replaced by the 3.10/3.11 pack text paths, never removed.

### 18 Oct 2026 · 3.1 Injected distressCheck when route.onFailure fails · decided by lead (fix round 1, silent-failure-hunter) · risk: medium
Decided: `PipelineDeps.distressCheck(text, lang): boolean` is a required dependency. The runner calls it on the scrubbed text when `route.onFailure` throws or returns invalid data, and a hit escalates the turn. If the check also throws, the turn uses `on_task`/`none`, route is marked `failed` in the trace, and both errors are listed in `finished.background`.
Why: "Distress keywords still escalate" must hold even when the route fallback itself breaks.
Alternatives: Only `ROUTE_DEFAULT` (the original design); a check hard-coded in the harness (keywords belong in locale packs).
Reversible: Yes. 3.3/4.3 provide the real keyword check, and the caller wires it in.

### 18 Oct 2026 · 3.1 Distress keyword check on the raw text when the scrub fails · decided by lead (fix round 2, safety-reviewer) · risk: medium
Decided: When the scrub throws or times out, the runner runs `deps.distressCheck` in-process on the raw text. On a hit, it raises a runner-built alert, sends the last-resort reply and saves the commit (with `input: null`) and the trace. No step runs on the raw text. The raw text is never stored, traced or reported, and a check failure is reported as a generic error.
Why: A failed scrub must not silently block a student in distress. The keyword check is local code with no model call, so the raw text never leaves the process.
Alternatives: Always block on a scrub failure (the original design); run the escalate step on the raw text.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Distress keyword check whenever preGuard is not ok · decided by lead (fix round 2, safety-reviewer) · risk: medium
Decided: When preGuard throws, times out or returns an invalid result, and route did not say distress, the runner runs `distressCheck` on the scrubbed text. A hit escalates instead of blocking.
Why: A classifier timeout must not turn a distress message into a plain block.
Alternatives: Rely on route alone.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Building the alert never breaks the escalation · decided by lead (fix round 2, safety-reviewer) · risk: medium
Decided: The runner-built alert is tried twice. Each failure is listed in `finished.background` (`alert`), and the trace marks escalate `failed`. The caring reply, the safety event and `done` are always sent. If both attempts fail, the turn is saved without an alert.
Why: Previously a throwing id source sent `provider_error` to a distressed student, and no alert was raised.
Alternatives: End with an error.
Reversible: Yes.

### 18 Oct 2026 · 3.1 Review · decided by team lead · risk: low
Decided: Two unused cancel sources in packages/harness/src/pipeline/runner.ts (routeFallback, backgroundStep) stay as they are. If building the alert fails twice, the alert worker (4.3) must raise a minimal alert or a critical ops event; failed-attempt usage is metered by the orchestrator (3.7).
Why: Nothing subscribes to those cancel sources, so they are harmless; alert delivery and metering belong to their own tasks.
Alternatives: Cancel them for consistency; handle the double alert failure in the runner.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Unexpected database errors are scrubbed into RepositoryError('failed') · decided by tdd-guide (fix round 1) · risk: low
Decided: Every repository method runs inside `guarded()`, applied to all methods by `createRepositories`. Any error that is not a `RepositoryError` becomes `RepositoryError('failed', method)` with code `provider_error` (the contracts have no database-specific code) and a `ScrubbedDbError` cause holding only the driver's error code (SQLSTATE or Node code) and constraint name; the Drizzle/pg error with its SQL, params and detail is dropped. `messages.append` reports a duplicate message id as `not_found`.
Why: Security review: Drizzle's "Failed query: … params: …" message quotes student and teacher ids and message text; a duplicate-id `invalid` let ids in other sessions be probed.
Alternatives: Redact the message text with regexes (fragile); keep the original as a hidden property; generate message ids server-side (the frozen TranscriptStore port passes the caller's id).
Reversible: Yes.

### 18 Oct 2026 · 1.2 Isolation enforced by required scopes in the repositories · decided by planner · risk: high
Decided: Every repository method takes a validated `TeacherScope` or `StudentScope` first and puts it in the WHERE clause of the same statement; messages and turn traces are scoped through a join on `sessions`; another scope's row reads as missing (`null`/`[]`) and writes to it throw `not_found`; frozen ports without a scope parameter (`TranscriptStore`) are bound to a scope at construction; the root `@edmate/db` export has no raw database handle or schema (`@edmate/db/internal` is for migrations, seed and tests). A typed case table makes the isolation test fail to compile when a method has no case.
Why: Data model rule "repositories require the right scope"; no RLS (1.1 decision); ports are frozen (ADR-0002).
Alternatives: Postgres RLS; changing the ports to take a scope (ADR); scope checks in the web layer only.
Reversible: Yes, but every caller binds scopes this way from 1.3 on.

### 18 Oct 2026 · 1.2 Pool limits from env, invalid values throw · decided by planner · risk: low
Decided: `DATABASE_POOL_MAX` (10, 1..100), `DATABASE_IDLE_TIMEOUT_MS` (30 000), `DATABASE_CONNECT_TIMEOUT_MS` (5 000), `DATABASE_STATEMENT_TIMEOUT_MS` (15 000); fixed idle-in-transaction timeout 30 s and `application_name=edmate`; an invalid value throws at startup; the migrator uses one connection and no statement timeout; idle client errors are logged redacted, not thrown.
Why: 1.1 review deferral (c); a silent default would hide a misconfiguration.
Alternatives: No limits (pg defaults); clamping bad values.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Typed jsonb columns, parsed on read · decided by planner · risk: low
Decided: `.$type<>()` ties `agent_versions.config`, `package_versions.config`, `messages.sources`, `turn_traces.steps`, `learner_profiles.mastery`/`mistakes` to contract types (no migration); every row leaving a repository is parsed with its contract schema and a mismatch with its own columns throws `integrity`. `sessions.help_state`, `eval_results.details`, `insights.payload`, `audit_log.before/after` and trust `staff_actions` stay `unknown` until their owners (3.5, 7.x, 11.3, 1.6, 12.x).
Why: 1.1 review deferral (a); a corrupted or mis-owned row must never be returned.
Alternatives: Trust stored jsonb.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Contracts and zod become runtime dependencies of @edmate/db · decided by planner · risk: low
Decided: `@edmate/contracts` (workspace) and `zod` 4.6.7 move from devDependencies to dependencies.
Why: Repositories parse scopes, inputs and rows at runtime.
Alternatives: Hand-written validators.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Exhaustive grid instead of a property-testing library · decided by planner · risk: low
Decided: The isolation test enumerates every actor x target over a two-teacher, two-student seed plus 20 seeded-random ids per read method; no new dependency.
Why: The seed is small enough to cover every combination exactly.
Alternatives: fast-check.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Message history ties ordered by id · decided by planner (lead accepted) · risk: low
Decided: `history` orders by `(created_at desc, id desc)` and returns the page oldest first; no sequence column.
Why: Lead answer Q4; the pipeline gives student and agent messages different timestamps.
Alternatives: An additive `bigserial seq` migration.
Reversible: Yes (3.8 may add a sequence).

### 18 Oct 2026 · 1.2 RepositoryError kinds and codes; constraint violations translated · decided by tdd-guide · risk: low
Decided: `scope` → `forbidden`, `not_found` → `not_found`, `invalid` → `validation`, `integrity` → `validation`. Writes translate a foreign-key violation to `not_found` (for example a scope id that is not a user) and a unique violation to `invalid` (an existing immutable package version); a duplicate message id is `not_found` and all other driver errors become `failed` (fix round 1, entry above). Messages carry the method and kind only.
Why: Driver messages quote row values (ids, text); a public repo's logs must not carry them.
Alternatives: Pass driver errors through; a separate `conflict` kind.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Ownership checks: INSERT … SELECT, or KEY SHARE check plus insert in one transaction · decided by tdd-guide · risk: low
Decided: Single-owner writes (sessions, messages, turn traces, package versions, teacher questions) are `INSERT … SELECT … FROM <owner> WHERE <scope>` built with `sql` templates and explicit casts. Set checks (package `moduleIds`, evidence `topicId`s, question `similarIds`) select the ids `FOR KEY SHARE` in the same transaction; any id that is missing or another teacher's makes the whole write fail with `scope`.
Why: Drizzle's `insert().select()` needs every column in table order; the template keeps the scope and the insert in one statement without `sql.raw`.
Alternatives: Check then insert without a lock.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Repository coverage enforced only when the integration suite runs · decided by planner (lead accepted) · risk: low
Decided: `vitest.config.ts` probes Postgres (or `CI=true`); when the suite runs, `src/repositories/**` must have 100% lines, functions and statements and 90% branches; otherwise that folder is left out of coverage so local runs without Docker stay green. CI always runs it.
Why: Lead answer Q3.
Alternatives: Always enforce (red without Docker); never enforce.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Small API limits not in the spec · decided by tdd-guide · risk: low
Decided: `teacherQuestions.listForStudent` returns at most the newest 200; `listForTeacher` takes a required `status` and a `limit` of 1..200; `teacherQuestions.open` rejects blank text and text over 8,000 characters; `sessions.get` returns a `SessionRow` with `helpState: unknown`.
Why: Bounded reads and no empty questions in a teacher's inbox.
Alternatives: Unbounded lists; accept any string.
Reversible: Yes.

### 18 Oct 2026 · 1.2 Review · decided by team lead · risk: low
Decided: Scope types in packages/db/src/repositories/scope.ts stay structural (not branded). The composite index for a student's questions waits for the questions inbox (8.9).
Why: The scope is a required first argument and every method re-validates it at runtime, enforced by a test over all 16 methods; listForStudent is capped at 200.
Alternatives: Branded scope types; add the index now.
Reversible: Yes.

### 18 Oct 2026 · Transcription · decided by you · risk: low
Decided: Live-class recordings are transcribed by a hosted speech-to-text API behind the Transcriber port for the MVP.
Why: No GPU to run, fastest to ship; the board's recommendation.
Alternatives: Self-hosted Whisper.
Reversible: Yes; the Transcriber port keeps it swappable.

### 18 Oct 2026 · 2.2 Anthropic provider-key entry · decided by planner · risk: high
Decided: add `anthropic: { apiKey: { variable: 'EDMATE_ANTHROPIC_API_KEY' } }` to `PROVIDER_KEYS`, same shape as `openai-compatible`.
Why: Anthropic is the main provider (decision log, 18 Oct 2026); its key enters through the same one door as every other provider.
Alternatives: None; the module's whole point is one place for every provider's keys.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Anthropic base URL is always passed · decided by builder · risk: high
Decided: the Anthropic adapter always passes `baseURL: https://api.anthropic.com/v1` (and always the key), so the SDK never reads `ANTHROPIC_BASE_URL` or `ANTHROPIC_API_KEY`. No base-URL override is offered for Anthropic.
Why: `@ai-sdk/anthropic` reads `ANTHROPIC_BASE_URL` when no base URL is given; a stray variable in the environment would send Edmate's key to another host. `env-fallback.test.ts` proves neither variable is read.
Alternatives: Let the SDK default apply; offer a configurable base URL (a proxy can be added later as an explicit option).
Reversible: Yes.

### 18 Oct 2026 · 2.2 `@ai-sdk/openai-compatible` over `@ai-sdk/openai` + baseURL · decided by planner · risk: low
Decided: the second adapter uses `createOpenAICompatible` from `@ai-sdk/openai-compatible`.
Why: it is the AI SDK's own client for OpenAI-shaped backends that are not OpenAI (OpenRouter, self-hosted); it never reads `OPENAI_API_KEY`.
Alternatives: `@ai-sdk/openai` with a custom `baseURL`.
Reversible: Yes, swapping the package behind the same `ModelAdapter` shape.

### 18 Oct 2026 · 2.2 Capabilities live beside the port, not inside it · decided by planner · risk: low
Decided: `AdapterCapabilities` and `ModelAdapter` are gateway-only types; `ModelGateway` in contracts is untouched. Anthropic's capabilities are fixed; OpenAI-compatible's are overridable per deployment with conservative defaults (vision off, 8 192 tokens) and `embeddings` follows whether an embedding model is configured.
Why: capabilities are routing data for 2.3, not part of the call contract; no contract change means no ADR.
Alternatives: a `capabilities()` method on the port.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Mocked fetch, not MSW · decided by planner · risk: low
Decided: tests inject a fake `fetch` through the AI SDK provider settings; a vitest setup file makes the global fetch always reject.
Why: AI SDK providers accept a `fetch` override; this keeps rule 4 with no new dependency, and an adapter that ignored the override would fail loudly.
Alternatives: `msw`.
Reversible: Yes.

### 18 Oct 2026 · 2.2 AI SDK pins · decided by builder · risk: low
Decided: `ai` 7.0.143, `@ai-sdk/anthropic` 4.0.82, `@ai-sdk/openai-compatible` 3.0.71, pinned exactly.
Why: current stable on 18 Oct 2026; all three share the same `@ai-sdk/provider`/`provider-utils` versions.
Alternatives: caret ranges.
Reversible: Yes.

### 18 Oct 2026 · 2.2 No SDK retries; errors mapped to fixed codes · decided by builder · risk: low
Decided: adapters call the SDK with `maxRetries: 0` and replace its console `onError`. Provider errors become `GatewayError` with a contracts `ErrorCode` (`rate_limited`, `input_too_large`, `validation`, `provider_error`), a `retryable` flag and a message written by the mapper; nothing from the provider error (body, url, request, headers, cause) is kept. A wrong or revoked provider key is `provider_error`, not `unauthorized`/`forbidden` (those are for Edmate's own auth). A failed connection is retryable.
Why: retry and fallback are the router's job (2.3), and one retry layer is easier to reason about and to meter; provider errors can carry request content.
Alternatives: keep the SDK's default 2 retries; pass the provider message through.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Output that stops early is a failure · decided by lead (fix round 1) · risk: low
Decided: when the model stops because of the token cap (`truncated`) or the provider's content filter / a refusal (`content_filter`), `stream()` first yields what it streamed and the usage, then throws `GatewayError('provider_error', retryable false)` with a gateway-local `reason`. `generateObject()` throws the same, even when the cut-off JSON happens to parse.
Why: a cut-off or filtered answer must not reach a student as if complete; the pipeline discards the partial answer, and the spent tokens still reach metering. `reason` lives in the gateway because contracts are frozen.
Alternatives: return the partial output with a flag; a new contracts error code (needs an ADR).
Reversible: Yes.

### 18 Oct 2026 · 2.2 No usage chunk when usage is unknown · decided by lead (fix round 1) · risk: low
Decided: `stream()` emits a usage chunk only when the provider reports both token counts as non-negative integers; real zeros stay zeros. For 2.4 (metering): a turn can end with no usage chunk; treat that as "usage unknown" (flag it, don't record it as free). Known gap: `@ai-sdk/openai-compatible` turns a partly missing usage object into zeros before the adapter sees it.
Why: a made-up zero makes a paid turn look free and hides a provider that stopped reporting usage.
Alternatives: report zeros (the first version); estimate tokens from text.
Reversible: Yes.

### 18 Oct 2026 · 2.2 Tool names are made provider-safe · decided by builder · risk: low
Decided: tool names are sent with characters outside `[A-Za-z0-9_-]` replaced by `_`, cut to 64 characters, `_2`/`_3` added on collision, and mapped back to the Edmate name on the way out. A call of a tool never offered or with unparseable arguments is a non-retryable `provider_error`.
Why: Edmate tool names such as `practice.next_item` contain dots, which Anthropic and OpenAI-style APIs reject.
Alternatives: forbid dots in tool names (a contracts change); encode names reversibly (longer, less readable to the model).
Reversible: Yes.

### 18 Oct 2026 · 2.2 Review · decided by team lead · risk: low
Decided: The `result.output as T` cast in packages/gateway/src/adapters/sdk-adapter.ts stays; tool-argument validation belongs to the tool registry (task 5.5), not the adapter.
Why: The cast narrows a ZodType<T> the caller already passed and is typecheck-clean; validating tool input where tools run keeps one place for it.
Alternatives: Drop the cast; validate tool args in the adapter.
Reversible: Yes.

### 18 Oct 2026 · Judge model for evals · decided by you · risk: medium
Decided: The eval runner scores answers with one mid-tier model (e.g. Claude Sonnet via the Anthropic adapter), pinned per release so scores stay comparable across runs.
Why: Cheapest consistent option; the board's recommendation.
Alternatives: The main model as judge; two judges that must agree.
Reversible: Yes, per release.

### 18 Oct 2026 · Demo course reviewer · decided by you · risk: low
Decided: You are the named subject expert in `reviewed_by` for the open-licensed demo course (task 1.8) for now; a real teacher re-reviews it before launch.
Why: Rule 7 needs a named human; this keeps 1.8 moving.
Alternatives: Name another person; postpone 1.8.
Reversible: Yes.

### 18 Oct 2026 · 2.6 Fixture format and location · decided by planner · risk: low
Decided: Scripts are hand-written TypeScript data modules in `packages/harness/src/testing/`, typed against the contracts `ModelChunk`/`ModelRequest`. They are not JSON files and not in `evals/fixtures/`.
Why: Harness purity rules out loading files at runtime. `evals/fixtures/` is for 3.12's recorded live responses, which have a different lifecycle.
Alternatives: JSON fixtures loaded by path; one fixtures directory shared with the eval runner.
Reversible: Yes.

### 18 Oct 2026 · 2.6 Clock kept local to harness/testing · decided by lead · risk: low
Decided: `Clock` (`{ sleep(ms): Promise<void> }`) lives in `packages/harness/src/testing/clock.ts`, not in contracts `ports.ts`.
Why: Only the test double needs it now. Task 3.1 should define the platform-wide clock/id shape and promote it by ADR if needed.
Alternatives: Add a `Clock` port to contracts now.
Reversible: Yes.

### 18 Oct 2026 · 2.6 Matching per method, predicate first then order · decided by lead · risk: low
Decided: Each method has its own queue. A call takes the first unused entry whose `match` returns true (in script order). If none matches, it takes the first unused entry without a predicate. Entries are never reused. The `stream()` entry is picked when `stream()` is called, not when it is first iterated.
Why: Pipeline steps 3, 4 and retrieval run concurrently, so one global call order would make tests flaky.
Alternatives: One global counter; matching by order only; picking at first iteration.
Reversible: Yes.

### 18 Oct 2026 · 2.6 How a missing script entry fails · decided by builder · risk: low
Decided: `stream()` with no matching entry throws `ScriptedGatewayError` on the first iteration, the same way a provider failure would surface. `generateObject`/`embed` reject. The error names the method and the 0-based call index for that method. On a predicate miss it adds a redacted snapshot (`tier`, the first 80 chars of `system`, `messageCount`; for `embed`, `textCount` only).
Why: Callers such as the 2.3 router only need to handle errors in one place, during iteration. The snapshot never carries message text.
Alternatives: Throw synchronously from `stream()`; return an empty stream.
Reversible: Yes.

### 18 Oct 2026 · 2.6 generateObject validates with the caller's schema · decided by lead · risk: low
Decided: `generateObject` returns `schema.parse(value)`, so a bad fixture throws a Zod error.
Why: A malformed fixture fails where it is defined, not later in a caller's test.
Alternatives: Pass the value through with a cast.
Reversible: Yes.

### 18 Oct 2026 · 2.6 Scripted provider errors and usage record · decided by builder · risk: low
Decided: A `{ type: 'error', code, message? }` step throws `ScriptedProviderError` carrying a contracts `ErrorCode`. `generateObject`/`embed` entries take an optional `usage`. The gateway exposes `usage`, a list of `{ method, usage }` in replay order that includes stream `usage` chunks.
Why: 2.3 needs a provider error it can recognise, and 2.4 needs usage from every call type, not only streams.
Alternatives: Throw a plain `Error`; leave usage on non-stream calls to later tasks.
Reversible: Yes.

### 18 Oct 2026 · 1.1 CI Postgres service container on the node job · decided by tdd-guide · risk: high
Decided: `.github/workflows/ci.yml`'s `node` job runs a `postgres` service (pgvector/pgvector:0.8.1-pg16, pinned by digest,
health-checked) with a throwaway password, and sets `TEST_DATABASE_URL`. `turbo.json` passes `TEST_DATABASE_URL` and `CI` to
`test`. The db integration tests fail when `CI=true` and the database is unreachable, and skip with a message locally.
Why: The acceptance ("migrate up/down clean") needs a real Postgres + pgvector on every PR (lead answer). Touches `.github/**`, so security-reviewer.
Alternatives: pglite (different engine, partial pgvector); a separate job (duplicates install/build); keep it local-only (no CI proof).
Reversible: Yes. Remove the service block and the env lines.

### 18 Oct 2026 · 1.1 Text ids with a UUID default · decided by planner · risk: low
Decided: Every primary and foreign key is `text`; new rows get `crypto.randomUUID()`.
Why: The contracts' id is any `[A-Za-z0-9_-]{1,128}` (fixtures use `stu_test_01`); a `uuid` column would reject valid ids.
Alternatives: Postgres `uuid`; prefixed ids.
Reversible: Yes, with a type-changing migration.

### 18 Oct 2026 · 1.1 "Migrate up/down clean" = apply, drop the test schemas, re-apply · decided by planner (lead accepted) · risk: low
Decided: Migrations are forward-only (drizzle-kit, no down files). The test applies them to an empty throwaway database, drops
`public` and `drizzle`, and applies them again; re-running on an applied database is a no-op.
Why: `database-migrations` skill: forward-only migrations; drizzle-kit has no per-file rollback.
Alternatives: Hand-written down.sql per migration.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Embedding column has no dimension and no vector index yet · decided by planner (lead accepted) · risk: low
Decided: `chunks.embedding` is a nullable dimensionless `vector` (a custom type). The dimension and the HNSW index come with
the embedding model in 2.7/5.3, in an additive migration. `0000_enable_pgvector.sql` runs `CREATE EXTENSION IF NOT EXISTS vector`
so CI and managed hosts work without docker/postgres/init.sql.
Why: The embedding model isn't chosen; guessing a dimension would mean a re-index later.
Alternatives: Fix 1536 now.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Isolation in repositories, not RLS · decided by planner (lead accepted) · risk: low
Decided: No Postgres RLS policies. Teacher and student scoping is enforced by task 1.2's repositories; the schema gives every
teacher-owned table a `teacher_id` (FK to users, leading an index) and every student table a `student_id` (leading an index).
Why: ADR-0002's port split; one app database user.
Alternatives: RLS policies per table.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Postgres enums for the fixed sets, checked against the contracts · decided by tdd-guide · risk: low
Decided: 9 `pgEnum`s: user_role, subscription_status, agent_status, chunk_kind, message_role, teacher_question_status,
evidence_source, model_tier, ledger_direction. Tests fail if a set drifts from the contracts' Zod enum. Open-ended values
(verification_status, payment/payout status, report/takedown/safety status, consent kind) are plain `text`.
Why: The database rejects values the app can't produce; adding a value later is an additive `ALTER TYPE … ADD VALUE`.
Alternatives: text + CHECK (changing it needs DROP CONSTRAINT, which the merge gate flags as destructive); text with no constraint.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Full-text search uses the 'simple' configuration · decided by tdd-guide · risk: low
Decided: `chunks.search` is `to_tsvector('simple', text)`, generated and stored, with a GIN index.
Why: Edmate is country-neutral; 'simple' doesn't stem for one language, so it behaves the same for every locale. Per-locale configs can come with 2.7.
Alternatives: 'english'; a per-row regconfig column.
Reversible: Yes (additive migration with a new column/index).

### 18 Oct 2026 · 1.1 Money and cost as bigint read as JS numbers · decided by tdd-guide · risk: low
Decided: `amount_minor` and `cost_micro_usd` are `bigint` columns mapped to `number` (`mode: 'number'`), matching the contracts' `count()`;
ledger entries are positive amounts with a debit/credit direction grouped by `transaction_id`.
Why: Values stay far below 2^53; the contracts use numbers.
Alternatives: `mode: 'bigint'`; numeric.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Dependency pins and esbuild build script · decided by tdd-guide · risk: low
Decided: drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1, @types/pg 8.23.1 (npm `latest` on 18 Oct 2026; drizzle 1.0 is still rc).
`pnpm-workspace.yaml` sets `allowBuilds: esbuild: false`: drizzle-kit's esbuild uses its prebuilt optional platform package.
Why: Exact pins (rule); pnpm refuses unlisted install scripts.
Alternatives: drizzle 1.0.0-rc; allow esbuild's install script.
Reversible: Yes.

### 18 Oct 2026 · 1.1 Review · decided by team lead · risk: low
Decided: Money and cost columns in packages/db/src/schema/billing.ts stay `bigint` in number mode, which is exact up to 2^53 (about 9 quadrillion minor units); contracts use JS numbers too. Typed jsonb columns, session joins for message isolation, and pool limits are follow-ups in task 1.2.
Why: The ceiling is far above any realistic amount, and 1.2 is where rows are mapped to contract shapes.
Alternatives: bigint as strings or BigInt everywhere.
Reversible: Yes, one migration.

### 18 Oct 2026 · 2.1 Provider key module · decided by planner · risk: high
Decided: Provider keys are read once at startup, only by `packages/gateway/src/keys`, from a `KeySource` (the environment now; a secret manager later through the same interface, no vendor chosen). Each value is wrapped in a `Secret` that prints and serialises as `[redacted]` and is read only with `reveal()`, which only adapters call. A missing or malformed key stops startup with one error that names the variables but never shows a value, a length or a fragment. Rotating a key means a restart.
Why: one door and one wrapper make "never logged, never returned" something a test can check, not just a habit.
Alternatives: Read `process.env` in each adapter; plain strings plus a logger redaction list; hot reload of keys.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Env variable names · decided by planner · risk: medium
Decided: Provider key variables are `EDMATE_<PROVIDER>_<FIELD>`, starting with `EDMATE_OPENAI_COMPATIBLE_API_KEY`, not the SDK defaults such as `OPENAI_API_KEY`.
Why: AI SDK provider packages read their default variable on their own when no key is passed. A different name means a key can't bypass our module.
Alternatives: The SDK default names.
Reversible: Yes, renaming the variables in deploys.

### 18 Oct 2026 · 2.1 process.env left as is · decided by planner · risk: low
Decided: The loader does not delete key variables from `process.env` after reading them.
Why: the spec doesn't ask for it, and `--live` runs and other tools read the environment. The leak tests cover our own outputs.
Alternatives: Scrub the variables after load.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Pino pinned as a devDependency · decided by tdd-guide · risk: low
Decided: `pino` `10.4.0` (current stable on 18 Oct 2026) is pinned exactly as a gateway devDependency, used only by the log-scan test.
Why: Pino is the stack's logger; testing the real logger is stronger than testing `JSON.stringify` alone (lead answer Q3).
Alternatives: Test only `JSON.stringify`; make Pino a runtime dependency now.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Blank optional key means unset · decided by tdd-guide · risk: medium
Decided: For a provider that is not required, a variable that is empty or whitespace-only counts as unset, so the provider is skipped. For a required provider it is still the `empty` problem.
Why: copying `docker/env.example` gives `EDMATE_OPENAI_COMPATIBLE_API_KEY=` (empty); startup must not fail for a provider nobody asked for.
Alternatives: Treat any set variable, even empty, as "configured" and fail.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Unknown provider id is a reported problem · decided by tdd-guide · risk: low
Decided: An id in `required` that is not in `PROVIDER_KEYS` adds an `unknown_provider` problem to the same `KeyConfigError` instead of being ignored.
Why: the type stops it in TypeScript, but plain JS or a config string could pass one; failing loudly beats a silent skip.
Alternatives: Ignore it; throw a separate error type.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Log scan uses a real node Console, not stdout spies · decided by tdd-guide · risk: low
Decided: The console part of the log-scan test writes through `new Console({ stdout, stderr })` into memory instead of spying on `process.stdout.write`.
Why: Vitest intercepts the global console in workers, so stdout spies would see nothing and the check would pass vacuously. The per-sink positive control proves this sink captures output.
Alternatives: Spy on `process.stdout.write` (vacuous under Vitest); set Vitest's `disableConsoleIntercept`.
Reversible: Yes.

### 18 Oct 2026 · 2.1 Review · decided by team lead · risk: low
Decided: Three LOW notes in packages/gateway/src/keys/load.ts stay as they are: error messages may name the caller's provider id (never a key value), and two type casts (`raw as string`, the generic cast in `get()`) are covered by tests. 2.2's adapters must always pass the key so the OpenAI SDK never falls back to OPENAI_API_KEY.
Why: None can expose a key; the casts are proven by tests.
Alternatives: Validate the id before use; discriminated results instead of casts.
Reversible: Yes.

### 18 Oct 2026 · 0.9 Per-commit secret scan runs main's scanner, allow list and driver · decided by tdd-guide · risk: high
Decided: A new CI job `secrets` (pull_request only) scans every commit in `origin/main..HEAD`. It uses the scanner and allow list from main (`git show origin/main:...` into `$RUNNER_TEMP`) and the driver `.github/scripts/scan-pr-commits.py`, also from main. The PR that adds the driver is the only one that uses its own copy, and it logs a warning when it does. The output shows commit, path, line and finding type only. Errors fail the job.
Why: A secret deleted in a later commit is still public in the history. Using main's copies stops a PR from weakening the scan of its own commits. It does not cover a PR that edits `ci.yml` itself: that is a `.github/**` risky path, so it needs a security review and a risk: high decision.
Alternatives: Use the PR's own driver every time (simpler, but the PR could change it). Put the logic inline in the YAML (harder to test). Change the scanner to read stdin (out of bounds for this task).
Reversible: Yes. Remove the job and the script.

### 18 Oct 2026 · 0.9 Lead adds `secrets` to required checks after merge · decided by tdd-guide · risk: low
Decided: Branch protection still needs `secrets` added to its required checks, as the plan says. This branch does not change branch protection.
Why: GitHub can only require a check that has already reported on main's PRs. Adding it before merge would block this PR.
Alternatives: None.
Reversible: Yes.

### 18 Oct 2026 · 0.9 Review · decided by team lead · risk: medium
Decided: A PR can still rewrite its own job in .github/workflows/ci.yml (GitHub runs the PR's copy of a workflow on pull_request). Accepted: the lead merges only through the local merge hook, which runs main's gate, and every .github change gets security-reviewer.
Why: Making a workflow untouchable needs org-level required workflows; CODEOWNERS doesn't help when the lead uses the owner account.
Alternatives: Org-level required workflows; a separate bot account.
Reversible: Yes.

### 18 Oct 2026 · Main model provider · decided by you · risk: medium
Decided: Anthropic (Claude) gets Edmate's native "main" adapter (task 2.2); the second adapter stays OpenAI-compatible, which also covers OpenRouter. Which model each tier uses is still decided after the cost and eval data (task 7.6).
Why: Strong instruction-following and refusal behaviour matter for a student-facing tutor and locked content.
Alternatives: OpenAI, Google Gemini, OpenRouter only for now.
Reversible: Yes; adapters sit behind the ModelGateway port.

### 18 Oct 2026 · 0.6 Exact pins for every dev container input · decided by tdd-guide · risk: low
Decided: Base image `mcr.microsoft.com/devcontainers/base:3.0.10-noble` by digest `sha256:21e9e327...86c3e6`; node feature `2.1.1` with Node `22.22.3` and nvm `0.40.8`; docker-outside-of-docker feature `1.10.1` with Docker CLI `29.5.3` and buildx `0.38.0`; Claude Code `2.1.302`; PyYAML `6.0.1-2build2` (apt); devcontainers CLI `0.89.0` for verification. Node 22.22.3 is the 22.x on the build machine, since `.nvmrc` and `engines` only say 22.
Why: Lead answer 1: pin everything so builds are repeatable; each version was current and checked to build.
Alternatives: Track `latest` or major tags (`:2`, `@latest`), which drift silently.
Reversible: Yes; bump the numbers in one PR.

### 18 Oct 2026 · 0.6 Not pinned where the tool has no option · decided by tdd-guide · risk: low
Decided: `python3` (3.12.3) and the `docker compose` plugin (moby-compose 5.6.0) are not pinned to an exact package version; jq (1.7.1) is fixed only by the base image digest.
Why: The docker feature has no compose-plugin version option, and pinning `python3` to an apt build in `noble-updates` would break once Ubuntu replaces it; the base digest already fixes jq.
Alternatives: Pin apt versions of python3/jq exactly and accept builds breaking on security updates.
Reversible: Yes.

### 18 Oct 2026 · 0.6 Node via the official node feature · decided by team lead · risk: low
Decided: Node comes from `ghcr.io/devcontainers/features/node` (pinned), not an nvm curl-install in postCreateCommand; pnpm only through corepack (`pnpmVersion: none`).
Why: Lead answer 2; the feature is pinned and cached in the image, and avoids piping an unpinned install script.
Alternatives: nvm install script in postCreateCommand, as the original plan step 2 said.
Reversible: Yes.

### 18 Oct 2026 · 0.6 Forward only port 3000; mount the repo at its host path · decided by tdd-guide · risk: low
Decided: The dev container forwards 3000 only, and mounts the workspace at the same path as on the host.
Why: Docker runs on the host (docker-outside-of-docker), so Compose already publishes 8080/9000/9001 on the host and forwarding them would clash; same-path mounting makes Compose's relative bind mounts work from inside the container.
Alternatives: Forward 8080/9000/9001 as the plan said; mount at `/workspaces/edmate` and pass `LOCAL_WORKSPACE_FOLDER` into Compose.
Reversible: Yes.

### 18 Oct 2026 · 0.5 CI reads scripts from main, not the PR · decided by planner · risk: high
Decided: `merge-gate.yml` and `risk-label.yml` check out `main` and only `git fetch` the PR's head commit into a same-named branch; they run main's `merge_gate.py`/`risk_labels.py`, never code from the PR.
Why: Running the PR's own copy of the gate would let a careless or malicious PR switch off its own check.
Alternatives: Check out the PR head (simpler, but that hole); `pull_request_target` (more ceremony and a riskier token, no gain).
Reversible: Yes.

### 18 Oct 2026 · 0.5 Risk labels are informational only · decided by planner · risk: high
Decided: The labeller adds `needs:<reviewer>` and `risk:touched` labels for visibility; no gate reads PR labels, and no `human-approved` label is created or checked anywhere.
Why: The lead decides every merge (human decision, 18 Oct 2026); a label gate would bring back the removed human-approval step.
Alternatives: Gate on a label, as 0.5 was first written; already rejected by the human.
Reversible: Yes.

### 18 Oct 2026 · 0.5 Workflow hardening choices · decided by tdd-guide · risk: medium
Decided: Actions pinned by full commit SHA with a version comment, minimal top-level permissions, `persist-credentials: false`, PR branch names passed through `env:` rather than inlined in shell, and the labeller skipped on fork PRs. A test file enforces all of these.
Why: Stops tag-swap supply-chain attacks, script injection through a crafted branch name, and token reuse by later steps.
Alternatives: Tag pins like `@v7` (drift silently); `actions/labeler` with its own glob list (would duplicate risk-paths.txt).
Reversible: Yes.

### 18 Oct 2026 · 0.5 No pnpm cache in CI for now · decided by tdd-guide · risk: low
Decided: `setup-node` runs without its pnpm cache; pnpm comes from corepack at install time.
Why: The cache step needs pnpm on PATH before corepack provides it; getting the order wrong breaks the job, and installs take only seconds.
Alternatives: `cache: pnpm` after a separate corepack step; `actions/cache` on the pnpm store.
Reversible: Yes.

### 18 Oct 2026 · 0.4 ADRs recorded · decided by team lead · risk: high
Decided: Three architecture decisions already made in the build plan and the decision log are now written down as ADRs: the tech stack (TypeScript throughout, no Rust), where port interfaces live (`packages/contracts/src/ports.ts`, type-only, differing from the Repo-layout prose that says harness defines them), and the access filter being built by construction (filtered search, the code-only probe, public titles, the 8-token leak definition). A template (`docs/adr/0000-template.md`) fixes the shape every future ADR must use.
Why: Rule 2 requires an ADR before contracts, stack or prompt-pack behaviour can change again; writing these three down now gives that rule something to point at, and the ports note resolves a reader-visible conflict between two parts of the spec. No code or contract changed; the ADRs only record what the spec and log already say, each with its source.
Alternatives: Leave the decisions only in the build plan and decision log, with no `docs/adr/` folder yet.
Reversible: Only by a new ADR superseding one of these.

### 18 Oct 2026 · 0.4 Builder writes the ADR text · decided by team lead · risk: low
Decided: For task 0.4 the builder wrote the ADR text directly from the build plan, PRD and decision log; `architect` did not pre-draft it, but still reviews every ADR and its findings are fixed before merge.
Why: Saves tokens; these ADRs only record decisions already made, so there is nothing for architect to decide up front.
Alternatives: Architect drafts the full ADR text first and the builder copies it, as the plan and the merge-gate skill describe.
Reversible: Yes; later ADRs can go back to architect drafting.

### 18 Oct 2026 · 0.4 Heading check has its own tests · decided by tdd-guide · risk: low
Decided: Added `docs/adr/test_check_headings.py` (stdlib unittest) next to `docs/adr/check-headings.py`, and the script takes an optional folder argument so tests can run it on temporary folders.
Why: The brief asked for tests first; a folder argument lets the tests check failures without breaking the real ADRs.
Alternatives: Only run the script by hand against the real folder.
Reversible: Yes, delete the test file.

### 18 Oct 2026 · 0.4 Review · decided by team lead · risk: low
Decided: check-headings.py does not flag a heading that appears twice; it checks only that every template heading is present and in order. The lead fixed four wording findings in the ADRs and the README in this PR.
Why: Duplicate headings are harmless and nothing in the spec asks for the check; later ADR edits need three reviewers, so cheap fixes were made now.
Alternatives: Add a duplicate check.
Reversible: Yes.

### 18 Oct 2026 · 0.3 Contracts created · decided by team lead · risk: high
Decided: The shared contracts now exist as Zod schemas, exactly matching the build plan's Core contracts. Tests fail if the code and the spec drift apart. Unknown fields are rejected, and the limits in the spec comments are enforced. From now on, changing a contract needs an ADR.
Why: Every package builds on these shapes; the tests prove they match the spec.
Alternatives: Hand-written TypeScript types without runtime checks.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Ports live in contracts · decided by team lead · risk: medium
Decided: The ports (Guard, Tool, RetrievalIndex, the stores, UsageMeter, ModelGateway, TraceSink, AlertSink) are type-only interfaces in packages/contracts/src/ports.ts, with no Zod schemas and no fixtures. The db, gateway and ingest adapters implement them by importing contracts, although the spec's repo layout says the harness defines them.
Why: Adapters can implement them without depending on the harness; functions can't be Zod data.
Alternatives: Define them in packages/harness.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Spec shapes kept as written · decided by team lead · risk: low
Decided: TurnEvent hint_rung keeps rung as a number and TurnTrace guards keep action as a plain string, as the spec says; at runtime hint_rung must be a whole number from 0 to 4.
Why: No type change to the spec, but bad rungs are still caught.
Alternatives: Change the types to the rung union and the guard action enum (needs an ADR).
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Conditional rules enforced · decided by team lead · risk: medium
Decided: Four rules from the spec comments are checked at runtime: an entitlement has a subscriptionId exactly when its source is subscription; no module is both allowed and locked (fail closed); a message turn needs text; a skill_action turn needs a skill. Each has a valid and an invalid fixture. TeacherQuestion.answeredAt has no rule.
Why: The spec states them in comments; checking them stops bad data at the boundary.
Alternatives: Leave them to the code that uses the data.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Field formats · decided by team lead · risk: medium
Decided: Timestamps are ISO 8601 with Z or an offset. Languages are a lowercase 2–3 letter primary tag. Currency is three capital letters. Market is a two-capital-letter ISO 3166 code or the word "global" (no invented codes; the pilot market stays your decision). Ids are any non-empty string. Counts, token numbers, versions, minor-unit amounts and cost are whole numbers from 0 up. Mastery p is between 0 and 1. Characters are counted as Unicode code points and words as runs of non-space. Attachment mime must start with image/.
Why: The spec gives these fields as plain strings and numbers; these are the narrowest formats it implies.
Alternatives: No format checks.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 No default message limit in the contract · decided by team lead · risk: low
Decided: PackageConfig.dailyMessageLimit is required in the contract; the studio and the seed fill in 20.
Why: A Zod default would make the field optional in the input type and break the exact match with the spec.
Alternatives: A Zod default of 20.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Zod version and strict objects · decided by tdd-guide · risk: low
Decided: Contracts pin zod 4.6.7 exactly (the newest stable 4.x on npm today). Every object schema is strict, so unknown keys are errors, not silently dropped; a client-sent packageId on a turn is rejected. Optional fields use Zod's exactOptional, so the types match the spec exactly and an explicit undefined is rejected.
Why: Zod 4 has the features the plan needs; strict objects catch typos and client-sent access fields.
Alternatives: zod 3; stripping unknown keys.
Reversible: Yes for the version; strictness only by ADR.

### 18 Oct 2026 · 0.3 Prompt-pack version is semver · decided by tdd-guide · risk: low
Decided: AgentConfig.promptPackVersion must be a semantic version such as 1.0.0 or 2.1.0-rc.1, because the spec comment says one semver pins the prompt-pack set.
Why: Catches values like "latest" that would break pinning.
Alternatives: Any string.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Size caps and safe formats · decided by tdd-guide · risk: medium
Decided: After review, the contracts cap sizes and narrow formats the spec left open. Ids are 1–128 letters, digits, _ or -. An attachment storage key is a relative path of at most 200 safe characters with no ".." part; an attachment is a PNG, JPEG, WebP or HEIC image of 1 byte to 20 MB. A skill payload is at most 16 KB of JSON. Turn text is also capped at 8,000 UTF-16 units before the 4,000-character count. Guard reasons are at most 500 characters; rewrite text and alert excerpts at most 8,000. Each locale PII pattern is at most 500 characters and must be a valid regular expression. The numbers live in LIMITS.
Why: Untrusted or model-made data reaches storage, prompts and alerts; small fixed caps stop abuse and runaway output at the boundary.
Alternatives: No caps; caps enforced only in the API layer.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Turn context must be consistent · decided by tdd-guide · risk: medium
Decided: A turn context is rejected if a retrieved chunk comes from a module the entitlement doesn't allow or from another teacher, or if the entitlement's package id, package version or agent id don't match the package and agent in the context.
Why: Fails closed if a bug ever mixes another package's or teacher's material into a turn.
Alternatives: Leave the checks to the pipeline code.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 One shared zod copy · decided by tdd-guide · risk: low
Decided: Contracts lists zod 4.6.7 as a peer dependency (and a dev dependency for its own tests), and each consumer installs zod itself; the harness now lists zod 4.6.7 because it uses the contracts at runtime.
Why: Every package then shares one zod, so schemas and their types stay compatible.
Alternatives: zod as a normal dependency of contracts.
Reversible: Yes.

### 18 Oct 2026 · 0.3 Review · decided by team lead · risk: low
Decided: The type cast in packages/harness/src/testing/fixtures.test.ts stays for now; the ports-in-contracts note goes into ADR-0002 (task 0.4). MEDIUM review findings were fixed in this PR, not deferred, because contracts freeze on merge.
Why: The cast is test-only and narrow; fixing contracts later would need an ADR and three reviewers.
Alternatives: Defer the MEDIUMs to a follow-up task.
Reversible: Yes.

### 18 Oct 2026 · 0.2 MinIO image from a community build · decided by tdd-guide · risk: medium
Decided: The local S3 server is `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, a maintained community build of the MinIO server with dated release tags, because the official MinIO images are no longer published.
Why: The amendment asks for MinIO pinned to a dated release tag; this is the only source found that still has one. It is dev-only, and the app talks plain S3, so it can be swapped without code changes.
Alternatives: `bitnamilegacy/minio` (frozen at 2025.7, no updates); Chainguard's MinIO (free tier is `latest` only); a different S3 server such as SeaweedFS or RustFS; building MinIO from source in our own image.
Reversible: Yes, one image line in docker/compose.yaml.

### 18 Oct 2026 · 0.2 Other image pins · decided by tdd-guide · risk: low
Decided: `pgvector/pgvector:0.8.1-pg16`, `redis:7.4.6-alpine`, `caddy:2.10.2-alpine`, and `node:22.22.3-alpine3.22` for both app images (the same Node as `.nvmrc` 22 in dev).
Why: Exact tags as amendment 2 asks; pgvector's image is Postgres 16 with the extension built in.
Alternatives: Floating tags such as `pg16`, `7-alpine`, `2-alpine`, `22-alpine`.
Reversible: Yes.

### 18 Oct 2026 · 0.2 S3 client · decided by lead · risk: low
Decided: The storage round-trip uses the AWS SDK v3 S3 client (`@aws-sdk/client-s3` 3.1152.0, exact), with path-style addressing on by default for MinIO.
Why: Production is any S3-compatible bucket, not necessarily MinIO (amendment 7).
Alternatives: The MinIO JS SDK.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Ports and defaults · decided by tdd-guide · risk: low
Decided: Only Caddy publishes a port, on 127.0.0.1:8080 (`EDMATE_HTTP_PORT`), plus MinIO's API and console on 127.0.0.1:9000/9001; web, worker, Postgres and Redis stay on the compose network. Compose runs with no env file: every setting has a dev default (`edmate` / `edmate-dev` / `edmate-dev-storage`) documented in docker/env.example.
Why: Port 3000 is taken on this machine (amendment 4); binding to 127.0.0.1 keeps the dev passwords off the local network; agents cannot create env files (amendment 3).
Alternatives: Publish on all interfaces; require an env file.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Standalone web image · decided by lead · risk: low
Decided: The web image runs Next.js standalone output (`output: 'standalone'` in apps/web/next.config.ts) as the `node` user; the worker image uses `pnpm deploy --prod` and runs as `node`.
Why: Small runtime images (about 200 MB) with no dev dependencies or root process.
Alternatives: `pnpm --filter web start` on a full install.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Worker healthcheck · decided by tdd-guide · risk: low
Decided: The worker counts as healthy when its container can open a connection to Redis, its queue.
Why: The worker has no HTTP port yet and app code was out of scope; this shows the process is up and its one dependency is reachable.
Alternatives: A heartbeat file or HTTP endpoint written by the worker (needs a change to apps/worker/src/index.ts); no healthcheck.
Reversible: Yes, when real queues land.

### 18 Oct 2026 · 0.2 Review · decided by team lead · risk: low
Decided: Three LOW review notes stay as they are: the MinIO healthcheck in docker/compose.yaml uses the image's own `mc`; apps/web/Dockerfile has no `outputFileTracingRoot`; roundtrip.ts picks a random object key by default. The MinIO community image is pinned by digest.
Why: Each is shown working in the evidence; none affects production.
Alternatives: Add a custom healthcheck, set outputFileTracingRoot, pass an explicit key.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Lead-approved risky merges · decided by tdd-guide · risk: high
Decided: The merge gate passes a risky branch only when review.md names every reviewer its risk groups need (listed in risk-paths.txt) and the handoff has a risk: high entry; otherwise it fails. It no longer reads the PR label and never says "needs human". A risky path with no reviewers line fails the gate.
Why: Your decision that the lead merges everything; this keeps the specialists and puts every risky merge on your skim list.
Alternatives: Keep a human step for some groups.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Decision checks · decided by lead · risk: low
Decided: A [wontfix] finding passes only if a decision entry for the task names its file. `board.py done` needs each handoff `Decided:` line word for word in the log.
Why: Simple, mechanical, hard to satisfy by accident.
Alternatives: Count entries; fuzzy matching.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Locale packs count as safety · decided by tdd-guide · risk: medium
Decided: Changes to content/locales need safety-reviewer and a safety-review.md, like the other child-safety paths.
Why: The scope change put locales in the safety group, and the safety review file goes with that group.
Alternatives: safety-reviewer only, no safety-review.md.
Reversible: Yes, one line in the gate.

### 18 Oct 2026 · 0.7 Wontfix file match · decided by tdd-guide · risk: low
Decided: The file a [wontfix] finding covers is its first word that looks like a path (has a slash or a file extension). An entry passes if it names that path or just the file name.
Why: Matches the review.md format; file names are how people write decisions.
Alternatives: Require the full path.
Reversible: Yes.

` ignored, safety-review.md for safety paths and locales, destructive migration needs `database-reviewer`, a glob with no `# reviewers:` line fails closed, never exit 3. `Wontfix` (6 cases).
- `test_board.py` (11): `done` refused with no handoff / no `## Decisions` / a `Decided:` line not in the log word for word / a condensed line (board file unchanged each time); `None` and whitespace-only differences pass; `next` warns for a planning task with no plan.md and not once it exists; other statuses unchanged.
- `test_hooks.py` (9): runs main's hooks unchanged (no edits): force-push denied, push to main allowed when the secret scan is clean and denied when it flags (a tracked `.npmrc`), label deny, `gh pr merge` needs a number, `.env` deny, no asks; guard-paths denies secrets/key files, allows contracts and harness files.

Gate demo in a temp repo (`contracts` change, `risk: high` entry present):
```
$ merge_gate.py 9.9   (reviewers missing) -> exit 1
  risky packages/contracts/src/x.ts
  FAIL  risky packages/contracts/src/x.ts: review.md Reviewers: is missing architect
  FAIL  risky packages/contracts/src/x.ts: review.md Reviewers: is missing security-reviewer
RESULT: FAIL — fix the items above, re-run the reviewers, then run the gate again.
$ merge_gate.py 9.9   (all three named) -> exit 0
  risky packages/contracts/src/x.ts
RESULT: PASS — risky, lead-approved: the required reviewers ran and a risk: high decision is logged. ...
```

`python3 .githooks/secret-scan.py --all`: clean (see final commit).

### 18 Oct 2026 · Merge policy · decided by you · risk: high
Decided: No permission prompts from the repo's hooks, and the team lead decides every merge, risky ones included. A risky merge needs the right specialist reviewers (safety-reviewer for child safety, security-reviewer for access, payments, sign-in and keys, architect for contracts and ADRs) and is logged as risk: high. Hard blocks stay: no secrets or key files, secret scan before pushes, harness purity, no force-push.
Why: You don't want to approve merges or edits; the lead holds the context.
Alternatives: Your approval for risky paths (the old rule).
Reversible: Yes; restore the ask rules and the merge gate's exit 3.

### 18 Oct 2026 · Repo and push policy · decided by you · risk: high
Decided: The code is now on GitHub at github.com/sid2305/edmate (public). Agents push, including straight to main; there is no human push step. Force-push stays blocked, and every push to main runs the secret scan first and is refused if anything is flagged.
Why: You don't want to run pushes yourself.
Alternatives: Agents push task branches only and the human pushes main; PR-only merges.
Reversible: Yes; restore the deny rule in guard-bash.sh.

### 18 Oct 2026 · Merge policy · decided by you · risk: high
Decided: Changes to packages/contracts no longer need your approval. The team lead decides, provided an ADR (written by architect) explains the change, security-reviewer and an Opus typescript-reviewer have reviewed it, and the lead logs it as risk: high. ADRs about the tech stack or prompt-pack behaviour, and all other risky paths, still need you.
Why: You don't want to be the bottleneck for contract changes.
Alternatives: Keep your approval for every contract change.
Reversible: Yes; put packages/contracts back on the human list.

### 17 Oct 2026 · Board · decided by you · risk: low
Decided: Added task 0.7, harness fixes found in the 0.1 dry run: a local human approval for the merge gate, decision-log checks, shell-write guards for protected paths, and planner and plan-file fixes.
Why: Without them, risky tasks can't pass the gate before GitHub exists, and some rules are only enforced for the Edit and Write tools.
Alternatives: Live with the gaps until CI (0.5).
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by tdd-guide · risk: low
Decided: Pinned pnpm 12.14.0, Turborepo 2.11.9, ESLint 10.13, Vitest 5.0.5, Next.js 16.4.2, React 19.3.1, BullMQ 6.3.16, Node 22.x. TypeScript 6.0.3, not 7, because the ESLint TypeScript plugin doesn't support 7 yet.
Why: Newest stable versions that work together on Node 22.
Alternatives: TypeScript 7 without type-aware linting.
Reversible: Yes, by bumping versions.

### 17 Oct 2026 · 0.1 Harness purity rule · decided by tdd-guide · risk: medium
Decided: Two narrow exceptions to the harness import rule: `vitest` in test files only, and tooling config files at the harness root (eslint.config.js, vitest.config.ts). Everything else fails closed, including relative paths that leave the package, unreadable import paths and indirect use of `require`.
Why: Harness tests need vitest and the lint config needs its preset; neither ships as harness code.
Alternatives: Vitest globals with no exceptions.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by you · risk: low
Decided: `packages/payments` is not created as an empty workspace; the payments milestone (M10) creates it.
Why: Same rule as the other risky folders: no empty placeholders in risky paths.
Alternatives: An empty shell like contracts, which would also need your approval.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by planner · risk: low
Decided: `edmate --version` runs from the built output; no dev-mode entrypoint. The web app gets no Tailwind, shadcn or next-intl yet, only `/api/health` and the minimal pages Next.js needs.
Why: Matches the acceptance order (build, then test, lint); UI choices belong to the UI tasks.
Alternatives: A tsx dev entrypoint; wiring the UI stack now.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by tdd-guide · risk: low
Decided: pnpm is a root dev dependency (no global install); install scripts are off by default; BullMQ uses its plain-JS fallback instead of a native add-on. Next.js's auto-generated AGENTS.md is off and next-env.d.ts is git-ignored.
Why: Repo rules forbid global installs; fewer install scripts means less supply-chain risk; the repo's CLAUDE.md already holds agent rules.
Alternatives: corepack enable; committing generated files.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Review · decided by team lead · risk: low
Decided: Two LOW review findings left as they are: the CLI reads its own package.json with an unchecked type cast, and the worker test passes a fake Redis with a type cast.
Why: Neither handles outside data.
Alternatives: Validate with Zod; build a typed fake connection.
Reversible: Yes.

### 17 Oct 2026 · Tech stack · decided by Claude (lead), at your request · risk: medium
Decided: Keep TypeScript end to end; no Rust. Revisit only for a single hot spot at scale, as a Rust service behind an existing port, with its own ADR.
Why: Turns are dominated by model, database and network waits, not our code; one language lets every app share the Zod contracts; the libraries we need (Next.js, Auth.js, AI SDK, Drizzle, BullMQ, payment SDKs) are TypeScript-first; agents and contributors move faster in TypeScript.
Alternatives: Rust backend with a TypeScript front end; Rust for the harness only.
Reversible: Yes, per component behind ports.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by you · risk: low
Decided: The scaffold does not create empty placeholder folders in risky or safety paths (harness access and guardrails, prompt packs, skills, locales, safety and locked evals, ADRs). The task that fills each folder creates it; the README lists the full layout.
Why: Empty files there would trigger safety review and approval for nothing.
Alternatives: Create every folder now.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Harness purity rule · decided by you · risk: low
Decided: The harness may import only contracts, zod, mathjs and its own files. Node built-ins (like node:crypto or fs) are blocked too.
Why: Rule 3 taken literally keeps the harness free of hidden I/O; a later need gets an explicit allow-list entry and a log entry.
Alternatives: Allow all node: built-ins.
Reversible: Yes, a one-line lint change.

### 17 Oct 2026 · Product · decided by you · risk: high
Decided: When the teacher's material doesn't cover a question, the agent says so and sends the question to the teacher. The teacher answers from an inbox; the answer goes back to the student and becomes a teacher note and a test case, so the agent can answer similar questions next time. The agent never fills gaps with general knowledge.
Why: Keeps the teacher in the loop and makes the agent better with every answer.
Alternatives: Allow labelled general knowledge; strict "not covered" with no follow-up.
Reversible: Yes.

### 17 Oct 2026 · Scope · decided by you · risk: medium
Decided: MVP cuts from the review: Google and email sign-in (no phone OTP); two model adapters; provider subscriptions with manual monthly payouts; study plan and photo upload moved to P1; load test at 50 students; manual teacher verification and regulated-subject review. One course and one agent per teacher. A public teaching scorecard on teacher pages is in the MVP.
Why: A smaller pilot that still shows what makes Edmate different.
Alternatives: Full scope.
Reversible: Yes; each item returns as a P1 task.

### 17 Oct 2026 · Build plan · decided by Claude · risk: medium
Decided: Applied the independent review (Fable) to the plan before task 0.1: completed the core contracts (about 12 missing types, entitlement sources for teacher preview and evals, one status list, guard results that carry replacement text, timezone, structured skill events); a code-only probe so "locked" and "not covered" are told apart without locked text reaching any model; concurrent checks so the harness adds under ~600 ms; per-turn cost ceiling and a default of 20 messages a day; the eval runner moved before the guards, with seeded suites; a defined "leak"; gates scoped by change. New tasks: demo teacher content (1.8), prompt packs v1 (3.11), eval runner (3.12), seed suites (4.0), ask-the-teacher path (5.10), outline and style drafters (5.11), scorecard (7.8), questions inbox (8.9). Now 104 tasks.
Why: The contracts freeze at task 0.3; fixing them later would need ADRs and rework.
Alternatives: Start building and fix as we go.
Reversible: Yes, until 0.3 merges.

### 17 Oct 2026 · Setup · decided by you · risk: low
Decided: All coding work (tdd-guide, build-error-resolver) runs on Opus 5.5 at medium effort, pinned in their agent files. The team lead no longer switches models for coding; cheaper defaults and per-task choices still apply to planning, review and docs agents.
Why: Code quality matters most where code is written; medium effort keeps token use in check.
Alternatives: Sonnet by default with Opus only for risky tasks.
Reversible: Yes, two lines in the agent files.

### 17 Oct 2026 · Setup · decided by you · risk: medium
Decided: The team lead picks each agent's model per task to save tokens. Every agent has a cheap default (mostly Sonnet, Haiku for docs lookup); the lead moves up to Opus only for risky or core tasks, or after two failed fix rounds. The safety reviewer always runs on Opus. The model used is recorded per task on the board.
Why: Most tasks don't need the most expensive model; the record shows where it is worth paying for.
Alternatives: One fixed model per agent.
Reversible: Yes, edit the table in the team-lead skill.

### 17 Oct 2026 · Product · decided by you · risk: medium
Decided: Edmate is country-neutral. Currency, language, helplines, payments, tax and privacy rules live in a locale pack per market; prices are stored as amount + currency. The pilot launches in one market, chosen later.
Why: Keep the platform open to any market; adding one later should mean adding a pack, not rewriting code.
Alternatives: India only.
Reversible: Yes, but cheapest to decide now, before the contracts freeze (task 0.3).

### 17 Oct 2026 · Setup · decided by Claude · risk: medium
Decided: The agent team changes for v0.3. The life-skills content-author is replaced by a pedagogy-author (platform prompt packs, skill and persona templates, the demo course). The safety-reviewer and eval-author now also cover locked content and regulated-subject advice. The access filter, payments and webhooks, and skill templates count as risky paths. marketing-agent and market-research move into the Validate phase; seo-specialist moves to the website phase; search-first is added for library choices.
Why: Teachers now bring their own course material, and the new promises (locked packages, payments) need the same protection as safety code.
Alternatives: Keep the v0.2 agents unchanged.
Reversible: Yes.

### 17 Oct 2026 · Build plan v0.3 · decided by Claude · risk: medium
Decided: Rewrote the build plan for PRD v0.3: 14 milestones, 94 tasks. The harness is still built and proven first (M0–M7), now with the access filter at its centre (task 5.4) and an exit gate requiring zero locked-content leaks. Payments (M10) and the trust console (M12) can run alongside. The v0.2 plan and PRD are archived in docs/archive/.
Why: The product changed from a school harness to a teacher-agent marketplace.
Alternatives: Patch the v0.2 plan.
Reversible: Yes; task IDs changed, so nothing built against the old plan exists yet.

### 17 Oct 2026 · Product · decided by you · risk: high
Decided: Edmate is a platform where a student finds the right teacher and learns with that teacher's AI agent. Teachers build the agent from their own knowledge and sell packages that control what the agent knows and can do. Not classroom-based, not a school replacement.
Why: Your direction for the product (PRD v0.3).
Alternatives: The v0.2 free, school-based life-skills harness.
Reversible: Yes, before code is built.

### 16 Oct 2026 · Setup · decided by you · risk: high
Decided: Nothing private or personal goes into the repo. A secret scan blocks credentials, private keys, personal emails and home-folder paths at three points: when an agent edits a file, at every git commit, and (from task 0.5) in CI. GitHub secret scanning and push protection are switched on when the repo is created.
Why: The repo is public, and anything pushed can be copied before it is deleted.
Alternatives: Rely on .gitignore only.
Reversible: Yes, but a leaked key must always be rotated, never just deleted.

### 16 Oct 2026 · Setup · decided by Claude · risk: low
Decided: This repo's commits use your private GitHub address (11736444+sid2305@users.noreply.github.com) instead of your Gmail. Your global git settings are unchanged.
Why: Every commit's email is public in a public repo.
Alternatives: Keep the Gmail address.
Reversible: Yes, one git setting.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Agents act on GitHub through a private GitHub App (edmate-bot), not your account. Its key lives outside the repo in ~/.edmate-bot/.
Why: GitHub can then tell agent actions from yours, so only you can give the human-approved label, and you can approve the bot's PRs.
Alternatives: A second "machine" GitHub account; your own account with a hook.
Reversible: Yes.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: The GitHub repo is public.
Why: Edmate is open source; branch protection and Actions minutes are free for public repos.
Alternatives: Private until the exit gate (needs GitHub Pro for branch protection).
Reversible: Partly. Anything already public may have been copied.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Code is MIT-licensed. Curriculum content stays CC BY-SA 4.0, as the PRD says.
Why: MIT is the easiest for schools, NGOs and other programmes to adopt.
Alternatives: Apache 2.0; AGPL.
Reversible: Only for future versions.

### 16 Oct 2026 · Setup · decided by you · risk: high
Decided: The team lead merges PRs itself once reviews are done, every CRITICAL and HIGH finding is fixed and re-checked, and the gates are green. You are asked only for risky or ambiguous changes.
Why: Waiting on you for every PR would stall the build; the lead holds the full context.
Alternatives: You approve every PR.
Reversible: Yes, by editing `risk-paths.txt` or the merge-gate skill.

### 16 Oct 2026 · Setup · decided by you · risk: high
Decided: Child-safety code, frozen contracts and ADRs, keys, sign-in, data isolation, migrations that delete data, and the `.claude/` and `.github/` config count as risky and need your `human-approved` label.
Why: The PRD calls a safety incident with a minor "existential", and these areas are hard to undo.
Alternatives: The lead also merges these.
Reversible: Yes, edit `.claude/skills/merge-gate/risk-paths.txt`.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Keep this decision log as one Markdown file, newest first, written only by the team lead on `main`.
Why: One writer means no merge conflicts between parallel agents; Markdown is easy to read anywhere.
Alternatives: One file per decision; a Claude Doc.
Reversible: Yes.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Host the code on GitHub and use GitHub Actions for CI gates, the merge-gate check and risk labels (added with task 0.5).
Why: GitHub then enforces the merge rules, rather than us trusting an agent to follow them.
Alternatives: Local checks only.
Reversible: Yes.
Open: private repo with GitHub Pro, or public now; a separate bot account for agent PRs (see the board's decisions).

### 15 Oct 2026 · Setup · decided by you · risk: medium
Decided: Use ECC's agents and skills as a library: copy only what each phase needs into the repo, instead of installing all of ECC.
Why: All of ECC adds about 35k tokens to every session, and its generic rules clash with the build plan.
Alternatives: Full ECC install; ECC plugin scoped to this project.
Reversible: Yes.

### 15 Oct 2026 · Setup · decided by you · risk: low
Decided: Use ECC agents instead of a custom role-based team (team lead, PM, designer and so on). Keep 3 Edmate-only agents ECC lacks: safety-reviewer, content-author, eval-author.
Why: ECC's agents are already tested; Edmate needs only the gaps filled.
Alternatives: A custom team of about 12 role agents.
Reversible: Yes.

### 15 Oct 2026 · Setup · decided by you · risk: low
Decided: Everything lives in `~/edmate` with project-level settings; nothing is installed globally.
Why: Keeps your other projects untouched, and the setup versioned with the code.
Alternatives: Global install in `~/.claude`.
Reversible: Yes.
