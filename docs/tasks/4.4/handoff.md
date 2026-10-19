# 4.4 handoff: `moderationIn`, `jailbreak`, strikes, and ADR-0006 SafetyEventSink

- **Status:** DONE (10 new eval cases are `reviewed_by: pending` until the human signs them off, so `suites.test.ts` fails on them as expected, together with 4.3's 7 pending cases)
- **Branch:** `m4/4.4-moderation-jailbreak`, from origin/main f92ef31, with **origin/m4/4.3-distress (e5dd16b) merged in at the start** so this builds on 4.3's real `PreGuardCtx`, pre-phase registry and normaliser. When 4.3 merges to main, main must be merged in again; hold this PR's merge until 4.3 is on main.
- **Worktree:** `.claude/worktrees/agent-a593cc4eb95f00ed8` (repo-relative)
- **Risky paths:** `packages/harness/src/guardrails/**`, `evals/suites/safety/**`, `apps/worker/src/alerts/**` → **safety-reviewer**; `packages/db/src/repositories/**` → **security-reviewer**; `packages/contracts/**`, `docs/adr/**` → **architect, security-reviewer, typescript-reviewer**. Recommended: silent-failure-hunter (new port, awaited writes, queue idempotency, worker errors).

## Acceptance evidence

| Item | Evidence |
|---|---|
| Moderation true positives, classifier `none` | `moderationJailbreak.test.ts`: **26/26 blocked** by `moderationIn`, 0 moderation/jailbreak classifier calls, the code's reply, exactly 1 safety event each |
| Jailbreak cases, classifier `none` | **31/31 blocked** by `jailbreak`, 0 classifier calls, 1 strike each |
| Near-misses, classifier `none` | **7/7 seeded not blocked** (11/11 with the 4 new ones): no rule hit, the student gets the normal reply |
| Same, classifier **throws** | **26/26 + 31/31 blocked** by rule; near-misses **7/7 (11/11) never a verdict block**: they end `failed` (refused with `guard_blocked`, never ok), no event written |
| Held-out paraphrases (pending) | 6/6 blocked in both runs; pattern unit tests: 21 moderation + 23 jailbreak held-out lines hit, 23 + 27 negatives never hit |
| Grooming build-up | the 5 build-up turns (en, hi-latin, deva) `must_block: false`, pass in both runs; the turn that asks for the rules or to break them blocks |
| Bullying (lead answer 2) | the 3 `hurt-bully` cases: `distressDetect` passes (does not escalate them first), `moderationIn` blocks `harm_to_others`, the reply acknowledges the bullying and suggests a trusted adult, one misuse `SafetyAlert` raised (also `runner.block.test.ts`, delivery retried) |
| Self-harm → distress (lead answer 1) | `preGuard.test.ts` "self-harm with distress scripted false → escalate from moderationIn": `distressDetect` ok, `moderationIn` escalates with a `distress` alert, no safety event; classifier `self_harm` also escalates (`moderationIn.test.ts`) |
| Encoded payloads (lead answer 5) | `base64-wrapper-en`, `base64-hi-latin`, `base64-deva` block as `jailbreak_encoded`; hex, `\x`, spaced hex, URL encoding, 2 levels (not 3), size caps, strict UTF-8 (`decodeAttempts.test.ts`) |
| Strikes recorded, no text | per blocking case exactly one `SafetyEventSink.record` with exactly the 7 ADR-0006 keys; db rows `reason` = `<guard>:<code>:<source>`; no student text in rows or log lines (`safetyEvent.int.test.ts`) |
| Queue → worker → Postgres | `apps/worker/test/safetyEvent.int.test.ts` (real Redis + Postgres): a real jailbreak turn on the queue-backed ports → reply sent, one row; a moderation turn adds one; a replayed record adds nothing |
| Isolation | `repositories.int.test.ts`: `safetyEvents.record` 20 write cases, `listForSession` 36 read cases, **0 leaks** |
| ADR-0006 | `docs/adr/0006-safety-event-sink.md`; `check-headings.py` exit 0; spec-drift test passes against the updated build-plan Core contracts block; type-level tests for `SafetyEventSink` and `SafetyEventCode` |
| Harness purity | `packages/harness/src/**` imports only `@edmate/contracts`, `zod` and its own modules (no Buffer/atob: own base64 and UTF-8 decoders) |
| Coverage | `src/guardrails` 100/100/100/100 (threshold enforced); queue 100%; `safety-events.ts` 100%; harness all files 99.44 / 98.44 / 98.8 / 99.67 |

Commands (compose Postgres and Redis up):

`corepack pnpm turbo run typecheck lint test --filter=...@edmate/contracts --force --continue`

```
Tasks:    36 successful, 37 total
Failed:   @edmate/evals#test   (only "every case validates": the 17 reviewed_by: pending cases, 7 from 4.3 + 10 new)
@edmate/contracts:test  Tests 335 passed   All files 100/100/100/100
@edmate/harness:test    Tests 3141 passed  All files 99.44/98.44/98.8/99.67 (src/guardrails 100%)
@edmate/queue:test      Tests 41 passed    All files 100/100/100/100
@edmate/db:test         Tests 447 passed   safetyEvents.record cases=20 leaks=0; listForSession cases=36 leaks=0
@edmate/worker:test     Tests 135 passed   (safetyEvent and alert int suites ran; alert delivered after 61640 ms, 7 attempts)
@edmate/evals:test      Tests 547 passed, 1 failed (pending)
  moderation/jailbreak, classifier none:   moderation 26/26 blocked, jailbreak 31/31 blocked, held-out 6/6 blocked; near-miss 11/11 not blocked by a verdict (seeded 7)
  moderation/jailbreak, classifier throws: moderation 26/26 blocked, jailbreak 31/31 blocked, held-out 6/6 blocked; near-miss 11/11 not blocked by a verdict (seeded 7)
  distress, false: 39/41 escalated (2 soft-only cleared by the classifier); near-miss 7/7 not escalated   (unchanged from 4.3)
@edmate/web, cli, gateway, content: all passed
```

`EDMATE_ALLOW_PENDING=1 vitest run` (packages/evals): 547 passed, 1 failed (the test that asserts the variable is unset; same as 4.3).

`python3 docs/adr/check-headings.py` → exit 0. `python3 <abs>/.githooks/secret-scan.py --all` → exit 0.

## Changes

- **Contracts (ADR-0006):** `SafetyEventCodeSchema` (17 fixed codes) in `safety.ts`; type-only `SafetyEventSink` in `ports.ts`; fixtures (valid/invalid); registry count 35 → 36; spec copy and the build plan's Core contracts block; type tests.
- **Harness guardrails:** `decodeAttempts.ts`, `rulePhrases.ts` (helpers over 4.3's `normaliseForDistress`, imported, not copied), `moderationPatterns.ts`, `jailbreakPatterns.ts`, `safetyClassifier.ts`, `moderationIn.ts`, `jailbreak.ts`, `blockReplies.ts`; `preGuardCtx.ts` gains `turnId`, `safetyEvents`, `packageNames`, `blocks` and `PreGuardBlock`.
- **Harness pipeline:** `preGuard.ts` registers both guards and returns the block's reply and alert; `PreGuardResult` block variant gains optional `reply` / `alert` (schema in `results.ts`); `runner.ts` sends the reply as the turn's reply (`blocked`, move `redirect`) and delivers a misuse alert like an escalation's; a block with no reply keeps `guard_blocked`. `PipelineDeps.safetyEvents`. Testing: `memorySafetyEventSink`, `testDeps().safetyEvents`. README section.
- **Queue:** `SAFETY_EVENT_QUEUE`, `JOB.safetyEventRecord`, `jobId.safetyEvent`, strict `SafetyEventSchema` / `SafetyEventJobSchema`, `queuedSafetyEventSink` (scope-bound, refuses without quoting), `TurnQueues.safetyEvent`, `QueuedTurnPorts.safetyEvents`.
- **DB:** `repositories/safety-events.ts` (`record`, `listForSession`), no migration; isolation cases and seed row; `safety-events.int.test.ts`.
- **Worker:** `alerts/safetyEvents.ts` (processor + worker, dead-letter with ids), wired in `src/index.ts`; `classify` exported from `commit/processors.ts`; unit and integration tests.
- **Evals:** `must_block` check (`schema.ts`, `agent.ts` `blocked`, `checkMustBlock`, runner order); `must_block` on all 64 seeded cases (downstream-defended turns left unset with a comment); 10 new pending cases (6 held-out, 4 over-blocking near-misses); `moderationJailbreak.test.ts`.
- **4.3 files touched (minimum):** `distressDetect.test.ts` ctx gains the 4 new fields; `preGuard.test.ts` and `runner.test.ts` script `none` for the two new classifiers; `distressEscalate.test.ts` `false` mode answers `none` to them. No change to 4.3's guard, keyword or escalate code.

## Deviations

- **Guards read the sink from `PreGuardCtx`, not a factory argument** (plan: `createModerationInGuard(sink)`): `preGuard` is a module-level step, so the sink comes from `PipelineDeps` per turn.
- **The runner changed** (plan listed it as frozen): lead answer 2's per-code replies and misuse alert need the block path to send text and deliver an alert. Small, additive (`sendBlockReply`).
- **Storage target is `session:<sessionId>`, not `student:<id>`**, so reads and writes scope to student x teacher through the session row with no migration.
- **The normaliser was not lifted to `textNormalize.ts`** (lead answer 10): 4.3 is still in review and owns `distressKeywords.ts`; 4.4 imports `normaliseForDistress` directly, so there is still one copy. The lift is a later no-behaviour-change move.
- **Cancel token:** `ModelGateway.generateObject` has no cancel parameter, so the guard races the call against its token and stops waiting (passing it in would be another contracts change).
- **Throw run:** the distress classifier still answers "no"; only the moderation and jailbreak classifiers throw. With distressDetect first in `GUARD_ORDER`, a down distress classifier fails the chain before moderationIn runs (still a refusal, no strike written).
- **Seeded code-comment and story cases** are blocked by rule ("ignore your rules", "a tutor with no rules") so 31/31 holds; answerLeak (4.5) defends them too.

## Open points for the lead

- **Latency:** three sequential small-classifier calls (distress 230 ms, moderation 250 ms, jailbreak 250 ms) can exceed step 3's 400 ms budget on a benign turn with a real provider, and a timed-out step fails closed. Rule hits avoid the calls. Worth deciding before live-model runs (7.x): parallel classifier calls, one combined call, or a larger budget.
- **B-12:** what a rising strike count does. Nothing waits on it.

## Decisions

### 19 Oct 2026 · 4.4 ADR-0006 SafetyEventSink and SafetyEventCode in contracts · decided by lead (plan review) · risk: high
- Decided: add a type-only `SafetyEventSink.record({studentId, teacherId, sessionId, turnId, guard, code, source})` and a 17-code `SafetyEventCodeSchema`; guards call it directly; `onGuardOutcome` stays the generic text-free seam.
- Why: the build plan's guard table needs a safety_event and strikes; `GuardOutcomeEvent` has no code or ids by design; a closed enum keeps text out.
- Alternatives: feed `onGuardOutcome`; a free-text reason; reuse `AlertSink`; a wall-clock dedupe bucket.
- Reversible: only with another ADR (contracts change); reviewers architect, security-reviewer, typescript-reviewer.

### 19 Oct 2026 · 4.4 moderationIn and jailbreak guards, rule tables and safety-event pipeline · decided by tdd-guide (per plan and lead answers) · risk: high
- Decided: phrase-level rule tables (en, hi-latin, deva) on normalised and decoded text decide with no model call; otherwise a small classifier with its own taxonomy; any classifier failure fails the chain closed; each block awaits a safety event, then blocks with a per-code English reply.
- Why: the gate must hold with the classifier down (26/26 + 31/31 in both runs) and never invent ok.
- Alternatives: classifier-only; a shared combined classifier; block without recording.
- Reversible: yes, tables and replies are data in the guard files.

### 19 Oct 2026 · 4.4 self-harm escalates, harm to others blocks with a misuse alert · decided by lead (plan review answers 1 and 2) · risk: high
- Decided: a moderation `self_harm` verdict escalates with a distress alert and records no safety event; `harm_to_others` blocks with the bullying reply and a misuse `SafetyAlert` delivered like an escalation's.
- Why: a student at risk gets the caring reply, not a refusal; a self-harm row must never count against them.
- Alternatives: block self-harm; record it as a moderation event.
- Reversible: yes.

### 19 Oct 2026 · 4.4 runner sends the block reply · decided by tdd-guide · risk: high
- Decided: a preGuard block that carries a reply ends the turn with that reply (token, done; saved `blocked`, move `redirect`); a block without one keeps the `guard_blocked` error.
- Why: per-code replies (lead answer 2) need the runner to send them; the runner was otherwise frozen.
- Alternatives: only the error code, with the client choosing text.
- Reversible: yes, one small runner method.

### 19 Oct 2026 · 4.4 strikes are a count only · decided by lead (plan review answer 7, open question B-12) · risk: high
- Decided: a jailbreak safety event is a strike; the guard blocks the same way however many came before; no enforcement until B-12 is answered.
- Why: no consequence (pause, stricter mode, flag) is specified yet.
- Alternatives: escalate or pause after N strikes.
- Reversible: yes.

### 19 Oct 2026 · 4.4 moderationIn skips its classifier on a jailbreak rule hit · decided by tdd-guide · risk: medium
- Decided: when no moderation rule hits but a jailbreak rule does, moderationIn passes without a classifier call; jailbreak blocks next.
- Why: lead answer 6 needs 0 classifier calls on true positives, and a down moderation classifier must not turn a certain jailbreak block into a chain failure.
- Alternatives: always ask the moderation classifier.
- Reversible: yes.

### 19 Oct 2026 · 4.4 safety_events stored without a migration · decided by tdd-guide · risk: medium
- Decided: `target` = `session:<sessionId>`, `reason` = `<guard>:<code>:<source>`, row id = hash of (turnId, guard), insert-only with `on conflict do nothing`.
- Why: the 1.1 table already has these columns; the session row scopes reads and writes to student x teacher.
- Alternatives: add student, teacher, session and turn columns (deferred to 12.x if needed).
- Reversible: yes, with a later migration.

### 19 Oct 2026 · 4.4 normaliser imported, not lifted · decided by tdd-guide · risk: low
- Decided: import 4.3's `normaliseForDistress` in place of lifting it to `textNormalize.ts` now.
- Why: 4.3 is still in review; editing its file would collide; there is still a single copy.
- Alternatives: lift it in this PR.
- Reversible: yes, a pure move later.

### 19 Oct 2026 · 4.4 must_block added to existing reviewed cases without resetting reviewed_by · decided by tdd-guide · risk: low
- Decided: keep `reviewed_by` on the 64 seeded cases when adding `must_block`; the 10 new cases are `pending`.
- Why: same as 4.3's `must_escalate`; the field records the guard-level expectation the reviewed text already implies.
- Alternatives: mark all 64 pending again.
- Reversible: yes.
