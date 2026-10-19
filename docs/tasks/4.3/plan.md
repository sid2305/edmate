# Task 4.3: `distressDetect`, escalate, alert worker with acknowledgement and 15-min escalation

Board: `board.py show 4.3` · M4 · deps 3.1, 3.12, 4.0, 4.1 (all done) · branch `m4/4.3-distress` ·
runs in parallel with 4.2 (`scrub` phase); 4.3 wires the `pre` phase.

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "`distressDetect`, escalate, alert worker with acknowledgement and 15-min escalation"
Accept: "100% of distress cases escalate; alert delivered < 5 min in an integration test; the turn
is still saved."

### How it will be shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Guard behaviour | `distressKeywords.test.ts` + `distressDetect.test.ts`: a built-in keyword table per language (en, hi — Devanagari and romanised together, since `Lang` carries no separate script tag) catches every one of the 33 seeded distress phrases without a model call; where the keyword list is deliberately conservative (ambiguous slang), a scripted small-tier classifier call via `ctx.gateway.generateObject` disambiguates; a keyword or classifier hit returns `{ok:false, action:'escalate', alert}` with a bounded `excerptRedacted` (from the already-scrubbed text, no PII); no hit returns `{ok:true}`; a classifier throw/timeout propagates (the guard never swallows it) so the chain fails closed instead of inventing a verdict. |
| Keyword fallback survives a chain failure | `preGuard.test.ts`: when the chain comes back `failed` (classifier threw), `steps.preGuard` throws (mirrors 4.2's `scrub.ts`); `runner.test.ts` (existing suite, read-only) already proves the runner's independent `deps.distressCheck` then escalates — this task only has to make `distressCheck`'s real implementation reuse the same keyword table, with a new `runner.test.ts` case wiring the real `distressDetect`/`distressCheck` together to close the loop end to end. |
| Reply is always the caring template | `escalate.test.ts`: `steps.escalate` ignores the `alert` it's given for reply purposes and always returns the locale pack's helplines (or, with none verified, the generic "local emergency services and a trusted person" wording per `locale-context` rule 4) — never alert-mechanism text (no "trust team", no alert id, no ids of any kind). |
| 100% of distress cases escalate; the turn is still saved | New `packages/evals/src/distressEscalate.test.ts`: loads all 39 cases (33 distress + 6 near-miss) via 3.12's `loadCasesFromDir`, drives each turn carrying a new `expect.must_escalate` through the real `runTurn` (real `preGuard`/`escalate`, happy-path fakes for the unbuilt steps, `ScriptedGateway` scripted per case). Asserts, per case: `commits[0].outcome` is `'escalated'`/not, `commits[0]` always exists ("the turn is still saved"), the trace's `move`/`intent` are `'redirect'`/`'distress'` on the 33 ("escalation-move" assertion), `alerts.raised.length` is 1/0, and the reply matches the caring-template check above. 33/33 escalate, 6/6 do not. |
| Alert worker: delivered < 5 min, idempotent, retried until delivered | New `apps/worker/test/alert.int.test.ts` (real Redis, compose-based, same pattern as `commit.int.test.ts`): enqueues a `SafetyAlert` on the real `ALERT_QUEUE` through `queuedAlertSink`; the real `createAlertWorkers` delivers it to a notifier that fails twice then succeeds; elapsed wall-clock time to first successful `notify('trust_team', …)` is asserted `< 5 * 60_000` ms (comfortably true: 5-attempt exponential backoff from 1 s tops out near 30 s). Processing the same alert id twice (replayed job) does not double-schedule the escalation check (jobId dedup). |
| Alert worker: acknowledgement and 15-min escalation | `processors.test.ts` (unit, fake queue/clock, no Redis): after a successful `alert.raise`, an `alert.escalate_check` job is scheduled with a configurable delay (prod default 15 min, test override); if `ackStore.isAcknowledged(alert.id)` is false when it runs, `notifier.notify(alert, 'on_call')` fires; if true, it does not. `alert.int.test.ts` also proves this with a short override delay (e.g. 50 ms) end to end on real Redis, both acked and not-acked. |
| Harness purity | `packages/harness/src/**` still imports only `@edmate/contracts`, `zod` and its own modules; no new dependency; `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/queue... --filter=@edmate/worker... --filter=@edmate/evals...` green. |

## Design

### What exists already (read only, not touched)
- `packages/harness/src/pipeline/runner.ts` (3.1/4.1, frozen by this task): the keyword-fallback-survives-chain-failure behaviour, the infinite in-process retry-until-delivered `deliverAlert` loop (250 ms → 30 s backoff), `buildAlert`'s fallback, and "escalate beats block" are already built and tested. **4.3 adds no runner.ts logic** — it only has to supply correct real implementations behind the seams the runner already calls (`steps.preGuard`, `steps.escalate`, `deps.distressCheck`, `deps.alerts`).
- `packages/harness/src/guardrails/{guard,registry,chain,order}.ts` (4.1): `runGuardChain` already re-checks a rewrite, lets `escalate` beat a verification-pass block, and treats every framework failure as `failed` (never `ok`). distressDetect's only non-`ok` action is `escalate` (per the guard table) — it never rewrites or blocks, so the verification pass never sees it fire twice.
- `docs/tasks/4.1/safety-review.md`: "4.3 and 4.5: save the escalate text but always reply with the caring template" and "4.3: a chain `failed` must not suppress the distress keyword fallback" — both satisfied structurally (see rows above), not by new runner code.
- `docs/tasks/4.1/handoff.md` decision: the first guard task that writes a `safety_events` row (likely 4.4) raises the `SafetyEventSink` ADR. **4.3 does not touch `safety_events`** — distress alerts go through the already-frozen `AlertSink` port (contracts) to a dedicated alert queue/worker, a separate mechanism from the trust-console `safety_events` table. No `packages/contracts` edit, no ADR.
- `apps/worker/src/alarms/{types,logSink,schedule,costAlarm}.ts` (2.5/3.8): the pattern this task copies for `apps/worker/src/alerts/` — a worker-local (not contracts) sink interface, a log-line stand-in ("real delivery... waits for a vendor decision, the same gap as 4.3's safety alerts" — `logSink.ts`'s own comment), a scheduled/delayed BullMQ job, dead-lettering via the existing `onJobFailed`.
- `apps/worker/test/commit.int.test.ts` (3.8): the exact integration-test shape this task copies for `alert.int.test.ts` — real compose Redis, `reachable()` skip-locally/fail-in-CI, `until()` polling, prefix-scoped queues cleaned up in `afterAll`. No Postgres needed for alerts (Redis only).
- `.claude/skills/merge-gate/risk-paths.txt` already names `apps/worker/src/alerts/**` in the safety-reviewer group — the folder name is fixed by that file, not a new choice.

### New shared type: `packages/harness/src/guardrails/preGuardCtx.ts`
```ts
export interface PreGuardCtx {
  locale: LocalePack;
  entitlement: Entitlement;   // studentId, teacherId, source
  sessionId: string;
  lang: Lang;
  gateway: ModelGateway;      // small-tier classifier calls
  ids: IdSource;              // SafetyAlert id
  clock: Clock;                // SafetyAlert createdAt
}
```
`GuardRegistry<PreGuardCtx>('pre')` and `runGuardChain<PreGuardCtx>` need one shared context type for every guard in the phase (chain.ts takes a single `ctx` for the whole chain) — `moderationIn`/`jailbreak` (4.4) will reuse or extend this, since 4.3 lands first. Flagged under Open questions.

### New module: `packages/harness/src/guardrails/distressKeywords.ts`
Pure, no model call: `hasDistressKeyword(text: string, lang: Lang): boolean`. A built-in (not locale-pack-sourced — see Open Q1), per-language table of self-harm/suicide/hopelessness phrases, English + Hindi (Devanagari and romanised together under `lang: 'hi'`), covering the 33 seeded distress cases while deliberately excluding bare ambiguous words the 6 near-miss cases use ("pagal", "dead 💀", "mar gaya", "nearly melted" as idiom) — those are left to the classifier. Reused verbatim as `PipelineDeps.distressCheck` (the composition root wires `distressCheck: (text, lang) => hasDistressKeyword(text, lang)`; `testing/testSteps.ts`'s existing `distressCheck: () => false` fake is untouched — other tasks' tests don't need real detection).

### New guard: `packages/harness/src/guardrails/distressDetect.ts`
`createDistressDetectGuard(): Guard<PreGuardCtx>`:
1. `hasDistressKeyword(text, ctx.lang)` → hit: build `SafetyAlertSchema.parse({id: ctx.ids.next('alert'), level:'alert', kind:'distress', studentId: ctx.entitlement.studentId, teacherId: ctx.entitlement.teacherId, sessionId: ctx.sessionId, excerptRedacted: <bounded slice of the scrubbed text>, createdAt: isoAt(ctx.clock.now())})`, return `{ok:false, action:'escalate', alert}`.
2. No hit → one `ctx.gateway.generateObject({tier:'small', system:<built-in classifier prompt>, messages:[{role:'user', content:text}], maxOutputTokens: <small>}, z.strictObject({distress: z.boolean()}))`. `distress: true` → same alert-building as (1); `false` → `{ok:true}`.
3. The classifier call is not wrapped in try/catch inside the guard — a throw/timeout propagates, so `runGuardChain` marks the chain `failed` (never invents an `ok`), per the 4.1 review note.
4. `usage: []` always — `ModelGateway.generateObject` has no usage-reporting channel today (see Open Q3); the classifier's cost is unmetered, same as it would be for any other `generateObject`-based guard.

### Wiring: `packages/harness/src/pipeline/steps/preGuard.ts` (replaces the stub)
```ts
const registry = new GuardRegistry<PreGuardCtx>('pre');
registry.register(createDistressDetectGuard());  // moderationIn, jailbreak register in 4.4

export const preGuard: Steps['preGuard'] = async (env, s) => {
  const ctx: PreGuardCtx = { locale: s.locale, entitlement: s.entitlement, sessionId: env.input.sessionId,
    lang: env.input.lang, gateway: env.deps.gateway, ids: env.deps.ids, clock: env.deps.clock };
  const chain = await runGuardChain(registry.ordered(), env.input.text ?? '', ctx,
    { phase: 'pre', clock: env.deps.clock, timeoutMs: <guard's own slice>, cancel: env.cancel });
  if (chain.outcome === 'ok') return { result: 'ok', guards: chain.guards, usage: chain.usage };
  if (chain.outcome === 'escalate') return { result: 'escalate', alert: chain.alert, guards: chain.guards, usage: chain.usage };
  // 'block' or 'failed': distressDetect alone never blocks, so this is a framework failure.
  // Throw (as scrub.ts does) so the runner's own distressCheck keyword fallback still runs.
  throw new Error(`preGuard guard chain failed closed${...}`, { cause: {...} });
};
```
`steps/index.ts` keeps importing `scrub` from 4.2's `scrub.ts` and `preGuard` from this file (coordination note under Risks below — whichever of 4.2/4.3 merges second rebases the one-line import).

### `packages/harness/src/pipeline/steps/escalate.ts` (replaces the stub)
Pure composition, no model call (the spec: "skip to step 11"), ignores the `alert` parameter entirely (the runner's existing `buildAlert`/`fallbackAlert` already handle every alert-sourcing case — see "What exists already"):
```ts
export const escalate: Steps['escalate'] = async (_env, s, _alert) =>
  ({ replyText: buildCaringReply(s.locale) });
```
`buildCaringReply(locale)`: a built-in English caring opening (same justification as `LAST_RESORT_DISTRESS_REPLY` — no i18n library allowed in the harness, build plan step 5 has no model call to translate) plus, if `locale.helplines.length > 0`, each helpline's name and number; else the generic fallback wording from `locale-context` rule 4. Never mentions an id, "alert" or "trust team".

### Test-only locale fixture: `packages/harness/src/testing/distressLocaleFixtures.ts`
`indiaLocalePackWithHelplines = { ...demoLocalePack, helplines: [{name:'Tele-MANAS', number:'14416', kind:'mental_health'}] }` for the `distress/in/**` cases; the `generic` cases and the near-misses reuse the existing `localePackMinimal` (`helplines: []`) unchanged. No `packages/contracts` edit (mirrors 4.2's `piiLocaleFixtures.ts`).

### `packages/queue`: alert transport
- `queues.ts`: `ALERT_QUEUE = 'edmate-safety-alert'`; `JOB.alertRaise`/`JOB.alertEscalateCheck`; `AlertJobSchema = z.strictObject({ scope: Scope, alert: SafetyAlertSchema })`; `jobId.alert`/`jobId.alertEscalate` (`${alertId}.alert` / `${alertId}.escalate`, so a retried or replayed raise never double-schedules the escalation check).
- `alertSink.ts`: `queuedAlertSink(queue: JobQueue, scope: JobScope): AlertSink` — `raise(a)` just enqueues `JOB.alertRaise` with the idempotent jobId and the existing `RETRY`/`jobOptions` backoff; it resolves once the job is durably enqueued (delivery and ack/escalation are the worker's job — the runner's own `deliverAlert` already retries `raise()` forever if even enqueueing fails, e.g. Redis briefly down).
- `index.ts`: `TurnQueues` gains an `alert: JobQueue`; `queuedTurnPorts` gains `alerts: queuedAlertSink(queues.alert, scope)`, so a later composition-root task has it ready (not wired into any app yet, same as the other producer ports are until a live turn route exists).

### `apps/worker/src/alerts/` (new; in risk-paths.txt's safety-reviewer group)
- `types.ts`: `AlertNotifier.notify(alert: SafetyAlert, audience: 'trust_team' | 'on_call'): Promise<void>`; `AckStore.acknowledge(alertId): Promise<void>` / `isAcknowledged(alertId): Promise<boolean>`. Worker-local, not contracts (mirrors `alarms/types.ts`'s `CostAlarmSink`).
- `logSink.ts`: `logAlertNotifier()` — one structured JSON log line per notify call (no excerpt text beyond what `SafetyAlert.excerptRedacted` already allows), explicitly the same known, logged vendor gap `alarms/logSink.ts` already names.
- `ackStore.ts`: `redisAckStore(redis, ttlSeconds)` — `SET alert:ack:<id>`/`EXISTS`, real (not a stub), ready for a later trust-console task to call `acknowledge`; see Open Q4.
- `processors.ts`: `alertProcessor(notifier, ackStore, queue, escalateAfterMs, log)`. `alert.raise`: `notifier.notify(alert, 'trust_team')`, then `queue.add(JOB.alertEscalateCheck, {scope, alert}, {delay: escalateAfterMs, jobId: jobId.alertEscalate(alert.id)})`. `alert.escalate_check`: if `!await ackStore.isAcknowledged(alert.id)`, `notifier.notify(alert, 'on_call')`. Both re-run safely (safety favours an extra notification over a missed one).
- `workers.ts`: `createAlertWorkers(...)` — one `Worker(ALERT_QUEUE, ...)`, concurrency matching `commit`'s pattern, wired to the existing `onJobFailed`/dead-letter.
- `ALERT_ESCALATION_MS = 15 * 60_000` default, injectable for tests.
- `apps/worker/src/index.ts`: wire `createAlertWorkers` alongside the turn workers; build `logAlertNotifier()` and `redisAckStore(connection, ...)`.

## Files

Create:
- `packages/harness/src/guardrails/{distressKeywords,distressDetect,preGuardCtx}.ts` + their `.test.ts`
- `packages/harness/src/testing/distressLocaleFixtures.ts`
- `packages/queue/src/alertSink.ts` + `.test.ts`
- `apps/worker/src/alerts/{types,logSink,ackStore,processors,workers,index}.ts` + unit `.test.ts` files
- `apps/worker/test/alert.int.test.ts`
- `packages/evals/src/distressEscalate.test.ts`

Modify:
- `packages/harness/src/pipeline/steps/{preGuard,escalate}.ts` (replace stubs); `steps/index.ts` (coordinate import with 4.2's split, see Risks)
- `packages/harness/src/pipeline/runner.test.ts` (one new case: real `distressDetect`+`distressCheck` wired together, chain `failed` still escalates via the keyword fallback)
- `packages/harness/src/guardrails/index.ts`, `packages/harness/src/testing/index.ts` (export the new names/fixture)
- `packages/queue/src/queues.ts`, `packages/queue/src/index.ts` (ALERT_QUEUE, job schema, `TurnQueues`/`queuedTurnPorts`)
- `apps/worker/src/index.ts` (wire the alert worker)
- `packages/evals/src/schema.ts` + `schema.test.ts` (add `must_escalate: z.boolean().exactOptional()` to `CheckSchema` — additive, `packages/evals`'s own case format, not `packages/contracts`)
- `evals/suites/safety/distress/{in,generic}/*.yaml` (33 files: add `must_escalate: true` to the distress turn's `expect`)
- `evals/suites/safety/distress-nearmiss/*.yaml` (6 files: add `must_escalate: false`)
- `packages/harness/README.md` (short note: `preGuard`'s `distressDetect` guard is wired; 4.4 adds `moderationIn`/`jailbreak` to the same `pre`-phase registry/`PreGuardCtx`)

Out of bounds:
- `packages/contracts/**` — no edit; `AlertSink`/`SafetyAlert` are already frozen and sufficient. No ADR.
- `packages/db/**`, `safety_events` — not touched (that table and its `SafetyEventSink` ADR are 4.4's, per the 4.1 handoff decision).
- `content/locales/**`, the real `TurnConfigStore` — 3.10's scope; this task's locale/keyword data is a harness-test fixture + a built-in table, both reversible.
- `apps/web/**`, `apps/cli/**` — no composition-root wiring of `alerts`/`PipelineDeps` into a live route; `queuedTurnPorts` just gains the capability.
- `packages/evals/src/{agent,runner}.ts`, a general-purpose `EvalAgent` implementation, recorded judge fixtures — the new assertion is a dedicated offline pipeline test (like 4.2's `piiScrubPipeline.test.ts`), not a full live-agent/judge wiring; the 39 cases' reply-level `judge`/`must_not_contain` checks stay exactly as deferred as 4.0/4.2 left them.
- `evals/suites/safety/distress/in/safety-distress-retract-joke-in-en.yaml` turn 2 — only turn 1 (the distress message) gets `must_escalate: true`; turn 2's post-joke reply quality needs real generation and stays deferred.
- `packages/harness/src/pipeline/runner.ts`, `chain.ts`, `registry.ts`, `order.ts` — frozen; this task only supplies real steps/guards behind the existing seams.
- `moderationIn`, `jailbreak` (4.4) — not built here; `registry.ordered()` simply has one entry for now.

## Tests first (tdd-guide order)
1. `distressKeywords.test.ts` — table of all 33 case phrases (must hit) and the 6 near-miss phrases (must not hit by keyword alone).
2. `distressDetect.test.ts` — keyword-hit shape, classifier-hit/no-hit shape, classifier-throw propagates (chain fails, guard doesn't swallow), `excerptRedacted` never echoes raw unredacted PII-shaped text, usage always `[]`.
3. `preGuard.test.ts` — `ok`/`escalate` pass-through; `failed`/`block` throws with cause, never the raw text.
4. `escalate.test.ts` — helpline-present vs. none (generic wording), never alert/id text, ignores the `alert` param.
5. `runner.test.ts` new case — real pieces wired, chain `failed` still escalates via `distressCheck`.
6. Build `distressKeywords.ts` → `distressDetect.ts` → `preGuard.ts`/`escalate.ts` → the runner case green.
7. `packages/evals/src/schema.test.ts` — `must_escalate` parses; `distressEscalate.test.ts` last (needs steps done): all 39 cases, 33/33 escalate + saved, 6/6 don't.
8. `apps/worker/src/alerts/{ackStore,processors,workers}.test.ts` (fakes, no Redis) → `apps/worker/test/alert.int.test.ts` (real Redis) last.
9. Full gate: `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/queue... --filter=@edmate/worker... --filter=@edmate/evals...`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/harness/src/guardrails/**` → **reviewers: safety-reviewer**.
- `apps/worker/src/alerts/**` → **reviewers: safety-reviewer**.
- `evals/suites/safety/**` (the 33+6 YAML edits) → **reviewers: safety-reviewer** (same group as above, one reviewer covers all three).
- `packages/contracts/**`, `docs/adr/**` — none touched; no architect/security-reviewer/typescript-reviewer requirement from this group.
- `packages/harness/src/pedagogy/**`, `packages/harness/src/access/**`, `content/locales/**`, `.claude/**`, `.github/**`, `.githooks/**` — none.
- `packages/queue/**`, `apps/worker/src/index.ts`, `packages/evals/src/{schema,distressEscalate}.test.ts` are not themselves risky-path globs, but given the subject matter, recommend (not required) safety-reviewer also skim them, matching 4.2's precedent.
- `docs/decisions/log.md` gets a `risk: high` entry at merge (new guard + alert-delivery logic in two risk-paths.txt safety groups), per rule 6.
- Recommended reviewers for the PR: **safety-reviewer** (required), plus **typescript-reviewer** and **silent-failure-hunter** (new ports, idempotency and background-error paths) — matching 4.1/4.2's own precedent, not required by risk-paths.txt.

## Open questions (recommendations)

- **Q1 Where do distress keywords live, with no `LocalePack` field and 3.10 not landed?** *Recommend:* a built-in harness table (`distressKeywords.ts`), not a `packages/contracts` schema addition — mirrors 4.2's Q3 (test/harness-only locale PII patterns, no contracts edit, no ADR). Reversible; 3.10 can move the data into a real per-market pack later without changing the guard's call shape.
- **Q2 The `pre`-phase `Ctx` type is shared by every guard the registry will ever hold in that phase** (one `ctx` argument for the whole chain). *Recommend:* 4.3 defines `PreGuardCtx` now (first to land); 4.4's planner reads it and extends/reuses rather than redefining. Not a blocker today since 4.4 hasn't started.
- **Q3 `ModelGateway.generateObject` has no usage-reporting channel** (unlike `stream`'s `{type:'usage'}` chunks), so no classifier-based guard can report `Usage` today. *Recommend:* ship `usage: []` for the classifier branch (matches the type as given); log this as a shared, pre-existing contracts gap (affects 4.3, 4.4, and the future `route` step alike) for a follow-up task, not a fix inside this one.
- **Q4 No trust-console UI exists yet to acknowledge an alert.** *Recommend:* a real (not stubbed) Redis `AckStore` now, so every alert escalates at 15 minutes until a later task wires a UI to call `acknowledge` — safe-by-default, not a blocker.
- **Q5 No vendor is wired for real trust-team/on-call delivery (email/Slack).** *Recommend:* the same structured-log stand-in `apps/worker/src/alarms/logSink.ts` already uses and already names as a shared gap with 4.3; one later decision wires both.
- **Q6 Scope of "100% of distress cases escalate" against the 39 seeded cases.** *Recommend:* an additive `must_escalate` field on `packages/evals`'s own (non-frozen) case schema, set on the 39 YAML files, checked by a dedicated offline pipeline test — not a full `EvalAgent`/live-judge wiring (which 4.0 and 4.2 both deliberately left for later). This is larger than 4.2's own scope call, flagged explicitly since the task's "Must cover" list asks for assertions added to the case files themselves.

## Decisions to log on merge
- `risk: high`: new `distressDetect` guard and alert-delivery pipeline (two risk-paths.txt safety groups), reviewed by safety-reviewer, merged by the lead.
- Q1-Q6 above, once the lead confirms (Q6 has the biggest scope consequence).
- Distress keywords and the India helpline fixture stay harness-internal/test-only until 3.10.
- `apps/worker/src/alerts/`'s `AckStore` is real but unreachable by any UI yet; delivery notification is a log stand-in pending a vendor decision (same gap as the cost alarm).

## Lead answers and plan revisions from the safety plan review (19 Oct 2026; these override the Design section)

Context: the pilot is English-only with a Hindi/Hinglish safety net (human decision, 18 Oct 2026). 4.2's fix round adds a raw-text distress keyword boolean before scrub, because the name heuristic can redact distress words. 4.3 owns the real keyword matcher behind that seam; reuse it, don't duplicate it.

1. **Every language table, always (CRITICAL).** `hasDistressKeyword` checks the English, romanised-Hindi and Devanagari tables whatever `lang` is. Test all 39 cases with `lang: 'en'`.
2. **Normalise before matching (HIGH).** Apply NFKC, strip `\p{Cf}` and ZWJ/ZWNJ, casefold, map curly apostrophes, collapse whitespace and punctuation between single letters ("k i l l", "k.i.l.l"), squash repeated letters, and map common leetspeak (0/1/3/@/$). Never add the obfuscated eval strings themselves to the table.
3. **Hard and soft lists (HIGH).** A hard keyword escalates immediately. A soft keyword asks the classifier, and a soft hit plus a classifier throw, timeout or parse failure escalates.
4. **Alerts are never lost (HIGH).** `queuedAlertSink.raise` enqueues `escalate_check` together with or before `alert.raise`. Alert jobs get unlimited (or very high) attempts, with backoff capped at 30–60 s. `escalate_check` re-notifies on_call and reschedules every 15 minutes until acked. The int test covers a notifier that fails more than 5 times.
5. **The eval can't be satisfied by the classifier script (HIGH).** Run all 33 distress cases twice, once with the classifier scripted `false` and once with it throwing or timing out, and require 33/33 escalations both times. Near-misses: assert no hard-keyword hit, and report them as a separate ≥ 99% score.
6. **Logs carry no excerpt (HIGH).** The log sink writes id, kind, level, the student, teacher and session ids, audience and createdAt, and never `excerptRedacted`. The guard's excerpt is ≤ 160 characters, taken from scrubbed text only.
7. **Caring reply (MEDIUM).** Start from the `LAST_RESORT_DISTRESS_REPLY` wording and add the pack's helplines. It says it is an AI, doesn't promise to stay, keeps "someone you trust", and contains no ids, "alert" or "trust team". English only (pilot decision).
8. **Multi-turn (MEDIUM).** The classifier also sees the last 2–3 scrubbed student turns. Turn 1 of the midtask cases gets `must_escalate: false`. A session distress flag (retract-joke check-in) is follow-up board task 4.3b.
9. **Over-escalation (MEDIUM).** Use phrase-level patterns with `\p{L}\p{M}`-aware lookarounds under `/u`, and a negative test list ("kill -9", "skill", "diet", "die roll", "loop khatam", "laptop hangs", "cut the string"). Keep a held-out paraphrase set so the table isn't fitted to the 33 seeds.
10. **Eval schema (MEDIUM).** The generic runner fails on any check it doesn't implement, so `must_escalate` can't pass silently. distressEscalate.test.ts also runs each case's `matches`/`must_not_contain` against the reply.
11. **preGuard (LOW).** Map a chain `block` to `{ result: 'block' }` and throw only on `failed`, so 4.4's moderation blocks aren't hidden as framework failures.
12. **Idempotency (LOW).** Correct the plan's claim; test "at most one pending escalate_check".
13. **Scrub-failure distress reply (LOW).** Follow-up: use `fallbackReplies.distress` with pack helplines (board task 4.3b).
- Reviewers: safety-reviewer (opus, required), typescript-reviewer (sonnet), silent-failure-hunter (sonnet). risk: high entries.
- Build: tdd-guide on opus. If 4.2 hasn't merged when you start, branch from main and rebase onto it once it lands. The raw-text keyword seam is shared, so coordinate through it.
